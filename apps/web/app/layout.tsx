import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { hasActiveSession } from "@/lib/session";
import { Providers } from "./providers";

export const dynamic = "force-dynamic";

const canonicalOrigin = getCanonicalOrigin();

export const metadata: Metadata = {
  metadataBase: canonicalOrigin === null ? undefined : new URL(canonicalOrigin),
  title: "D2KIRO",
  description: "Coach de draft para Dota 2: lee bans, picks y tu pool de héroes y te dice qué elegir, con el porqué.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const signedIn = await hasActiveSession();
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <Providers>
          <AppShell signedIn={signedIn}>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
