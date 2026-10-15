"use client";
// Uygulamanın "beyni": kim giriş yaptı, hangi cihaz veritabanı açık,
// senkron motoru çalışıyor mu? Tüm sayfalar bu bilgiye useApp() ile ulaşır.
//
// İNTERNETSİZ AÇILIŞ: Giriş yapan kullanıcının kimliği localStorage'da
// ("kk.user") saklanır. Uygulama açılınca önce buna bakılır; sunucuya
// sormadan cihaz veritabanı açılır. Böylece internet yokken de çalışır.
import Dexie from "dexie";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { dbNameFor, type LocalDB, openLocalDB } from "@/lib/db/database";
import { requestPersistentStorage, readJSON, writeJSON } from "@/lib/storage";
import { ensureDefaults } from "@/lib/notetypes/builtins";
import { startAutoSync } from "@/lib/sync/auto";
import { SyncEngine } from "@/lib/sync/engine";
import { SupabaseMediaTransport, SupabaseSyncTransport, subscribeRemoteChanges } from "@/lib/sync/supabase-transport";
import type { MediaTransport } from "@/lib/sync/transport";
import { getSupabase, supabaseConfigured } from "@/lib/supabase/client";

const USER_KEY = "kk.user";
const profileKey = (id: string) => `kk.profile.${id}`;

export interface LocalUser {
  id: string;
  email: string;
}

export interface Profile {
  email: string;
  display_name: string | null;
  role: "admin" | "user";
}

interface AppState {
  /** localStorage okundu mu (ilk çizimde false) */
  ready: boolean;
  user: LocalUser | null;
  db: LocalDB | null;
  engine: SyncEngine | null;
  /** Resimleri sunucudan indirmek/yüklemek için */
  media: MediaTransport | null;
  profile: Profile | null;
  /** Supabase oturumu geçerli mi? null = henüz bilinmiyor */
  hasSession: boolean | null;
  signOut: () => Promise<void>;
  /** Cihazdaki veriyi siler ve sayfayı yeniler (oturum kalır; her şey sunucudan yeniden iner) */
  resetLocal: () => Promise<void>;
}

const AppContext = createContext<AppState | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<LocalUser | null>(null);
  const [db, setDb] = useState<LocalDB | null>(null);
  const [engine, setEngine] = useState<SyncEngine | null>(null);
  const [media, setMedia] = useState<MediaTransport | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  // 1) Cihazda kayıtlı kullanıcıyı oku (sunucuya sormadan)
  useEffect(() => {
    setUser(readJSON<LocalUser>(USER_KEY));
    setReady(true);
  }, []);

  // 2) Supabase oturum olaylarını dinle (giriş, çıkış, token yenileme)
  useEffect(() => {
    if (!supabaseConfigured) return;
    const { data } = getSupabase().auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        const next = { id: session.user.id, email: session.user.email ?? "" };
        setHasSession(true);
        setUser((prev) => (prev?.id === next.id && prev.email === next.email ? prev : next));
        writeJSON(USER_KEY, next);
      } else if (event === "SIGNED_OUT" || event === "INITIAL_SESSION") {
        // Oturum yok/bitti. Cihazdaki veri SİLİNMEZ; kullanıcı internetsiz
        // çalışmaya devam edebilir, eşleme için tekrar giriş yapması gerekir.
        setHasSession(false);
      }
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // 3) Kullanıcı belli olunca: cihaz veritabanını aç, senkron motorunu başlat
  const userId = user?.id;
  useEffect(() => {
    if (!userId || !supabaseConfigured) return;
    let cancelled = false;
    let opened: LocalDB | undefined;
    let stopAuto: (() => void) | undefined;
    (async () => {
      opened = await openLocalDB(userId);
      if (cancelled) return opened.close();
      const sb = getSupabase();
      const mediaTransport = new SupabaseMediaTransport(sb);
      const eng = await new SyncEngine({
        db: opened,
        transport: new SupabaseSyncTransport(sb),
        media: mediaTransport,
        isOnline: () => navigator.onLine,
      }).load();
      if (cancelled) return opened.close();
      setDb(opened);
      setEngine(eng);
      setMedia(mediaTransport);
      stopAuto = startAutoSync(eng);
      // İlk eşleme bitince (sunucudaki veri indikten sonra) hazır not tipleri,
      // varsayılan deste ve ayar yoksa oluşturulur.
      const unsub = eng.subscribe((s) => {
        if (s.initialSyncDone) {
          queueMicrotask(() => unsub());
          void ensureDefaults(opened!);
        }
      });
      void requestPersistentStorage();
    })();
    return () => {
      cancelled = true;
      stopAuto?.();
      opened?.close();
      setDb(null);
      setEngine(null);
      setMedia(null);
    };
  }, [userId]);

  // 3b) Realtime: başka cihaz bir şey gönderince hemen pull yap.
  // Sadece geçerli oturum varken (yoksa boşuna bağlanmaya çalışmasın).
  useEffect(() => {
    if (!engine || !userId || !hasSession) return;
    return subscribeRemoteChanges(getSupabase(), userId, engine.db.deviceId, () => void engine.sync());
  }, [engine, userId, hasSession]);

  // 4) Profil (rol, ad): önce cihazdaki kopya, çevrimiçiyse sunucudan tazesi
  useEffect(() => {
    if (!userId) {
      setProfile(null);
      return;
    }
    setProfile(readJSON<Profile>(profileKey(userId)));
    if (!hasSession || !supabaseConfigured) return;
    void getSupabase()
      .from("profiles")
      .select("email, display_name, role")
      .eq("id", userId)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setProfile(data as Profile);
          writeJSON(profileKey(userId), data);
        }
      });
  }, [userId, hasSession]);

  /** Çıkış: oturumu kapatır ve BU CİHAZDAKİ veriyi siler (sunucudaki veri durur).
   *  Eşlenmemiş değişiklik uyarısı çağıran ekranda gösterilir. */
  const resetLocal = useCallback(async () => {
    if (!user) return;
    db?.close();
    await Dexie.delete(dbNameFor(user.id));
    window.location.reload();
  }, [user, db]);

  const signOut = useCallback(async () => {
    if (!user) return;
    db?.close();
    try {
      await getSupabase().auth.signOut({ scope: "local" });
    } catch {
      // internetsizken de çıkış yapılabilsin
    }
    try {
      localStorage.removeItem("kk-auth");
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(profileKey(user.id));
    } catch {
      // önemli değil
    }
    setUser(null);
    setHasSession(false);
    await Dexie.delete(dbNameFor(user.id));
  }, [user, db]);

  const value = useMemo<AppState>(
    () => ({ ready, user, db, engine, media, profile, hasSession, signOut, resetLocal }),
    [ready, user, db, engine, media, profile, hasSession, signOut, resetLocal],
  );

  if (!supabaseConfigured) return <MissingConfig />;
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp, AppProvider içinde kullanılmalı");
  return ctx;
}

function MissingConfig() {
  return (
    <main className="mx-auto max-w-lg px-4 py-16">
      <h1 className="font-display text-2xl font-semibold">Kurulum tamamlanmamış</h1>
      <p className="mt-3 text-ink-soft">
        Supabase bağlantı bilgileri bulunamadı. Proje klasöründeki <code>.env.example</code> dosyasını{" "}
        <code>.env.local</code> adıyla kopyalayıp değerleri doldur, sonra geliştirme sunucusunu yeniden başlat.
        Ayrıntılar README.md dosyasında.
      </p>
    </main>
  );
}
