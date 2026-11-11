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

export function SimulatorLightScope({ children }: { children: ReactNode }) {
  return (
    <LabProvider value={{ autoplay: false, mode: "system" }}>
      <div className="r3-page sl-page" style={MOTION_VARS}>
        <div className="sl-light" data-theme="light">
          {children}
        </div>
      </div>
    </LabProvider>
  );
}
