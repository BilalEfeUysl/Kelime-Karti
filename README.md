# Kelime Kartı

İnternetsiz de çalışan, cihazlar arasında eşlenen, çok kullanıcılı bir kelime kartı (flashcard) uygulaması.
Telefonda ve bilgisayarda aynı site kullanılır; ana ekrana / Dock'a eklenince uygulama gibi açılır (PWA).

> Uygulamanın adı `lib/config.ts` içindeki `APP_NAME` sabitinden değiştirilebilir.

**Durum:** Tüm fazlar (0–6) tamamlandı. Son eklenenler (Faz 6): Anki'ye dışa aktarma (.apkg/.colpkg), metin dışa aktarma, yedek indir/geri yükle, haftalık otomatik sunucu yedeği, bakım araçları.

---

## İçindekiler

1. [Nasıl çalışır? (kısa)](#nasıl-çalışır-kısa)
2. [Klasör yapısı](#klasör-yapısı)
3. [Kurulum (adım adım)](#kurulum-adım-adım)
4. [Giriş: isimle](#giriş-isimle)
5. [Kullanım](#kullanım)
6. [Bilgisayarında çalıştırma](#bilgisayarında-çalıştırma)
7. [Eşlemeyi iki pencerede deneme](#eşlemeyi-iki-pencerede-deneme)
8. [Testler](#testler)
9. [Vercel'e yayınlama](#vercele-yayınlama)
10. [Telefona / Mac'e kurma](#telefona--mace-kurma)
11. [Sınırlar ve önemli notlar](#sınırlar-ve-önemli-notlar)
12. [Sorun giderme](#sorun-giderme)

---

## Nasıl çalışır? (kısa)

**"Önce cihaz, sonra eşle" (local-first):**

- Ekranda gördüğün her şey cihazdaki veritabanından (**IndexedDB**, Dexie.js ile) okunur ve oraya yazılır. Bu yüzden internet olsa da olmasa da aynı hızda çalışır.
- Her değişiklik ayrıca **outbox** (gönderilecekler kuyruğu) tablosuna not edilir.
- **Senkron motoru** (`lib/sync/`) arka planda:
  - **PUSH:** kuyruktaki değişiklikleri paketler halinde sunucuya (Supabase) gönderir.
  - **PULL:** sunucuda her satırın artan bir sıra numarası (`server_seq`) vardır. Cihaz "en son gördüğüm numara"yı saklar, sadece ondan sonrakileri çeker.
- **Çakışma kuralları:**
  - Cevap geçmişi (`review_logs`) sadece eklenir; iki cihazdaki cevapların hepsi korunur.
  - Kartların zamanlama alanlarında son tekrarı daha yeni olan kazanır. Diğer alanlarında (deste, bayrak…) son düzenleyen kazanır.
  - Diğer her şeyde son yazan kazanır. Zaman damgası olarak **HLC** (hybrid logical clock) kullanılır; telefonun saati yanlış olsa bile doğru sıralar.
  - Silme gerçek silme değildir: satır `deleted_at` ile işaretlenir, böylece silme de eşlenir. Bir cihazda silinen şey diğerinde *daha sonra* düzenlenirse düzenleme kazanır (son yazan kazanır).
- **Ne zaman eşlenir?** Uygulama açılınca, internet gelince, uygulama öne gelince veya arka plana giderken, değişiklikten ~3 sn sonra, açıkken 5 dakikada bir, "Şimdi eşle" butonuyla ve başka cihaz bir şey gönderdiğinde (Supabase Realtime sinyali).

## Klasör yapısı

```
app/                      Sayfalar (Next.js App Router)
  page.tsx                Desteler (sayılar, alt desteler, sürükle-bırak)
  calis/                  Çalışma ekranı (/calis?deste=…)
  ekle/                   Kart ekleme
  iceaktar/               Anki paketi (.apkg/.colpkg) ve CSV/TXT içe aktarma
  deste-ayarlari/         Deste seçenekleri ve ayar grupları (preset)
  kartlar/                Kart tarayıcı (/kartlar?q=arama)
  not-tipleri/            Not tipi yöneticisi (/not-tipleri?id=…)
  etiketler/              Etiket yöneticisi
  ornek-cumleler/         Gemini ile toplu örnek cümle üretimi + onay bekleyenler
  istatistikler/          İstatistikler (hepsi cihazda hesaplanır)
  disa-aktar/             Anki paketi, metin, yedek
  bakim/                  Bakım araçları
  api/fsrs/optimize/      FSRS kişisel parametre hesaplama (sunucu, resmi fsrs-rs)
  api/ai/                 Gemini yolları (sunucu): key, explain, chat, examples, jobs
  giris/                  Giriş (sadece ad yazılır)
  ayarlar/                Hesap, eşleme durumu, kullanım, tema, çıkış
  admin/                  Yönetim: kullanıcılar, kullanım göstergeleri
  kurulum/                "Ana Ekrana Ekle" rehberi
  cevrimdisi/             İnternetsiz açılamayan sayfa için yedek sayfa
  api/login/              İsimle giriş (sunucu tarafı)
  sw.ts                   Service worker (uygulama kabuğunu önbelleğe alır)
  serwist/[path]/         Service worker dosyasını üreten route
  manifest.ts             PWA bildirimi (ad, ikonlar, standalone)
components/
  app/                    Uygulama çerçevesi, durum göstergesi, bantlar, AppProvider, veri kancaları (data.ts)
  screens/                Ekranlar (Desteler, Çalışma, Ekle, Kartlar, Not tipleri, Etiketler, Ayarlar…)
  browse/                 Kart tarayıcı parçaları: tablo, sol panel, sağ panel, toplu işlemler
  card/CardFrame.tsx      Kartı kum havuzlu (sandbox) iframe içinde gösterir
  editor/                 Zengin metin editörü (araç çubuğu, alanlar), etiket kutusu, örnek cümle düzenleyici
  app/undo.ts             Geri al / yinele kancası
  ai/                     "Gemini'ye sor" paneli, Ayarlar → Gemini bölümü
  study/                  Not düzenleme ve kart bilgisi pencereleri
  ui/                     Buton, metin kutusu, pencere gibi küçük parçalar
lib/
  config.ts               APP_NAME, saat dilimi, gün başlangıcı gibi sabitler
  db/                     Cihaz veritabanı: tablolar (database.ts), tipler, yazma fonksiyonları (mutations.ts)
  sync/                   Senkron motoru: hlc.ts, merge.ts, engine.ts, transport.ts, media.ts, auto.ts
  supabase/               Supabase istemcileri (tarayıcı + sunucu)
  server/members.ts       Girebilecek kişilerin listesi (sadece sunucuda)
  server/ai/              Gemini (sadece sunucu): anahtar şifreleme, istemci, günlük sayaç, hata mesajları
  ai/                     İstemler + cevap doğrulama (prompts.ts), tarayıcı istekleri (client.ts), toplu iş döngüsü (runner.ts)
  template/               Kart şablonu motoru (Anki sözdizimi, cloze, "cevabı yaz" karşılaştırması)
  notetypes/builtins.ts   Hazır not tipleri (Basic, Cloze…) ve varsayılan deste
  cards/generate.ts       Bir nottan hangi kartların oluşacağı
  scheduler/              FSRS + klasik (sm2.ts) zamanlayıcı, yük dengeleme, gün hesabı, sınırlar ve çalışma sırası, optimize.ts
  filtered.ts             Filtreli desteler (topla / boşalt / yeniden oluştur)
  io.ts                   Resim maskeleme: maske biçimi (Anki ile aynı), kart katmanı
  math.ts                 Formüller (KaTeX) — generated/katex-css.ts gömülü yazı tipli stil
  appearance.ts           Cihaza özel görünüm tercihleri ve kısayollar
  customStudy.ts          Özel çalışma (bugünlük sınır artışı, unutulanlar, ileriyi tekrar…)
  stats.ts                İstatistik hesapları
  export/                 Anki paketi yazıcı (anki.ts), metin (text.ts)
  backup.ts               Yedek oluştur / geri yükle / haftalık otomatik
  maintenance.ts          Veritabanı kontrolü, boş kartlar, kullanılmayan resimler, temizlik
  study/actions.ts        Cevap kaydetme, göm, askıya al, bayrak, işaret
  undo.ts                 Çok seviyeli geri al / yinele (değişen satırların önceki/sonraki hâli)
  search/                 Anki arama dili: ayrıştırıcı (parser.ts) ve uygulayıcı (evaluate.ts)
  browse/ops.ts           Toplu işlemler: deste/etiket/bul-değiştir/tarih ata/unut/not tipi değiştir/kopyalar
  notetypes/manage.ts     Not tipi oluştur/sil, alan ve şablon değişikliklerini kartlara uygula
  import/                 .apkg/.colpkg okuyucu, Anki → uygulama dönüştürücü, CSV/TXT
  notes.ts                Not ekleme / güncelleme / silme
  decks.ts                Deste ağacı yardımcıları
supabase/migrations/      Sunucu veritabanı şeması (SQL)
tests/                    Otomatik testler (Vitest)
fixtures/                 Elle denemek için örnek dosyalar (npm run fixtures ile üretilir)
scripts/                  İkon üretici, örnek paket üretici, sql.js wasm kopyalayıcı
```

---

## Kurulum (adım adım)

### 1. Gerekenler

- **Node.js 20 veya üstü** ve **npm** (kontrol: `node -v`)
- Ücretsiz bir **Supabase** hesabı: https://supabase.com
- (Yayın için) ücretsiz **GitHub** ve **Vercel** hesapları

### 2. Supabase projesi oluştur

1. https://supabase.com/dashboard adresine gir → **New project**.
2. **Name:** `kelime-karti` (istediğin ad).
3. **Database Password:** güçlü bir şifre üret ve bir yere kaydet (uygulama kullanmıyor, ama ileride lazım olabilir).
4. **Region:** Türkiye'ye yakın olsun: **Central EU (Frankfurt)**.
5. **Plan:** Free → **Create new project**. 1-2 dakika bekle.

### 3. Veritabanı şemasını kur

`supabase/migrations/` klasöründeki dosyaları **dosya adı sırasıyla** (en küçük numaradan başlayarak) çalıştır:

1. Sol menüden **SQL Editor**'e tıkla → **New query**.
2. İlk dosyayı (`20261013000001_init.sql`) aç, **tamamını** kopyala, editöre yapıştır.
3. Sağ alttaki **Run** düğmesine bas. "Success. No rows returned" görmelisin.
4. Sonraki dosyalar (`…02_advisor_fixes.sql`, `…03_name_login.sql`, `…04_review_log_undo.sql`, `…05_ai_keys.sql`, `…06_backups_maintenance.sql`) için 1–3. adımları sırayla tekrarla.

> Yeni fazlarda yeni migration dosyaları eklenecek; her seferinde sadece yeni dosyaları çalıştırman yeterli.

> Supabase CLI kullanmayı biliyorsan bunun yerine `supabase link` + `supabase db push` de olur.

### 4. Giriş (Auth) ayarları

Sol menü → **Authentication** → **Sign In / Providers**:
- **Allow new users to sign up** seçeneğini **KAPAT** → Save.
  (Hesapları sadece bizim sunucumuz, `/api/login` üzerinden açar; dışarıdan kimse hesap oluşturamaz.)
- **Email** sağlayıcısı **açık** kalsın (giriş arka planda onu kullanıyor; kimseye e-posta gönderilmez).

### 5. Realtime'ı kontrol et (opsiyonel)

Migration, `sync_heads` tablosunu otomatik olarak Realtime yayınına ekler. Kontrol etmek için:
**Database** → **Publications** → `supabase_realtime` → `sync_heads` işaretli olmalı.
(Bu, iki cihaz aynı anda açıkken değişikliklerin birkaç saniye içinde diğerine geçmesini sağlar. Olmasa da eşleme çalışır; sadece uygulama öne gelince ya da 5 dakikada bir eşlenir.)

### 6. Anahtarları `.env.local` dosyasına yaz

1. Proje klasöründe `.env.example` dosyasını kopyala, adını `.env.local` yap:
   ```bash
   cp .env.example .env.local
   ```
2. Supabase panelinde **Project Settings** (sol alttaki dişli) → **Data API**: **Project URL**'i kopyala → `NEXT_PUBLIC_SUPABASE_URL=` satırına yapıştır.
3. **Project Settings** → **API Keys**:
   - **Publishable key** (`sb_publishable_...`) → `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=`
   - **Secret key** (`sb_secret_...`, "Reveal" ile göster) → `SUPABASE_SECRET_KEY=`
   - Eski tip anahtarlar görüyorsan (*anon* ve *service_role*): anon → `NEXT_PUBLIC_SUPABASE_ANON_KEY`, service_role → `SUPABASE_SERVICE_ROLE_KEY` olarak da yazabilirsin.

4. **Gemini anahtarlarını şifrelemek için** bir sır üret ve `GEMINI_KEY_SECRET=` satırına yaz:
   ```bash
   openssl rand -base64 32
   ```
   (Bu değeri sonradan değiştirirsen kayıtlı Gemini anahtarları okunamaz; herkes anahtarını yeniden girer.) İstersen `GEMINI_MODEL=` ile modeli değiştirebilirsin; boşsa `gemini-3.5-flash-lite`.

> ⚠️ **Secret key gizlidir.** Kimseyle paylaşma, GitHub'a yükleme (`.env.local` zaten `.gitignore`'da).

---

## Giriş: isimle

Kayıt, şifre ve davet kodu yok. Giriş ekranında **adını yazman** yeterli.

- Girebilecek kişiler `lib/server/members.ts` dosyasında yazılı. Bu liste **sadece sunucuda** durur; sitede hiçbir yerde gösterilmez, tarayıcıya gönderilmez.
- Yazım farkları sorun değil: büyük/küçük harf ve Türkçe karakterler (ı/i, ö/o, ş/s…) tolere edilir. Tam ad yazılırsa ilk kelimeye bakılır.
- Bir kişi **ilk kez** giriş yaptığında hesabı ve profili otomatik oluşturulur. Listede `role: "admin"` olan kişi yönetici olur ve **Yönetim** sayfasını görür.
- Her cihazda bir kez giriş yapmak yeterli; cihaz seni hatırlar ve sonra internetsiz de açılır.

**Yeni bir arkadaş eklemek:** `lib/server/members.ts` içindeki listeye bir satır ekle (ör. `{ slug: "zeynep", displayName: "Zeynep", role: "user" }` — `slug` küçük harf ve Türkçe karaktersiz olmalı), sonra yeniden yayınla (`git push`).

**Birini engellemek:** **Yönetim → Kullanıcılar → Devre dışı bırak** (hemen etkili olur; giriş ve eşleme yapamaz). Kalıcı olarak çıkarmak için listeden de satırını sil.

> ⚠️ **Bilinçli bir tercih:** Şifre olmadığı için, site adresini ve listedeki bir adı bilen herkes o kişi olarak girebilir. Adresi sadece arkadaşlarınla paylaş. İleride istersen giriş ekranına kişi başı kısa bir PIN eklemek kolay.

---

## Kullanım

**Menü:** bilgisayarda solda sabit bir menü (Desteler, Kart ekle, Kartlar, İstatistikler, Ayarlar) ve en altında eşleme durumu; telefonda aynı menü ekranın altındadır. Seyrek kullanılan sayfalar (İçe aktar, Örnek cümleler, Etiketler, Not tipleri, Dışa aktar ve yedek, Bakım) **Ayarlar → Diğer araçlar** altındadır. Hazır not tiplerinin ve alanlarının adları arayüzde Türkçe görünür (Basic → Basit, Front/Back → Soru/Cevap); veride İngilizce kalır, böylece dışa aktarılan paketler uyumlu kalır.

### Desteler (ana sayfa)

- Her destede üç sayı vardır: **Yeni** (bugün açılacak yeni kart), **Öğrenme** (öğrenme adımındaki kart), **Tekrar** (bugün tekrarı gelen kart). Sayılar günlük sınırlara göre hesaplanır.
- **Alt deste:** adına `::` yaz. `YDS::Fiiller` yazınca `YDS` ve altında `Fiiller` oluşur.
- **Taşıma:** bilgisayarda bir desteyi sürükleyip başka bir destenin üstüne bırak. Sürüklerken listenin altında beliren kesikli kutuya bırakırsan en üst seviyeye çıkar. Telefonda destenin **⋯** menüsünden **Taşı**'yı kullan.
- **⋯ menüsü:** Ad değiştir, Taşı, Kart ekle, Deste seçenekleri, Sil. Silinen destenin alt desteleri ve kartları da silinir (onay sorulur).
- Alt destesi olan bir destenin solundaki ok ile alt desteler gizlenir ya da gösterilir.
- İlk girişte **Varsayılan** adlı bir deste ve 6 hazır not tipi otomatik oluşur (boş Varsayılan deste, başka deste varken listede gizlenir).

### Kart ekleme (Ekle)

- **Not tipi** ve **Deste** seç, alanları doldur. Son seçtiğin not tipi ve deste hatırlanır.
- Hazır not tipleri:
  - **Basic:** ön yüz → arka yüz (1 kart).
  - **Basic (and reversed card):** iki yönlü (2 kart).
  - **Basic (optional reversed card):** "Add Reverse" alanı doluysa ters kart da oluşur.
  - **Basic (type in the answer):** cevabı yazarsın, harf harf karşılaştırılır.
  - **Cloze:** boşluk doldurma. `{{c1::kelime}}`, ikinci boşluk `{{c2::…}}`, ipucu `{{c1::kelime::ipucu}}`.
- **Etiketler:** boşlukla ayır. Yazarken var olan etiketler önerilir.
- **Resim:** bir alana resmi yapıştır (Ctrl/Cmd+V) ya da sürükleyip bırak. En fazla 10 MB.
- **Örnek cümleler:** "+ Cümle ekle" ile cümle ve (istersen) Türkçe çevirisini ekle. Kartın arka yüzünde gösterilir.
- **Ctrl/Cmd + Enter** ile ekler (etiket kutusundayken de çalışır).
- **Araç çubuğu:** kalın, italik, altı çizili, üst/alt simge, yazı rengi, vurgulama, madde/numaralı liste, bağlantı, hizalama, biçimi temizle ve **HTML görünümü** (`</>`: alanın ham HTML'ini düzenle).
- **Cloze kısayolları:** metni seç, **Alt+C** yeni numara (`c1`, `c2`…), **Alt+Shift+C** aynı numara. (Ctrl/Cmd+Shift+C de çalışır; ama Chrome bu tuşu “öğeyi incele” için kullanabilir.)
- **Yapışkan alan:** alan adının yanındaki iğneye bas; kart eklendikten sonra o alan temizlenmez (aynı kaynaktan çok kart eklerken işe yarar).
- **Kopya uyarısı:** ilk alana yazdığın kelime aynı not tipinde zaten varsa altında uyarı ve **Göster** bağlantısı çıkar.

### Örnek cümleler nasıl görünür?

- Hazır not tiplerinin arka yüzünde `{{Example}}` vardır. Bir notun birden çok örnek cümlesi varsa **her gösterimde rastgele biri** görünür (aynısı arka arkaya gelmez). Altında **"Diğer örnekleri göster (n)"** ile kalanlar açılır.
- Kelime cümlede **kalın** gösterilir (`abandon` → "They **abandoned** the car.").
- Çeviri sadece **cevap tarafında** görünür.
- Kendi şablonlarında `{{Example}}` (bir cümle) ya da `{{Examples}}` (hepsi, liste) kullanabilirsin.

### Resim maskeleme (Image Occlusion)

**Ekle → Not tipi: Image Occlusion.**
1. Resmi sürükle, yapıştır ya da **Resim seç**.
2. Araç seç: **Dikdörtgen**, **Elips** ya da **Çokgen** (çokgende noktalara tek tek tıkla; bitirmek için ilk noktaya tıkla, çift tıkla ya da Enter). Resmin üzerinde gizlemek istediğin yerleri çiz.
3. **Seç / taşı** ile maskeleri seç (Shift ile çoklu), sürükleyip taşı, **Sil** (Delete), **Grupla** (birlikte tek kartta sorulsun) ya da **Ayır**.
4. Mod: **Hepsini gizle, birini sor** (diğer maskeler de kapalı kalır) ya da **Birini gizle, birini sor**.
5. Her maske (ya da grup) ayrı bir kart olur. Soruda sorulan maske turuncu, cevapta açılır.

Anki'den içe aktarılan resim maskeleme notları da aynı biçimi kullanır ve otomatik olarak bu görünüme çevrilir.

### Formüller ve Japonca okunuş

- Alanlara Anki'deki gibi `\( x^2 \)` (satır içi) ya da `\[ \frac{a}{b} \]` (ayrı satır) yaz. Kartta güzel çizilir; internetsiz de çalışır (KaTeX; MathJax sözdiziminin aynısı).
- Şablonda `{{furigana:Alan}}`, `{{kana:Alan}}`, `{{kanji:Alan}}`: `日本語[にほんご]` biçimi okunuşu üstte gösterir / sadece okunuşu / sadece kanjiyi verir.

### Görünüm ve kısayollar

**Ayarlar → Görünüm** (bu cihaza özel): tema, kart yazı boyutu, kart ölçeği, koyu temada kartlar (kartın kendi stili / her zaman koyu zemin / açık kalsın), **sade çalışma modu** (sayılar ve işlem düğmeleri gizlenir) ve **çalışma kısayollarını değiştirme** (düğmeye bas, yeni tuşa bas; aynı tuş başka işe bağlıysa ikisi yer değiştirir). Çalışırken **?** tuşu kısayol listesini açar.

### Geri al / yinele

- Her sayfada **Ctrl/Cmd+Z** geri al, **Ctrl/Cmd+Shift+Z** (ya da Ctrl+Y) yinele. Son **50 işlem** hatırlanır; işlemin adı bildirimde yazar (“Geri alındı: Deste değiştirme”).
- Geri alınabilenler: cevaplar, göm/askıya al/bayrak/işaret, not ekleme/düzenleme/silme, deste işlemleri, deste seçenekleri, kart tarayıcıdaki tüm toplu işlemler, not tipi ve etiket değişiklikleri.
- Telefonda kart tarayıcıdaki **Geri al / Yinele** düğmelerini, çalışırken **Geri al**'ı kullan.
- Yazı kutusunun içindeyken Ctrl/Cmd+Z o kutudaki yazıyı geri alır (tarayıcının kendi özelliği).
- Geçmiş sayfa yenilenince sıfırlanır. İçe aktarma geri alınamaz (gerekirse desteyi sil).

### Çalışma

Desteye tıkla → **Çalışmaya başla**.

| Tuş | İş |
| --- | --- |
| Boşluk / Enter | Cevabı göster; cevap açıksa **İyi** (Enter sabit; diğerleri Ayarlar → Görünüm'den değiştirilebilir) |
| G | Gemini'ye sor |
| ? | Kısayol listesi |
| 1 / 2 / 3 / 4 | Tekrar / Zor / İyi / Kolay (düğmelerin üstünde bir sonraki aralık yazar) |
| Ctrl/Cmd + Z | Geri al (son cevap, erteleme, askıya alma, bayrak, işaret) |
| E | Notu düzenle |
| I | Kart bilgisi (durum, aralık, kararlılık, tekrar geçmişi) |
| Ctrl + 1…7 | Bayrak (kırmızı, turuncu, yeşil, mavi, pembe, turkuaz, mor). Aynısına tekrar basınca kalkar |
| * | Notu işaretle (`marked` etiketi) |
| - / = | Kartı / notu yarına ertele |
| @ / ! | Kartı / notu askıya al |

- Telefonda büyük cevap düğmeleri ekranın altındadır. Klavye yoksa aynı işler **Diğer ▾** menüsündedir.
- **"Cevabı yaz" kartları:** kutuya yazıp Enter'a bas. Doğru harfler yeşil, yanlışlar kırmızı, eksikler gri görünür.
- **Sıra:** önce zamanı gelmiş öğrenme kartları, sonra tekrarlar ve yeni kartlar karışık. Öğrenme kartı 20 dakika içinde gelecekse oturum bitmeden gösterilir.
- **Zamanlayıcı:** FSRS (Anki'nin yeni algoritması). Her cevap ayrıca **cevap geçmişine** yazılır ve eşlenir.

### Deste seçenekleri

Destenin ⋯ menüsü → **Seçenekler** (ya da çalışma sayfasındaki **Deste seçenekleri**). Ayarlar **ayar grubu (preset)** içinde durur; aynı grubu birden çok deste kullanabilir.

- **Günlük sınırlar:** yeni kart / gün, tekrar / gün. **Sadece bu desteye özel sınır** grubun sınırının yerine geçer. Üst destenin sınırı alt destelerin toplamını keser.
- **Yeni kartlar:** öğrenme adımları (`1m 10m`), toplama sırası (deste / eklenme / rastgele not / rastgele kart), gösterim sırası, yeni–tekrar karışımı (karışık / önce yeniler / önce tekrarlar). Klasik algoritmada mezuniyet ve kolay aralığı.
- **Unutmalar:** yeniden öğrenme adımları, en kısa aralık, (klasikte) yeni aralık, **sülük** eşiği ve eylemi (sadece `leech` etiketi / etiketle + askıya al).
- **Gösterim sırası ve kardeş kartlar:** tekrarların sırası (vadesi en eski, unutulmaya en yakın, aralık, zorluk, rastgele); yeni / tekrar / günlük öğrenme kardeşlerini yarına gömme.
- **Algoritma:** **FSRS** (önerilen) ya da **klasik SM-2** (başlangıç kolaylığı, kolay bonusu, aralık çarpanı, zor aralığı). FSRS'te istenen hatırlama oranı ve en uzun aralık.
  - **Parametreleri optimize et:** en az 400 tekrar varsa, bu ayar grubunu kullanan destelerin geçmişinden kişisel FSRS parametreleri hesaplanır (sunucuda resmi FSRS kütüphanesi, ~1 sn; sadece puan ve tarih gönderilir). **Kaydet** ile uygulanır; **Varsayılana dön** ile geri alınır.
  - **Tahmini günlük tekrar yükü:** %80, %85, %90, %95 hatırlama oranında günde kaç tekrar düşeceği.
- **Yük dengeleme:** aralık birkaç gün oynatılabildiğinde en boş gün seçilir (her şey aynı güne yığılmaz). **Kolay günler:** haftanın bir gününü “yarım” ya da “boş” yaparsan o güne daha az tekrar düşer.
- **Zamanlayıcılar:** en uzun cevap süresi (istatistik için), cevabı otomatik gösterme ve otomatik ilerleme (“İyi” / “Tekrar” say ya da göm).
- **Gün başlangıcı ve saat dilimi:** **Ayarlar → Çalışma** (varsayılan 04:00, Europe/Istanbul).

### Yöneticinin desteleri herkeste (paylaşılan desteler)

Yöneticinin (Bilal) **içinde kart olan her destesi** diğer herkesin deste listesinde de kendiliğinden çıkar. Herkes **kendi kopyasını kendi hızında** çalışır: kimin hangi kelimeyi bildiği, tekrar zamanları ve istatistikler kişiye özeldir.

- Yönetici sonradan kart ekler, düzeltir ya da silerse bu değişiklik diğerlerinde de bir sonraki eşlemede görünür. Çalışma ilerlemesi bozulmaz.
- Bir üye kendi kopyasında bir kartı düzenlerse onun düzeltmesi kalır (yönetici aynı kartı tekrar düzenleyene kadar).
- Üyelerin kendi eklediği desteler sadece kendilerinde kalır.
- "Kartları düzenle" önerisi sadece yöneticiye çıkar: yönetici desteyi düzenleyince düzenlenmiş hâli herkese gider.
- Boş "Varsayılan" deste paylaşılmaz. Resimler de gelir (dosyalar yöneticinin Storage klasöründen okunur).

Nasıl çalışır: istemci her eşlemede `sync_shared_decks()` fonksiyonunu çağırır; sunucu eksik kopyaları ekler, eskimiş olanları günceller (`supabase/migrations/20261016000007_shared_decks.sql`). Test: `tests/shared.test.ts`.

### Filtreli desteler ve özel çalışma

- **Filtreli deste:** bir aramaya uyan kartları geçici bir desteye toplar (Kartlar'da bir arama yapıp **Bunları çalış**, ya da destenin çalışma ekranında **Özel çalışma**). Ayarlar: arama, en fazla kart, sıra, **cevaplarıma göre yeniden zamanla** (kapalıysa sadece alıştırma, zamanlama değişmez), isteğe bağlı **ikinci filtre**. Menüden **Yeniden oluştur**, **Boşalt**, **Filtreyi düzenle**, **Sil** (kartlar kendi destelerine döner). Listede “F” rozetiyle görünür; askıdaki ve yarına ertelenmiş kartlar alınmaz.
- **Özel çalışma** (bir destenin çalışma sayfasında): bugünkü yeni / tekrar sınırını artır (sadece bugün), unutulan kartlar (son N gün), ileriyi tekrar et (N gün), yeni kartları önizle, etikete göre çalış. Sınır artışı dışındakiler “Özel çalışma oturumu” adlı filtreli desteye toplanır.

### İstatistikler

**Menü → İstatistikler.** Deste ve zaman aralığı (1 ay / 3 ay / 1 yıl) seç. Bugünün özeti (cevap, süre, doğru oranı, seri), çalışma takvimi (son bir yıl), gelecek yük, günlük cevap ve süre, kart sayıları (yeni / öğreniliyor / genç / olgun / askıda / gömülü), aralık–zorluk–kararlılık–hatırlama olasılığı–kolaylık dağılımları, saatlere göre başarı, düğme kullanımı, eklenen kartlar ve doğru cevap oranı tablosu. Her grafiğin üzerine gelince ayrıntı çıkar; “Tablo olarak göster” ile sayılar listelenir. Hepsi cihazda hesaplanır, internet gerekmez.

**Hatırlatma:** O gün hiç çalışmadıysan ve bekleyen kart varsa deste listesinin üstünde bir bant çıkar (“Kapat” o gün için gizler).

### Dışa aktarma ve yedek

**Ayarlar → Diğer araçlar → Dışa aktar ve yedek.**

- **Anki paketi (.apkg):** bir deste ya da tüm koleksiyon; Anki masaüstü / AnkiDroid / AnkiMobile içe aktarabilir. Çalışma geçmişi dahil ya da hariç (hariçse kartlar yeni gider). Resimler dahildir. **Örnek cümleler** yeni bir “Examples” alanına (ya da seçtiğin bir alanın sonuna) liste olarak eklenir; şablonlardaki `{{Example}}` bu alana çevrilir. Resim maskeleme notları Anki'nin kendi maskeleme tipine çevrilir.
- **Tüm koleksiyon (.colpkg):** Anki'de açılınca oradaki koleksiyonun **yerine geçer**; var olan Anki'ye eklemek için .apkg kullan.
- **Metin (.txt):** sekmeyle ayrılmış; not tipi, deste, alanlar, (örnekler), etiketler. Excel/Sheets'te açılır; Anki ve bu uygulama geri okur.
- **Yedek:** “Şimdi yedekle” tüm veriyi (istersen resimlerle) sıkıştırılmış `.json.gz` olarak indirir. “Yedekten geri yükle” yedekteki kayıtları cihaza yazar ve eşler (yedekten sonra eklediklerin silinmez).
- **Haftalık otomatik yedek:** açıkken (varsayılan) uygulama haftada bir sunucuya sıkıştırılmış yedek koyar; en fazla son 3 tanesi saklanır. Aynı yerden listele, indir, geri yükle ya da “Şimdi sunucuya yedekle”.

### Bakım

**Ayarlar → Diğer araçlar → Bakım.** Her araç önce ne bulduğunu gösterir; onaylamadan bir şey değişmez (sıfırlama hariç hepsi Ctrl/Cmd+Z ile geri alınır).

- **Veritabanını kontrol et:** notu/destesi silinmiş kartlar, şablonu olmayan ya da kopya kartlar, kartsız notlar, öksüz örnek cümleler → **Düzelt**.
- **Boş kartlar:** ön yüzü artık boş kalan kartları bul ve sil.
- **Kullanılmayan resimler:** hiçbir notta geçmeyen resimleri bul ve sil (sunucudaki kopyası da silinir; resim kotası 1 GB).
- **Kopya notlar:** her not tipinde ilk alanı aynı olan notlar; **Göster** ile kart tarayıcıda aç.
- **Eski silinmiş kayıtları temizle:** 90 günden eski “silindi” işaretli kayıtları cihazdan ve sunucudan kaldırır (90 günden uzun açılmamış bir cihazın varsa önce onu eşle).
- **Yerel veriyi sıfırla:** bu cihazdaki kopyayı silip her şeyi sunucudan yeniden indirir (gönderilmemiş değişiklik varsa uyarır).

### İçe aktarma

**Desteler → İçe aktar** (her şey cihazında işlenir, internet gerekmez; sonra eşlenir).

**Anki paketi (.apkg) ya da koleksiyonu (.colpkg):**
- Anki'nin üç dosya biçimi de okunur (eski `collection.anki2`, `collection.anki21` ve yeni sıkıştırılmış `collection.anki21b`). Anki'de **Dışa aktar** yaparken "eski Anki sürümleriyle uyumlu" kutusunu işaretlemek gerekmez.
- **Çalışma geçmişini de al:** işaretlersen kartların durumu ve cevap geçmişi de gelir; işaretlemezsen hepsi yeni kart olur. (.colpkg'de varsayılan olarak işaretli.)
- **Aynı not zaten varsa** (Anki not kimliği, GUID): Güncelle / Atla / Kopya oluştur.
- **Resimler** alınır (10 MB'tan büyükler atlanır). **Ses ve video atlanır**, sonuçta kaç tane atlandığı yazar.
- **Örnek cümle sihirbazı:** her not tipi için "Kelime hangi alanda?" ve "Örnek cümle hangi alanda?" sorulur (alan adlarından tahmin edilir). Örnek alanındaki cümleler satırlara, maddelere ve "1. … 2. …" numaralarına göre ayrılıp örnek cümle olarak kaydedilir. "{{Example}} kullan" seçilirse kart şablonunda o alan yerine her seferinde farklı bir cümle gösterilir.

**Karışık kelime desteleri ("Kartları düzenle"):** internetten indirilen bazı destelerde (ör. YDS 1000) ön yüze kelimeyle birlikte 1-3 örnek cümle de yazılmış olur; çoğu da Word'den kopyalanmış gizli stiller taşır. Böyle bir deste bulunursa Desteler sayfasında öneri çıkar. **Kartları düzenle** deyince:
- ön yüzde sadece **kelime** ve altında küçük harfle **okunuş + tür** kalır (not tipine "Okunuş" alanı eklenir; "Ön/Geri" alanlarının adı **Kelime/Anlam** olur),
- ön yüzdeki cümleler uygulamanın **örnek cümle** listesine taşınır; soru tarafında kelimenin altında **tek bir cümle** görünür, her tekrarda sıradaki farklı cümle gelir,
- cevabı açınca altta **anlam** görünür,
- arka yüzdeki Word çöpü temizlenir.

Çalışma geçmişi değişmez; Ctrl/Cmd+Z ile geri alınabilir. "Olduğu gibi kalsın" dersen öneri o cihazda bir daha çıkmaz. Kod: `lib/tidy.ts`, test: `tests/tidy.test.ts`.

**Metin dosyası (.txt, .csv, .tsv):**
- Ayırıcı (sekme, virgül, noktalı virgül, dikey çizgi) otomatik tahmin edilir, istersen değiştir.
- Anki'den "Notes in Plain Text" ile alınan dosyaların başlıkları (`#separator:tab`, `#html:true`, `#tags column:3`) anlaşılır.
- Her sütun için ne olduğunu seç: alan, etiketler, örnek cümle, örnek cümlenin çevirisi ya da yok say.
- Ön yüzü boş kalan satırlar atlanır.

**Denemek için örnek dosyalar:** `fixtures/` klasöründe hazır: `ornek-eski-format.apkg`, `ornek-yeni-format.apkg` (resim, ses, cloze, çalışma geçmişi, örnek cümle alanı içerir) ve `ornek-kelimeler.txt`. Yeniden üretmek için:

```bash
npm run fixtures
```

---

## Bilgisayarında çalıştırma

```bash
npm install
npm run dev
```

Tarayıcıda http://localhost:3000 adresini aç.

- Geliştirme modunda (`npm run dev`) **service worker kapalıdır** (önbellek kafa karıştırmasın).
- İnternetsiz açılmayı ve "Yeni sürüm hazır" bandını denemek için üretim modunu kullan:
  ```bash
  npm run build
  npm run start
  ```

---

## Eşlemeyi iki pencerede deneme

İki ayrı tarayıcı "cihaz" gibi davranır. Örneğin **Chrome** ve **Safari**, ya da Chrome'da normal pencere + **gizli pencere**.

**Hazırlık:**
1. `npm run build && npm run start` ile uygulamayı başlat (ya da Vercel adresini kullan).
2. Pencere A'da ve Pencere B'de **aynı adla** giriş yap.
3. Sağ üstteki göstergede **"Çevrimiçi • Eşlendi"** görmelisin.

**Deneme 1: Çevrimiçi eşleme**
1. A'da `YDS::Fiiller` yazıp **Oluştur**'a bas. Listede `YDS` ve altında `Fiiller` görünür.
2. Birkaç saniye içinde B'de de görünmeli. (Görünmezse B'nin göstergesine tıkla = "Şimdi eşle".)

**Deneme 2: İnternetsiz değişiklik**
1. A'da internetsiz moda geç. Chrome'da **F12 → Network** sekmesi → **No throttling** yazan menüden **Offline**. Ya da Wi-Fi'yi kapat.
2. Gösterge **"Çevrimdışı"** olur. A'da `Phrasal verbs` destesi oluştur. Gösterge **"Çevrimdışı • 1 değişiklik bekliyor"** der.
3. B'de bu deste görünmez (normal).
4. A'da tekrar **Online**'a dön. Birkaç saniye içinde gösterge **"Çevrimiçi • Eşlendi"** olur ve B'de de deste görünür.

**Deneme 3: Çakışma (son yazan kazanır)**
1. A'yı internetsiz yap. A'da `Fiiller` destesini **Ad değiştir** ile `Fiiller (A)` yap.
2. B'de (çevrimiçi) aynı desteyi `Fiiller (B)` yap.
3. A'yı tekrar çevrimiçi yap. İki pencerede de **daha sonra yapılan** değişiklik (B) görünür.

**Deneme 4: Silme + düzenleme**
1. A'yı internetsiz yap, A'da bir desteyi sil.
2. B'de aynı desteyi *daha sonra* yeniden adlandır.
3. A çevrimiçi olunca deste ikisinde de **geri gelir** (son yazan düzenleme olduğu için). Sıra tersi olursa (önce düzenleme, sonra silme) deste silinmiş kalır.

**Deneme 5: Uygulama internetsiz açılıyor mu?**
1. Üretim modunda (`npm run start` veya Vercel) siteyi bir kez aç, giriş yap.
2. Sunucuyu kapat (terminalde Ctrl+C) ya da uçak moduna geç.
3. Sayfayı yenile. Uygulama yine açılmalı ve desteler görünmeli.

Ayrıntılar için **Ayarlar → Eşleme** bölümüne bak: son eşleme zamanı, bekleyen değişiklik sayısı, "Şimdi eşle" ve teknik ayrıntılar (cihaz kimliği, son sunucu sırası).

---

## Testler

```bash
npm test
```

- `tests/sync.test.ts`: Senkron senaryoları. Testlerde **gerçek Postgres** (PGlite, tarayıcı/WASM sürümü) çalışır ve `supabase/migrations` altındaki SQL **aynen** kullanılır. Yani sunucu kodu da test edilir. Senaryolar:
  - İki cihazda internetsizken deste oluşturma → eşleme
  - Aynı desteyi iki cihazda yeniden adlandırma (sonra yapan kazanır)
  - Bir cihazda silme, diğerinde düzenleme (iki sıra için de)
  - Aynı karta iki cihazdan cevap (iki cevap da geçmişte, zamanlama sonrakinden)
  - Kart bir cihazda çalışılır, diğerinde destesi değişir (ikisi de korunur)
  - Saati 1 saat geri olan cihaz (HLC)
  - Eşleme sürerken yapılan değişiklik, kaybolan sunucu cevabı (çift kayıt yok)
  - 250 satırlık ilk indirme, sayfalama ve ilerleme
  - Güvenlik: başka kullanıcının verisi görünmez, üstüne yazılamaz; profili olmayan kullanıcı eşleyemez
  - Hatalı bir satır diğerlerini engellemez; eski uygulama sürümü eksik sütunla yazarsa veri silinmez
  - Aynı resmin iki cihazda eklenmesi (tek kayıt, tek yükleme, üçüncü cihaz indirir)
  - Geri alınan bir cevabın diğer cihazlarda da geri alınmış görünmesi
  - Sunucunun reddettiği bir resim (ör. çok büyük) notların gönderilmesini engellemez; internet yoksa resim sonra tekrar denenir
- `tests/template.test.ts`: şablon motoru (alanlar, koşullu bölümler, FrontSide, cloze, ipucu, "cevabı yaz" karşılaştırması, {{Example}}).
- `tests/scheduler.test.ts`: FSRS, öğrenme adımları, gün başlangıcı (yaz saati dahil), günlük sınırlar ve alt desteler, çalışma sırası.
- `tests/notes.test.ts`: not ekleme/güncelleme, kart üretimi, geri al / yinele (cevap, göm, askıya al, bayrak, işaret, not silme), 50 işlem sınırı.
- `tests/search.test.ts`: arama dilinin ayrıştırıcısı (ve/veya/değil, parantez, tırnak, kaçış, hatalı aramalar) ve tüm arama türlerinin sonuçları.
- `tests/browse.test.ts`: toplu işlemler (deste, etiket ekle/çıkar/yeniden adlandır/birleştir/sil, bul-değiştir, yeniden sırala, tarih ata, unut, not tipi değiştir, kopyalar) ve toplu işlemin tek adımda geri alınması.
- `tests/notetypes.test.ts`: not tipi kopyalama/silme, şablon ekleme-sıralama-silmenin kartlara etkisi, alan adı değişince şablon güncellemesi, doğrulama.
- `tests/import.test.ts`: eski ve yeni .apkg biçimleri (fixture dosyalarıyla), GUID güncelle/atla/kopya, çalışma geçmişi, resimler, sesin atlanması, örnek cümle sihirbazı, CSV/TXT.
- `tests/scheduling2.test.ts`: klasik algoritma, bulanıklaştırma ve yük dengeleme (kolay günler), iç içe deste sınırları ve bugünlük artış, yeni/tekrar karışımı, filtreli deste (alıştırma modu), sülük, kardeş gömme, istatistik oranları.
- `tests/faz5.test.ts`: resim maskeleme biçimi (oku/yaz), grup başına kart, soru/cevap maske katmanı, furigana filtreleri, KaTeX formül çizimi.
- `tests/faz6.test.ts`: Anki'ye dışa aktarma tam turu (dışa aktar → kendi okuyucumuzla geri oku: alanlar, resim, örnek alanı, zamanlama, FSRS değerleri, geçmiş), geçmişsiz dışa aktarma, metin biçimi, yedek oluştur → yeni cihaza geri yükle, bakım (bul + düzelt).
- `tests/ai.test.ts`: Gemini anahtarının şifrelenmesi, Gemini cevaplarının doğrulanması (bozuk/eksik/tekrarlı cümleler), kota günü.
- `tests/hlc.test.ts`, `tests/merge.test.ts`, `tests/decks.test.ts`, `tests/members.test.ts`: saat, çakışma kuralı, deste ağacı ve isimle giriş eşleştirme testleri.

Tip kontrolü: `npm run typecheck`

---

## Vercel'e yayınlama

### 1. Kodu GitHub'a yükle

GitHub'da yeni, **private** bir depo oluştur (ör. `kelime-karti`). Sonra proje klasöründe:

```bash
git init
git add .
git commit -m "Faz 0"
git branch -M main
git remote add origin https://github.com/KULLANICI_ADIN/kelime-karti.git
git push -u origin main
```

### 2. Vercel'de proje oluştur

1. https://vercel.com → GitHub ile giriş yap → **Add New… → Project**.
2. `kelime-karti` deposunu **Import** et. Framework otomatik **Next.js** seçilir; diğer ayarlara dokunma.
3. **Environment Variables** bölümüne 3 değişkeni ekle (`.env.local`'daki değerlerle aynı):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
   - `SUPABASE_SECRET_KEY`
   - `GEMINI_KEY_SECRET` (ve istersen `GEMINI_MODEL`)
4. **Deploy**'a bas. Bitince `https://kelime-karti-xxxx.vercel.app` gibi bir adres verir.

### 3. Güncelleme yayınlamak

Kodda değişiklik yapıp `git push` yaptığında Vercel otomatik yeniden yayınlar. Açık olan uygulamalarda üstte **"Yeni sürüm hazır"** bandı çıkar; **Yenile**'ye basınca yeni sürüm açılır.

> Ortam değişkenlerini Vercel'de değiştirirsen **Deployments → … → Redeploy** yapman gerekir.

---

## Telefona / Mac'e kurma

Uygulamanın içinde **/kurulum** sayfasında resimli adımlar var. Kısaca:

- **iPhone (Safari):** Paylaş → **Ana Ekrana Ekle** → Ekle.
- **Mac (Safari):** Dosya → **Dock'a Ekle**.
- **Chrome / Edge:** adres çubuğundaki **yükle** simgesi.

İlk açılışta internet gerekir (giriş ve verilerin inmesi için). Sonrasında internetsiz çalışır.

---

## Sınırlar ve önemli notlar

- **Supabase ücretsiz plan:** 500 MB veritabanı, 1 GB dosya (resim), aylık 5 GB veri çıkışı. Yönetim sayfasında veritabanı ve resim kullanımını görebilirsin.
- **Supabase ücretsiz projeler 7 gün hiç kullanılmazsa duraklatılır (pause).** Veriler silinmez; Supabase panelinden **Restore/Resume** ile tekrar açılır. Düzenli kullanımda sorun olmaz.
- **Giriş şifresiz** (bkz. [Giriş: isimle](#giriş-isimle)). Site adresini sadece arkadaşlarınla paylaş.
- **Çıkış yapınca** bu cihazdaki veri silinir (sunucudaki durur). Eşlenmemiş değişiklik varsa uygulama uyarır.
- **iPhone:** Safari, ana ekrana eklenmemiş sitelerin verisini bir süre kullanılmazsa silebilir. Ana ekrana eklemen önerilir. Silinse bile tekrar giriş yapınca her şey sunucudan geri iner; sadece eşlenmemiş değişiklikler kaybolur.
- **Saat dilimi / gün başlangıcı:** varsayılan Europe/Istanbul, 04:00. **Ayarlar → Çalışma**'dan değiştirilir; ayar eşlenir.
- **Ses ve video desteklenmiyor:** içe aktarırken atlanır, kartta `[sound:…]` yazısı da gösterilmez.
- **Resim sınırı:** resim başına 10 MB (Supabase ücretsiz plan dosya kotası 1 GB).
- **Büyük desteler:** içe aktarma tarayıcıda yapılır; on binlerce kartlık bir koleksiyon birkaç dakika sürebilir. Bu sırada sayfayı kapatma. İlk eşleme de (sunucuya gönderme) biraz sürer; sağ üstteki gösterge ilerlemeyi gösterir.
- **Kart içindeki JavaScript** kum havuzunda çalışır: uygulamanın verisine ve oturumuna erişemez.

---

## Sorun giderme

| Belirti | Ne yapmalı |
| --- | --- |
| "Kurulum tamamlanmamış" ekranı | `.env.local` eksik ya da hatalı. Doldurup `npm run dev`'i yeniden başlat. Vercel'de ortam değişkenlerini kontrol et ve Redeploy yap. |
| Girişte "Bu isimle giriş yapılamaz" | Ad `lib/server/members.ts` listesinde yok. Listeye ekleyip yeniden yayınla. |
| Girişte "devre dışı bırakıldı" | Yönetim sayfasından **Etkinleştir**. |
| Gösterge "Eşleme hatası", Ayarlar'da "eşleme izni yok" | Hesap devre dışı bırakılmış ya da profili yok. Çıkış yapıp tekrar adla gir. |
| Gösterge "Oturum gerekli" | Oturum sona erdi. Tekrar adınla giriş yap; değişikliklerin cihazda duruyor. |
| Diğer cihazdaki değişiklik gelmiyor | Göstergeye tıkla (Şimdi eşle). Ayarlar → Eşleme'deki hata mesajına bak. |
| Eski sürüm görünüyor | Üstte "Yeni sürüm hazır" bandını bekle ya da uygulamayı kapatıp aç. Tarayıcıda Ctrl+Shift+R. |
| Girişte "Sunucu ayarları eksik" ya da 500 hatası | `SUPABASE_SECRET_KEY` tanımlı değil (Vercel'de de ortam değişkenlerine ekli olmalı). |
| İçe aktarmada "Dosya okunamadı: …" | Dosya bozuk ya da Anki paketi değil. Anki'de tekrar **Dışa aktar** yap. `.colpkg` yerine tek deste için `.apkg` dene. |
| `npm run dev` sırasında "sql-wasm-browser.wasm" bulunamadı | `npm install` yap; dosya `npm run dev` / `npm run build` öncesinde otomatik kopyalanır. |
| Destede kart var ama "Yeni 0" | Günlük yeni kart sınırına ulaşıldı ya da kartlar yarına ertelendi/askıda. Deste seçeneklerinden sınırı artır. |
| Gemini: “Önce kendi API anahtarını gir” | Ayarlar → Gemini'ye anahtarını yapıştır. |
| Gemini: “Kayıtlı anahtar okunamadı” | `GEMINI_KEY_SECRET` değişmiş ya da Vercel'de eksik. Ekleyip Redeploy yap; gerekirse anahtarı yeniden gir. |
| Gemini: “ücretsiz kullanım sınırın doldu” | Google kotası doldu; Türkiye saatiyle ~10:00–11:00'da sıfırlanır. Toplu iş kendiliğinden bekleyip devam eder. |
| Geri alınan cevap diğer cihazda hâlâ duruyor | `…04_review_log_undo.sql` migration'ı çalıştırılmamış (bkz. Kurulum 3. adım). |
