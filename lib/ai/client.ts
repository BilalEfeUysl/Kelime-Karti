"use client";
// TARAYICI: Gemini API yollarına oturumla istek atar.
// Anahtar burada YOK; sunucu kişinin şifreli saklanan anahtarını kullanır.
import { getSupabase } from "@/lib/supabase/client";
import type { Explanation } from "./prompts";

export class AiClientError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AiClientError("Gemini için oturum gerekli: tekrar giriş yap.", "auth", 401);
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

export async function aiFetch(path: string, init: { method?: string; body?: unknown } = {}): Promise<Response> {
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new AiClientError("İnternet gerekiyor.", "offline", 0);
  let res: Response;
  try {
    res = await fetch(path, {
      method: init.method ?? (init.body === undefined ? "GET" : "POST"),
      headers: await authHeaders(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  } catch {
    throw new AiClientError("Sunucuya ulaşılamıyor. İnternet bağlantını kontrol et.", "offline", 0);
  }
  if (!res.ok) {
    const j = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
    throw new AiClientError(j?.error ?? `İstek başarısız (${res.status}).`, j?.code ?? "error", res.status);
  }
  return res;
}

export async function aiJson<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  return (await aiFetch(path, init)).json() as Promise<T>;
}

export interface KeyStatus {
  hasKey: boolean;
  last4: string | null;
  dailyLimit: number;
  usedToday: number;
  model: string;
}

// Anahtar durumu: tüm ekranlar aynı bilgiyi paylaşsın diye küçük bir depo
let keyStatus: KeyStatus | null = null;
const listeners = new Set<() => void>();
export const keyStore = {
  get: () => keyStatus,
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  set(s: KeyStatus | null) {
    keyStatus = s;
    for (const l of listeners) l();
  },
  async refresh(): Promise<KeyStatus | null> {
    try {
      keyStore.set(await aiJson<KeyStatus>("/api/ai/key"));
    } catch {
      // internet yok / oturum yok: eski bilgi kalsın
    }
    return keyStatus;
  },
};

export function explainWord(word: string, meaning?: string, refresh = false) {
  return aiJson<{ explanation: Explanation; cached: boolean }>("/api/ai/explain", { body: { word, meaning, refresh } });
}

/** Sohbet: cevap parça parça gelir; her parçada onChunk çağrılır */
export async function chatStream(
  messages: { role: "user" | "model"; text: string }[],
  context: string | undefined,
  onChunk: (textSoFar: string) => void,
): Promise<string> {
  const res = await aiFetch("/api/ai/chat", { body: { messages, context } });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    onChunk(text);
  }
  return text;
}
