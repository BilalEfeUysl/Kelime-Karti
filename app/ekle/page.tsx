import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { AddNoteScreen } from "@/components/screens/AddNoteScreen";

export const metadata: Metadata = { title: "Kart ekle" };

// Sorgu parametresi (?deste=…) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <AddNoteScreen />
      </Suspense>
    </AppShell>
  );
}
