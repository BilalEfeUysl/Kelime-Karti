"use client";
// ÇALIŞMA EKRANI
//   Genel bakış → "Çalışmaya başla" → soru → "Cevabı göster" (Boşluk/Enter)
//   → Tekrar/Zor/İyi/Kolay (1-4). Butonların üstünde sonraki aralık önizlemesi.
// Kısayollar: Ctrl/Cmd+Z geri al (Ctrl/Cmd+Shift+Z yinele), E düzenle, I kart bilgisi, G Gemini.
// Her şey cihazdaki veritabanında olur; internet gerekmez.
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useShell } from "@/components/app/AppShell";
import { useUndo, useUndoEvents } from "@/components/app/undo";
import { DECK_LIMITS_SETTING, useDayInfo, useDeckLimits, useDecks, useOptionsResolver } from "@/components/app/data";
import { type CardKey, CardFrame } from "@/components/card/CardFrame";
import { CardInfoModal } from "@/components/study/CardInfoModal";
import { EditNoteModal } from "@/components/study/EditNoteModal";
import { Button, Notice } from "@/components/ui";
import type { CardRow, DeckRow } from "@/lib/db/types";
import { buildDeckTree, flattenDeckTree } from "@/lib/decks";
import { resolveMediaInHtml } from "@/lib/media-url";
import { approvedExamples } from "@/lib/notes";
import type { DeckOptions } from "@/lib/scheduler/config";
import { type Answer, ANSWER_LABELS, ANSWERS, previewAnswers } from "@/lib/scheduler/fsrs";
import { buildStudyQueue, type QueueKind } from "@/lib/scheduler/queue";
import {
  buryCards,
  chooseExample,
  MARKED_TAG,
  recordAnswer,
} from "@/lib/study/actions";
import { FLAG_COLORS, FLAG_NAMES } from "@/lib/flags";
import { renderCard } from "@/lib/template/render";
import { actionForKey, useAppearance } from "@/lib/appearance";
import { ShortcutHelp } from "@/components/study/ShortcutHelp";
import { CustomStudyModal, FilteredDeckActions, FilteredDeckDialog } from "@/components/study/DeckTools";
import { BOOSTS_SETTING, type Boosts, boostsForToday, increaseLimit } from "@/lib/customStudy";
import { getSetting, setSetting } from "@/lib/db/mutations";
import { filterOf } from "@/lib/filtered";
import type { ScheduleContext } from "@/lib/scheduler/fsrs";
import { AskButton, AskPanel } from "@/components/ai/AskPanel";
import { noteWord } from "@/lib/ai/local";
import { stripHtml } from "@/lib/text";
import { fieldLabel, noteTypeLabel } from "@/lib/notetypes/labels";

const ANSWER_STYLE: Record<Answer, string> = {
  1: "bg-danger/10 text-danger border-danger/30",
  2: "bg-ink/5 text-ink border-rule",
  3: "bg-ok/10 text-ok border-ok/30",
  4: "bg-accent/10 text-accent border-accent/30",
};

function useNightMode(): boolean {
  const [night, setNight] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const update = () => setNight(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);
  return night;
}

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

