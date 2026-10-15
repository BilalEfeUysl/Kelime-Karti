import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { DeckOptionsScreen } from "@/components/screens/DeckOptionsScreen";

export const metadata: Metadata = { title: "Deste seçenekleri" };

// Sorgu parametresi (?deste=…) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <DeckOptionsScreen />
      </Suspense>
    </AppShell>
  );
}
