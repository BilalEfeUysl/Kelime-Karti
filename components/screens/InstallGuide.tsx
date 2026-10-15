"use client";
// "Ana Ekrana Ekle" rehberi: uygulamayı telefona / bilgisayara kurma.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/app/AppProvider";
import { Notice, Section } from "@/components/ui";
import { APP_NAME } from "@/lib/config";
import { isIOS, isStandalone } from "@/lib/storage";

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-accent">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
  );
}

export function InstallGuide() {
  const { user } = useApp();
  const [standalone, setStandalone] = useState(false);
  const [ios, setIos] = useState(false);
  useEffect(() => {
    setStandalone(isStandalone());
    setIos(isIOS());
  }, []);

  const iphone = (
    <Section title="iPhone / iPad (Safari)">
      <Steps
        items={[
          <>Bu sayfayı <strong>Safari</strong> ile aç (Chrome&apos;da da çalışır, ama Safari önerilir).</>,
          <>Alttaki <strong>Paylaş</strong> düğmesine dokun (yukarı ok çıkan kare).</>,
          <>Listeyi kaydırıp <strong>Ana Ekrana Ekle</strong>&apos;yi seç.</>,
          <>Sağ üstteki <strong>Ekle</strong>&apos;ye dokun. Ana ekranda {APP_NAME} simgesi belirir.</>,
          <>Bundan sonra uygulamayı hep bu simgeden aç.</>,
        ]}
      />
    </Section>
  );

  return (
    <div className="space-y-5">
      <h1 className="font-display text-[28px] font-semibold leading-tight">Uygulamayı yükle</h1>
      {standalone ? (
        <Notice tone="ok">Uygulama zaten ana ekrandan açılmış. Her şey hazır.</Notice>
      ) : (
        <p className="text-ink-soft">
          {APP_NAME} bir web uygulamasıdır; mağazadan indirmen gerekmez. Ana ekrana (veya Dock&apos;a) eklediğinde kendi
          penceresinde açılır ve internetsiz de çalışır.
        </p>
      )}

      {ios && iphone}

      <Section title="Mac (Safari)">
        <Steps
          items={[
            <>Siteyi Safari&apos;de aç.</>,
            <>Menü çubuğunda <strong>Dosya → Dock&apos;a Ekle</strong>&apos;yi seç (macOS Sonoma ve sonrası).</>,
            <><strong>Ekle</strong>&apos;ye tıkla. Uygulama Dock&apos;ta ve Launchpad&apos;de görünür.</>,
          ]}
        />
      </Section>

      <Section title="Chrome / Edge (Mac, Windows, Android)">
        <Steps
          items={[
            <>Adres çubuğunun sağındaki <strong>yükle</strong> simgesine tıkla (ekran ve aşağı ok).</>,
            <>Ya da menüden <strong>Yayınla ve kaydet → Sayfayı uygulama olarak yükle</strong> / Android&apos;de <strong>Ana ekrana ekle</strong>.</>,
          ]}
        />
      </Section>

      {!ios && iphone}

      <Section title="Neden önemli?">
        <ul className="list-disc space-y-2 pl-5 text-ink-soft">
          <li>
            iPhone&apos;da Safari, ana ekrana eklenmemiş sitelerin verisini bir süre kullanılmazsa silebilir. Ana ekrana
            eklenen uygulamada veriler kalıcı olur.
          </li>
          <li>
            Asıl yedek sunucudadır. Cihazdaki veri silinse bile tekrar giriş yapınca her şey geri iner; sadece henüz
            eşlenmemiş değişiklikler kaybolabilir. Arada bir internete bağlanıp eşlemek yeterli.
          </li>
          <li>İlk açılışta internet gerekir (giriş ve verilerin indirilmesi için). Sonrasında internetsiz çalışır.</li>
        </ul>
      </Section>

      <Link href={user ? "/" : "/giris"} className="inline-block font-semibold text-accent hover:underline">
        {user ? "Destelere dön" : "Giriş sayfasına dön"}
      </Link>
    </div>
  );
}
