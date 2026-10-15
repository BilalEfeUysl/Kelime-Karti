"use client";
// Giriş: sadece ad yazılır. İzin verilen kişiler sunucuda tutulur
// (lib/server/members.ts); burada hiçbir isim listesi yoktur.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { useOnline } from "@/components/app/hooks";
import { Button, Notice, TextField } from "@/components/ui";
import { getSupabase } from "@/lib/supabase/client";

export function LoginScreen() {
  const router = useRouter();
  const { user, hasSession } = useApp();
  const online = useOnline();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Zaten giriş yapılmışsa ana sayfaya
  useEffect(() => {
    if (user && hasSession) router.replace("/");
  }, [user, hasSession, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        access_token?: string;
        refresh_token?: string;
        error?: string;
      };
      if (!res.ok || !body.access_token || !body.refresh_token) {
        throw new Error(body.error ?? "Giriş yapılamadı.");
      }
      const { error } = await getSupabase().auth.setSession({
        access_token: body.access_token,
        refresh_token: body.refresh_token,
      });
      if (error) throw error;
      router.replace("/");
    } catch (err) {
      const message = (err as Error).message;
      setError(/failed to fetch|network|load failed/i.test(message) ? "Sunucuya ulaşılamadı. İnternet bağlantını kontrol et." : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h1 className="font-display text-[28px] font-semibold leading-tight">Giriş yap</h1>
      {user && hasSession === false && (
        <p className="mt-2 text-ink-soft">
          Oturumun sona erdi. Cihazındaki değişiklikler duruyor; tekrar giriş yapınca eşlenecek.
        </p>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4">
        {!online && <Notice tone="warn">Giriş için internet gerekiyor. Bağlantın gelince tekrar dene.</Notice>}
        <TextField
          label="Adın"
          autoComplete="username"
          autoCapitalize="words"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy || !name.trim()}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </Button>
      </form>
      <p className="mt-6 text-sm text-ink-soft">
        Bir kez giriş yapman yeterli; bu cihaz seni hatırlar ve sonra internetsiz de açılır.
      </p>
      <Link href="/kurulum" className="mt-3 inline-block text-sm text-ink-soft hover:text-ink">
        Uygulamayı ana ekrana ekleme rehberi
      </Link>
    </div>
  );
}
