// Yerel yazma işlemleri. Arayüz veriyi SADECE bu fonksiyonlarla değiştirir.
// Her fonksiyon tek bir transaction içinde:
//   1) satırı yazar (HLC damgasıyla),
//   2) outbox'a "bu satır değişti" kaydı ekler,
//   3) HLC saatinin son hâlini saklar.
// Böylece "veri yazıldı ama outbox'a eklenmedi" gibi yarım durumlar oluşmaz.
import { v5 as uuidv5 } from "uuid";
import { isCardSchedField, type SyncTable } from "@/lib/sync/tables";
import type { LocalDB, RecordedChange } from "./database";
import type { BaseRow, CardRow, OutboxEntry, TableRowMap } from "./types";

type Row<T extends SyncTable> = TableRowMap[T];
/** Ekleme için: ortak alanlar opsiyonel, diğerleri tablo varsayılanlarıyla tamamlanır */
export type NewRow<T extends SyncTable> = Partial<Row<T>>;

export function newId(): string {
  return crypto.randomUUID();
}

/** Aynı girdiden her cihazda aynı UUID'yi üretir (ör. ayar anahtarı, resim hash'i). */
export function deterministicId(name: string, userId: string): string {
  return uuidv5(name, userId);
}

// Tablo bazında varsayılan değerler (sunucudaki varsayılanlarla aynı)
const DEFAULTS: { [T in SyncTable]: Omit<Row<T>, keyof BaseRow | "sched_updated_at"> } = {
  deck_configs: { name: "Varsayılan", config: {} },
  decks: {
    name: "Yeni deste",
    parent_id: null,
    config_id: null,
    description: "",
    collapsed: false,
    is_filtered: false,
    filter: null,
  },
  note_types: {
    name: "Yeni not tipi",
    kind: "standard",
    fields: [],
    templates: [],
    css: "",
    sort_field: null,
    word_field: null,
  },
  notes: { note_type_id: "", guid: "", fields: {}, tags: [], sort_field: "" },
  note_examples: {
    note_id: "",
    text: "",
    translation: null,
    source: "user",
    approved: true,
    position: 0,
  },
  cards: {
    note_id: "",
    deck_id: "",
    ord: 0,
    state: 0,
    step: 0,
    due: 0,
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: 0,
    lapses: 0,
    last_review: null,
    ease: 2500,
    interval_days: 0,
    last_example_id: null,
    flags: 0,
    suspended: false,
    buried_until: null,
    original_deck_id: null,
    original_due: null,
    position: 0,
  },
  review_logs: {
    card_id: "",
    note_id: null,
    deck_id: null,
    reviewed_at: 0,
    rating: 0,
    kind: 0,
    state: null,
    due: null,
    stability: null,
    difficulty: null,
    elapsed_days: null,
    last_elapsed_days: null,
    scheduled_days: null,
    interval_before: null,
    interval_after: null,
    ease: null,
    duration_ms: 0,
  },
  media: {
    hash: "",
    filename: "",
    mime: "application/octet-stream",
    size: 0,
    storage_path: null,
    uploaded_at: null,
  },
  app_settings: { key: "", value: null },
};

function outboxEntry(table: SyncTable, id: string, hlc: string): OutboxEntry {
  return { key: `${table}:${id}`, table, id, hlc, failed_hlc: null, error: null };
}

/** Geri alma kaydı açıksa satırın önceki/sonraki hâlini not eder */
// Resim kayıtları (yükleme durumu) ve ayarlar geri alınmaz: arka plandaki
// eşleme bunları bir işlemin ortasında değiştirebilir.
const NOT_RECORDED: ReadonlySet<SyncTable> = new Set<SyncTable>(["media", "app_settings"]);

function record(db: LocalDB, table: SyncTable, before: BaseRow | undefined, after: BaseRow) {
  const rec = db.recorder;
  if (!rec || NOT_RECORDED.has(table)) return;
  const key = `${table}:${after.id}`;
  const prev = rec.get(key);
  rec.set(key, {
    table,
    id: after.id,
    before: (prev ? prev.before : before) as RecordedChange["before"],
    after: after as RecordedChange["after"],
  });
}

/** Bir transaction içinde: satırları yaz + outbox + HLC durumunu sakla */
async function writeRows<T extends SyncTable>(db: LocalDB, table: T, rows: Row<T>[]) {
  await db.transaction("rw", [db.table(table), db.outbox, db.sync_state], async () => {
    if (db.recorder) {
      const before = await db.syncTable(table).bulkGet(rows.map((r) => r.id));
      rows.forEach((r, i) => record(db, table, before[i], r));
    }
    await db.syncTable(table).bulkPut(rows);
    await db.outbox.bulkPut(rows.map((r) => outboxEntry(table, r.id, changedHlc(r))));
    await db.sync_state.put({ key: "hlc", value: db.clock.current() });
  });
  db.emitLocalChange();
}

