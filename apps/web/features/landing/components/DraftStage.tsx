/* LANDING-01B · the product stage. One component, two densities: `demo` (full columns) and `hero`
   (call + roster strip). It renders a `DraftFrame` and nothing else — no engine, no network.

   Motion is state-driven and carries ONE carrier per change (Motion Canonical budget rule):
   - importance moved to another section → the perimeter segment travels there, one flash, still;
   - the same section, values changed in place → a 2 px lean on the big number;
   - the ranking changed → FLIP reorder (in StageCall), settle spring, 0 % overshoot;
   - default (thin-evidence) source → no segment at all, the change is written in words. */
"use client";

import { useEffect, useRef } from "react";
import { PerimeterFrame, type PerimeterEdge } from "@/design/round-3a/perimeter-frame";
import { useChangeCount, useReducedMotion } from "@/design/round-3a/lab-context";
import { EASINGS, TIMING } from "@/design/canonical/motion/timing";
import { play } from "@/design/canonical/motion/play";
import { positionLabel, type DraftFrame, type FocusSection } from "../product-state/types";
import { BanRow, EnemyColumn, RosterStrip, TeamColumn } from "./StageRoster";
import { StageCall } from "./StageCall";

export type StageVariant = "hero" | "demo";

export const FOCUS_EDGE: Readonly<Record<FocusSection, PerimeterEdge>> = { turn: "top", rival: "right", evidence: "bottom", pool: "left" };

function sectionChanged(frame: DraftFrame, previous: DraftFrame | null) {
  return previous !== null && previous.focus !== frame.focus;
}

function useLeanOnValueChange(host: React.RefObject<HTMLElement | null>, frame: DraftFrame, previous: DraftFrame | null, reduced: boolean) {
  useEffect(() => {
    if (!previous || sectionChanged(frame, previous)) return;
    const value = host.current?.querySelector<HTMLElement>(".cx-metric-value");
    if (!value) return;
    const sign = frame.top3[0].fit >= previous.top3[0].fit ? -1 : 1;
    play(value, "lean", [{ translate: "0 0" }, { offset: 0.3, translate: `0 ${sign * TIMING.leanPx}px` }, { translate: "0 0" }], { duration: TIMING.leanMs, easing: EASINGS.out }, reduced);
  }, [frame, host, previous, reduced]);
}

function StageTop({ frame }: { frame: DraftFrame }) {
  const caption = frame.onTheClock === null ? "No seat on the clock" : `Your turn · ${positionLabel(frame.onTheClock)}`;
  return (
    <header className="ld-stage-top" data-active={frame.focus === "turn" ? "true" : "false"}>
      <span className="ld-stage-turn">{caption}</span>
      <BanRow bans={frame.bans} />
    </header>
  );
}

function StageEvidence({ frame }: { frame: DraftFrame }) {
  const strategic = frame.basis === "STRATEGIC";
  const note = strategic ? "Strategic call" : "Default view";
  return (
    <footer className="ld-stage-foot" data-active={frame.focus === "evidence" ? "true" : "false"}>
      <span>{frame.evidenceSamples} matches</span>
      <span className="ld-stage-note" data-basis={strategic ? "strategic" : "default"}>{note}</span>
    </footer>
  );
}

function DemoBody({ frame, previous }: { frame: DraftFrame; previous: DraftFrame | null }) {
  return (
    <div className="ld-stage-body" data-variant="demo">
      <section aria-label="Your team" className="ld-col ld-col--team" data-active={frame.focus === "pool" ? "true" : "false"}>
        <h3 className="ld-col-title">Your team</h3>
        <TeamColumn frame={frame} />
      </section>
      <StageCall frame={frame} previous={previous} />
      <section aria-label="Enemy team" className="ld-col ld-col--enemy" data-active={frame.focus === "rival" ? "true" : "false"}>
        <h3 className="ld-col-title">Enemy</h3>
        <EnemyColumn frame={frame} />
      </section>
    </div>
  );
}

function HeroBody({ frame, previous }: { frame: DraftFrame; previous: DraftFrame | null }) {
  return (
    <div className="ld-stage-body" data-variant="hero">
      <StageCall frame={frame} previous={previous} />
      <RosterStrip frame={frame} />
    </div>
  );
}

function StageBody({ frame, previous, variant }: { frame: DraftFrame; previous: DraftFrame | null; variant: StageVariant }) {
  if (variant === "hero") return <HeroBody frame={frame} previous={previous} />;
  return <DemoBody frame={frame} previous={previous} />;
}

/** `entered` false holds the segment at rest; the hero flips it once so the first acquire plays on entrance, never on first paint. */
export function DraftStage({ entered = true, entrancePulse = 0, frame, previous, variant }: { entered?: boolean; entrancePulse?: number; frame: DraftFrame; previous: DraftFrame | null; variant: StageVariant }) {
  const host = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  const strategic = frame.basis === "STRATEGIC";
  const travels = useChangeCount(frame.focus);
  const edge = entered ? FOCUS_EDGE[frame.focus] : null;
  useLeanOnValueChange(host, frame, previous, reduced);

  return (
    <div className="ld-stage" data-entered={entered ? "true" : "false"} data-frame={frame.id} data-variant={variant} ref={host}>
      <PerimeterFrame canonical className="ld-stage-frame" edge={edge} label="Draft state" pulse={travels + entrancePulse} rest="corners" source={strategic ? "strategic" : "default"}>
        <StageTop frame={frame} />
        <StageBody frame={frame} previous={previous} variant={variant} />
        <StageEvidence frame={frame} />
      </PerimeterFrame>
    </div>
  );
}
