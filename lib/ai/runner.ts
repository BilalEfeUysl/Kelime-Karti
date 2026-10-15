"use client";
// TOPLU ÖRNEK CÜMLE İŞLERİNİ YÜRÜTEN DÖNGÜ (uygulama açıkken çalışır)
//
//  1) Sunucudan işleri al (ai_jobs). Çalışan iş yoksa bekle.
//  2) Bitmemiş notlardan 25'lik parti hazırla (silinmiş notlar ve "zaten X
//     cümlesi var" olanlar atlanır).
//  3) Sunucuya gönder → gelen cümleleri cihaza yaz → ilerlemeyi sunucuya bildir.
//  4) Gemini'nin atladığı kelimeler sonraki partide tekrar denenir (en fazla 2 kez).
//  5) Günlük hak bitince durur, sonra tekrar dener.
// Birden çok sekme açıksa sadece biri çalışır (navigator.locks).
import type { LocalDB } from "@/lib/db/database";
import { AiClientError, aiJson, keyStore } from "./client";
import { addExamples, noteWord } from "./local";
import { BATCH_SIZE, type BatchWord, type ExampleSentence } from "./prompts";

export interface AiJob {
  id: string;
  status: "pending" | "running" | "paused" | "done" | "failed" | "cancelled";
  params: { count: number; level: string; translate: boolean; skipIfHas: number; label: string };
  note_ids: string[];
  done_ids: string[];
  total: number;
  done: number;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface RunnerState {
  phase: "idle" | "running" | "limit" | "error" | "offline" | "nokey";
  message: string | null;
  jobs: AiJob[];
  remainingToday: number;
  dailyLimit: number;
}

const PAUSE_BETWEEN = 4_000; // dakikada ~15 isteği geçmemek için
const IDLE_WAIT = 5 * 60_000;
const LIMIT_WAIT = 30 * 60_000;
const ERROR_WAIT = 60_000;
const MAX_ATTEMPTS = 2;

class Runner {
  state: RunnerState = { phase: "idle", message: null, jobs: [], remainingToday: 0, dailyLimit: 0 };
  private listeners = new Set<() => void>();
  private wake: (() => void) | null = null;
  private db: LocalDB | null = null;
  private started = false;
  private attempts = new Map<string, number>();

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getState = () => this.state;

