/* Alcance Canonical Light para los stories de VRT de StateTarget / HeroDraftSlot. Componentes REALES; este archivo solo coloca una rejilla.
   `data-motion="reduced"` congela el movimiento (el DS lo lee igual que prefers-reduced-motion). */
import type { CSSProperties, ReactNode } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/motion/motion.css";
import { motionCssVars } from "@/design/round-3a/motion-tokens";

const VARS = motionCssVars() as CSSProperties;

export function LightGrid({ children, columns = 4, width = 232 }: { children: ReactNode; columns?: number; width?: number }) {
  return (
    <div className="r3-page" data-motion="reduced" style={VARS}>
      <div data-theme="light" style={{ background: "var(--r3-bg)", display: "grid", gap: 32, gridTemplateColumns: `repeat(${columns}, ${width}px)`, padding: 32 }}>
        {children}
      </div>
    </div>
  );
}
