import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { StatsScreen } from "@/components/screens/StatsScreen";

export const metadata: Metadata = { title: "İstatistikler" };

export default function Page() {
  return (
    <AppShell>
      <StatsScreen />
    </AppShell>
  );
}
