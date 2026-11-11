/* LANDING-01B · the page. Everything it shows comes from two inputs: `productState` (fake today,
   the engine adapter tomorrow) and `coach` (the character component, when it exists). Both are
   props with safe defaults, so neither arrival changes this file or any section. */
"use client";

import { useState, type CSSProperties } from "react";
import "@/design/round-3a-labs.css";
import "@/design/round-3b-labs.css";
import "@/design/canonical/tokens.css";
import "@/design/canonical/primitives/primitives.css";
import "@/design/canonical/canonical.css";
import "@/design/canonical/motion/motion.css";
import "./landing.css";
import { LabProvider, useReducedMotion, type MotionMode } from "@/design/round-3a/lab-context";
import { motionCssVars } from "@/design/round-3a/motion-tokens";
import { CoachSlotProvider, coachCueFor, type CoachCharacter } from "./coach/coach-slot";
import { CounterfactualSection } from "./components/CounterfactualSection";
import { LandingFooter } from "./components/LandingFooter";
import { LandingHero } from "./components/LandingHero";
import { LandingNav } from "./components/LandingNav";
import { MemorySection } from "./components/MemorySection";
import { PropositionSection } from "./components/PropositionSection";
import { EntrySection } from "./components/EntrySection";
import { FAKE_PRODUCT_STATE } from "./product-state/fake-scenario";
import type { LandingProductState } from "./product-state/types";

const MOTION_VARS = motionCssVars() as CSSProperties;

export type LandingPageProps = {
  /** The Coach character component. Omit until it exists: the slot stays an empty reservation. */
  coach?: CoachCharacter;
  /** Forces motion on/off for review; `system` follows the visitor's preference. */
  motionMode?: MotionMode;
  /** Draft frames. Defaults to the deterministic fake scenario. */
  productState?: LandingProductState;
  /** Draws a labelled outline where the Coach will go (review builds only). */
  showCoachPlaceholder?: boolean;
};

function LandingBody({ coach, productState, showCoachPlaceholder }: Required<Pick<LandingPageProps, "productState" | "showCoachPlaceholder">> & Pick<LandingPageProps, "coach">) {
  const reduced = useReducedMotion();
  const character = coach ?? null;
  const heroFrame = productState.frames[0];
  /* One-way latch, local to Hero ↔ Memory: once the bridge is on screen the Hero stays on the locked Puck. */
  const [departing, setDeparting] = useState(false);
  return (
    <div className="ld-motion" data-motion={reduced ? "reduced" : "full"}>
      <CoachSlotProvider character={character} cue={coachCueFor(heroFrame, null)} reducedMotion={reduced} showPlaceholder={showCoachPlaceholder}>
        <LandingNav />
        <main>
          <LandingHero departing={departing} />
          <MemorySection onBridge={setDeparting} reducedMotion={reduced} />
          <CounterfactualSection reducedMotion={reduced} />
          <PropositionSection character={character} productState={productState} reducedMotion={reduced} showCoachPlaceholder={showCoachPlaceholder} />
          <EntrySection />
        </main>
        <LandingFooter />
      </CoachSlotProvider>
    </div>
  );
}

export function LandingPage({ coach, motionMode = "system", productState = FAKE_PRODUCT_STATE, showCoachPlaceholder = false }: LandingPageProps) {
  return (
    <div className="r3-page ld-root" data-landing="01b" data-testid="landing-01b" style={MOTION_VARS}>
      {/* Canonical Light, igual que el resto del producto: el tema lo declara el hijo `data-theme="light"` del alcance `.r3-page`. */}
      <div className="ld-theme" data-theme="light">
        <LabProvider value={{ autoplay: false, mode: motionMode }}>
          <LandingBody coach={coach} productState={productState} showCoachPlaceholder={showCoachPlaceholder} />
        </LabProvider>
      </div>
    </div>
  );
}
