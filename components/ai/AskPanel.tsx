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
import { Markdown } from "./Markdown";

export const PREFILL_KEY = "kk.add.prefill";

export interface AskTarget {
  word: string;
  meaning?: string;
  /** Kartta o an gösterilen örnek cümle (sohbette bağlam olur, hazır sorular çıkar) */
  sentence?: { text: string; translation?: string | null };
  /** Örnekleri eklenecek not (yoksa "örneklere ekle" gizlenir) */
  noteId?: string;
  /** Sohbette bağlam olarak gidecek kart içeriği (düz metin) */
  context?: string;
}

const PRIVACY = "Kişisel bilgi yazma: ücretsiz katmanda Google verileri model geliştirmek için kullanabilir.";

function Pills({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-semibold text-ink-soft">{title}</h4>
      <div className="flex flex-wrap gap-1.5">
        {items.map((x) => (
          <span key={x} className="rounded-full bg-ink/5 px-2.5 py-1 text-sm">
            {x}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Cümlede kelimeyi (çekimli hâlleri dahil) kalın ve renkli gösterir */
function Highlight({ text, word }: { text: string; word: string }) {
  const w = word.trim();
  if (w.length < 2) return <>{text}</>;
  const esc = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let re: RegExp;
  try {
    re = new RegExp(`(?<![\\p{L}])(${esc}[\\p{L}]*)`, "giu");
  } catch {
    return <>{text}</>;
  }
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <b key={i} className="font-semibold not-italic text-accent">
            {part}
          </b>
        ) : (
          part
        ),
      )}
    </>
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

  // Not: yeni tarayıcılarda scrollIntoView bir Promise döndürür; etkiden geri
  // döndürülmemeli (React onu temizleme fonksiyonu sanıp hata verir)
  useEffect(() => {
    if (messages.length) chatEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [messages]);

  const chatContext = [
    `Kelime: ${target.word}`,
    target.meaning && `Karttaki anlam: ${target.meaning}`,
    target.sentence && `Kartta gösterilen örnek cümle: "${target.sentence.text}"${target.sentence.translation ? ` (çevirisi: ${target.sentence.translation})` : ""}`,
    target.context && `Kartın tüm alanları:\n${target.context}`,
  ]
    .filter(Boolean)
    .join("\n");

  const ask = (question: string) => void sendText(question);
  const send = (e: FormEvent) => {
    e.preventDefault();
    void sendText(input);
  };
  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || streaming) return;
    const next = [...messages, { role: "user" as const, text }];
    setMessages([...next, { role: "model", text: "" }]);
    setInput("");
    setStreaming(true);
    try {
      await chatStream(next, chatContext, (t) => setMessages([...next, { role: "model", text: t }]));
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

  const quick = [
    ...(target.sentence
      ? ["Bu cümleyi Türkçeye çevir", "Kelime bu cümlede tam olarak ne anlama geliyor?", "Bu cümlenin dil bilgisini açıkla"]
      : []),
    "Benzer kelimelerden farkı ne?",
    "Başka bir örnek cümle ver",
  ];

  return (
    <Modal title={`Gemini · ${target.word}`} onClose={onClose} wide>
      <div className="space-y-5">
        {!online && <Notice tone="warn">İnternet gerekiyor. Uygulamanın geri kalanı internetsiz çalışmaya devam eder.</Notice>}
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

        {target.sentence && (
          <figure className="rounded-xl border-l-4 border-accent/50 bg-accent/5 px-4 py-3">
            <figcaption className="mb-1 text-xs font-semibold text-ink-soft">Karttaki cümle</figcaption>
            <blockquote className="italic leading-relaxed">
              <Highlight text={target.sentence.text} word={target.word} />
            </blockquote>
            {target.sentence.translation && <p className="mt-1 text-sm text-ink-soft">{target.sentence.translation}</p>}
          </figure>
        )}

        {loading && !expl && (
          <div role="status" className="space-y-2 rounded-xl border border-rule bg-surface p-4">
            <div className="h-6 w-40 animate-pulse rounded bg-ink/10" />
            <div className="h-4 w-full animate-pulse rounded bg-ink/5" />
            <div className="h-4 w-2/3 animate-pulse rounded bg-ink/5" />
            <span className="sr-only">Gemini düşünüyor…</span>
          </div>
        )}

        {expl && (
          <section className="space-y-4 rounded-xl border border-rule bg-surface p-4 sm:p-5">
            <header>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h3 className="font-display text-2xl font-semibold">{expl.word}</h3>
                {expl.partOfSpeech && (
                  <span className="rounded-full border border-rule px-2.5 py-0.5 text-xs font-medium text-ink-soft">{expl.partOfSpeech}</span>
                )}
                {cached && <span className="ml-auto text-xs text-ink-soft">önbellekten · hak harcanmadı</span>}
              </div>
              {expl.meaningsTr.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {expl.meaningsTr.map((m) => (
                    <span key={m} className="rounded-full bg-accent/10 px-3 py-1 text-[15px] font-medium text-accent">
                      {m}
                    </span>
                  ))}
                </div>
              )}
              {expl.definitionEn && <p className="mt-2.5 text-[15px] italic leading-relaxed text-ink-soft">{expl.definitionEn}</p>}
            </header>

            {expl.examples.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-semibold text-ink-soft">Örnek cümleler</h4>
                <ul className="space-y-2.5">
                  {expl.examples.map((x) => (
                    <li key={x.en} className="border-l-2 border-rule pl-3">
                      <p className="italic leading-relaxed">
                        <Highlight text={x.en} word={expl.word} />
                      </p>
                      {x.tr && <p className="text-sm text-ink-soft">{x.tr}</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Pills title="Eş anlamlılar" items={expl.synonyms} />
              <Pills title="Zıt anlamlılar" items={expl.antonyms} />
            </div>
            <Pills title="Sık kullanılan kalıplar" items={expl.collocations} />

            {expl.ydsNote && (
              <div className="rounded-lg border-l-4 border-mark bg-mark/15 px-3.5 py-2.5">
                <h4 className="text-xs font-semibold text-ink-soft">YDS ipucu</h4>
                <p className="mt-0.5 leading-relaxed">{expl.ydsNote}</p>
              </div>
            )}

            <div className="flex flex-wrap gap-2 border-t border-rule pt-3">
              {target.noteId && expl.examples.length > 0 && (
                <Button variant="secondary" onClick={() => void addToNote()} disabled={added !== null}>
                  {added === null ? "Cümleleri karta ekle" : added ? `${added} cümle eklendi` : "Hepsi zaten ekli"}
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

        <section aria-label="Sohbet" className="space-y-3">
          <h3 className="font-display text-lg font-semibold">Soru sor</h3>
          {messages.length > 0 && (
            <div className="space-y-3">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-accent px-3.5 py-2 text-[15px] text-accent-ink">
                    {m.text}
                  </div>
                ) : (
                  <div key={i} className="max-w-[92%] rounded-2xl rounded-bl-md border border-rule bg-surface px-4 py-3 text-[15px]">
                    <div className="mb-1 text-xs font-semibold text-accent">Gemini</div>
                    {m.text ? (
                      <Markdown text={m.text} />
                    ) : (
                      <span className="inline-flex gap-1 py-1" aria-label="Yazıyor">
                        <span className="size-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.3s]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-ink-soft [animation-delay:-0.15s]" />
                        <span className="size-1.5 animate-bounce rounded-full bg-ink-soft" />
                      </span>
                    )}
                  </div>
                ),
              )}
            </div>
          )}
          <div ref={chatEnd} />
          {!streaming && (
            <div className="flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button
                  key={q}
                  type="button"
                  disabled={!online}
                  onClick={() => ask(q)}
                  className="rounded-full border border-rule bg-surface px-3 py-1.5 text-sm text-ink-soft hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={send} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={target.sentence ? "Kelime ya da cümle hakkında sor…" : `“${target.word}” hakkında sor…`}
              aria-label="Gemini'ye soru"
              disabled={!online || streaming}
              className="min-h-11 min-w-0 flex-1 rounded-lg border border-rule bg-surface px-3 placeholder:text-ink-soft/70 focus:border-accent focus:outline-none"
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