  private set(patch: Partial<RunnerState>) {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** Beklemeyi kes ve hemen tekrar bak (ör. yeni iş oluşturuldu) */
  poke() {
    this.wake?.();
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        window.removeEventListener("online", done);
        resolve();
      }
      this.wake = done;
      window.addEventListener("online", done);
    });
  }

  start(db: LocalDB) {
    this.db = db;
    if (this.started) return;
    this.started = true;
    const loop = () => this.loop();
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks) void locks.request("kk-ai-runner", loop);
    else void loop();
  }

  async refreshJobs(): Promise<AiJob[]> {
    const r = await aiJson<{ jobs: AiJob[]; remainingToday: number; dailyLimit: number; hasKey: boolean }>("/api/ai/jobs");
    this.set({ jobs: r.jobs, remainingToday: r.remainingToday, dailyLimit: r.dailyLimit, ...(r.hasKey ? {} : { phase: "nokey" }) });
    return r.jobs;
  }

  private async patch(id: string, body: Record<string, unknown>) {
    const r = await aiJson<{ job: AiJob }>("/api/ai/jobs", { method: "PATCH", body: { id, ...body } });
    this.set({ jobs: this.state.jobs.map((j) => (j.id === id ? r.job : j)) });
    return r.job;
  }

  private async loop(): Promise<void> {
    for (;;) {
      const db = this.db;
      if (!db) return;
      if (!navigator.onLine) {
        this.set({ phase: "offline", message: "İnternet yok; bağlanınca devam edecek." });
        await this.sleep(IDLE_WAIT);
        continue;
      }
      try {
        const jobs = await this.refreshJobs();
        if (this.state.phase === "nokey") {
          await this.sleep(IDLE_WAIT);
          continue;
        }
        const job = jobs.find((j) => j.status === "running");
        if (!job) {
          this.set({ phase: "idle", message: null });
          await this.sleep(IDLE_WAIT);
          continue;
        }
        if (this.state.remainingToday <= 0) {
          this.set({ phase: "limit", message: "Bugünkü Gemini hakkın bitti; yarın kaldığı yerden devam edecek." });
          await this.sleep(LIMIT_WAIT);
          continue;
        }
        this.set({ phase: "running", message: null });
        await this.step(db, job);
        await this.sleep(PAUSE_BETWEEN);
      } catch (err) {
        const e = err instanceof AiClientError ? err : null;
        if (e?.code === "quota" || e?.code === "limit") {
          this.set({ phase: "limit", message: e.message });
          await this.sleep(LIMIT_WAIT);
        } else if (e?.code === "offline" || e?.code === "auth") {
          this.set({ phase: "offline", message: e.message });
          await this.sleep(IDLE_WAIT);
        } else if (e?.code === "no_key" || e?.code === "bad_key") {
          this.set({ phase: "nokey", message: e.message });
          await this.sleep(IDLE_WAIT);
        } else {
          this.set({ phase: "error", message: e?.message ?? "Beklenmeyen hata; 1 dakika sonra tekrar denenecek." });
          await this.sleep(ERROR_WAIT);
        }
      }
    }
  }

  /** Bir parti işler */
  private async step(db: LocalDB, job: AiJob) {
    const done = new Set(job.done_ids);
    const pending = job.note_ids.filter((id) => !done.has(id));
    const skip: string[] = [];
    const batch: BatchWord[] = [];
    const types = new Map((await db.note_types.toArray()).map((t) => [t.id, t]));
    for (const id of pending) {
      if (batch.length >= BATCH_SIZE) break;
      const note = await db.notes.get(id);
      if (!note || note.deleted_at !== null || (this.attempts.get(id) ?? 0) >= MAX_ATTEMPTS) {
        skip.push(id);
        continue;
      }
      if (job.params.skipIfHas > 0) {
        const have = (await db.note_examples.where("note_id").equals(id).toArray()).filter((e) => e.deleted_at === null).length;
        if (have >= job.params.skipIfHas) {
          skip.push(id);
          continue;
        }
      }
      const { word, meaning } = noteWord(note, types.get(note.note_type_id));
      if (!word) {
        skip.push(id);
        continue;
      }
      batch.push({ id, word, meaning: meaning || undefined });
    }

    if (!batch.length) {
      await this.patch(job.id, { doneIds: skip.length ? skip : pending });
      return;
    }
    const r = await aiJson<{ results: Record<string, ExampleSentence[]>; missing: string[]; remainingToday: number }>("/api/ai/examples", {
      body: { jobId: job.id, items: batch },
    });
    for (const [noteId, sentences] of Object.entries(r.results)) await addExamples(db, noteId, sentences);
    const finished = [...skip, ...Object.keys(r.results)];
    for (const id of r.missing) {
      const n = (this.attempts.get(id) ?? 0) + 1;
      this.attempts.set(id, n);
      if (n >= MAX_ATTEMPTS) finished.push(id); // iki kez olmadı: atla
    }
    await this.patch(job.id, { doneIds: finished, error: null });
    this.set({ remainingToday: r.remainingToday });
    void keyStore.refresh();
  }

  async create(noteIds: string[], params: Partial<AiJob["params"]>): Promise<AiJob> {
    const r = await aiJson<{ job: AiJob }>("/api/ai/jobs", { body: { noteIds, params } });
    this.set({ jobs: [r.job, ...this.state.jobs] });
    this.poke();
    return r.job;
  }

  async setStatus(id: string, status: "running" | "paused" | "cancelled") {
    await this.patch(id, { status });
    this.poke();
  }
}

export const aiRunner = new Runner();
