/* LANDING V2 · 3 · COUNTERFACTUAL. The LOCKED Counterfactual V1: the same persistent draft read For anyone → Add your games →
   For you, Puck #2 → #1, qualitative evidence, the Coach pointing once. It plays when the object is mostly on screen, rests on
   "For you", and replays from the start when it comes back after having left. Reduced motion shows the same three reads with
   the travel removed. The section head replaces the Lab's own header so the page keeps one voice. */
"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { LandingSection } from "@/features/landing/components/LandingSection";
import { Counterfactual } from "../counterfactual-lab/Counterfactual";
import { BEATS, FINAL_BEAT } from "../counterfactual-lab/model";
import { COUNTERFACTUAL } from "./copy";
import { useShare } from "./viewport";

export function CounterfactualSection() {
  const reduced = useReducedMotion();
  const host = useRef<HTMLDivElement>(null);
  const { engaged, gone } = useShare(host, 0.45);
  const [index, setIndex] = useState(0);
  const [started, setStarted] = useState(false);

  // starts once the object is mostly on screen; a full exit rewinds it so the next arrival tells the story again
  /* eslint-disable react-hooks/set-state-in-effect -- the story state follows an external signal (IntersectionObserver) */
  useEffect(() => {
    if (engaged) setStarted(true);
    else if (gone) {
      setStarted(false);
      setIndex(0);
    }
  }, [engaged, gone]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!started || index >= FINAL_BEAT) return;
    const timer = window.setTimeout(() => setIndex((i) => i + 1), BEATS[index].ms * (reduced ? 1.3 : 1));
    return () => window.clearTimeout(timer);
  }, [index, reduced, started]);

  const current = BEATS[index];
  return (
    <LandingSection id="counterfactual" kicker={COUNTERFACTUAL.kicker} layout="split" lede={COUNTERFACTUAL.lede} title={COUNTERFACTUAL.title}>
      <div className="lv2-cf" data-testid="lv2-counterfactual" ref={host}>
        <Counterfactual beat={current.id} coach={current.coach} phase={current.phase} reduced={reduced} showCoach />
      </div>
    </LandingSection>
  );
}
