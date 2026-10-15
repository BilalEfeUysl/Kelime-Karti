"use client";
// "GEMİNİ'YE SOR" PANELİ (telefonda alttan açılır)
//   1) Hazır açıklama: anlam, tür, örnekler, eş/zıt anlam, kalıplar, YDS notu
//      (ortak önbellekten gelirse kota harcanmaz)
//   2) "Bu cümleleri örneklere ekle"   3) Serbest sohbet (cevap akarak gelir)
//   4) "Bundan kart oluştur" (kart ekleme ekranını doldurur)
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useUndo } from "@/components/app/undo";
import { Button, Modal, Notice } from "@/components/ui";
import { AiClientError, chatStream, explainWord, keyStore } from "@/lib/ai/client";
import { addExamples } from "@/lib/ai/local";
import type { Explanation } from "@/lib/ai/prompts";
import { writeJSON } from "@/lib/storage";
import { useKeyStatus } from "./hooks";

export const PREFILL_KEY = "kk.add.prefill";

export interface AskTarget {
  word: string;
  meaning?: string;
  /** Örnekleri eklenecek not (yoksa "örneklere ekle" gizlenir) */
  noteId?: string;
  /** Sohbette bağlam olarak gidecek kart içeriği (düz metin) */
  context?: string;
}

const PRIVACY = "Kişisel bilgi yazma: ücretsiz katmanda Google verileri model geliştirmek için kullanabilir.";

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="text-xs font-semibold text-ink-soft">{title}</h4>
      <p className="mt-0.5">{items.join(", ")}</p>
    </div>
  );
}

