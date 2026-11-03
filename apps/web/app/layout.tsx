import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/nav-bar/NavBar";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { hasActiveSession } from "@/lib/session";
import { Providers } from "./providers";

export const dynamic = "force-dynamic";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const canonicalOrigin = getCanonicalOrigin();

export const metadata: Metadata = {
  metadataBase: canonicalOrigin === null ? undefined : new URL(canonicalOrigin),
  title: "dota2coach",
  description: "Sugerencias de draft en vivo para Dota 2, en tiempo real.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const signedIn = await hasActiveSession();
  return (
    <html
      lang="es"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>
          <NavBar signedIn={signedIn} />
          {children}
        </Providers>
      </body>
    </html>
  );
}
