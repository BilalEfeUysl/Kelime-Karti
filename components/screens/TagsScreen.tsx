"use client";
// ETİKET YÖNETİCİSİ (/etiketler): yeniden adlandır, birleştir, sil.
// Etiketler notların üzerinde durur; hiçbir notta kalmayan etiket listeden
// kendiliğinden kalkar (ayrıca "kullanılmayanları sil" gerekmez).
import { useLiveQuery } from "dexie-react-hooks";
import Link from "next/link";
import { useMemo, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useUndo } from "@/components/app/undo";
import { Button, Modal, Notice } from "@/components/ui";
import { deleteTag, listTags, renameTag, type TagInfo } from "@/lib/browse/ops";
import { quoteSearchValue } from "@/lib/search/parser";

export function TagsScreen() {
  const { db } = useApp();
  const undo = useUndo();
  const notes = useLiveQuery(async () => (db ? db.notes.toArray() : []), [db]);
  const tags = useMemo(() => (notes ? listTags(notes) : []), [notes]);
  const [filter, setFilter] = useState("");
  const [dialog, setDialog] = useState<{ kind: "rename" | "delete"; tag: TagInfo } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!db || !notes) return null;

  const shown = tags.filter((t) => t.name.toLocaleLowerCase("tr").includes(filter.toLocaleLowerCase("tr")));
  const target = name.trim();
  const merging = dialog?.kind === "rename" && tags.some((t) => t.name.toLocaleLowerCase("tr") === target.toLocaleLowerCase("tr") && t.name !== dialog.tag.name);
  const childCount = dialog ? tags.filter((t) => t.name.toLocaleLowerCase("tr").startsWith(`${dialog.tag.name.toLocaleLowerCase("tr")}::`)).length : 0;
  const close = () => (setDialog(null), setError(null));

  return (
    <div className="space-y-5">
      <div>
        <Link href="/ayarlar" className="text-sm text-ink-soft hover:text-ink">
          ← Ayarlar
        </Link>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight">Etiketler</h1>
        <p className="mt-1 text-sm text-ink-soft">
          Alt etiket için <code>::</code> kullan (ör. <code>yds::fiil</code>). Bir etiketi başka bir etiketin adıyla yeniden adlandırırsan ikisi birleşir.
          Hiçbir notta kalmayan etiket listeden kendiliğinden kalkar.
        </p>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Etiket ara"
        aria-label="Etiket ara"
        className="min-h-11 w-full rounded-lg border border-rule bg-surface px-3 focus:border-accent focus:outline-none"
      />
      {message && <Notice tone="ok">{message}</Notice>}

      {tags.length === 0 ? (
        <Notice tone="info">Henüz hiçbir notta etiket yok. Kart eklerken ya da kart tarayıcıdan toplu olarak etiket ekleyebilirsin.</Notice>
      ) : (
        <ul className="divide-y divide-rule overflow-hidden rounded-xl border border-rule bg-surface">
          {shown.map((t) => {
            const depth = t.name.split("::").length - 1;
            return (
              <li key={t.name} className="flex items-center gap-2 px-3 py-2" style={{ paddingLeft: 12 + depth * 16 }}>
                <Link href={`/kartlar?q=${encodeURIComponent(`tag:${quoteSearchValue(t.name)}`)}`} className="min-w-0 flex-1 truncate hover:text-accent">
                  {t.name}
                </Link>
                <span className="text-sm tabular-nums text-ink-soft">{t.count} not</span>
                <button
                  type="button"
                  onClick={() => (setDialog({ kind: "rename", tag: t }), setName(t.name), setError(null))}
                  className="rounded-md px-2.5 py-1.5 text-sm text-ink-soft hover:bg-ink/5 hover:text-ink"
                >
                  Ad değiştir
                </button>
                <button type="button" onClick={() => setDialog({ kind: "delete", tag: t })} className="rounded-md px-2.5 py-1.5 text-sm text-danger hover:bg-danger/10">
                  Sil
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {dialog?.kind === "rename" && (
        <Modal title="Etiketi yeniden adlandır" onClose={close}>
          <form
            className="space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const n = await undo.run("Etiket adı değiştirme", () => renameTag(db, dialog.tag.name, target));
                setMessage(`${n} not güncellendi.`);
                close();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Yeni ad"
              className="min-h-11 w-full rounded-lg border border-rule bg-surface px-3 focus:border-accent focus:outline-none"
            />
            {childCount > 0 && <p className="text-sm text-ink-soft">{childCount} alt etiket de yeni ada taşınacak.</p>}
            {merging && <Notice tone="info">“{target}” zaten var: iki etiket birleşecek.</Notice>}
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={!target || target === dialog.tag.name}>
              {merging ? "Birleştir" : "Kaydet"}
            </Button>
          </form>
        </Modal>
      )}
      {dialog?.kind === "delete" && (
        <Modal title="Etiketi sil" onClose={close}>
          <p>
            “{dialog.tag.name}” etiketi {childCount > 0 ? `ve ${childCount} alt etiketi ` : ""}tüm notlardan kaldırılsın mı? Notlar silinmez.
          </p>
          <div className="mt-4 flex gap-2">
            <Button
              variant="danger"
              onClick={async () => {
                const n = await undo.run("Etiket silme", () => deleteTag(db, dialog.tag.name));
                setMessage(`Etiket ${n} nottan kaldırıldı.`);
                close();
              }}
            >
              Kaldır
            </Button>
            <Button variant="ghost" onClick={close}>
              Vazgeç
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
