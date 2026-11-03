/* Motion runs ON TOP of the design system. `skin` decides how a demo is dressed, never how it moves:
   - "canonical" (default review surface): the real V1.1 primitives — Glass, Metric, Delta, RankMove,
     HeroDraftSlot / HeroIcon, ActionPrimary, PerimeterFrame, LiveModule, the `cx-target` state grammar —
     over an environment that has something luminous behind the glass.
   - "anatomy": the stripped-down engineering view (neutral surfaces), kept as a secondary.
   Every motion handler, claim, timing and reduced-motion substitute is identical in both. */
import { createContext, useContext, type ReactNode } from "react";

export type MotionSkin = "canonical" | "anatomy";

const SkinContext = createContext<MotionSkin>("anatomy");

export const SkinProvider = SkinContext.Provider;

export function useSkin() {
  return useContext(SkinContext);
}

/** Environment (surface level 0) for glass: bounded spectral light + a ghost numeral. Static, never animated. */
function Ghost({ value }: { value: string }) {
  if (!value) return null;
  return <span aria-hidden="true" className="r3b-ghost dsc-ghost cm-ghost-num">{value}</span>;
}

export function SkinStage({ center = false, children, className = "", ghost = "62" }: { center?: boolean; children: ReactNode; className?: string; ghost?: string }) {
  return (
    <div className={`r3b-field cm-skin-stage ${center ? "cm-skin-stage--center" : ""} ${className}`.replace(/\s+/g, " ").trim()}>
      <span aria-hidden="true" className="cm-light cm-light--pink" />
      <span aria-hidden="true" className="cm-light cm-light--cyan" />
      <span aria-hidden="true" className="cm-light cm-light--lime" />
      <Ghost value={ghost} />
      <div className="cm-skin-body">{children}</div>
    </div>
  );
}
