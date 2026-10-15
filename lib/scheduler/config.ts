// DESTE SEÇENEKLERİ (preset). Bir preset birden fazla desteye atanabilir.
// deck_configs.config sütununda JSON olarak saklanır. Eksik/bozuk değerler
// varsayılanla tamamlanır (eski sürümün kaydettiği ayarlar da çalışır).
import type { DeckConfigRow, DeckRow } from "@/lib/db/types";

export type LeechAction = "tag" | "suspend";
export type NewGatherOrder = "deck" | "position" | "positionDesc" | "randomNotes" | "randomCards";
export type NewSortOrder = "gathered" | "template" | "random";
export type ReviewSortOrder = "due" | "intervalAsc" | "intervalDesc" | "difficultyDesc" | "retrievabilityAsc" | "random";
export type NewReviewMix = "mix" | "newFirst" | "reviewFirst";
export type AutoAction = "good" | "again" | "bury";

export interface DeckOptions {
  // --- günlük sınırlar
  newPerDay: number;
  reviewsPerDay: number;
  // --- öğrenme
  learningSteps: string[];
  relearningSteps: string[];
  /** Öğrenmeyi bitiren kartın ilk aralığı (gün, sadece klasik algoritma) */
  graduatingInterval: number;
  /** Yeni kartta "Kolay" aralığı (gün, sadece klasik) */
  easyInterval: number;
  // --- unutma (lapse)
  /** Unutulan kartın yeni aralığı = eski aralık × bu oran (klasik) */
  newInterval: number;
  minimumInterval: number;
  leechThreshold: number;
  leechAction: LeechAction;
  // --- algoritma
  fsrs: boolean;
  desiredRetention: number;
  /** Optimize edilmiş FSRS parametreleri (boşsa varsayılan) */
  fsrsParams: number[] | null;
  maximumInterval: number;
  // klasik (SM-2) ayarları
  startingEase: number;
  easyBonus: number;
  intervalModifier: number;
  hardInterval: number;
  // --- kardeş kartlar
  buryNewSiblings: boolean;
  buryReviewSiblings: boolean;
  buryInterdaySiblings: boolean;
  // --- gösterim sırası
  newGatherOrder: NewGatherOrder;
  newSortOrder: NewSortOrder;
  reviewSortOrder: ReviewSortOrder;
  newReviewMix: NewReviewMix;
  // --- yük dengeleme
  loadBalance: boolean;
  /** Haftanın günleri (Pzt..Paz) için yük oranı: 1 = normal, 0.5 = yarı, 0 = boş gün */
  easyDays: number[];
  // --- zamanlayıcılar
  /** Cevap süresi bu kadar saniyeyi geçerse bu kadar sayılır */
  maxAnswerSeconds: number;
  /** 0 = kapalı; soru bu kadar saniye sonra kendiliğinden çevrilir */
  autoShowAnswerSeconds: number;
  /** 0 = kapalı; cevap bu kadar saniye sonra kendiliğinden işaretlenir */
  autoAdvanceSeconds: number;
  autoAdvanceAction: AutoAction;
}

export const DEFAULT_DECK_OPTIONS: DeckOptions = {
  newPerDay: 20,
  reviewsPerDay: 200,
  learningSteps: ["1m", "10m"],
  relearningSteps: ["10m"],
  graduatingInterval: 1,
  easyInterval: 4,
  newInterval: 0,
  minimumInterval: 1,
  leechThreshold: 8,
  leechAction: "tag",
  fsrs: true,
  desiredRetention: 0.9,
  fsrsParams: null,
  maximumInterval: 36500,
  startingEase: 2.5,
  easyBonus: 1.3,
  intervalModifier: 1,
  hardInterval: 1.2,
  buryNewSiblings: false,
  buryReviewSiblings: false,
  buryInterdaySiblings: false,
  newGatherOrder: "deck",
  newSortOrder: "gathered",
  reviewSortOrder: "due",
  newReviewMix: "mix",
  loadBalance: true,
  easyDays: [1, 1, 1, 1, 1, 1, 1],
  maxAnswerSeconds: 60,
  autoShowAnswerSeconds: 0,
  autoAdvanceSeconds: 0,
  autoAdvanceAction: "good",
};

const STEP_RE = /^\d+(\.\d+)?[mhd]$/;

