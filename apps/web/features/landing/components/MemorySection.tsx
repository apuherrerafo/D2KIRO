/* LANDING-01B · Memory Strip on the real page (TSK-241). The Hero made one call; here that call becomes history.
   One sticky stage, one Phase C player: scroll picks the beat (`memory-scroll.ts`) and, inside a transition, the
   frame — the five scenes are never copied and no transition is rebuilt here. The handoff keeps the first retained
   decision (the hero seal and "You · Pos 2 Mid", the Hero's own seat) on screen while the rest of Match 01 joins it. */
"use client";

import { useRef, type CSSProperties } from "react";
import { CoachCueScope, CoachSlot } from "../coach/coach-slot";
import { MEMORY } from "../copy";
import { useMemoryScroll } from "../hooks";
import { MEMORY_BEATS_ON_SCROLL, MEMORY_SCROLL_SCREENS, beatName, memoryCoachCue } from "../memory-scroll";
import { MemoryStripMotion } from "../memory-strip";

const TRACK_STYLE = { "--ld-memory-screens": String(MEMORY_SCROLL_SCREENS) } as CSSProperties;

export function MemorySection({ reducedMotion }: { reducedMotion: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useMemoryScroll(track, stage, reducedMotion);
  const beat = MEMORY_BEATS_ON_SCROLL[view.beat];
  const handoff = { "--ld-handoff": String(view.handoff) } as CSSProperties;
  return (
    <section aria-labelledby="memory-title" className="ld-memory" data-section="memory" id="memory">
      <header className="ld-wrap ld-memory-head">
        <p className="ld-kicker">{MEMORY.kicker}</p>
        <h2 className="ld-h2" id="memory-title">{MEMORY.title}</h2>
      </header>
      <div className="ld-memory-track" ref={track} style={TRACK_STYLE}>
        <div className="ld-memory-stage" data-beat={beatName(beat)} data-handoff={view.handoff < 1 ? "pending" : "done"} ref={stage} style={handoff}>
          <MemoryStripMotion reducedMotion={reducedMotion ? "reduce" : "full"} sceneId={view.sceneId} scrub={view.scrub} />
          <CoachCueScope cue={memoryCoachCue(beat)}>
            <CoachSlot placement="memory" />
          </CoachCueScope>
        </div>
      </div>
    </section>
  );
}
