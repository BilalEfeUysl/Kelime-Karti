import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { ExamplesScreen } from "@/components/screens/ExamplesScreen";

export const metadata: Metadata = { title: "Örnek cümleler" };

// Sorgu parametresi (?secim=1) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <ExamplesScreen />
      </Suspense>
    </AppShell>
  );
}
