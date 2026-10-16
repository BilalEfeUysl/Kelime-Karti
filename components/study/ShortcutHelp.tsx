"use client";
// Çalışma kısayolları listesi (? tuşu). Değiştirmek için: Ayarlar → Görünüm.
import Link from "next/link";
import { Modal } from "@/components/ui";
import { ACTION_LABELS, keyLabel, type StudyAction, useAppearance } from "@/lib/appearance";

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const { shortcuts } = useAppearance();
  const fixed: [string, string][] = [
    ["Enter", "Cevabı göster / İyi"],
    ["Ctrl/Cmd+Z", "Geri al"],
    ["Ctrl/Cmd+Shift+Z", "Yinele"],
    ["?", "Bu liste"],
  ];
  return (
    <Modal title="Klavye kısayolları" onClose={onClose}>
      <dl className="divide-y divide-rule text-sm">
        {(Object.keys(ACTION_LABELS) as StudyAction[]).map((a) => (
          <div key={a} className="flex justify-between py-1.5">
            <dt>{ACTION_LABELS[a]}</dt>
            <dd>
              <kbd className="rounded border border-rule bg-surface px-1.5 py-0.5 font-mono text-xs">{keyLabel(shortcuts[a])}</kbd>
            </dd>
          </div>
        ))}
        {fixed.map(([k, l]) => (
          <div key={k} className="flex justify-between py-1.5">
            <dt>{l}</dt>
            <dd>
              <kbd className="rounded border border-rule bg-surface px-1.5 py-0.5 font-mono text-xs">{k}</kbd>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-ink-soft">
        Değiştirmek için{" "}
        <Link href="/ayarlar#gorunum" className="text-accent underline" onClick={onClose}>
          Ayarlar → Görünüm
        </Link>
        .
      </p>
    </Modal>
  );
}
