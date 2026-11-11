import Link from "next/link";
import type { ReactNode } from "react";

export type AppLinkLook = "outline" | "solid" | "quiet";

const LOOK_CLASS: Record<AppLinkLook, string> = {
  outline: "ap-btn",
  solid: "ap-btn ap-btn--solid",
  quiet: "ap-btn ap-btn--quiet",
};

interface AppLinkProps {
  href: string;
  look?: AppLinkLook;
  children: ReactNode;
  testId?: string;
}

// Navegación con la forma de un botón canónico: una ruta real del sitio, no una acción. Los compromisos (guardar,
// calcular, entrar) usan `ActionPrimary`; esto es para ir a otra pantalla.
export function AppLink({ href, look = "outline", children, testId }: AppLinkProps) {
  return (
    <Link href={href} className={LOOK_CLASS[look]} data-testid={testId}>
      {children}
    </Link>
  );
}
