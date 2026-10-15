import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ImportScreen } from "@/components/screens/ImportScreen";

export const metadata: Metadata = { title: "İçe aktar" };

// Sorgu parametresi (?deste=…) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <ImportScreen />
      </Suspense>
    </AppShell>
  );
}