/** Yeni satırlar ekler. Eksik alanlar varsayılanlarla doldurulur. */
export async function insertRows<T extends SyncTable>(
  db: LocalDB,
  table: T,
  partials: NewRow<T>[],
): Promise<Row<T>[]> {
  const now = db.now();
  const rows = partials.map((partial) => {
    const hlc = db.clock.tick();
    const row = {
      ...DEFAULTS[table],
      ...partial,
      id: partial.id ?? newId(),
      user_id: db.userId,
      created_at: partial.created_at ?? now,
      updated_at: hlc,
      deleted_at: partial.deleted_at ?? null,
    } as Row<T>;
    if (table === "cards") (row as CardRow).sched_updated_at = hlc;
    return row;
  });
  await writeRows(db, table, rows);
  return rows;
}

export async function insertRow<T extends SyncTable>(db: LocalDB, table: T, partial: NewRow<T>): Promise<Row<T>> {
  const [row] = await insertRows(db, table, [partial]);
  return row;
}

/** Yamadan kimlik/damga alanlarını çıkarır */
function cleanPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = { ...patch };
  for (const k of ["id", "user_id", "created_at", "updated_at", "server_seq", "sched_updated_at"]) delete clean[k];
  return clean;
}

/** Bir satıra yamayı uygular; kartlarda değişen gruba göre damga basar */
function applyPatch<T extends SyncTable>(db: LocalDB, table: T, existing: Row<T>, clean: Record<string, unknown>): Row<T> {
  const hlc = db.clock.tick();
  const next = { ...existing, ...clean } as Row<T>;
  if (table === "cards") {
    const keys = Object.keys(clean);
    if (keys.some(isCardSchedField)) (next as CardRow).sched_updated_at = hlc;
    if (keys.some((k) => !isCardSchedField(k)) || keys.length === 0) next.updated_at = hlc;
  } else {
    next.updated_at = hlc;
  }
  return next;
}

function changedHlc(row: BaseRow): string {
  const card = row as Partial<CardRow>;
  return card.sched_updated_at && card.sched_updated_at > row.updated_at ? card.sched_updated_at : row.updated_at;
}

/**
 * Var olan bir satırı günceller. Kartlarda hangi alan grubunun değiştiğine
 * bakılır: zamanlama alanları değiştiyse sched_updated_at, diğerleri
 * değiştiyse updated_at yeni damga alır.
 */
export async function updateRow<T extends SyncTable>(
  db: LocalDB,
  table: T,
  id: string,
  patch: Partial<Row<T>>,
): Promise<Row<T> | undefined> {
  const [row] = await updateRows(db, table, [{ id, patch }]);
  return row;
}

/**
 * Birçok satırı TEK transaction'da günceller (toplu işlemler için hızlı).
 * Bulunamayan satırlar atlanır. Güncellenen satırları döndürür.
 */
export async function updateRows<T extends SyncTable>(
  db: LocalDB,
  table: T,
  patches: { id: string; patch: Partial<Row<T>> }[],
): Promise<Row<T>[]> {
  if (!patches.length) return [];
  const out: Row<T>[] = [];
  await db.transaction("rw", [db.table(table), db.outbox, db.sync_state], async () => {
    const existing = await db.syncTable(table).bulkGet(patches.map((p) => p.id));
    const next: Row<T>[] = [];
    patches.forEach((p, i) => {
      const row = existing[i];
      if (!row) return;
      const updated = applyPatch(db, table, row, cleanPatch(p.patch as Record<string, unknown>));
      record(db, table, row, updated);
      next.push(updated);
    });
    if (!next.length) return;
    await db.syncTable(table).bulkPut(next);
    await db.outbox.bulkPut(next.map((r) => outboxEntry(table, r.id, changedHlc(r))));
    await db.sync_state.put({ key: "hlc", value: db.clock.current() });
    out.push(...next);
  });
  if (out.length) db.emitLocalChange();
  return out;
}

/** Siler (tombstone): satır kalır, deleted_at dolar. Silme de eşlenir. */
export async function softDeleteRows(db: LocalDB, table: SyncTable, ids: string[]): Promise<void> {
  if (table === "review_logs") throw new Error("Cevap geçmişi silinemez");
  const now = db.now();
  await updateRows(db, table, ids.map((id) => ({ id, patch: { deleted_at: now } as Partial<Row<typeof table>> })));
}

/** "Geri al": cevap geçmişi kaydını silindi olarak işaretler (içerik değişmez). */
export async function retractReviewLog(db: LocalDB, id: string): Promise<void> {
  await updateRow(db, "review_logs", id, { deleted_at: db.now() });
}

/** Kullanıcı ayarı yazar (her ayar ayrı satır; id = uuidv5(key, userId)). */
export async function setSetting(db: LocalDB, key: string, value: unknown) {
  const id = deterministicId(`setting:${key}`, db.userId);
  const existing = await db.app_settings.get(id);
  if (existing) return updateRow(db, "app_settings", id, { value, deleted_at: null });
  return insertRow(db, "app_settings", { id, key, value });
}

export async function getSetting<V>(db: LocalDB, key: string, fallback: V): Promise<V> {
  const row = await db.app_settings.get(deterministicId(`setting:${key}`, db.userId));
  return row && row.deleted_at === null ? (row.value as V) : fallback;
}
