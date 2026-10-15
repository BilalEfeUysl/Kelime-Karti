// GERİ AL / YİNELE (çok seviyeli, işlem adıyla)
//
// Her işlem undo.run("İşlemin adı", async () => { ... }) içinde yapılır.
// Bu sürede yazma fonksiyonları (lib/db/mutations.ts) değişen her satırın
// ÖNCEKİ ve SONRAKİ hâlini kaydeder. Geri al = satırları önceki hâline
// döndürmek; bu da yeni bir değişiklik olarak yazılır ve normal şekilde eşlenir.
//
// Cevap geçmişi (review_logs) değiştirilemediği için özel durum:
//   geri al → kayıt "silindi" işaretlenir; yinele → aynı içerikle yeni kayıt.
// Yığın sadece bu oturumda (sayfa yenilenince sıfırlanır), en fazla 50 işlem.
import type { LocalDB, RecordedChange } from "@/lib/db/database";
import { insertRows, updateRows } from "@/lib/db/mutations";
import type { BaseRow, ReviewLogRow } from "@/lib/db/types";
import type { SyncTable } from "@/lib/sync/tables";

export const UNDO_LIMIT = 50;

export interface UndoMeta {
  /** Çalışma ekranı: geri alınca bu kart tekrar gösterilsin */
  cardId?: string;
}

export interface UndoStep {
  label: string;
  changes: RecordedChange[];
  meta?: UndoMeta;
}

export interface UndoEvent {
  type: "undo" | "redo";
  step: UndoStep;
}

type Listener = (event?: UndoEvent) => void;

const IGNORED = new Set(["id", "user_id", "created_at", "updated_at", "sched_updated_at", "server_seq"]);

function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/** Bir işlemi çalıştırır ve yaptığı değişiklikleri döndürür (iç içe çağrılarda dıştaki kaydeder). */
export async function recordChanges<T>(db: LocalDB, fn: () => Promise<T>): Promise<{ result: T; changes: RecordedChange[] }> {
  if (db.recorder) return { result: await fn(), changes: [] };
  const rec = new Map<string, RecordedChange>();
  db.recorder = rec;
  try {
    const result = await fn();
    return { result, changes: [...rec.values()] };
  } finally {
    db.recorder = null;
  }
}

/** Değişiklikleri tersine çevirir: her satırı "önceki" hâline döndürür. */
async function revert(db: LocalDB, changes: RecordedChange[]): Promise<void> {
  const patches = new Map<SyncTable, { id: string; patch: Record<string, unknown> }[]>();
  const add = (table: SyncTable, id: string, patch: Record<string, unknown>) => {
    if (!patches.has(table)) patches.set(table, []);
    patches.get(table)!.push({ id, patch });
  };
  const reinsertLogs: ReviewLogRow[] = [];
  const retractLogs: string[] = [];

  // Güncel satırları tablo başına tek seferde oku
  const currentRows = new Map<string, BaseRow | undefined>();
  const byTable = new Map<SyncTable, string[]>();
  for (const ch of changes) byTable.set(ch.table, [...(byTable.get(ch.table) ?? []), ch.id]);
  for (const [table, ids] of byTable) {
    const rows = await db.syncTable(table).bulkGet(ids);
    ids.forEach((id, i) => currentRows.set(`${table}:${id}`, rows[i] as BaseRow | undefined));
  }

  for (const ch of [...changes].reverse()) {
    const current = currentRows.get(`${ch.table}:${ch.id}`);
    if (!current) continue;
    if (ch.table === "review_logs") {
      const before = ch.before as ReviewLogRow | undefined;
      if (!before) {
        if (current.deleted_at === null) retractLogs.push(ch.id); // eklenmişti → silindi işaretle
      } else if (before.deleted_at === null && current.deleted_at !== null) {
        reinsertLogs.push(before); // silindi işaretlenmişti → aynısını yeniden ekle
      }
      continue;
    }
    if (!ch.before) {
      if (current.deleted_at === null) add(ch.table, ch.id, { deleted_at: db.now() });
      continue;
    }
    const patch: Record<string, unknown> = {};
    const before = ch.before as unknown as Record<string, unknown>;
    const now = current as unknown as Record<string, unknown>;
    for (const key of new Set([...Object.keys(before), ...Object.keys(now)])) {
      if (IGNORED.has(key)) continue;
      if (!same(before[key], now[key])) patch[key] = before[key] ?? null;
    }
    if (Object.keys(patch).length) add(ch.table, ch.id, patch);
  }

  for (const [table, list] of patches) await updateRows(db, table, list as never);
  if (retractLogs.length) {
    const at = db.now();
    await updateRows(db, "review_logs", retractLogs.map((id) => ({ id, patch: { deleted_at: at } })));
  }
  if (reinsertLogs.length) {
    await insertRows(
      db,
      "review_logs",
      reinsertLogs.map((l) => {
        const { id: _id, updated_at: _u, server_seq: _s, ...rest } = l;
        void _id;
        void _u;
        void _s;
        return { ...rest, deleted_at: null };
      }),
    );
  }
}

export class UndoManager {
  private undoStack: UndoStep[] = [];
  private redoStack: UndoStep[] = [];
  private listeners = new Set<Listener>();
  private busy = false;

  constructor(private readonly db: LocalDB) {}

  /** İşlemi çalıştırır; bir şey değiştiyse geri alma yığınına ekler. */
  async run<T>(label: string, fn: () => Promise<T>, meta?: UndoMeta): Promise<T> {
    const { result, changes } = await recordChanges(this.db, fn);
    if (changes.length) {
      this.undoStack = [...this.undoStack, { label, changes, meta }].slice(-UNDO_LIMIT);
      this.redoStack = [];
      this.emit();
    }
    return result;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }
  get canRedo() {
    return this.redoStack.length > 0;
  }
  get undoLabel(): string | null {
    return this.undoStack.at(-1)?.label ?? null;
  }
  get redoLabel(): string | null {
    return this.redoStack.at(-1)?.label ?? null;
  }

  async undo(): Promise<UndoStep | null> {
    return this.move(this.undoStack, this.redoStack, "undo");
  }

  async redo(): Promise<UndoStep | null> {
    return this.move(this.redoStack, this.undoStack, "redo");
  }

  private async move(from: UndoStep[], to: UndoStep[], type: UndoEvent["type"]): Promise<UndoStep | null> {
    if (this.busy) return null;
    const step = from.pop();
    if (!step) return null;
    this.busy = true;
    try {
      const { changes } = await recordChanges(this.db, () => revert(this.db, step.changes));
      to.push({ label: step.label, changes, meta: step.meta });
      if (to.length > UNDO_LIMIT) to.shift();
    } finally {
      this.busy = false;
    }
    this.emit({ type, step });
    return step;
  }

  subscribe(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private emit(event?: UndoEvent) {
    for (const l of this.listeners) l(event);
  }
}

const managers = new WeakMap<LocalDB, UndoManager>();

/** Veritabanı başına tek geri alma yöneticisi */
export function getUndoManager(db: LocalDB): UndoManager {
  let m = managers.get(db);
  if (!m) {
    m = new UndoManager(db);
    managers.set(db, m);
  }
  return m;
}
