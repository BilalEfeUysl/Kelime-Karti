import type { Metadata } from "next";
import { AppShell } from "@/components/app/AppShell";
import { TagsScreen } from "@/components/screens/TagsScreen";

export const metadata: Metadata = { title: "Etiketler" };

export default function Page() {
  return (
    <AppShell>
      <TagsScreen />
    </AppShell>
  );
}