export function StudyScreen() {
  const { db } = useApp();
  const params = useSearchParams();
  const deckId = params.get("deste");
  const decks = useDecks();
  const optionsFor = useOptionsResolver(decks);
  const { day, now } = useDayInfo();
  const [studying, setStudying] = useState(false);

  const deckNames = useMemo(() => {
    const map = new Map<string, string>();
    if (decks) for (const n of flattenDeckTree(buildDeckTree(decks), true)) map.set(n.deck.id, n.fullName);
    return map;
  }, [decks]);

  const subtree = useMemo(() => {
    if (!decks || !deckId) return [];
    const ids = [deckId];
    for (let i = 0; i < ids.length; i++) ids.push(...decks.filter((d) => d.parent_id === ids[i]).map((d) => d.id));
    return ids;
  }, [decks, deckId]);

  // Tüm kartlar: kuyruk alt desteleri kendisi süzer; yük dengeleme için tüm tekrarlar gerekir
  const cards = useLiveQuery(async () => (db && subtree.length ? db.cards.toArray() : []), [db, subtree.length > 0]);
  const boostsRaw = useLiveQuery(async () => (db ? getSetting<Boosts | null>(db, BOOSTS_SETTING, null) : null), [db]);
  const boosts = useMemo(() => boostsForToday(boostsRaw ?? null, day.today), [boostsRaw, day.today]);
  const todayLogs = useLiveQuery(
    async () => (db ? db.review_logs.where("reviewed_at").aboveOrEqual(day.dayStart).toArray() : []),
    [db, day.dayStart],
  );

  const [avoidId, setAvoidId] = useState<string | null>(null);
  const study = useMemo(() => {
    if (!decks || !cards || !todayLogs || !optionsFor || !deckId) return null;
    return buildStudyQueue({ decks, cards, todayLogs, optionsFor, now, day, boosts }, deckId, avoidId);
  }, [decks, cards, todayLogs, optionsFor, now, day, deckId, avoidId, boosts]);

  // Günlük hedeften sonra destede kalan (bugün çalışılabilecek) kartlar
  const more = (() => {
    if (!cards || !study) return { news: 0, reviews: 0 };
    const inTree = new Set(subtree);
    let news = 0;
    let reviews = 0;
    for (const c of cards) {
      if (c.deleted_at !== null || c.suspended || !inTree.has(c.deck_id) || (c.buried_until && c.buried_until > now)) continue;
      if (c.state === 0) news++;
      else if (c.state === 2 && c.due < day.nextDayStart) reviews++;
    }
    return { news: Math.max(0, news - study.counts.new), reviews: Math.max(0, reviews - study.counts.review) };
  })();

  if (!deckId) return <Notice tone="error">Deste seçilmedi.</Notice>;
  if (!decks || !study) return null;
  const deckName = deckNames.get(deckId);
  if (!deckName) return <Notice tone="error">Bu deste bulunamadı (silinmiş olabilir).</Notice>;

  if (!studying) {
    return (
      <Overview
        deck={decks.find((d) => d.id === deckId)!}
        deckName={deckName}
        counts={study.counts}
        nextLearnDue={study.nextLearnDue}
        onStart={() => setStudying(true)}
        now={now}
        more={more}
        reviewsPerDay={optionsFor!(deckId).reviewsPerDay}
      />
    );
  }
  return (
    <Session
      deckName={deckName}
      deckNames={deckNames}
      study={study}
      cards={cards ?? []}
      decks={decks}
      deckId={deckId}
      more={more}
      optionsFor={optionsFor!}
      setAvoidId={setAvoidId}
      onExit={() => setStudying(false)}
      now={now}
    />
  );
}

function Counts({ counts, current }: { counts: { new: number; learn: number; review: number }; current?: QueueKind }) {
  const item = (n: number, cls: string, kind: QueueKind, label: string) => (
    <span className={`${cls} ${current === kind ? "underline decoration-2 underline-offset-4" : ""}`} title={label}>
      <span className="sr-only">{label}: </span>
      {n}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-3 font-semibold tabular-nums">
      {item(counts.new, "text-accent", "new", "Yeni")}
      {item(counts.learn, "text-warn", "learn", "Öğrenme")}
      {item(counts.review, "text-ok", "review", "Tekrar")}
    </span>
  );
}

function untilText(t: number, now: number): string {
  const min = Math.max(1, Math.round((t - now) / 60_000));
  return min < 60 ? `${min} dakika` : `${Math.round(min / 60)} saat`;
}

