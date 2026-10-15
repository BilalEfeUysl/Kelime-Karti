// Toplu örnek cümle işleri (sunucuda ai_jobs tablosunda): listele, oluştur, güncelle.
// İş uygulama açıkken ilerler; durum sunucuda olduğu için başka cihazdan da devam edilir.
import { AiError, aiErrorResponse, requireMember, usedToday } from "@/lib/server/ai/gemini";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLS = "id, status, params, note_ids, done_ids, total, done, error, created_at, updated_at";

export async function GET(req: Request) {
  try {
    const ctx = await requireMember(req);
    const { data, error } = await ctx.admin
      .from("ai_jobs")
      .select(COLS)
      .eq("user_id", ctx.user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new AiError("İşler okunamadı.", 500);
    const { data: key } = await ctx.admin.from("ai_keys").select("daily_limit").eq("user_id", ctx.user.id).maybeSingle();
    const used = await usedToday(ctx);
    return Response.json({ jobs: data ?? [], remainingToday: key ? Math.max(0, key.daily_limit - used) : 0, dailyLimit: key?.daily_limit ?? 0, hasKey: !!key });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    const ctx = await requireMember(req);
    const body = (await req.json().catch(() => null)) as { noteIds?: string[]; params?: Record<string, unknown> } | null;
    const noteIds = [...new Set((body?.noteIds ?? []).filter((id) => UUID.test(id)))].slice(0, 20000);
    if (!noteIds.length) throw new AiError("Seçimde not yok.", 400, "bad_request");
    const p = body?.params ?? {};
    const params = {
      count: Math.min(5, Math.max(1, Math.round(Number(p.count) || 2))),
      level: String(p.level || "YDS / B1-B2").slice(0, 60),
      translate: p.translate !== false,
      skipIfHas: Math.min(10, Math.max(0, Math.round(Number(p.skipIfHas) || 0))),
      label: String(p.label || "").slice(0, 120),
    };
    const { data, error } = await ctx.admin
      .from("ai_jobs")
      .insert({ user_id: ctx.user.id, status: "running", params, note_ids: noteIds, total: noteIds.length })
      .select(COLS)
      .single();
    if (error) throw new AiError("İş oluşturulamadı.", 500);
    return Response.json({ job: data });
  } catch (err) {
    return aiErrorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const ctx = await requireMember(req);
    const body = (await req.json().catch(() => null)) as { id?: string; status?: string; doneIds?: string[]; error?: string | null } | null;
    if (!body?.id || !UUID.test(body.id)) throw new AiError("İş kimliği eksik.", 400, "bad_request");
    const { data: job } = await ctx.admin.from("ai_jobs").select("note_ids, done_ids, total, status").eq("id", body.id).eq("user_id", ctx.user.id).maybeSingle();
    if (!job) throw new AiError("İş bulunamadı.", 404, "bad_request");
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.doneIds?.length) {
      const allowed = new Set(job.note_ids as string[]);
      const done = [...new Set([...(job.done_ids as string[]), ...body.doneIds.filter((id) => allowed.has(id))])];
      patch.done_ids = done;
      patch.done = done.length;
      if (done.length >= job.total) patch.status = "done";
    }
    if (body.status && ["running", "paused", "cancelled"].includes(body.status) && job.status !== "done") patch.status = body.status;
    if (body.error !== undefined) {
      patch.error = body.error ? String(body.error).slice(0, 300) : null;
      patch.last_error_at = body.error ? new Date().toISOString() : null;
    }
    const { data, error } = await ctx.admin.from("ai_jobs").update(patch).eq("id", body.id).eq("user_id", ctx.user.id).select(COLS).single();
    if (error) throw new AiError("İş güncellenemedi.", 500);
    return Response.json({ job: data });
  } catch (err) {
    return aiErrorResponse(err);
  }
}
