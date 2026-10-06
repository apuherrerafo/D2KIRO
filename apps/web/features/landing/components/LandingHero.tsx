/* LANDING-01C · hero. The product is the hero's visual and it tells its own story, unprompted (~13 s,
   then the next draft, in place): our supports are locked while the enemy's stay hidden, the enemy reveal is the new
   information, counter / synergy / the player's own context move the Mid scores for named reasons, one call resolves
   as #1 and is locked into Pos 2. See `hero-story/HeroStory.tsx`.
   The copy, the actions and the Coach slot are readable and usable from frame 0. Reduced motion plays the
   same five moments once, as crossfades. */
"use client";

import { useState } from "react";
import { ActionPrimary, ActionQuiet } from "@/design/canonical/primitives";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { CoachCueScope, CoachSlot, type CoachCue } from "../coach/coach-slot";
import { CTA_LABEL, HERO } from "../copy";
import { HeroStory } from "../hero-story/HeroStory";
import type { StoryStep } from "../hero-story/use-hero-story";
import { scrollToId } from "../scroll";

/** What the Coach is doing at each step of the story — bound to the product moment, never to what it says. */
const COACH_BY_STEP: Readonly<Record<StoryStep, CoachCue>> = {
  picks: { anchor: "rival", state: "watching" },
  reveal: { anchor: "rival", state: "analyzing" },
  counterA: { anchor: "evidence", state: "analyzing" },
  counterB: { anchor: "evidence", state: "analyzing" },
  synergy: { anchor: "evidence", state: "analyzing" },
  pool: { anchor: "pool", state: "analyzing" },
  decide: { anchor: "turn", state: "pointing" },
  lock: { anchor: "turn", state: "confirming" },
  place: { anchor: "turn", state: "confirming" },
  hold: { anchor: "turn", state: "confirming" },
};

function HeroCopy({ onDemo, onJoin }: { onDemo: () => void; onJoin: () => void }) {
  return (
    <div className="ld-hero-copy">
      <p className="ld-kicker">{HERO.eyebrow}</p>
      <h1 className="ld-h1" id="hero-title">
        <span className="ld-h1-lead">{HERO.headlineLead}</span>
        <span className="ld-h1-accent">{HERO.headlineAccent}</span>
      </h1>
      <p className="ld-hero-sub">{HERO.sub}</p>
      <div className="ld-hero-actions">
        <ActionPrimary onPress={onJoin}>{CTA_LABEL}</ActionPrimary>
        <ActionQuiet icon="live" onPress={onDemo}>{HERO.secondary}</ActionQuiet>
      </div>
      <p className="ld-reassurance">{HERO.reassurance}</p>
    </div>
  );
}

export function LandingHero() {
  const reduced = useReducedMotion();
  const [step, setStep] = useState<StoryStep>("picks");

  function handleJoin() {
    scrollToId("waitlist", reduced);
  }
  function handleDemo() {
    scrollToId("demo", reduced);
  }

  return (
    <section aria-labelledby="hero-title" className="ld-hero" data-section="hero" data-story-step={step} id="hero">
      <div className="ld-wrap ld-hero-grid">
        <HeroCopy onDemo={handleDemo} onJoin={handleJoin} />
        <div className="ld-hero-product">
          <HeroStory onStep={setStep} />
          <p className="ld-illustrative">{HERO.illustrative}</p>
          <CoachCueScope cue={COACH_BY_STEP[step]}>
            <CoachSlot placement="hero" />
          </CoachCueScope>
        </div>
      </div>
    </section>
  );
}