function Overview({
  deck,
  deckName,
  counts,
  nextLearnDue,
  onStart,
  now,
  more,
  reviewsPerDay,
}: {
  more: { news: number; reviews: number };
  reviewsPerDay: number;
  deck: DeckRow;
  deckName: string;
  counts: { new: number; learn: number; review: number };
  nextLearnDue: number | null;
  onStart: () => void;
  now: number;
}) {
  const deckId = deck.id;
  const { db } = useApp();
  const limits = useDeckLimits();
  const [editGoal, setEditGoal] = useState(false);
  const goal = limits?.[deckId]?.new;
  // Desteye ilk girişte (ya da "Değiştir"e basınca) günlük hedef sorulur
  const askGoal = !deck.is_filtered && !!limits && (goal === undefined || editGoal);
  const totalNew = counts.new + more.news;
  const saveGoal = async (n: number) => {
    if (!db || !limits) return;
    await setSetting(db, DECK_LIMITS_SETTING, { ...limits, [deckId]: { new: n, review: limits[deckId]?.review ?? reviewsPerDay } });
    setEditGoal(false);
  };
  const [custom, setCustom] = useState(false);
  const [filterDialog, setFilterDialog] = useState(false);
  const total = counts.new + counts.learn + counts.review;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!askGoal && !isTypingTarget(e.target) && (e.key === " " || e.key === "Enter") && total > 0) {
        e.preventDefault();
        onStart();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStart, total, askGoal]);

  if (askGoal) {
    return (
      <div className="space-y-6">
        <div>
          <Link href="/" className="text-sm text-ink-soft hover:text-ink">
            ← Desteler
          </Link>
          <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight break-words">{deckName}</h1>
        </div>
        <GoalPicker totalNew={totalNew} current={goal} onPick={(n) => void saveGoal(n)} onCancel={goal !== undefined ? () => setEditGoal(false) : undefined} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/" className="text-sm text-ink-soft hover:text-ink">
          ← Desteler
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight break-words">{deckName}</h1>
        {!deck.is_filtered && goal !== undefined && (
          <p className="mt-1 text-sm text-ink-soft">
            Günlük hedef: <strong className="text-ink">{goal} yeni kelime</strong>{" "}
            <button type="button" onClick={() => setEditGoal(true)} className="ml-1 text-accent underline">
              Değiştir
            </button>
          </p>
        )}
      </div>
      <div className="overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="h-1 bg-margin" aria-hidden />
        <dl className="grid grid-cols-3 divide-x divide-rule text-center">
          {[
            ["Yeni", counts.new, "text-accent"],
            ["Öğrenme", counts.learn, "text-warn"],
            ["Tekrar", counts.review, "text-ok"],
          ].map(([label, n, cls]) => (
            <div key={label as string} className="px-2 py-5">
              <dd className={`font-display text-3xl font-semibold tabular-nums ${cls}`}>{n}</dd>
              <dt className="mt-1 text-sm text-ink-soft">{label}</dt>
            </div>
          ))}
        </dl>
      </div>
      {total > 0 ? (
        <Button className="w-full sm:w-auto" onClick={onStart}>
          Çalışmaya başla
        </Button>
      ) : (
        (more.news > 0 || more.reviews > 0) && !deck.is_filtered ? (
          <GoalReached deckId={deck.id} more={more} />
        ) : (
        <Notice tone="ok">
          Bu destede şimdilik çalışılacak kart yok.
          {nextLearnDue ? ` Bir sonraki öğrenme kartı yaklaşık ${untilText(nextLearnDue, now)} sonra.` : " Yarın tekrar bak."}
        </Notice>
        )
      )}
      {deck.is_filtered ? (
        <FilteredDeckActions deck={deck} onEdit={() => setFilterDialog(true)} />
      ) : (
      <div className="flex flex-wrap gap-2 text-sm">
        <button type="button" onClick={() => setCustom(true)} className="rounded-md border border-rule bg-surface px-3 py-2 font-medium hover:border-ink-soft">
          Özel çalışma
        </button>
        <Link href={`/ekle?deste=${deckId}`} className="rounded-md border border-rule bg-surface px-3 py-2 font-medium hover:border-ink-soft">
          Kart ekle
        </Link>
        <Link href={`/deste-ayarlari?deste=${deckId}`} className="rounded-md border border-rule bg-surface px-3 py-2 font-medium hover:border-ink-soft">
          Deste seçenekleri
        </Link>
      </div>
      )}
      {custom && <CustomStudyModal deck={deck} deckName={deckName} onClose={() => setCustom(false)} />}
      {filterDialog && <FilteredDeckDialog deck={deck} onClose={() => setFilterDialog(false)} />}
    </div>
  );
}

