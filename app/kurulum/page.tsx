import type { Metadata } from "next";
import { PublicShell } from "@/components/app/AppShell";
import { InstallGuide } from "@/components/screens/InstallGuide";

export const metadata: Metadata = { title: "Uygulamayı yükle" };

export default function Page() {
  return (
    <PublicShell wide>
      <InstallGuide />
    </PublicShell>
  );
}
