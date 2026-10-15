import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { ExportScreen } from "@/components/screens/ExportScreen";

export const metadata: Metadata = { title: "Dışa aktar ve yedek" };

export default function Page() {
  return (
    <AppShell>
      <ExportScreen />
    </AppShell>
  );
}