function Session({
  deckName,
  deckNames,
  study,
  cards,
  decks,
  more,
  deckId: sessionDeckIdRaw,
  optionsFor,
  setAvoidId,
  onExit,
  now,
}: {
  deckName: string;
  deckNames: Map<string, string>;
  study: NonNullable<ReturnType<typeof buildStudyQueue>>;
  cards: CardRow[];
  decks: DeckRow[];
  more: { news: number; reviews: number };
  deckId: string;
  optionsFor: (deckId: string) => DeckOptions;
  setAvoidId: (id: string | null) => void;
  onExit: () => void;
  now: number;
}) {
  const { db, media } = useApp();
  // Filtreli destede günlük hedef yok
  const sessionDeckId = decks.find((d) => d.id === sessionDeckIdRaw)?.is_filtered ? null : sessionDeckIdRaw;
  const night = useNightMode();
  const { setImmersive } = useShell();
  // Çalışırken alt menü gizlenir (cevap butonları için yer açılır)
  useEffect(() => {
    setImmersive(true);
    return () => setImmersive(false);
  }, [setImmersive]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [typed, setTyped] = useState("");
  const undo = useUndo();
  const [stale, setStale] = useState<{ id: string; sched: string } | null>(null);
  const [modal, setModal] = useState<"edit" | "info" | "ai" | "keys" | null>(null);
  const look = useAppearance();
  const [toast, setToast] = useState<string | null>(null);
  const [exampleId, setExampleId] = useState<string | null>(null);
  // Çizilecek HTML (resimler çözüldükten sonra); hangi kart/yüz için olduğu da tutulur
  const [html, setHtml] = useState<{ key: string; value: string } | null>(null);
  const shownAt = useRef(Date.now());
  const busy = useRef(false);
  // Gömülen kart ertesi günün başına kadar gösterilmez (kullanıcının gün ayarına göre)
  const { day } = useDayInfo();
  const nextDayStartRef = useRef(day.nextDayStart);
  nextDayStartRef.current = day.nextDayStart;

  // Gösterilecek kart: seçili kart sabit kalır; cevaplanınca kuyruğun başı alınır.
  const queueItem = useMemo(() => {
    const items = study.queue.filter((q) => !(stale && q.card.id === stale.id && q.card.sched_updated_at === stale.sched));
    return items.find((q) => q.card.id === currentId) ?? null;
  }, [study.queue, currentId, stale]);

  useEffect(() => {
    if (queueItem || showAnswer) return;
    const next = study.queue.find((q) => !(stale && q.card.id === stale.id && q.card.sched_updated_at === stale.sched));
    setCurrentId(next?.card.id ?? null);
  }, [queueItem, study.queue, stale, showAnswer]);

  const card = queueItem?.card ?? (currentId ? cards.find((c) => c.id === currentId) : undefined);
  const note = useLiveQuery(async () => (db && card ? db.notes.get(card.note_id) : undefined), [db, card?.note_id]);
  const noteType = useLiveQuery(async () => (db && note ? db.note_types.get(note.note_type_id) : undefined), [db, note?.note_type_id]);
  const examples = useLiveQuery(async () => (db && card ? approvedExamples(db, card.note_id) : []), [db, card?.note_id]);

  // Yeni kart gösterildiğinde: süre sayacı, örnek cümle seçimi
  useEffect(() => {
    if (!card) return;
    shownAt.current = Date.now();
    setTyped("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id]);
  useEffect(() => {
    if (card && examples) setExampleId(chooseExample(examples, card.last_example_id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, examples?.length]);

  // Filtreli destedeki kart asıl destesinin ayarlarıyla zamanlanır
  const options = card ? optionsFor(card.original_deck_id ?? card.deck_id) : null;
  const cardDeck = card ? decks.find((d) => d.id === card.deck_id) : undefined;
  // Yük dengeleme: gün → o gün vakti gelen tekrar sayısı
  const dueByOffset = useMemo(() => {
    const m = new Map<number, number>();
    for (const c of cards) {
      if (c.deleted_at !== null || c.suspended || !(c.state === 2 || c.scheduled_days >= 1)) continue;
      const off = Math.floor((c.due - day.dayStart) / 86_400_000);
      if (off >= 0) m.set(off, (m.get(off) ?? 0) + 1);
    }
    return m;
  }, [cards, day.dayStart]);
  const ctx: ScheduleContext = useMemo(() => ({ day, dueOnDay: (d: number) => dueByOffset.get(d) ?? 0 }), [day, dueByOffset]);
  const rendered = useMemo(() => {
    if (!card || !note || !noteType) return null;
    return renderCard(
      {
        noteType,
        note,
        cardOrd: card.ord,
        deckName: deckNames.get(card.deck_id) ?? "",
        flags: card.flags,
        examples: (examples ?? []).map((e) => ({ id: e.id, text: e.text, translation: e.translation })),
        chosenExampleId: exampleId,
      },
      { typed },
    );
  }, [card, note, noteType, examples, exampleId, typed, deckNames]);

  const htmlKey = `${card?.id}:${showAnswer ? "a" : "q"}`;
  useEffect(() => {
    if (!rendered || !db) return;
    let cancelled = false;
    void resolveMediaInHtml(showAnswer ? rendered.answer : rendered.question, db, media).then((h) => {
      if (!cancelled) setHtml({ key: htmlKey, value: h });
    });
    return () => {
      cancelled = true;
    };
  }, [rendered, showAnswer, db, media, htmlKey]);

  const previews = useMemo(() => (card && options ? previewAnswers(card, options, Date.now(), ctx) : null), [card, options, showAnswer, ctx]);

  const flash = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 1800);
  };

  const answer = useCallback(
    async (a: Answer) => {
      if (!db || !card || !options || !showAnswer || busy.current) return;
      busy.current = true;
      try {
        const { leech } = await undo.run(
          "Cevap",
          () =>
            recordAnswer(db, card, a, options, {
              durationMs: Math.min(Date.now() - shownAt.current, options.maxAnswerSeconds * 1000),
              exampleId,
              ctx,
              nextDayStart: nextDayStartRef.current,
              filteredReschedule: cardDeck?.is_filtered ? filterOf(cardDeck).reschedule : undefined,
            }),
          { cardId: card.id },
        );
        if (leech) flash(options.leechAction === "suspend" ? "Bu kart çok sık unutuldu ve askıya alındı" : "Bu kart çok sık unutuldu (“leech” etiketi eklendi)");
        setStale({ id: card.id, sched: card.sched_updated_at });
        setAvoidId(card.id);
        setShowAnswer(false);
        setCurrentId(null);
      } finally {
        busy.current = false;
      }
    },
    [db, card, options, showAnswer, exampleId, setAvoidId, undo, ctx, cardDeck],
  );

  // Geri al / yinele (bu ekrandan ya da genel kısayoldan): ilgili kartı göster
  useUndoEvents((e) => {
    setStale(null);
    setShowAnswer(false);
    if (e.step.meta?.cardId) setCurrentId(e.step.meta.cardId);
  });
  const doUndo = useCallback(() => void undo.manager?.undo(), [undo.manager]);
  const doRedo = useCallback(() => void undo.manager?.redo(), [undo.manager]);

  // Otomatik ilerlemede "kartı yarına ertele" seçeneği için
  const buryCurrent = useCallback(async () => {
    if (!db || !card) return;
    const cardId = card.id;
    await undo.run("Kartı erteleme", () => buryCards(db, [cardId], nextDayStartRef.current), { cardId });
    flash("Kart yarına ertelendi");
    setShowAnswer(false);
    setCurrentId(null);
  }, [db, card, undo]);

  // Otomatik cevap gösterme / ilerleme (deste seçeneklerinde ayarlanır; pencere açıkken durur)
  useEffect(() => {
    if (!card || !options || modal) return;
    const secs = showAnswer ? options.autoAdvanceSeconds : options.autoShowAnswerSeconds;
    if (!secs) return;
    const t = setTimeout(() => {
      if (!showAnswer) setShowAnswer(true);
      else if (options.autoAdvanceAction === "bury") void buryCurrent();
      else void answer(options.autoAdvanceAction === "again" ? 1 : 3);
    }, secs * 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id, showAnswer, options, modal]);

  const handleKey = useCallback(
    (k: CardKey) => {
      if (modal) return;
      const mod = k.ctrl || k.meta;
      if (mod && k.key.toLowerCase() === "z") return k.shift ? doRedo() : doUndo();
      if (k.ctrl && k.key.toLowerCase() === "y") return doRedo();
      if (mod || k.alt) return;
      if (k.key === "?") return setModal("keys");
      if (k.key === "Enter") {
        if (!showAnswer) setShowAnswer(true);
        else void answer(3);
        return;
      }
      switch (actionForKey(k.key, look.shortcuts)) {
        case "showAnswer":
          if (!showAnswer) setShowAnswer(true);
          else void answer(3);
          break;
        case "again":
        case "hard":
        case "good":
        case "easy": {
          const a = ({ again: 1, hard: 2, good: 3, easy: 4 } as const)[actionForKey(k.key, look.shortcuts) as "again"];
          if (showAnswer) void answer(a);
          break;
        }
        case "edit":
          setModal("edit");
          break;
        case "info":
          setModal("info");
          break;
        case "gemini":
          if (navigator.onLine) setModal("ai");
          break;
      }
    },
    [modal, showAnswer, answer, doUndo, doRedo, look],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // Geri al / yinele kısayolları genel olarak (AppShell) işlenir
      if ((e.ctrlKey || e.metaKey) && /^[zy]$/i.test(e.key)) return;
      if (e.key === " " || e.key === "Enter") e.preventDefault();
      if (e.key === "?" && modal === "keys") return;
      handleKey({ key: e.key, code: e.code, ctrl: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleKey]);

  const marked = note?.tags.some((t) => t.toLowerCase() === MARKED_TAG);

  const topBar = (
    <div className="mb-3 flex items-center gap-2">
      <button type="button" onClick={onExit} className="rounded-md px-2 py-1.5 text-sm text-ink-soft hover:text-ink">
        ← Bitir
      </button>
      <span className="min-w-0 flex-1 truncate text-sm font-medium" title={deckName}>
        {look.minimal ? "" : deckName}
      </span>
      {!look.minimal && <Counts counts={study.counts} current={queueItem?.kind} />}
      <button type="button" onClick={() => setModal("keys")} className="rounded-md px-2 py-1 text-sm text-ink-soft hover:text-ink" title="Kısayollar (?)" aria-label="Kısayollar">
        ?
      </button>
    </div>
  );

  if (!card || !rendered || !noteType || !note) {
    if (study.queue.length > 0 && !card) return <>{topBar}</>;
    return (
      <div>
        {topBar}
        <div className="rounded-xl border border-rule bg-surface p-6 text-center">
          <h2 className="font-display text-2xl font-semibold">Tebrikler!</h2>
          {(more.news > 0 || more.reviews > 0) && sessionDeckId ? (
            <div className="mt-3 text-left">
              <GoalReached deckId={sessionDeckId} more={more} />
            </div>
          ) : (
            <p className="mt-2 text-ink-soft">
              Bu destede şimdilik çalışılacak kart kalmadı.
              {study.nextLearnDue ? ` Bir sonraki öğrenme kartı yaklaşık ${untilText(study.nextLearnDue, now)} sonra.` : ""}
            </p>
          )}
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Link href="/" className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-accent-ink">
              Destelere dön
            </Link>
            {undo.canUndo && (
              <Button variant="secondary" onClick={doUndo}>
                Geri al: {undo.undoLabel}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {topBar}
      <div className="relative overflow-hidden rounded-xl border border-rule bg-surface">
        <div className="h-1 bg-margin" aria-hidden />
        <div className="absolute right-2 top-3 z-10 flex items-center gap-1.5">
          {card.flags > 0 && (
            <span className="size-3 rounded-full" style={{ background: FLAG_COLORS[card.flags] }} title={`${FLAG_NAMES[card.flags]} bayrak`} />
          )}
          {marked && <span title="İşaretli" className="text-mark">★</span>}
        </div>
        {html?.key === htmlKey ? (
        <CardFrame
          html={html.value}
          css={rendered.css}
          cardOrd={card.ord}
          night={night}
          focusInput={!showAnswer && !!rendered.typeAnswer}
          onTyped={setTyped}
          onEnter={() => (showAnswer ? void answer(3) : setShowAnswer(true))}
          onKey={handleKey}
          minHeight={220}
        />
        ) : (
          <div style={{ height: 220 }} aria-hidden />
        )}
      </div>

      <div className={`mt-3 flex-wrap items-center gap-1 text-sm ${look.minimal ? "hidden" : "flex"}`}>
        <button type="button" disabled={!undo.canUndo} onClick={doUndo} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-40" title={undo.undoLabel ? `Geri al: ${undo.undoLabel} (Ctrl/Cmd+Z)` : "Ctrl/Cmd+Z"}>
          Geri al
        </button>
        <button type="button" onClick={() => setModal("edit")} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink" title="E">
          Düzenle
        </button>
        <button type="button" onClick={() => setModal("info")} className="rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink" title="I">
          Kart bilgisi
        </button>
        <AskButton onClick={() => setModal("ai")} />
        {toast && <span className="ml-auto text-ink-soft" role="status">{toast}</span>}
      </div>

      {/* Cevap butonları: telefonda ekranın altında, başparmakla basılabilir */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-rule bg-paper/95 pb-safe backdrop-blur md:static md:mt-4 md:border-0 md:bg-transparent">
        <div className="mx-auto max-w-3xl px-safe py-2.5 md:px-0">
          {!showAnswer ? (
            <Button className="min-h-14 w-full text-base" onClick={() => setShowAnswer(true)}>
              Cevabı göster
            </Button>
          ) : (
            <div className="grid grid-cols-4 gap-2">
              {ANSWERS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => void answer(a)}
                  className={`flex min-h-14 flex-col items-center justify-center rounded-lg border font-semibold ${ANSWER_STYLE[a]}`}
                >
                  <span className="text-xs font-medium opacity-80 tabular-nums">{previews?.[a]}</span>
                  <span>{ANSWER_LABELS[a]}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {modal === "keys" && <ShortcutHelp onClose={() => setModal(null)} />}
      {modal === "ai" && note && (
        <AskPanel
          target={{
            ...noteWord(note, noteType),
            noteId: note.id,
            // Kartta o an görünen örnek cümle (sorular onunla ilgili de olabilsin)
            sentence: (() => {
              const ex = examples?.find((e) => e.id === exampleId);
              return ex ? { text: ex.text, translation: ex.translation } : undefined;
            })(),
            context: noteType?.fields.map((f) => `${fieldLabel(f.name)}: ${stripHtml(note.fields[f.id] ?? "")}`).join("\n"),
          }}
          onClose={() => setModal(null)}
        />
      )}
      {modal === "edit" && <EditNoteModal note={note} noteType={noteType} onClose={() => setModal(null)} />}
      {modal === "info" && options && (
        <CardInfoModal
          card={card}
          deckName={deckNames.get(card.deck_id) ?? deckName}
          noteTypeName={noteTypeLabel(noteType.name)}
          options={options}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}

/** Günlük hedef tamamlandı: istersen devam et (bugünlük hedefe ekler) */
function GoalReached({ deckId, more }: { deckId: string; more: { news: number; reviews: number } }) {
  const { db } = useApp();
  const { day } = useDayInfo();
  const add = (kind: "new" | "review", n: number) => db && void increaseLimit(db, deckId, kind, n, day.today);
  return (
    <div className="rounded-xl border border-ok/40 bg-ok/10 p-4">
      <p className="font-semibold">Bugünkü hedefini tamamladın.</p>
      <p className="mt-1 text-sm text-ink-soft">
        {more.news > 0 ? `Destede ${more.news} yeni kelime daha var.` : ""}
        {more.reviews > 0 ? ` ${more.reviews} tekrar da bekliyor.` : ""} İstersen devam edebilirsin.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {more.news > 0 && <Button onClick={() => add("new", Math.min(10, more.news))}>{Math.min(10, more.news)} yeni kelime daha</Button>}
        {more.news > 10 && (
          <Button variant="secondary" onClick={() => add("new", Math.min(20, more.news))}>
            {Math.min(20, more.news)} yeni kelime daha
          </Button>
        )}
        {more.reviews > 0 && (
          <Button variant="secondary" onClick={() => add("review", more.reviews)}>
            Kalan {more.reviews} tekrarı da çalış
          </Button>
        )}
      </div>
    </div>
  );
}

/** "Günlük hedefin ne?" — desteye ilk girişte sorulur */
function GoalPicker({ totalNew, current, onPick, onCancel }: { totalNew: number; current?: number; onPick: (n: number) => void; onCancel?: () => void }) {
  const [custom, setCustom] = useState("");
  const days = (n: number) => (totalNew > 0 ? Math.ceil(totalNew / n) : 0);
  const options = [10, 20, 30, 50];
  return (
    <div className="space-y-4 rounded-xl border border-rule bg-surface p-5">
      <div>
        <h2 className="font-display text-xl font-semibold">Günlük hedefin ne?</h2>
        <p className="mt-1 text-sm text-ink-soft">
          Her gün kaç <strong>yeni</strong> kelime öğrenmek istiyorsun? Hedefi bitirince istersen devam edebilirsin; tekrar edilecek eski kelimeler buna ek
          olarak gelir.
          {totalNew > 0 && ` Bu destede ${totalNew} yeni kelime var.`}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {options.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPick(n)}
            aria-pressed={current === n}
            className="rounded-xl border border-rule px-3 py-3 text-left hover:border-accent aria-pressed:border-accent aria-pressed:bg-accent/10"
          >
            <span className="block font-display text-2xl font-semibold">{n}</span>
            <span className="block text-sm text-ink-soft">kelime / gün</span>
            {totalNew > 0 && <span className="mt-1 block text-xs text-ink-soft">~{days(n)} günde biter</span>}
          </button>
        ))}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Math.round(Number(custom));
          if (n >= 1 && n <= 9999) onPick(n);
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-semibold">Başka bir sayı</span>
          <input
            type="number"
            min={1}
            max={9999}
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            className="min-h-11 w-32 rounded-lg border border-rule bg-paper px-3 focus:border-accent focus:outline-none"
          />
        </label>
        <Button type="submit" variant="secondary" disabled={!(Number(custom) >= 1)}>
          Kaydet
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Vazgeç
          </Button>
        )}
      </form>
    </div>
  );
}
