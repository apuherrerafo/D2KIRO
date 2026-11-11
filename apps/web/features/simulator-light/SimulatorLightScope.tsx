import type { CSSProperties, ReactNode } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/motion/motion.css";
import "./light.css";
import { LabProvider } from "@/design/round-3a/lab-context";
import { motionCssVars } from "@/design/round-3a/motion-tokens";

// Alcance Canonical Light, igual que `features/team-groups/CanonicalLightScope.tsx` (dos elementos: `.r3-page` + hijo `data-theme="light"`,
// mismo orden de CSS) más `motion.css` (las clases `.cm-*` de forma del movimiento canónico). `mode: "system"` = el DS lee prefers-reduced-motion.
const MOTION_VARS = motionCssVars() as CSSProperties;

export interface SimulatorLightScopeProps {
  children: ReactNode;
  /** `strip` = franja compacta (encabezado del draft); por defecto, el bloque completo del tablero. */
  variant?: "block" | "strip";
  /** Solo posicionamiento de la raíz (p. ej. `sl-sticky`). */
  className?: string;
  testId?: string;
}

export function SimulatorLightScope({ children, variant = "block", className, testId }: SimulatorLightScopeProps) {
  return (
    <LabProvider value={{ autoplay: false, mode: "system" }}>
      <div className={className === undefined ? "r3-page sl-page" : `r3-page sl-page ${className}`} data-testid={testId} style={MOTION_VARS}>
        <div className="sl-light" data-theme="light" data-variant={variant}>
          {children}
        </div>
      </div>
    </LabProvider>
  );
}
