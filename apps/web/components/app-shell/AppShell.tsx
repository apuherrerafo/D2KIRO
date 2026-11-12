import type { CSSProperties, ReactNode } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/motion/motion.css";
import "./app-shell.css";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { NavBar } from "@/components/nav-bar/NavBar";
import { FeedbackWidget } from "@/features/feedback/FeedbackWidget";

// <Dominio><Cosa>: el alcance Canonical Light de TODA la aplicación. Es el único tema del producto: dos elementos
// (`.r3-page` + hijo `data-theme="light"`, tal como el Design System entrega Light) que traen los tokens `--r3-*`, la
// tipografía canónica y los alias semánticos de design/tokens/semantic.css. Navegación y páginas viven dentro.
const MOTION_VARS = motionCssVars() as CSSProperties;

// El botón de feedback existe solo para cuentas con sesión: quien no entró no tiene a quién reportar.
function FeedbackSlot({ signedIn }: { signedIn: boolean }) {
  if (!signedIn) return null;
  return <FeedbackWidget />;
}

export function AppShell({ children, signedIn }: { children: ReactNode; signedIn: boolean }) {
  return (
    <div className="r3-page ap-root" data-testid="app-shell" style={MOTION_VARS}>
      <div className="ap-light" data-theme="light">
        <NavBar signedIn={signedIn} />
        {children}
        <FeedbackSlot signedIn={signedIn} />
      </div>
    </div>
  );
}
