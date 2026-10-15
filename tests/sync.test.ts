// Senkron motoru senaryoları: iki (veya daha fazla) sanal cihaz internetsizken
// farklı değişiklikler yapar, sonra eşlenir. Sunucu gerçek Postgres'tir
// (PGlite) ve supabase/migrations altındaki SQL aynen çalıştırılır.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getSetting, insertRow, insertRows, retractReviewLog, setSetting, softDeleteRows, updateRow } from "@/lib/db/mutations";
import type { CardRow } from "@/lib/db/types";
import { MAX_MEDIA_BYTES, MediaRejectedError, addMediaFile, getMediaData } from "@/lib/sync/media";
import { toSyncError } from "@/lib/sync/transport";
import { createTestClient, syncAll, TestTime } from "./helpers/client";
import { TestServer } from "./helpers/server";

let server: TestServer;
let time: TestTime;
let uid: string;

beforeAll(async () => {
  server = await TestServer.create();
});
afterAll(async () => {
  await server.pg.close();
});
beforeEach(async () => {
  await server.reset();
  time = new TestTime();
  uid = await server.addUser("ali@example.com");
});

const MIN = 60_000;

async function twoDevices() {
  const a = await createTestClient(server, uid, time, { name: "telefon" });
  const b = await createTestClient(server, uid, time, { name: "bilgisayar" });
  return { a, b };
}

async function makeCard(db: Parameters<typeof insertRow>[0], extra: Partial<CardRow> = {}) {
  return insertRow(db, "cards", { note_id: crypto.randomUUID(), deck_id: crypto.randomUUID(), ...extra });
}

/** Basit bir "cevap verme" taklidi (Faz 1'de gerçek zamanlayıcı gelecek) */
async function review(db: Parameters<typeof insertRow>[0], card: CardRow, rating: number) {
  const now = db.now();
  const current = (await db.cards.get(card.id))!;
  await updateRow(db, "cards", card.id, {
    state: 2,
    reps: current.reps + 1,
    last_review: now,
    due: now + rating * 86_400_000,
    interval_days: rating,
  });
  await insertRow(db, "review_logs", {
    card_id: card.id,
    reviewed_at: now,
    rating,
    kind: 1,
    interval_before: current.interval_days,
    interval_after: rating,
    duration_ms: 4000,
  });
}

describe("temel eşleme", () => {
  it("internetsizken iki cihazda oluşturulan desteler eşlenince ikisinde de görünür", async () => {
    const { a, b } = await twoDevices();
    a.goOffline();
    b.goOffline();
    await insertRow(a.db, "decks", { name: "YDS Fiiller" });
    await insertRow(b.db, "decks", { name: "YDS İsimler" });
    expect(await a.db.outbox.count()).toBe(1);

    // internetsizken eşleme denemesi: hiçbir şey kaybolmaz, durum "offline"
    expect((await a.sync()).phase).toBe("offline");

    a.goOnline();
    b.goOnline();
    await syncAll(a, b);

    const names = async (c: typeof a) => (await c.db.decks.toArray()).map((d) => d.name).sort();
    expect(await names(a)).toEqual(["YDS Fiiller", "YDS İsimler"]);
    expect(await names(b)).toEqual(["YDS Fiiller", "YDS İsimler"]);
    expect(await a.db.outbox.count()).toBe(0);
    expect(await b.db.outbox.count()).toBe(0);
  });

  it("aynı satırdaki art arda değişiklikler outbox'ta tek kayıt olur", async () => {
    const { a, b } = await twoDevices();
    const deck = await insertRow(a.db, "decks", { name: "1" });
    for (let i = 2; i <= 5; i++) await updateRow(a.db, "decks", deck.id, { name: String(i) });
    expect(await a.db.outbox.count()).toBe(1);
    await syncAll(a, b);
    expect((await b.db.decks.get(deck.id))?.name).toBe("5");
  });

  it("yeni cihazda ilk giriş: tüm veri sayfa sayfa iner ve ilerleme bildirilir", async () => {
    const a = await createTestClient(server, uid, time, { name: "telefon", pushBatchSize: 40 });
    await insertRows(
      a.db,
      "decks",
      Array.from({ length: 250 }, (_, i) => ({ name: `Deste ${i}` })),
    );
    await a.sync();
    expect(await server.rawCount("decks")).toBe(250);

    const b = await createTestClient(server, uid, time, { name: "yeni-cihaz", pullPageSize: 100 });
    const seen: number[] = [];
    b.engine.subscribe((s) => s.progress && seen.push(s.progress.done));
    const status = await b.sync();
    expect(status.phase).toBe("idle");
    expect(status.initialSyncDone).toBe(true);
    expect(await b.db.decks.count()).toBe(250);
    expect(seen).toContain(100);
    expect(seen).toContain(250);
  });

  it("ayarlar anahtar bazında eşlenir: iki cihaz farklı ayarları değiştirirse ikisi de korunur", async () => {
    const { a, b } = await twoDevices();
    a.goOffline();
    b.goOffline();
    await setSetting(a.db, "dayStartHour", 5);
    await setSetting(b.db, "timezone", "Europe/Berlin");
    a.goOnline();
    b.goOnline();
    await syncAll(a, b);
    for (const c of [a, b]) {
      expect(await getSetting(c.db, "dayStartHour", 4)).toBe(5);
      expect(await getSetting(c.db, "timezone", "Europe/Istanbul")).toBe("Europe/Berlin");
    }
  });
});

