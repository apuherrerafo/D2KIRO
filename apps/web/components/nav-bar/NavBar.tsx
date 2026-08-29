"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

interface NavLinkDef {
  href: string;
  label: string;
}

// TSK-187 (Fase 8B, SPEC.md §14.8): el nav pasa de 7 a 4 links -- el flujo real es login +
// cuenta + pool + Simulador de Draft. `/live-draft`, `/team-groups` y `/heroes` salen del array
// pero sus rutas, componentes y tests quedan intactos: siguen alcanzables por URL directa.
// Reversible -- volver a agregarlos es editar este array.
export function buildNavLinks(): NavLinkDef[] {
  return [
    { href: "/simulator", label: "Simulador de Draft" },
    { href: "/hero-pool", label: "Mi pool" },
    { href: "/meta", label: "Meta" },
    { href: "/settings", label: "Configuración" },
  ];
}

export function accountLabel(accountId: number | null): string {
  return accountId === null ? "Mi cuenta" : `Cuenta · ${accountId}`;
}

export interface AccountProfile {
  accountId: number;
  personaName: string;
  avatarUrl: string | null;
}

export function profileLabel(profile: AccountProfile): { displayName: string; accountIdLabel: string } {
  return { displayName: profile.personaName, accountIdLabel: String(profile.accountId) };
}

const NAV_LINK_BASE =
  "border-b-2 px-3 py-2 text-body transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

function navLinkClassName(isActive: boolean): string {
  if (isActive) {
    return `${NAV_LINK_BASE} border-accent-primary text-content-primary`;
  }
  return `${NAV_LINK_BASE} border-transparent text-content-secondary hover:text-content-primary`;
}

// <Dominio><Cosa>: shell de navegación compartido (TSK-029) -- se renderiza una sola vez en
// RootLayout, nunca duplicado por página. Resuelve el reporte de producto ("cada pantalla es una
// isla, no sé qué sigue después de guardar el pool") dejando siempre visibles las rutas reales
// del sitio, con la actual marcada.
export function NavBar() {
  const pathname = usePathname();
  const navLinks = buildNavLinks();
  const [profile, setProfile] = useState<AccountProfile | null>(null);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() as Promise<AccountProfile> : null)
      .then(setProfile)
      .catch(() => setProfile(null));
  }, []);

  const label = profile === null ? null : profileLabel(profile);

  return (
    <nav className="flex items-center gap-1 border-b border-surface-border bg-surface-raised px-4">
      <Link href="/" className="px-3 py-2 text-body font-semibold text-content-primary">
        dota2coach
      </Link>
      {navLinks.map((link) => (
        <Link key={link.href} href={link.href} className={navLinkClassName(pathname === link.href)}>
          {link.label}
        </Link>
      ))}
      <div className="ml-auto flex items-center gap-2 px-3 py-1">
        <Link href="/settings" className="flex items-center gap-2 text-left hover:text-content-primary">
          {profile?.avatarUrl ? (
            <img src={profile.avatarUrl} alt="" className="size-8 rounded-full border border-surface-border" />
          ) : (
            <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border border-surface-border bg-surface-overlay text-caption text-content-muted">S</span>
          )}
          <span className="flex flex-col">
            <span className="text-caption text-content-primary">{label?.displayName ?? accountLabel(null)}</span>
            {label && <span className="font-mono text-[10px] text-content-muted">{label.accountIdLabel}</span>}
          </span>
        </Link>
        {profile && (
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="text-caption text-content-secondary hover:text-content-primary">Salir</button>
          </form>
        )}
      </div>
    </nav>
  );
}
