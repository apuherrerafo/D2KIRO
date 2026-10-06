/* DS V1 · Landing 01B — the real landing, built from the canonical primitives (no landing-local
   buttons / cards / glass). Same components the Master and Motion boards review. Fake, deterministic
   product state (features/landing/product-state/fake-scenario.ts); the Coach is a reserved slot. */
import { LandingPage, type CoachCharacterProps } from "@/features/landing";

const meta = {
  title: "DS V1/Landing 01B",
  parameters: { layout: "fullscreen" },
};
export default meta;

export function FullPage() {
  return <LandingPage />;
}

export function ReducedMotion() {
  return <LandingPage motionMode="reduced" />;
}

export function CoachSlotReserved() {
  return <LandingPage showCoachPlaceholder />;
}

/** Proves the plug-in contract with a deliberately inert stand-in — NOT the Coach, never a mascot. */
function ContractProbe({ anchor, cue, placement }: CoachCharacterProps) {
  return <span data-probe={placement} style={{ font: "500 11px/1 var(--f-pmono)" }}>{`cue:${cue} anchor:${anchor ?? "none"}`}</span>;
}

export function CoachContractProbe() {
  return <LandingPage coach={ContractProbe} />;
}
