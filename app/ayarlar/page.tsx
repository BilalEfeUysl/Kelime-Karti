import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { SettingsScreen } from "@/components/screens/SettingsScreen";

export const metadata: Metadata = { title: "Ayarlar" };

export default function Page() {
  return (
    <AppShell>
      <SettingsScreen />
    </AppShell>
  );
}
