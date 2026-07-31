"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinkDef {
  href: string;
  label: string;
}

export function buildNavLinks(draftLiveEnabled: boolean): NavLinkDef[] {
  const draftLabel = draftLiveEnabled ? "Draft" : "Draft local";
  return [
    { href: "/draft", label: draftLabel },
    { href: "/simulator", label: "Simulador" },
    { href: "/hero-pool", label: "Mi pool" },
    { href: "/team-groups", label: "Equipos" },
    { href: "/heroes", label: "Héroes" },
    { href: "/meta", label: "Meta" },
    { href: "/settings", label: "Configuración" },
  ];
}

const NAV_LINK_BASE =
  "border-b-2 px-3 py-2 text-body transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-primary";

function navLinkClassName(isActive: boolean): string {
  if (isActive) {
    return `${NAV_LINK_BASE} border-accent-primary text-content-primary`;
  }
  return `${NAV_LINK_BASE} border-transparent text-content-secondary hover:text-content-primary`;
}

interface NavBarProps {
  draftLiveEnabled: boolean;
}

// <Dominio><Cosa>: shell de navegación compartido (TSK-029) -- se renderiza una sola vez en
// RootLayout, nunca duplicado por página. Resuelve el reporte de producto ("cada pantalla es una
// isla, no sé qué sigue después de guardar el pool") dejando siempre visibles las rutas reales
// del sitio, con la actual marcada.
export function NavBar({ draftLiveEnabled }: NavBarProps) {
  const pathname = usePathname();
  const navLinks = buildNavLinks(draftLiveEnabled);

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
    </nav>
  );
}
