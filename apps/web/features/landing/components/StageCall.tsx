/* LANDING-01B · the call itself: the big fit number over glass, then the Top 3 with their reasons.
   Composition only — Glass, Metric, Delta, RankMove, StateTarget and HeroIcon are the canonical
   primitives. Rows are keyed by hero so a rank change is a reorder (FLIP), not a remount. */
import { useRef } from "react";
import { HeroIcon } from "@/design/canonical/hero-media";
import { Delta, Glass, Metric, RankMove, StateTarget, type TargetState } from "@/design/canonical/primitives";
import { useSettleFlip } from "@/design/canonical/motion/flip";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { positionLabel, type Candidate, type DraftFrame } from "../product-state/types";

const LOCALE = "en";
const CONFIDENCE_LABEL = { high: "High confidence", low: "Low evidence", medium: "Medium confidence" } as const;

export function previousFit(previous: DraftFrame | null, hero: string) {
  return previous?.top3.find((candidate) => candidate.hero === hero)?.fit ?? null;
}

export function previousRank(previous: DraftFrame | null, hero: string) {
  return previous?.top3.find((candidate) => candidate.hero === hero)?.rank ?? null;
}

function rowState(candidate: Candidate, frame: DraftFrame): TargetState {
  if (candidate.rank !== 1) return "rest";
  if (frame.basis === "DETERMINISTIC_DEFAULT") return "uncertain";
  return "recommended";
}

function FitDelta({ candidate, previous }: { candidate: Candidate; previous: DraftFrame | null }) {
  const before = previousFit(previous, candidate.hero);
  if (before === null || before === candidate.fit) return <span className="ld-cand-delta" />;
  return <span className="ld-cand-delta"><Delta digits={0} locale={LOCALE} unit="pts" value={candidate.fit - before} /></span>;
}

function RankShift({ candidate, previous }: { candidate: Candidate; previous: DraftFrame | null }) {
  const before = previousRank(previous, candidate.hero);
  if (before === null || before === candidate.rank) return <span className="ld-cand-move" />;
  const dir = before > candidate.rank ? "up" : "down";
  return <span className="ld-cand-move"><RankMove by={Math.abs(before - candidate.rank)} dir={dir} /></span>;
}

function ReasonList({ candidate }: { candidate: Candidate }) {
  return (
    <ul className="ld-reasons">
      {candidate.reasons.map((reason) => <li data-kind={reason.kind} key={reason.text}>{reason.text}</li>)}
    </ul>
  );
}

function CandidateRow({ candidate, frame, previous }: { candidate: Candidate; frame: DraftFrame; previous: DraftFrame | null }) {
  const state = rowState(candidate, frame);
  const note = state === "uncertain" ? "Low evidence · neutral view" : undefined;
  return (
    <li className="ld-cand" data-flip-key={candidate.hero} data-rank={candidate.rank}>
      <StateTarget notch="Recommended" note={note} state={state} title={candidate.hero} value={String(candidate.fit)}>
        <span className="ld-cand-rank">{candidate.rank}</span>
        <span className="ld-cand-icon"><HeroIcon hero={candidate.hero} size="lg" /></span>
        <ReasonList candidate={candidate} />
        <FitDelta candidate={candidate} previous={previous} />
        <RankShift candidate={candidate} previous={previous} />
      </StateTarget>
    </li>
  );
}

function CallHeading({ frame }: { frame: DraftFrame }) {
  const strategic = frame.basis === "STRATEGIC";
  const kicker = strategic ? `Recommended · ${positionLabel(frame.top3[0].position)}` : "No clear strategic priority";
  return (
    <div className="ld-call-head">
      <span className="ld-call-kicker" data-basis={strategic ? "strategic" : "default"}>{kicker}</span>
      <span className="ld-call-confidence" data-level={frame.confidence}>{CONFIDENCE_LABEL[frame.confidence]}</span>
    </div>
  );
}

function CallMetric({ frame, previous }: { frame: DraftFrame; previous: DraftFrame | null }) {
  const top = frame.top3[0];
  const before = frame.basis === "STRATEGIC" ? previousFit(previous, top.hero) : null;
  const delta = before !== null && before !== top.fit ? <Delta digits={0} locale={LOCALE} unit="pts" value={top.fit - before} /> : undefined;
  const label = frame.basis === "STRATEGIC" ? `Fit of ${top.hero} for ${positionLabel(top.position)}` : `Starting view: ${top.hero} for ${positionLabel(top.position)}`;
  return (
    <div className="ld-call-metric" data-source={frame.basis === "STRATEGIC" ? "strategic" : "default"}>
      <Metric delta={delta} label={label} register="expressive" value={String(top.fit)} />
    </div>
  );
}

/** Center column of the stage: the call over glass (surface 3) with the ranked candidates inside. */
export function StageCall({ frame, previous }: { frame: DraftFrame; previous: DraftFrame | null }) {
  const list = useRef<HTMLOListElement>(null);
  const reduced = useReducedMotion();
  const order = frame.top3.map((candidate) => candidate.hero).join(",");
  useSettleFlip(list, order, reduced);
  return (
    <Glass className="ld-call" edge={frame.basis === "STRATEGIC"} surfaceLevel="3">
      <CallHeading frame={frame} />
      <CallMetric frame={frame} previous={previous} />
      <ol aria-label="Top 3 calls" className="ld-cands" ref={list}>
        {frame.top3.map((candidate) => <CandidateRow candidate={candidate} frame={frame} key={candidate.hero} previous={previous} />)}
      </ol>
    </Glass>
  );
}
