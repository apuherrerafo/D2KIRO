/* LANDING-01B · the page. Everything it shows comes from two inputs: `productState` (fake today,
   the engine adapter tomorrow) and `coach` (the character component, when it exists). Both are
   props with safe defaults, so neither arrival changes this file or any section. */
"use client";

import type { CSSProperties } from "react";
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
import { DemoSection } from "./components/DemoSection";
import { EvidenceSection } from "./components/EvidenceSection";
import { LandingFooter } from "./components/LandingFooter";
import { LandingHero } from "./components/LandingHero";
import { LandingNav } from "./components/LandingNav";
import { PropositionSection } from "./components/PropositionSection";
import { SignalsSection } from "./components/SignalsSection";
import { WaitlistSection, type JoinWaitlist } from "./components/WaitlistSection";
import { FAKE_PRODUCT_STATE } from "./product-state/fake-scenario";
import type { LandingProductState } from "./product-state/types";

const MOTION_VARS = motionCssVars() as CSSProperties;

export type LandingPageProps = {
  /** The Coach character component. Omit until it exists: the slot stays an empty reservation. */
  coach?: CoachCharacter;
  /** Forces motion on/off for review; `system` follows the visitor's preference. */
  motionMode?: MotionMode;
  /** Real waitlist endpoint. Omit and the form runs in labelled preview. */
  onJoinWaitlist?: JoinWaitlist;
  /** Draft frames. Defaults to the deterministic fake scenario. */
  productState?: LandingProductState;
  /** Draws a labelled outline where the Coach will go (review builds only). */
  showCoachPlaceholder?: boolean;
};

function LandingBody({ coach, onJoinWaitlist, productState, showCoachPlaceholder }: Required<Pick<LandingPageProps, "productState" | "showCoachPlaceholder">> & Pick<LandingPageProps, "coach" | "onJoinWaitlist">) {
  const reduced = useReducedMotion();
  const character = coach ?? null;
  const heroFrame = productState.frames[0];
  return (
    <div className="ld-motion" data-motion={reduced ? "reduced" : "full"}>
      <CoachSlotProvider character={character} cue={coachCueFor(heroFrame, null)} reducedMotion={reduced} showPlaceholder={showCoachPlaceholder}>
        <LandingNav reducedMotion={reduced} />
        <main>
          <LandingHero />
          <PropositionSection />
          <DemoSection character={character} productState={productState} reducedMotion={reduced} showCoachPlaceholder={showCoachPlaceholder} />
          <SignalsSection productState={productState} />
          <EvidenceSection productState={productState} />
          <WaitlistSection onJoin={onJoinWaitlist} />
        </main>
        <LandingFooter />
      </CoachSlotProvider>
    </div>
  );
}

export function LandingPage({ coach, motionMode = "system", onJoinWaitlist, productState = FAKE_PRODUCT_STATE, showCoachPlaceholder = false }: LandingPageProps) {
  return (
    <div className="r3-page ld-root" data-landing="01b" data-testid="landing-01b" data-theme="dark" style={MOTION_VARS}>
      <LabProvider value={{ autoplay: false, mode: motionMode }}>
        <LandingBody coach={coach} onJoinWaitlist={onJoinWaitlist} productState={productState} showCoachPlaceholder={showCoachPlaceholder} />
      </LabProvider>
    </div>
  );
}
