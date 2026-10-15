import type { Metadata } from "next";
import { Suspense } from "react";
import { AppShell } from "@/components/app/AppShell";
import { StudyScreen } from "@/components/screens/StudyScreen";

export const metadata: Metadata = { title: "Çalış" };

// Sorgu parametresi (?deste=…) kullandığı için Suspense içinde
export default function Page() {
  return (
    <AppShell>
      <Suspense>
        <StudyScreen />
      </Suspense>
    </AppShell>
  );
}
