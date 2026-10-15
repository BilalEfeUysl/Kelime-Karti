import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { AdminScreen } from "@/components/screens/AdminScreen";

export const metadata: Metadata = { title: "Yönetim" };

export default function Page() {
  return (
    <AppShell>
      <AdminScreen />
    </AppShell>
  );
}
