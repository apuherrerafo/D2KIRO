import type { Metadata } from "next";
import { AccountHome } from "@/features/account-home";
import { LandingPage } from "@/features/landing";
import { LANDING_METADATA } from "@/features/landing/metadata";
import { hasActiveSession } from "@/lib/session";

// `/` atiende a dos públicos. Quien tiene sesión válida entra a su inicio (también el destino tras el login); quien no, ve
// la portada pública. Solo la portada lleva sus propios metadatos; el inicio usa los del producto.
export async function generateMetadata(): Promise<Metadata> {
  if (await hasActiveSession()) return {};
  return LANDING_METADATA;
}

export default async function Home() {
  if (await hasActiveSession()) return <AccountHome />;
  return <LandingPage />;
}
