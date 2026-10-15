import type { Metadata } from "next";
import { PublicShell } from "@/components/app/AppShell";
import { LoginScreen } from "@/components/screens/LoginScreen";

export const metadata: Metadata = { title: "Giriş" };

export default function Page() {
  return (
    <PublicShell>
      <LoginScreen />
    </PublicShell>
  );
}
