// Hazır not tiplerinin ve alanlarının adları veride İngilizce kalır (şablonlar
// {{Front}} gibi bu adlara bağlı; dışa aktarılan paketler de uyumlu kalsın).
// Arayüzde bunların Türkçe karşılıkları gösterilir.

const NOTE_TYPE_LABELS: Record<string, string> = {
  Basic: "Basit",
  "Basic (and reversed card)": "Basit (ters kart da)",
  "Basic (optional reversed card)": "Basit (isteğe bağlı ters kart)",
  "Basic (type in the answer)": "Basit (cevabı yazarak)",
  Cloze: "Boşluk doldurma",
  "Image Occlusion": "Resim maskeleme",
};

const FIELD_LABELS: Record<string, string> = {
  Front: "Soru",
  Back: "Cevap",
  Text: "Metin",
  "Back Extra": "Ek bilgi",
  "Add Reverse": "Ters kart (doluysa ters kart da oluşur)",
  Header: "Başlık",
  Comments: "Açıklama",
  Image: "Resim",
  Occlusion: "Maskeler",
};

/** Not tipinin arayüzde görünen adı */
export function noteTypeLabel(name: string): string {
  return NOTE_TYPE_LABELS[name] ?? name;
}

/** Alanın arayüzde görünen adı */
export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name;
}
