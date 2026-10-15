// Cihaz içi veritabanı (IndexedDB) — Dexie.js ile.
// Her kullanıcı için ayrı bir veritabanı açılır: "kelime-karti-<userId>".
// Böylece aynı cihazda iki hesap kullanılsa da veriler karışmaz.
import Dexie, { type DexieOptions, type Table } from "dexie";
import { HybridClock, randomNodeId } from "@/lib/sync/hlc";
import type {
  AppSettingRow,
  CardRow,
  DeckConfigRow,
  DeckRow,
  MediaBlobEntry,
  MediaRow,
  NoteExampleRow,
  NoteRow,
  NoteTypeRow,
  OutboxEntry,
  ReviewLogRow,
  SyncStateEntry,
  TableRowMap,
} from "./types";

export const DB_PREFIX = "kelime-karti-";

export function dbNameFor(userId: string) {
  return `${DB_PREFIX}${userId}`;
}

export interface LocalDBOptions {
  /** Testlerde sahte IndexedDB vermek için */
  dexie?: DexieOptions;
  /** Testlerde saati kontrol etmek için (varsayılan Date.now) */
  now?: () => number;
}

type ChangeListener = () => void;

/** Geri alma için kaydedilen değişiklik: satırın önceki ve sonraki hâli */
export interface RecordedChange {
  table: keyof TableRowMap;
  id: string;
  before: TableRowMap[keyof TableRowMap] | undefined; // undefined = satır yeni eklendi
  after: TableRowMap[keyof TableRowMap];
}

export class LocalDB extends Dexie {
  // Eşlenen tablolar (sunucuyla aynı)
  deck_configs!: Table<DeckConfigRow, string>;
  decks!: Table<DeckRow, string>;
  note_types!: Table<NoteTypeRow, string>;
  notes!: Table<NoteRow, string>;
  note_examples!: Table<NoteExampleRow, string>;
  cards!: Table<CardRow, string>;
  review_logs!: Table<ReviewLogRow, string>;
  media!: Table<MediaRow, string>;
  app_settings!: Table<AppSettingRow, string>;
  // Sadece cihazda
  outbox!: Table<OutboxEntry, string>;
  sync_state!: Table<SyncStateEntry, string>;
  media_blobs!: Table<MediaBlobEntry, string>;

  /** HLC saati — open() sonrası hazır olur */
  clock!: HybridClock;
  readonly now: () => number;
  private listeners = new Set<ChangeListener>();
  /** Doluysa yazma fonksiyonları değişiklikleri buraya da kaydeder (geri al/yinele) */
  recorder: Map<string, RecordedChange> | null = null;

  constructor(
    readonly userId: string,
    options: LocalDBOptions = {},
  ) {
    super(dbNameFor(userId), options.dexie);
    this.now = options.now ?? Date.now;

    // Şema sürümü. İleride yeni index gerekirse version(2) eklenir.
    // Not: Sadece index'lenecek alanlar yazılır; diğer alanlar yine saklanır.
    this.version(1).stores({
      deck_configs: "id",
      decks: "id, parent_id, name",
      note_types: "id, name",
      notes: "id, note_type_id, guid, *tags",
      note_examples: "id, note_id",
      cards: "id, note_id, deck_id, due, [deck_id+state]",
      review_logs: "id, card_id, reviewed_at",
      media: "id, hash",
      app_settings: "id, &key",
      outbox: "key, hlc, table",
      sync_state: "key",
      media_blobs: "hash, pending_upload",
    });
  }

  /** Veritabanını açar ve HLC saatini kaldığı yerden yükler. */
  async init(): Promise<this> {
    await this.open();
    let node = (await this.sync_state.get("node_id"))?.value as string | undefined;
    if (!node) {
      node = randomNodeId();
      await this.sync_state.put({ key: "node_id", value: node });
    }
    const last = (await this.sync_state.get("hlc"))?.value as string | undefined;
    this.clock = new HybridClock(node, last ?? null, this.now);
    return this;
  }

  get deviceId(): string {
    return this.clock.node;
  }

  syncTable<T extends keyof TableRowMap>(name: T): Table<TableRowMap[T], string> {
    return this.table(name) as unknown as Table<TableRowMap[T], string>;
  }

  async getState<V>(key: string, fallback: V): Promise<V> {
    const entry = await this.sync_state.get(key);
    return entry === undefined ? fallback : (entry.value as V);
  }

  async setState(key: string, value: unknown): Promise<void> {
    await this.sync_state.put({ key, value });
  }

  /** Yerel bir değişiklik olduğunda (senkronu tetiklemek için) dinleyici ekler. */
  onLocalChange(listener: ChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emitLocalChange() {
    for (const l of this.listeners) l();
  }
}

/** Kullanıcının veritabanını açar. */
export async function openLocalDB(userId: string, options?: LocalDBOptions): Promise<LocalDB> {
  const db = new LocalDB(userId, options);
  return db.init();
}
