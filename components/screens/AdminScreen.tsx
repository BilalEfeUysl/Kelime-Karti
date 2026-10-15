"use client";
// Yönetim: kullanım göstergeleri ve kullanıcılar.
// Bu sayfa sunucudan canlı veri okur; internet gerekir.
import { useCallback, useEffect, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useOnline } from "@/components/app/hooks";
import { Button, InfoRow, Notice, Section } from "@/components/ui";
import { formatBytes } from "@/lib/storage";
import { getSupabase } from "@/lib/supabase/client";

interface UserProfile {
  id: string;
  display_name: string | null;
  role: "admin" | "user";
  gemini_daily_limit: number;
  disabled_at: string | null;
  created_at: string;
}

interface Usage {
  db_bytes: number;
  storage_bytes: number;
  users: number;
  gemini_today: number;
}

const FREE_DB = 500 * 1024 ** 2;
const FREE_STORAGE = 1024 ** 3;
const pct = (used: number, total: number) => `%${Math.round((used / total) * 100)}`;

export function AdminScreen() {
  const { profile, user } = useApp();
  const online = useOnline();
  const [usage, setUsage] = useState<Usage | null>(null);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const [u, p] = await Promise.all([
      sb.rpc("admin_usage"),
      sb.from("profiles").select("id, display_name, role, gemini_daily_limit, disabled_at, created_at").order("created_at"),
    ]);
    const err = u.error ?? p.error;
    if (err) return setError(err.message);
    setError(null);
    setUsage(u.data as Usage);
    setUsers((p.data ?? []) as UserProfile[]);
  }, []);

  useEffect(() => {
    if (online && profile?.role === "admin") void load();
  }, [online, profile?.role, load]);

  if (profile?.role !== "admin") {
    return <Notice tone="error">Bu sayfa sadece yöneticiler içindir.</Notice>;
  }

  const toggleDisabled = async (u: UserProfile) => {
    const { error } = await getSupabase()
      .from("profiles")
      .update({ disabled_at: u.disabled_at ? null : new Date().toISOString() })
      .eq("id", u.id);
    if (error) setError(error.message);
    await load();
  };

  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-semibold leading-tight">Yönetim</h1>
      {!online && <Notice tone="warn">Yönetim sayfası için internet gerekiyor.</Notice>}
      {error && <Notice tone="error">{error}</Notice>}

      <Section title="Kullanım (ücretsiz plan)">
        <dl>
          <InfoRow label="Veritabanı">
            {usage ? `${formatBytes(usage.db_bytes)} / 500 MB (${pct(usage.db_bytes, FREE_DB)})` : "—"}
          </InfoRow>
          <InfoRow label="Resim deposu">
            {usage ? `${formatBytes(usage.storage_bytes)} / 1 GB (${pct(usage.storage_bytes, FREE_STORAGE)})` : "—"}
          </InfoRow>
          <InfoRow label="Kullanıcı">{usage?.users ?? "—"}</InfoRow>
          <InfoRow label="Bugünkü Gemini isteği">{usage?.gemini_today ?? "—"}</InfoRow>
        </dl>
      </Section>

      <Section title="Kullanıcılar">
        {users.length === 0 ? (
          <p className="text-ink-soft">Henüz kimse giriş yapmadı.</p>
        ) : (
          <ul className="divide-y divide-rule">
            {users.map((u) => (
              <li key={u.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
                <span className="font-medium">{u.display_name}</span>
                <span className="text-sm text-ink-soft">{u.role === "admin" ? "Yönetici" : "Kullanıcı"}</span>
                {u.disabled_at && <span className="text-sm text-danger">Devre dışı</span>}
                {u.id !== user?.id && (
                  <Button
                    variant="ghost"
                    className="ml-auto min-h-9 px-2.5 text-sm"
                    disabled={!online}
                    onClick={() => void toggleDisabled(u)}
                  >
                    {u.disabled_at ? "Etkinleştir" : "Devre dışı bırak"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-sm text-ink-soft">
          Kişiler ilk giriş yaptıklarında burada görünür. Devre dışı bırakılan kişi giriş ve eşleme yapamaz.
        </p>
      </Section>
    </div>
  );
}