describe("çakışmalar", () => {
  it("aynı deste iki cihazda internetsizken yeniden adlandırılırsa SONRA yapılan kazanır", async () => {
    const { a, b } = await twoDevices();
    const deck = await insertRow(a.db, "decks", { name: "Eski ad" });
    await syncAll(a, b);

    a.goOffline();
    b.goOffline();
    time.advance(MIN);
    await updateRow(b.db, "decks", deck.id, { name: "Bilgisayardaki ad" });
    time.advance(MIN);
    await updateRow(a.db, "decks", deck.id, { name: "Telefondaki ad" }); // daha sonra

    // Önce sonradan yapan eşlensin, sonra diğeri: sonuç yine "Telefondaki ad"
    a.goOnline();
    b.goOnline();
    await syncAll(a, b);
    expect((await a.db.decks.get(deck.id))?.name).toBe("Telefondaki ad");
    expect((await b.db.decks.get(deck.id))?.name).toBe("Telefondaki ad");
    expect((await server.rawRow("decks", deck.id))?.name).toBe("Telefondaki ad");
  });

  it("bir cihazda silinip diğerinde DAHA SONRA düzenlenen deste geri gelir (son yazan kazanır)", async () => {
    const { a, b } = await twoDevices();
    const deck = await insertRow(a.db, "decks", { name: "Deste" });
    await syncAll(a, b);
    a.goOffline();
    b.goOffline();
    time.advance(MIN);
    await softDeleteRows(a.db, "decks", [deck.id]);
    time.advance(MIN);
    await updateRow(b.db, "decks", deck.id, { name: "Deste (düzenlendi)" });
    a.goOnline();
    b.goOnline();
    await syncAll(a, b);
    for (const c of [a, b]) {
      const d = await c.db.decks.get(deck.id);
      expect(d?.deleted_at).toBeNull();
      expect(d?.name).toBe("Deste (düzenlendi)");
    }
  });

  it("bir cihazda düzenlenip diğerinde DAHA SONRA silinen deste silinmiş kalır", async () => {
    const { a, b } = await twoDevices();
    const deck = await insertRow(a.db, "decks", { name: "Deste" });
    await syncAll(a, b);
    a.goOffline();
    b.goOffline();
    time.advance(MIN);
    await updateRow(b.db, "decks", deck.id, { name: "Deste (düzenlendi)" });
    time.advance(MIN);
    await softDeleteRows(a.db, "decks", [deck.id]);
    b.goOnline();
    a.goOnline();
    await syncAll(b, a);
    for (const c of [a, b]) {
      expect((await c.db.decks.get(deck.id))?.deleted_at).not.toBeNull();
    }
    // satır sunucuda fiziksel olarak duruyor (tombstone)
    expect((await server.rawRow("decks", deck.id))?.deleted_at).not.toBeNull();
  });

  it("aynı karta iki cihazdan internetsizken cevap: iki cevap da geçmişte, zamanlama SONRAKİ tekrardan", async () => {
    const { a, b } = await twoDevices();
    const card = await makeCard(a.db);
    await syncAll(a, b);

    a.goOffline();
    b.goOffline();
    time.advance(MIN);
    await review(a.db, card, 1); // telefonda "Tekrar"
    time.advance(MIN);
    await review(b.db, card, 4); // bilgisayarda daha sonra "Kolay"
    a.goOnline();
    b.goOnline();
    await syncAll(a, b);

    for (const c of [a, b]) {
      const logs = await c.db.review_logs.where("card_id").equals(card.id).toArray();
      expect(logs.map((l) => l.rating).sort()).toEqual([1, 4]);
      const merged = (await c.db.cards.get(card.id))!;
      expect(merged.interval_days).toBe(4);
    }
    expect(await server.rawCount("review_logs")).toBe(2);
  });

  it("kart bir cihazda çalışılır, diğerinde destesi değiştirilirse ikisi de korunur", async () => {
    const { a, b } = await twoDevices();
    const card = await makeCard(a.db);
    await syncAll(a, b);
    const newDeck = crypto.randomUUID();

    a.goOffline();
    b.goOffline();
    time.advance(MIN);
    await updateRow(b.db, "cards", card.id, { deck_id: newDeck, flags: 3 }); // önce taşıma
    time.advance(MIN);
    await review(a.db, card, 3); // sonra (diğer cihazda) çalışma
    a.goOnline();
    b.goOnline();
    await syncAll(a, b);

    for (const c of [a, b]) {
      const merged = (await c.db.cards.get(card.id))!;
      expect(merged.deck_id).toBe(newDeck);
      expect(merged.flags).toBe(3);
      expect(merged.reps).toBe(1);
      expect(merged.interval_days).toBe(3);
    }
  });

  it("saati geri olan cihaz, gördüğü bir değişikliğin üstüne yazınca yine kazanır (HLC)", async () => {
    const a = await createTestClient(server, uid, time, { name: "telefon" });
    // bilgisayarın saati 1 saat geride
    const b = await createTestClient(server, uid, time, { name: "bilgisayar", skewMs: -60 * MIN });
    const deck = await insertRow(a.db, "decks", { name: "İlk" });
    await syncAll(a, b);

    time.advance(MIN);
    await updateRow(a.db, "decks", deck.id, { name: "Telefon" });
    await syncAll(a, b); // bilgisayar telefonun değişikliğini GÖRDÜ
    time.advance(MIN);
    await updateRow(b.db, "decks", deck.id, { name: "Bilgisayar" }); // gerçekte daha sonra
    await syncAll(b, a);

    expect((await a.db.decks.get(deck.id))?.name).toBe("Bilgisayar");
    expect((await b.db.decks.get(deck.id))?.name).toBe("Bilgisayar");
  });

  it("eşleme sürerken yapılan değişiklik kaybolmaz", async () => {
    const { a, b } = await twoDevices();
    const deck = await insertRow(a.db, "decks", { name: "v1" });
    // push sunucuda işlendikten hemen sonra (cevap gelmeden) kullanıcı tekrar düzenliyor
    let once = true;
    a.transport.afterPush = async () => {
      if (!once) return;
      once = false;
      time.advance(1000);
      await updateRow(a.db, "decks", deck.id, { name: "v2" });
    };
    await a.sync();
    // v1 onaylandı ama v2 kuyrukta kalmalı (motor tur bitince tekrar dener)
    await a.sync();
    await b.sync();
    expect((await b.db.decks.get(deck.id))?.name).toBe("v2");
    expect(await a.db.outbox.count()).toBe(0);
  });

  it("cevap kaybolursa (push sunucuya ulaştı ama yanıt gelmedi) tekrar gönderim çift kayıt oluşturmaz", async () => {
    const { a, b } = await twoDevices();
    const card = await makeCard(a.db);
    await review(a.db, card, 3);
    let fail = true;
    a.transport.afterPush = () => {
      if (fail) {
        fail = false;
        throw new TypeError("Failed to fetch");
      }
    };
    expect((await a.sync()).phase).toBe("offline");
    expect(await a.db.outbox.count()).toBeGreaterThan(0);
    await syncAll(a, b);
    expect(await server.rawCount("review_logs")).toBe(1);
    expect(await server.rawCount("cards")).toBe(1);
    expect(await b.db.review_logs.count()).toBe(1);
  });
});

