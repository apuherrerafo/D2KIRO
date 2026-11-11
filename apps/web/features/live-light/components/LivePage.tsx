import type { ReactNode } from "react";
import { SimulatorLightScope } from "@/features/simulator-light";
import "../live-page.css";

// <Dominio><Cosa>: la raíz Canonical Light de /live-draft. Es el fondo y el alcance de TODA la ruta (título, conexión, controles, tablero, diagnóstico):
// antes solo el tablero y la franja de picks estaban en Light y el resto era el tema oscuro del sitio. El alcance trae los tokens `--r3-*`, la tipografía
// canónica y el puente que hace que los nombres semánticos del sitio (`--surface-*`, `--content-*`) apunten a los tokens Light dentro de esta página.

export interface LivePageProps {
  testId: string;
  children: ReactNode;
}

export function LivePage({ testId, children }: LivePageProps) {
  return (
    <main className="ll-main" data-testid={testId}>
      <SimulatorLightScope className="ll-page">
        <h1 className="ll-title">D2KIRO · Draft en vivo</h1>
        {children}
      </SimulatorLightScope>
    </main>
  );
}
