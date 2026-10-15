// Cihazdaki (IndexedDB) ve sunucudaki (Postgres) tabloların satır tipleri.
// İki tarafta da AYNI yapı kullanılır; sütun adları birebir aynıdır.

/** Tüm eşlenen tablolarda ortak sütunlar */
export interface BaseRow {
  id: string; // istemcide üretilen UUID
  user_id: string;
  created_at: number; // ms
  updated_at: string; // HLC damgası (bkz. lib/sync/hlc.ts)
  deleted_at: number | null; // null = canlı; dolu = silinmiş (tombstone)
  server_seq?: number; // sunucunun verdiği sıra numarası (sadece bilgi amaçlı)
}

export interface DeckConfigRow extends BaseRow {
  name: string;
  config: Record<string, unknown>;
}

export interface DeckRow extends BaseRow {
  name: string; // sadece bu destenin adı; tam ad üst destelerden hesaplanır
  parent_id: string | null;
  config_id: string | null;
  description: string;
  collapsed: boolean;
  is_filtered: boolean;
  filter: Record<string, unknown> | null;
}

export interface NoteTypeField {
  id: string; // alanın kalıcı kimliği (yeniden adlandırınca değişmez)
  name: string;
  sticky?: boolean;
  [key: string]: unknown;
}

export interface NoteTypeTemplate {
  id: string;
  name: string;
  front: string;
  back: string;
  [key: string]: unknown;
}

export type NoteTypeKind = "standard" | "cloze" | "image_occlusion";

export interface NoteTypeRow extends BaseRow {
  name: string;
  kind: NoteTypeKind;
  fields: NoteTypeField[];
  templates: NoteTypeTemplate[];
  css: string;
  sort_field: string | null;
  word_field: string | null;
}

export interface NoteRow extends BaseRow {
  note_type_id: string;
  guid: string;
  fields: Record<string, string>; // { alanId: "html" }
  tags: string[];
  sort_field: string;
}

export type ExampleSource = "deck" | "user" | "gemini";

export interface NoteExampleRow extends BaseRow {
  note_id: string;
  text: string;
  translation: string | null;
  source: ExampleSource;
  approved: boolean;
  position: number;
}

export interface CardRow extends BaseRow {
  note_id: string;
  deck_id: string;
  ord: number;
  // --- zamanlama grubu (sched_updated_at ile karşılaştırılır) ---
  state: number; // 0 yeni, 1 öğreniliyor, 2 tekrar, 3 yeniden öğreniliyor
  step: number;
  due: number; // ms
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  last_review: number | null;
  ease: number; // binde (2500 = %250)
  interval_days: number;
  last_example_id: string | null;
  sched_updated_at: string; // zamanlama alanlarının HLC'si
  // --- meta grup (updated_at ile karşılaştırılır) ---
  flags: number;
  suspended: boolean;
  buried_until: number | null;
  original_deck_id: string | null;
  original_due: number | null;
  position: number;
}

export interface ReviewLogRow extends BaseRow {
  card_id: string;
  note_id: string | null;
  deck_id: string | null;
  reviewed_at: number;
  rating: number; // 1 Tekrar, 2 Zor, 3 İyi, 4 Kolay (0 = elle)
  kind: number; // 0 öğrenme, 1 tekrar, 2 yeniden öğrenme, 3 filtreli, 4 elle
  state: number | null;
  due: number | null;
  stability: number | null;
  difficulty: number | null;
  elapsed_days: number | null;
  last_elapsed_days: number | null;
  scheduled_days: number | null;
  interval_before: number | null;
  interval_after: number | null;
  ease: number | null;
  duration_ms: number;
}

export interface MediaRow extends BaseRow {
  hash: string; // SHA-256 (hex)
  filename: string;
  mime: string;
  size: number;
  storage_path: string | null;
  uploaded_at: number | null; // null = henüz Storage'a yüklenmedi
}

export interface AppSettingRow extends BaseRow {
  key: string;
  value: unknown;
}

/** Tablo adı → satır tipi eşlemesi */
export interface TableRowMap {
  deck_configs: DeckConfigRow;
  decks: DeckRow;
  note_types: NoteTypeRow;
  notes: NoteRow;
  note_examples: NoteExampleRow;
  cards: CardRow;
  review_logs: ReviewLogRow;
  media: MediaRow;
  app_settings: AppSettingRow;
}

// ---------------------------------------------------------------------
// Sadece cihazda duran tablolar
// ---------------------------------------------------------------------

/** Gönderilecekler kuyruğu. Her satır için tek kayıt (aynı satır 5 kez
 *  değişse de kuyrukta bir kez durur; gönderirken en son hâli okunur). */
export interface OutboxEntry {
  key: string; // `${table}:${id}`
  table: keyof TableRowMap;
  id: string;
  hlc: string; // son değişikliğin damgası (sıralama ve "değişti mi" kontrolü için)
  failed_hlc?: string | null; // sunucu bu sürümü reddettiyse damgası
  error?: string | null;
}

/** Anahtar-değer: last_server_seq, node_id, hlc, last_sync_at ... */
export interface SyncStateEntry {
  key: string;
  value: unknown;
}

/** Resim içerikleri (hem yüklenmeyi bekleyenler hem indirilip saklananlar) */
export interface MediaBlobEntry {
  hash: string;
  data: ArrayBuffer; // Safari'de Blob saklamak sorunlu olabildiği için ArrayBuffer
  mime: string;
  size: number;
  pending_upload: 0 | 1;
  added_at: number;
}