describe("sunucu kuralları ve güvenlik", () => {
  it("cevap geçmişi değiştirilemez: aynı id ile gelen farklı kayıt yok sayılır", async () => {
    const a = await createTestClient(server, uid, time, { name: "telefon" });
    const card = await makeCard(a.db);
    await review(a.db, card, 3);
    await a.sync();
    const log = (await a.db.review_logs.toArray())[0];
    const res = await a.transport.push(
      [{ table: "review_logs", row: { ...log, rating: 1, updated_at: "999999999999999-00000-ffffffffffffffff" } }],
      "x",
    );
    expect(res.applied).toBe(0);
    expect((await server.rawRow("review_logs", log.id))?.rating).toBe(3);
  });

  it("geri alınan cevap her yerde silindi olarak işaretlenir, içeriği değişmez", async () => {
    const { a, b } = await twoDevices();
    const c = await makeCard(a.db);
    await review(a.db, c, 3);
    await syncAll(a, b);
    const log = (await a.db.review_logs.toArray())[0];
    await retractReviewLog(a.db, log.id);
    await syncAll(a, b);
    const serverRow = await server.rawRow("review_logs", log.id);
    expect(serverRow?.deleted_at).not.toBeNull();
    expect(serverRow?.rating).toBe(3);
    expect((await b.db.review_logs.get(log.id))?.deleted_at).not.toBeNull();
    // İçerik değiştirme denemesi yine reddedilir
    const res = await a.transport.push(
      [{ table: "review_logs", row: { ...log, rating: 1, deleted_at: 5, updated_at: "999999999999999-00000-ffffffffffffffff" } }],
      "x",
    );
    expect(res.applied).toBe(0);
    expect((await server.rawRow("review_logs", log.id))?.rating).toBe(3);
  });

  it("eski sürüm uygulama eksik sütunla gönderirse var olan değerler silinmez", async () => {
    const a = await createTestClient(server, uid, time, { name: "telefon" });
    const deck = await insertRow(a.db, "decks", { name: "Deste", description: "Önemli açıklama" });
    await a.sync();
    const res = await a.transport.push(
      [{ table: "decks", row: { id: deck.id, name: "Yeni ad", updated_at: "999999999999999-00000-ffffffffffffffff" } }],
      "x",
    );
    expect(res.applied).toBe(1);
    const row = await server.rawRow("decks", deck.id);
    expect(row?.name).toBe("Yeni ad");
    expect(row?.description).toBe("Önemli açıklama");
  });

  it("bir kullanıcı başkasının verisini göremez ve üstüne yazamaz", async () => {
    const a = await createTestClient(server, uid, time, { name: "ali" });
    const deck = await insertRow(a.db, "decks", { name: "Ali'nin destesi" });
    await a.sync();

    const veliId = await server.addUser("veli@example.com");
    const veli = await createTestClient(server, veliId, time, { name: "veli" });
    // Veli, Ali'nin deste id'siyle bir satır göndermeye çalışıyor
    const res = await veli.transport.push(
      [{ table: "decks", row: { ...deck, name: "Ele geçirildi", updated_at: "999999999999999-00000-ffffffffffffffff" } }],
      "x",
    );
    expect(res.applied).toBe(0);
    expect((await server.rawRow("decks", deck.id))?.name).toBe("Ali'nin destesi");
    expect((await server.rawRow("decks", deck.id))?.user_id).toBe(uid);
    // Veli pull yaptığında hiçbir şey görmez
    await veli.sync();
    expect(await veli.db.decks.count()).toBe(0);
  });

  it("davetle kayıt olmamış (profili olmayan) kullanıcı eşleme yapamaz", async () => {
    const strangerId = await server.addUser("yabanci@example.com", { member: false });
    const c = await createTestClient(server, strangerId, time, { name: "yabancı" });
    await insertRow(c.db, "decks", { name: "x" });
    const status = await c.sync();
    expect(status.phase).toBe("error");
    expect(status.errorKind).toBe("forbidden");
    expect(await server.rawCount("decks")).toBe(0);
  });

  it("sunucunun reddettiği hatalı bir satır diğerlerinin eşlenmesini engellemez", async () => {
    const { a, b } = await twoDevices();
    const good = await insertRow(a.db, "decks", { name: "Sağlam" });
    // Hatalı satır: zorunlu alan boş (ör. bir yazılım hatası)
    const bad = await insertRow(a.db, "notes", { note_type_id: null as unknown as string });
    const status = await a.sync();
    expect(status.phase).toBe("idle");
    expect(await server.rawRow("decks", good.id)).toBeDefined();
    const entry = await a.db.outbox.get(`notes:${bad.id}`);
    expect(entry?.error).toMatch(/null/);
    // Satır düzeltilince tekrar gönderilir
    await updateRow(a.db, "notes", bad.id, { note_type_id: crypto.randomUUID() });
    await syncAll(a, b);
    expect(await b.db.notes.get(bad.id)).toBeDefined();
    expect(await a.db.outbox.count()).toBe(0);
  });
});

