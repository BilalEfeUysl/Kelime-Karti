// Testler için sanal Supabase sunucusu: gerçek Postgres (PGlite, WASM).
// supabase/migrations altındaki SQL dosyaları AYNEN çalıştırılır; böylece
// testler sadece TypeScript'i değil, sunucudaki SQL'i de doğrular.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PGlite, type Transaction } from "@electric-sql/pglite";
import type { MediaTransport, PulledRow, PushChange, PushResult, SyncTransport } from "@/lib/sync/transport";

const root = fileURLToPath(new URL("../../", import.meta.url));

export interface TestTransport extends SyncTransport {
  online: boolean;
  /** push sunucuda işlendikten SONRA çağrılır (ör. cevap kaybını taklit etmek için) */
  afterPush?: () => Promise<void> | void;
  pushCalls: number;
}

export class TestServer {
  /** Storage taklidi: yol → içerik */
  readonly storage = new Map<string, { data: ArrayBuffer; mime: string }>();

  private constructor(readonly pg: PGlite) {}

  static async create(): Promise<TestServer> {
    const pg = await PGlite.create();
    await pg.exec(readFileSync(`${root}tests/helpers/supabase-stubs.sql`, "utf8"));
    const dir = `${root}supabase/migrations/`;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      await pg.exec(readFileSync(dir + file, "utf8"));
    }
    return new TestServer(pg);
  }

  /** Yeni kullanıcı ekler. member=false ise profili yoktur (davetsiz kayıt). */
  async addUser(email: string, { member = true, role = "user" } = {}): Promise<string> {
    const id = crypto.randomUUID();
    await this.pg.query("insert into auth.users (id, email) values ($1, $2)", [id, email]);
    if (member) {
      await this.pg.query("insert into public.profiles (id, email, role) values ($1, $2, $3)", [id, email, role]);
    }
    return id;
  }

  /** Sorguyu "giriş yapmış kullanıcı" olarak çalıştırır (RLS devrede). */
  async asUser<T>(uid: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.pg.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: uid, role: "authenticated" }),
      ]);
      return fn(tx);
    });
  }

  /** Sunucudaki satırı (RLS olmadan) okur */
  async rawRow(table: string, id: string): Promise<Record<string, unknown> | undefined> {
    const res = await this.pg.query<Record<string, unknown>>(`select * from public.${table} where id = $1`, [id]);
    return res.rows[0];
  }

  async rawCount(table: string): Promise<number> {
    const res = await this.pg.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
    return res.rows[0].n;
  }

  transportFor(uid: string): TestTransport {
    const server = this;
    const offlineError = () => new TypeError("Failed to fetch");
    const t: TestTransport = {
      online: true,
      pushCalls: 0,
      async push(changes: PushChange[], deviceId: string): Promise<PushResult> {
        if (!t.online) throw offlineError();
        t.pushCalls += 1;
        const res = await server.asUser(uid, (tx) =>
          tx.query<{ r: PushResult }>("select public.push_changes($1::jsonb, $2) as r", [
            JSON.stringify(changes),
            deviceId,
          ]),
        );
        await t.afterPush?.();
        return res.rows[0].r;
      },
      async pull(since: number, limit: number): Promise<PulledRow[]> {
        if (!t.online) throw offlineError();
        const res = await server.asUser(uid, (tx) =>
          tx.query<PulledRow>("select tbl, seq, row_data from public.pull_changes($1, $2)", [since, limit]),
        );
        return res.rows.map((r) => ({ ...r, seq: Number(r.seq) }));
      },
      async pullCount(since: number): Promise<number> {
        if (!t.online) throw offlineError();
        const res = await server.asUser(uid, (tx) =>
          tx.query<{ n: number }>("select public.pull_count($1)::int as n", [since]),
        );
        return res.rows[0].n;
      },
      async syncShared(): Promise<number> {
        if (!t.online) throw offlineError();
        const res = await server.asUser(uid, (tx) => tx.query<{ n: number }>("select public.sync_shared_decks()::int as n"));
        return res.rows[0].n;
      },
    };
    return t;
  }

  /** Storage taklidi: kullanıcı sadece kendi klasörüne yazıp okuyabilir. */
  mediaFor(uid: string, isOnline: () => boolean = () => true): MediaTransport & { uploads: number } {
    const storage = this.storage;
    const m = {
      uploads: 0,
      async upload(path: string, data: ArrayBuffer, mime: string) {
        if (!isOnline()) throw new TypeError("Failed to fetch");
        if (!path.startsWith(`${uid}/`)) throw new Error("Storage: izin yok");
        m.uploads += 1;
        storage.set(path, { data, mime });
      },
      async download(path: string) {
        if (!isOnline()) throw new TypeError("Failed to fetch");
        if (!path.startsWith(`${uid}/`)) throw new Error("Storage: izin yok");
        const obj = storage.get(path);
        if (!obj) throw new Error("Storage: bulunamadı");
        return obj.data;
      },
    };
    return m;
  }

  /** Testler arasında her şeyi temizler. */
  async reset() {
    await this.pg.exec("truncate auth.users cascade;");
    this.storage.clear();
  }
}
