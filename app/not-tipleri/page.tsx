import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { NoteTypesScreen } from "@/components/screens/NoteTypesScreen";

export const metadata: Metadata = { title: "Not tipleri" };

// Sorgu parametresi (?id=…) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <NoteTypesScreen />
      </Suspense>
    </AppShell>
  );
}