describe("resimler", () => {
  it("aynı resim iki cihazda internetsizken eklenirse tek kayıt olur, yüklenir ve üçüncü cihaz indirebilir", async () => {
    const { a, b } = await twoDevices();
    const bytes = new TextEncoder().encode("sahte-png-icerigi").buffer as ArrayBuffer;
    a.goOffline();
    b.goOffline();
    const m1 = await addMediaFile(a.db, bytes, "kedi.png", "image/png");
    const m2 = await addMediaFile(b.db, bytes.slice(0), "kedi-kopya.png", "image/png");
    expect(m1.id).toBe(m2.id); // aynı içerik → aynı id
    expect(m1.uploaded_at).toBeNull();

    a.goOnline();
    b.goOnline();
    await syncAll(a, b);
    expect(await server.rawCount("media")).toBe(1);
    expect(server.storage.size).toBe(1);
    expect((await a.db.media.get(m1.id))?.uploaded_at).not.toBeNull();

    const c = await createTestClient(server, uid, time, { name: "tablet" });
    await c.sync();
    const got = await getMediaData(c.db, m1.hash, server.mediaFor(uid));
    expect(new TextDecoder().decode(got!.data)).toBe("sahte-png-icerigi");
    // artık cihazda: internetsiz de açılır
    c.goOffline();
    expect(await getMediaData(c.db, m1.hash, null)).not.toBeNull();
  });

  it("10 MB'tan büyük ya da resim olmayan dosya eklenmez", async () => {
    const { a } = await twoDevices();
    await expect(addMediaFile(a.db, new ArrayBuffer(MAX_MEDIA_BYTES + 1), "dev.png", "image/png")).rejects.toBeInstanceOf(
      MediaRejectedError,
    );
    await expect(addMediaFile(a.db, new ArrayBuffer(10), "ses.mp3", "audio/mpeg")).rejects.toBeInstanceOf(MediaRejectedError);
    expect(await a.db.media.count()).toBe(0);
  });

  it("sunucunun reddettiği bir resim, notların ve destelerin gönderilmesini engellemez", async () => {
    const { a } = await twoDevices();
    const bytes = new TextEncoder().encode("reddedilecek").buffer as ArrayBuffer;
    const m = await addMediaFile(a.db, bytes, "kedi.png", "image/png");
    await insertRow(a.db, "decks", { name: "Resimli deste" });
    a.media.upload = async () => {
      throw toSyncError({ message: "The object exceeded the maximum allowed size", statusCode: "413" });
    };

    const status = await a.sync();
    expect(status.phase).toBe("idle");
    expect(await server.rawCount("decks")).toBe(1); // deste yine gitti
    expect(await server.rawCount("media")).toBe(1); // resim satırı var ama yüklenmedi
    expect((await a.db.media.get(m.id))?.uploaded_at).toBeNull();
    expect((await a.db.media_blobs.get(m.hash))?.pending_upload).toBe(0); // kalıcı hata: tekrar denenmez
  });

  it("geçici sunucu hatasında resim sonra tekrar denenir; internet yoksa eşleme bekler", async () => {
    const { a } = await twoDevices();
    const bytes = new TextEncoder().encode("gecici").buffer as ArrayBuffer;
    const m = await addMediaFile(a.db, bytes, "kedi.png", "image/png");
    const realUpload = a.media.upload.bind(a.media);
    a.media.upload = async () => {
      throw toSyncError({ message: "Internal Server Error", statusCode: "500" });
    };
    expect((await a.sync()).phase).toBe("idle");
    expect((await a.db.media_blobs.get(m.hash))?.pending_upload).toBe(1); // sırada bekliyor

    a.media.upload = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect((await a.sync()).phase).toBe("offline");

    a.media.upload = realUpload;
    expect((await a.sync()).phase).toBe("idle");
    expect((await a.db.media.get(m.id))?.uploaded_at).not.toBeNull();
    expect(server.storage.size).toBe(1);
  });
});
