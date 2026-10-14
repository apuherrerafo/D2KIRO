/* LANDING V3 · the Hero's real Pause (the loop runs longer than five seconds, so WCAG 2.2.2 asks for one). */
"use client";

import { useSyncExternalStore } from "react";
import { HERO } from "../copy";
import { motionStore } from "../hero/motion-store";

export function MotionToggle() {
  const paused = useSyncExternalStore(motionStore.subscribe, motionStore.get, () => false);
  function handleToggle() {
    motionStore.set(!paused);
  }
  return (
    <button aria-label={paused ? HERO.playHint : HERO.pauseHint} aria-pressed={paused} className="mtoggle" data-testid="hero-motion-toggle" onClick={handleToggle} type="button">
      {paused ? HERO.play : HERO.pause}
    </button>
  );
}
