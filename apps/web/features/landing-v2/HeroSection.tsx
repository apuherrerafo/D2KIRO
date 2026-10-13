/* LANDING V2 · 1 · HERO. The LOCKED Hero Loop V1.1, unchanged, inside the page's own frame: headline, one action and a real
   Pause (the loop runs past five seconds, so WCAG 2.2.2 asks for one). No Lab controls. The first cycle (draft A) already says
   all three things: this is a draft tool, it recommends your pick, it weighs your games. Coach = the approved pre-rendered
   Hero pack on desktop AND mobile (same semantic controller, only the renderer is chosen here); reduced motion = static state
   stills. The live Gold Master (Three.js) stays a Lab/product-surface renderer and is never requested by this page. */
"use client";

import { useRef, useState } from "react";
import { ActionPrimary } from "@/design/canonical/primitives";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { scrollToId } from "@/features/landing/scroll";
import { CTA_LABEL } from "@/features/landing/copy";
import { useCoachMode } from "../hero-loop/coach/HeroCoach";
import { HeroLoop } from "../hero-loop/HeroLoop";
import { usePortraitsReady } from "../hero-loop/preload";
import { LOOP_SCENARIOS } from "./story/scenarios";
import { positionFor, useHeroLoop } from "../hero-loop/use-hero-loop";
import { useIdlePrefetch } from "./assets";
import { HERO } from "./copy";

const START = positionFor(0);

export function HeroSection() {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const portraitsReady = usePortraitsReady(LOOP_SCENARIOS);
  const clock = useHeroLoop(host, reduced, paused, START, portraitsReady);
  const coachMode = useCoachMode(reduced, "sprite");
  useIdlePrefetch(portraitsReady);

  function handleJoin() {
    scrollToId("waitlist", reduced);
  }
  function handlePause() {
    setPaused((p) => !p);
  }

  return (
    <section aria-labelledby="hero-title" className="lv2-hero" data-section="hero" id="hero">
      <div className="ld-wrap">
        <div className="lv2-hero-head">
          <p className="ld-kicker">{HERO.kicker}</p>
          <h1 className="lv2-h1" id="hero-title">{HERO.title}</h1>
          <p className="ld-hero-sub">{HERO.sub}</p>
          <div className="lv2-hero-actions">
            <ActionPrimary onPress={handleJoin}>{CTA_LABEL}</ActionPrimary>
          </div>
        </div>
        <div className="lv2-hero-stage" ref={host}>
          <HeroLoop calls clock={clock} coachMode={coachMode} quality="lite" reduced={reduced} />
        </div>
        <div className="lv2-hero-foot">
          <p className="ld-illustrative">{HERO.illustrative}</p>
          <button
            aria-label={paused ? HERO.playHint : HERO.pauseHint}
            className="lv2-pause"
            data-testid="hero-pause"
            onClick={handlePause}
            type="button"
          >
            {paused ? HERO.play : HERO.pause}
          </button>
        </div>
      </div>
    </section>
  );
}
