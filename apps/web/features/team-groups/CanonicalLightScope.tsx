import type { CSSProperties, ReactNode } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "./team-groups.css";
import { motionCssVars } from "@/design/round-3a/motion-tokens";

// Canonical LIGHT, the way the design system actually ships it: every Light token is declared on
// `.r3-page [data-theme="light"]` -- a DESCENDANT of `.r3-page`, which itself carries the dark defaults. So the scope is two
// elements: the page (fonts, motion variables, glass geometry) and, inside it, the element that says `data-theme="light"`.
// Nothing here repaints a dark theme white: the Light tokens are the real ones. Every rule is under `.r3-page`, so the
// styles reach only what is rendered inside this scope.

const MOTION_VARS = motionCssVars() as CSSProperties;

export function CanonicalLightScope({ children }: { children: ReactNode }) {
  return (
    <div className="r3-page tg-page" style={MOTION_VARS}>
      <div className="tg-light" data-theme="light">
        {children}
      </div>
    </div>
  );
}
