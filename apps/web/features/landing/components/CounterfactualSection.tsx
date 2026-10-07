/* LANDING-01B · Counterfactual personalization on the real page (TSK-242). The Memory Strip ended on the Player Model; this
   is what that model is FOR. One short pinned stage: the same draft, read generically, then through the model, then the
   order moves. Scroll picks the stage and, inside a transformation, the 0–1 that drives it (`counterfactual/scroll.ts`);
   the CSS draws it. The pin is short on purpose (≈2.2 screens, against the strip's 5.3): one transformation, not five. */
"use client";

import { useRef, type CSSProperties } from "react";
import { CoachCueScope, CoachSlot } from "../coach/coach-slot";
import { COUNTERFACTUAL } from "../copy";
import { CounterfactualObject } from "../counterfactual/CounterfactualObject";
import { COUNTERFACTUAL_SCROLL_SCREENS, counterfactualCoachCue } from "../counterfactual/scroll";
import { useCounterfactualScroll } from "../counterfactual/use-counterfactual-scroll";

const TRACK_STYLE = { "--ld-cf-screens": String(COUNTERFACTUAL_SCROLL_SCREENS) } as CSSProperties;

export function CounterfactualSection({ reducedMotion }: { reducedMotion: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useCounterfactualScroll(track, stage, reducedMotion);
  return (
    <section aria-labelledby="counterfactual-title" className="ld-cf" data-section="counterfactual" data-stage={view.stage} id="counterfactual">
      <header className="ld-wrap ld-cf-head">
        <p className="ld-kicker">{COUNTERFACTUAL.kicker}</p>
        <h2 className="ld-h2" id="counterfactual-title">{COUNTERFACTUAL.title}</h2>
      </header>
      <div className="ld-cf-track" ref={track} style={TRACK_STYLE}>
        <div className="ld-cf-stage" ref={stage}>
          <CounterfactualObject reducedMotion={reducedMotion} view={view} />
          <CoachCueScope cue={counterfactualCoachCue(view.stage)}>
            <CoachSlot placement="counterfactual" />
          </CoachCueScope>
        </div>
      </div>
    </section>
  );
}
