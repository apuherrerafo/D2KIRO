"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AccountAvatar } from "@/components/app-shell/AccountAvatar";
import { useAccountProfile, type AccountProfile } from "@/lib/use-account-profile";

interface NavLinkDef {
  href: string;
  label: string;
}

// Las rutas del MVP, todas reales y todas dentro del mismo Canonical Light. `/heroes` queda alcanzable por URL
// directa pero no es parte del recorrido; `/draft` y `/random-draft` son redirecciones de enlaces antiguos.
export function buildNavLinks(): NavLinkDef[] {
  return [
    { href: "/simulator", label: "Simulador" },
    { href: "/live-draft", label: "Draft en vivo" },
    { href: "/hero-pool", label: "Mi pool" },
    { href: "/team-groups", label: "Equipos" },
    { href: "/meta", label: "Meta" },
  ];
}

export const ACCOUNT_HREF = "/settings";
const ACCOUNT_FALLBACK_LABEL = "Mi cuenta";

// Nombre visible de la cuenta: el de Steam, o "Mi cuenta" mientras carga o si no está disponible. Nunca el Steam32.
export function accountLabel(profile: AccountProfile | null): string {
  if (profile === null) return ACCOUNT_FALLBACK_LABEL;
  const name = profile.personaName.trim();
  if (name === "") return ACCOUNT_FALLBACK_LABEL;
  return name;
}

export function isActiveLink(pathname: string | null, href: string): boolean {
  if (pathname === null) return false;
  return pathname === href || pathname.startsWith(`${href}/`);
}

// El visitante sin sesión no ve el menú de la cuenta: en `/` la portada pública trae su propia barra; en las demás
// puertas públicas (acceso, sin acceso) solo se muestra la marca.
export function isHiddenForVisitor(signedIn: boolean, pathname: string | null): boolean {
  return !signedIn && pathname === "/";
}

function BrandLink() {
  return (
    <Link href="/" className="ap-brand">
      D2KIRO
    </Link>
  );
}

function VisitorBar() {
  return (
    <nav aria-label="D2KIRO" className="ap-nav" data-testid="app-nav">
      <div className="ap-nav-row">
        <BrandLink />
      </div>
    </nav>
  );
}

function MemberBar({ pathname }: { pathname: string | null }) {
  const state = useAccountProfile(true);
  const profile = state.kind === "ready" ? state.profile : null;
  return (
    <nav aria-label="Principal" className="ap-nav" data-testid="app-nav">
      <div className="ap-nav-row">
        <BrandLink />
        <ul className="ap-nav-links">
          {buildNavLinks().map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="ap-nav-link" aria-current={isActiveLink(pathname, link.href) ? "page" : undefined}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <div className="ap-nav-account">
          <Link href={ACCOUNT_HREF} className="ap-account-chip" aria-current={isActiveLink(pathname, ACCOUNT_HREF) ? "page" : undefined}>
            <AccountAvatar avatarUrl={profile?.avatarUrl ?? null} />
            <span className="ap-account-name">{accountLabel(profile)}</span>
          </Link>
          <form action="/api/auth/logout" method="post" className="ap-logout">
            <button type="submit" className="ap-btn ap-btn--quiet">
              Salir
            </button>
          </form>
        </div>
      </div>
    </nav>
  );
}

// <Dominio><Cosa>: la barra de navegación del producto, una sola para todas las rutas y siempre Canonical Light
// (vive dentro del alcance de <AppShell>). Muestra al jugador por su nombre de Steam, nunca por su identificador.
export function NavBar({ signedIn = true }: { signedIn?: boolean }) {
  const pathname = usePathname();
  if (isHiddenForVisitor(signedIn, pathname)) return null;
  if (!signedIn) return <VisitorBar />;
  return <MemberBar pathname={pathname} />;
}
