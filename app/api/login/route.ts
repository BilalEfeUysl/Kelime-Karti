// İsimle giriş. Şifre yok: sunucu, yazılan ad izin verilen kişilerden biriyse
// o kişinin hesabını açar (ilk girişte hesabı ve profili otomatik oluşturur)
// ve tarayıcıya bir oturum (access + refresh token) döndürür.
//
// Nasıl çalışır: Gizli anahtarla tek kullanımlık bir "giriş bağlantısı"
// üretilir (e-posta GÖNDERİLMEZ) ve hemen sunucuda doğrulanarak oturuma
// çevrilir.
import { createClient } from "@supabase/supabase-js";
import { findMember, memberEmail } from "@/lib/server/members";
import { getAdminClient, jsonError } from "@/lib/supabase/server";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { name?: string } | null;
  const member = findMember(body?.name ?? "");
  if (!member) return jsonError("Bu isimle giriş yapılamaz.", 401);

  const admin = getAdminClient();
  const email = memberEmail(member);

  // 1) Tek kullanımlık giriş bağlantısı üret; hesap yoksa önce oluştur
  let link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (link.error) {
    const created = await admin.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { display_name: member.displayName },
    });
    if (created.error) return jsonError("Hesap oluşturulamadı, tekrar dene.", 500);
    link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  }
  if (link.error || !link.data.user || !link.data.properties?.hashed_token) {
    return jsonError("Giriş yapılamadı, tekrar dene.", 500);
  }
  const userId = link.data.user.id;

  // 2) Profil (üyelik) yoksa oluştur; varsa dokunma (rol / devre dışı ayarı korunur)
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(
      { id: userId, email, display_name: member.displayName, role: member.role },
      { onConflict: "id", ignoreDuplicates: true },
    );
  if (profileError) return jsonError("Profil oluşturulamadı, tekrar dene.", 500);

  const { data: profile } = await admin.from("profiles").select("disabled_at").eq("id", userId).maybeSingle();
  if (profile?.disabled_at) return jsonError("Bu hesap yönetici tarafından devre dışı bırakıldı.", 403);

  // 3) Bağlantıyı doğrulayıp oturuma çevir
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const auth = createClient(url, publicKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth;
  const { data, error } = await auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: link.data.properties.verification_type === "signup" ? "signup" : "magiclink",
  });
  if (error || !data.session) return jsonError("Giriş yapılamadı, tekrar dene.", 500);

  return Response.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
}