/** Kayıtlı (belki eksik/bozuk) ayarı güvenli bir DeckOptions'a çevirir. */
export function normalizeOptions(raw: Record<string, unknown> | null | undefined): DeckOptions {
  const r = raw ?? {};
  const d = DEFAULT_DECK_OPTIONS;
  const num = (v: unknown, def: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  const int = (v: unknown, def: number, min: number, max: number) => Math.round(num(v, def, min, max));
  const bool = (v: unknown, def: boolean) => (typeof v === "boolean" ? v : def);
  const pick = <T extends string>(v: unknown, def: T, allowed: readonly T[]) => (allowed.includes(v as T) ? (v as T) : def);
  const steps = (v: unknown, def: string[]) =>
    Array.isArray(v) && v.every((s) => typeof s === "string" && STEP_RE.test(s)) ? (v as string[]) : def;
  const params = Array.isArray(r.fsrsParams) && r.fsrsParams.length >= 17 && r.fsrsParams.every((x) => typeof x === "number" && Number.isFinite(x))
    ? (r.fsrsParams as number[])
    : null;
  const easyDays =
    Array.isArray(r.easyDays) && r.easyDays.length === 7 && r.easyDays.every((x) => typeof x === "number")
      ? (r.easyDays as number[]).map((x) => Math.min(1, Math.max(0, x)))
      : d.easyDays;
  return {
    newPerDay: int(r.newPerDay, d.newPerDay, 0, 9999),
    reviewsPerDay: int(r.reviewsPerDay, d.reviewsPerDay, 0, 99999),
    learningSteps: steps(r.learningSteps, d.learningSteps),
    relearningSteps: steps(r.relearningSteps, d.relearningSteps),
    graduatingInterval: int(r.graduatingInterval, d.graduatingInterval, 1, 365),
    easyInterval: int(r.easyInterval, d.easyInterval, 1, 365),
    newInterval: num(r.newInterval, d.newInterval, 0, 1),
    minimumInterval: int(r.minimumInterval, d.minimumInterval, 1, 365),
    leechThreshold: int(r.leechThreshold, d.leechThreshold, 1, 99),
    leechAction: pick(r.leechAction, d.leechAction, ["tag", "suspend"] as const),
    fsrs: bool(r.fsrs, d.fsrs),
    desiredRetention: num(r.desiredRetention, d.desiredRetention, 0.7, 0.99),
    fsrsParams: params,
    maximumInterval: int(r.maximumInterval, d.maximumInterval, 1, 36500),
    startingEase: num(r.startingEase, d.startingEase, 1.31, 5),
    easyBonus: num(r.easyBonus, d.easyBonus, 1, 5),
    intervalModifier: num(r.intervalModifier, d.intervalModifier, 0.5, 2),
    hardInterval: num(r.hardInterval, d.hardInterval, 1, 2),
    buryNewSiblings: bool(r.buryNewSiblings, d.buryNewSiblings),
    buryReviewSiblings: bool(r.buryReviewSiblings, d.buryReviewSiblings),
    buryInterdaySiblings: bool(r.buryInterdaySiblings, d.buryInterdaySiblings),
    newGatherOrder: pick(r.newGatherOrder, d.newGatherOrder, ["deck", "position", "positionDesc", "randomNotes", "randomCards"] as const),
    newSortOrder: pick(r.newSortOrder, d.newSortOrder, ["gathered", "template", "random"] as const),
    reviewSortOrder: pick(r.reviewSortOrder, d.reviewSortOrder, ["due", "intervalAsc", "intervalDesc", "difficultyDesc", "retrievabilityAsc", "random"] as const),
    newReviewMix: pick(r.newReviewMix, d.newReviewMix, ["mix", "newFirst", "reviewFirst"] as const),
    loadBalance: bool(r.loadBalance, d.loadBalance),
    easyDays,
    maxAnswerSeconds: int(r.maxAnswerSeconds, d.maxAnswerSeconds, 5, 600),
    autoShowAnswerSeconds: int(r.autoShowAnswerSeconds, d.autoShowAnswerSeconds, 0, 600),
    autoAdvanceSeconds: int(r.autoAdvanceSeconds, d.autoAdvanceSeconds, 0, 600),
    autoAdvanceAction: pick(r.autoAdvanceAction, d.autoAdvanceAction, ["good", "again", "bury"] as const),
  };
}

/** "1m 10m 1d" → ["1m","10m","1d"]; geçersizse null */
export function parseSteps(text: string): string[] | null {
  const parts = text.trim().split(/[\s,]+/).filter(Boolean);
  return parts.every((p) => STEP_RE.test(p)) ? parts : null;
}

export function formatSteps(steps: string[]): string {
  return steps.join(" ");
}

/** Adımı milisaniyeye çevirir ("10m" → 600000) */
export function stepMs(step: string): number {
  const n = parseFloat(step);
  const unit = step.slice(-1);
  return n * (unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000);
}

/** Bir destenin geçerli ayarları: destenin preset'i → varsayılan preset → yerleşik varsayılan */
export function resolveDeckOptions(
  deck: Pick<DeckRow, "config_id"> | undefined,
  configs: Map<string, DeckConfigRow>,
  defaultConfigId: string,
): DeckOptions {
  const own = deck?.config_id ? configs.get(deck.config_id) : undefined;
  const chosen = own && own.deleted_at === null ? own : configs.get(defaultConfigId);
  return normalizeOptions(chosen && chosen.deleted_at === null ? chosen.config : null);
}
