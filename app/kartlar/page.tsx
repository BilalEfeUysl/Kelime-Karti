import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { BrowserScreen } from "@/components/screens/BrowserScreen";

export const metadata: Metadata = { title: "Kartlar" };

// Sorgu parametresi (?q=…) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <BrowserScreen />
      </Suspense>
    </AppShell>
  );
}