export function AskPanel({ target, onClose }: { target: AskTarget; onClose: () => void }) {
  const { db } = useApp();
  const undo = useUndo();
  const router = useRouter();
  const { status, online } = useKeyStatus();
  const [expl, setExpl] = useState<Explanation | null>(null);
  const [cached, setCached] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<number | null>(null);
  const [messages, setMessages] = useState<{ role: "user" | "model"; text: string }[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);

  const explain = useCallback(
    async (refresh = false) => {
      setLoading(true);
      setError(null);
      try {
        const r = await explainWord(target.word, target.meaning, refresh);
        setExpl(r.explanation);
        setCached(r.cached);
        if (!r.cached) void keyStore.refresh();
      } catch (err) {
        setError(err instanceof AiClientError ? err.message : "Bir şey ters gitti.");
      } finally {
        setLoading(false);
      }
    },
    [target.word, target.meaning],
  );

  // Açılınca hazır açıklamayı getir (önbellekteyse kota harcamaz)
  useEffect(() => {
    if (online && target.word) void explain();
  }, [online, target.word, explain]);

  useEffect(() => chatEnd.current?.scrollIntoView({ block: "end" }), [messages]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || streaming) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages([...next, { role: "model", text: "" }]);
    setInput("");
    setStreaming(true);
    try {
      const context = [`Kelime: ${target.word}`, target.meaning && `Anlam: ${target.meaning}`, target.context].filter(Boolean).join("\n");
      await chatStream(next, context, (t) => setMessages([...next, { role: "model", text: t }]));
      void keyStore.refresh();
    } catch (err) {
      setMessages([...next, { role: "model", text: `⚠ ${err instanceof AiClientError ? err.message : "Cevap alınamadı."}` }]);
    } finally {
      setStreaming(false);
    }
  };

  const addToNote = async () => {
    if (!db || !target.noteId || !expl) return;
    const n = await undo.run("Gemini cümlelerini ekleme", () => addExamples(db, target.noteId!, expl.examples, { approved: true }));
    setAdded(n);
  };

  const createCard = () => {
    if (!expl) return;
    writeJSON(PREFILL_KEY, {
      front: expl.word,
      back: expl.meaningsTr.slice(0, 3).join(", "),
      examples: expl.examples.map((x) => ({ text: x.en, translation: x.tr || null })),
    });
    onClose();
    router.push("/ekle?doldur=1");
  };

  const noKey = online && status && !status.hasKey;

  return (
    <Modal title={`Gemini: ${target.word}`} onClose={onClose} wide>
      <div className="space-y-4">
        {!online && <Notice tone="warn">İnternet gerekiyor. Uygulamanın geri kalanı internetsiz çalışmaya devam eder.</Notice>}
        {loading && <p role="status" className="text-ink-soft">Gemini düşünüyor…</p>}
        {error && (
          <Notice tone="error">
            {error}
            {noKey && (
              <>
                {" "}
                <Link href="/ayarlar#gemini" className="font-semibold underline" onClick={onClose}>
                  Ayarlar → Gemini
                </Link>
              </>
            )}
          </Notice>
        )}

        {expl && (
          <section className="space-y-3 rounded-xl border border-rule bg-surface p-4 text-[15px]">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-display text-xl font-semibold">{expl.word}</span>
              {expl.partOfSpeech && <span className="text-sm text-ink-soft">{expl.partOfSpeech}</span>}
              {cached && <span className="ml-auto text-xs text-ink-soft">önbellekten, hak harcanmadı</span>}
            </div>
            {expl.meaningsTr.length > 0 && <p className="font-medium">{expl.meaningsTr.join(", ")}</p>}
            {expl.definitionEn && <p className="text-ink-soft">{expl.definitionEn}</p>}
            {expl.examples.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-ink-soft">Örnekler</h4>
                <ul className="mt-1 space-y-1.5">
                  {expl.examples.map((x) => (
                    <li key={x.en}>
                      <span className="italic">{x.en}</span>
                      {x.tr && <span className="block text-sm text-ink-soft">{x.tr}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <List title="Eş anlamlılar" items={expl.synonyms} />
            <List title="Zıt anlamlılar" items={expl.antonyms} />
            <List title="Sık kalıplar" items={expl.collocations} />
            {expl.ydsNote && (
              <div>
                <h4 className="text-xs font-semibold text-ink-soft">YDS notu</h4>
                <p className="mt-0.5">{expl.ydsNote}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {target.noteId && expl.examples.length > 0 && (
                <Button variant="secondary" onClick={() => void addToNote()} disabled={added !== null}>
                  {added === null ? "Bu cümleleri örneklere ekle" : added ? `${added} cümle eklendi` : "Hepsi zaten ekli"}
                </Button>
              )}
              <Button variant="ghost" onClick={createCard}>
                Bundan kart oluştur
              </Button>
              {cached && (
                <Button variant="ghost" onClick={() => void explain(true)} disabled={loading}>
                  Yeniden üret
                </Button>
              )}
            </div>
          </section>
        )}

        <section aria-label="Sohbet" className="space-y-2">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[90%] whitespace-pre-wrap rounded-xl px-3 py-2 text-[15px] ${m.role === "user" ? "ml-auto bg-accent/15" : "bg-surface"}`}
            >
              {m.text || (streaming && i === messages.length - 1 ? "…" : "")}
            </div>
          ))}
          <div ref={chatEnd} />
          <form onSubmit={send} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={`“${target.word}” hakkında sor (ör. farkı ne, nasıl telaffuz edilir?)`}
              aria-label="Gemini'ye soru"
              disabled={!online || streaming}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 focus:border-accent focus:outline-none"
            />
            <Button type="submit" disabled={!online || streaming || !input.trim()}>
              Sor
            </Button>
          </form>
        </section>

        <p className="text-xs text-ink-soft">
          {PRIVACY}
          {status?.hasKey && ` Bugün ${status.usedToday} / ${status.dailyLimit} istek kullanıldı.`}
        </p>
      </div>
    </Modal>
  );
}

/** Gemini düğmesi: internetsizken pasif ve "İnternet gerekiyor" yazar */
export function AskButton({ onClick, className = "" }: { onClick: () => void; className?: string }) {
  const { online } = useKeyStatus();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!online}
      title={online ? "Gemini'ye sor (G)" : "İnternet gerekiyor"}
      className={`rounded-md px-2.5 py-1.5 text-ink-soft hover:bg-ink/5 hover:text-ink disabled:opacity-40 ${className}`}
    >
      {online ? "Gemini'ye sor" : "Gemini (internet gerekiyor)"}
    </button>
  );
}
