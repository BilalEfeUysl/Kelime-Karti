"use client";
// Desteler sayfasında: ön yüzü karışık (kelime + cümleler) kelime destesi
// bulunursa "kartları düzenleyeyim mi?" önerisi. Ctrl/Cmd+Z ile geri alınabilir.
import { useLiveQuery } from "dexie-react-hooks";
import { useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useUndo } from "@/components/app/undo";
import { Button, Notice } from "@/components/ui";
import { findTidyCandidates, tidyNoteType } from "@/lib/tidy";

const dismissKey = (id: string) => `kk.tidyDismissed.${id}`;
function isDismissed(id: string) {
  try {
    return localStorage.getItem(dismissKey(id)) === "1";
  } catch {
    return false;
  }
}

export function TidyBanner() {
  const { db } = useApp();
  const undo = useUndo();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [dismissed, rerender] = useState(0);
  const found = useLiveQuery(async () => {
    if (!db) return null;
    const c = (await findTidyCandidates(db)).find((x) => !isDismissed(x.noteType.id));
    if (!c) return null;
    const card = await db.cards.where("note_id").equals(c.notes[0].id).first();
    const deck = card && (await db.decks.get(card.deck_id));
    return { c, deckName: deck?.name ?? c.noteType.name };
  }, [db, dismissed]);

  if (done) return <Notice tone="ok">{done}</Notice>;
  if (!db || !found) return null;
  const { c, deckName } = found;
  return (
    <Notice tone="info">
      <div className="space-y-2">
        <p>
          <b>{deckName}</b> destesindeki kartların soru tarafında farklı sayıda örnek cümle var, bu yüzden karışık görünüyor. Düzenleyeyim mi?
        </p>
        <p className="text-sm text-ink-soft">Soru tarafında kelime, okunuşu ve tek bir örnek cümle olur (her tekrarda farklı bir cümle). Cevabı açınca altında anlamı görünür. Çalışma geçmişin değişmez, Ctrl/Cmd+Z ile geri alabilirsin.</p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await undo.run("Kartları düzenleme", () => tidyNoteType(db, c));
                setDone(`${r.notes} kart düzenlendi.`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Düzenleniyor…" : "Kartları düzenle"}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              try {
                localStorage.setItem(dismissKey(c.noteType.id), "1");
              } catch {}
              rerender((n) => n + 1);
            }}
          >
            Olduğu gibi kalsın
          </Button>
        </div>
      </div>
    </Notice>
  );
}
