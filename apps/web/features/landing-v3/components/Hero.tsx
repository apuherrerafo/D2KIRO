/* LANDING V3 · 1 · HERO. "A draft that adapts to you." The page's own headline and the real waitlist form sit on top of the LOCKED Hero Loop
   (the same canonical stage Landing V2 plays: real Dota portraits, Glass, the settle / gather / tether / scatter verbs, FIT counting up).
   Coach = the approved pre-rendered pack on phones; on supported desktop it is the approved Coach Motion V2 pack; reduced motion = state stills.
   The Loop's first cycle is Draft A, the same draft every later chapter reads. The loop runs past five seconds, so there is a real Pause (WCAG 2.2.2). */
"use client";

import { useRef, useState } from "react";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { useLandingCoachMode } from "../../hero-loop/coach/HeroCoach";
import { HeroLoop } from "../../hero-loop/HeroLoop";
import { usePortraitsReady } from "../../hero-loop/preload";
import { LOOP_SCENARIOS } from "../../hero-loop/scenarios";
import { positionFor, useHeroLoop } from "../../hero-loop/use-hero-loop";
import { HERO } from "../copy";
import { WaitlistForm } from "./WaitlistForm";

const START = positionFor(0);

export function Hero() {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  const portraitsReady = usePortraitsReady(LOOP_SCENARIOS);
  const clock = useHeroLoop(host, reduced, paused, START, portraitsReady);
  const coachMode = useLandingCoachMode(reduced);

  function handlePause() {
    setPaused((current) => !current);
  }

  return (
    <section aria-labelledby="hero-title" className="hero" data-testid="hero">
      <div className="wrap">
        <div className="hero-head">
          <div className="hero-copy">
            <p className="kicker">{HERO.kicker}<b>{HERO.kickerGame}</b></p>
            <h1 id="hero-title">{HERO.title}</h1>
            <p className="hero-sub">{HERO.sub}</p>
          </div>
          <WaitlistForm inputId="wl-hero" variant="hero" />
        </div>
        <div className="hero-stage" data-testid="hero-stage" ref={host}>
          <HeroLoop calls clock={clock} coachMode={coachMode} paused={paused} quality="lite" reduced={reduced} />
        </div>
        <div className="hero-foot">
          <p className="illus">{HERO.illustrative}</p>
          <button aria-label={paused ? HERO.playHint : HERO.pauseHint} aria-pressed={paused} className="mtoggle" data-testid="hero-motion-toggle" onClick={handlePause} type="button">
            {paused ? HERO.play : HERO.pause}
          </button>
        </div>
      </div>
    </section>
  );
}
