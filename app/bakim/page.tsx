import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { MaintenanceScreen } from "@/components/screens/MaintenanceScreen";

export const metadata: Metadata = { title: "Bakım" };

export default function Page() {
  return (
    <AppShell>
      <MaintenanceScreen />
    </AppShell>
  );
}
