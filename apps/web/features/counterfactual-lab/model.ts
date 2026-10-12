/* COUNTERFACTUAL LAB · the pure part. The order and every number on screen is a function of the phase and nothing else:
   the draft never changes, only which evidence is read. No DOM, no clock. */
import type { CoachCue } from "../hero-loop/loop";
import { CANDIDATES, type CandidateFixture } from "./scenario";

export type Phase = "generic" | "evidence" | "personal";

export type BeatId = "generic" | "evidence" | "rerank" | "call" | "quiet";

export type Beat = { id: BeatId; phase: Phase; ms: number; coach: CoachCue };

const cue = (state: CoachCue["state"], aim: CoachCue["aim"], scale: number, verb: CoachCue["verb"], amplitude: number): CoachCue => ({ state, aim, scale, verb, amplitude });

/** One short story. The Coach watches, analyzes, confirms, points once and then steps back. */
export const BEATS: readonly Beat[] = [
  { id: "generic", phase: "generic", ms: 3200, coach: cue("watching", "center", 1, null, 0.6) },
  { id: "evidence", phase: "evidence", ms: 2800, coach: cue("analyzing", "right", 1, "TETHER", 0.8) },
  { id: "rerank", phase: "personal", ms: 1700, coach: cue("confirming", "right", 1, "SETTLE", 0.9) },
  { id: "call", phase: "personal", ms: 1900, coach: cue("pointing", "right", 1, "TRANSFER", 0.8) },
  { id: "quiet", phase: "personal", ms: 0, coach: cue("watching", "center", 0.86, null, 0.4) },
];

export const beatIndexOf = (id: BeatId) => BEATS.findIndex((b) => b.id === id);

/** `?phase=` picks the settled beat for that phase (personal rests on `quiet`; `?beat=call` reaches the pointing frame). */
export const BEAT_FOR_PHASE: Record<Phase, BeatId> = { generic: "generic", evidence: "evidence", personal: "quiet" };

export const FINAL_BEAT = BEATS.length - 1;

/** Which FIT is in force. Evidence ARRIVES before it counts: during `evidence` the order and the numbers are still the generic ones. */
export const fitOf = (c: CandidateFixture, phase: Phase) => (phase === "personal" ? c.personalFit : c.genericFit);

export type Row = CandidateFixture & {
  rank: number;
  fit: number;
  /** Evidence chip visible (it has arrived). */
  evidenceShown: boolean;
  /** The signed change and its cause are visible: only once your games count. */
  deltaShown: boolean;
};

/** Best first. Ties keep the fixture order so a tie can never reorder by accident. */
export function rowsAt(phase: Phase, candidates: readonly CandidateFixture[] = CANDIDATES): Row[] {
  return candidates
    .map((c) => ({ c, fit: fitOf(c, phase) }))
    .sort((a, b) => b.fit - a.fit || a.c.order - b.c.order)
    .map(({ c, fit }, index) => ({ ...c, rank: index + 1, fit, evidenceShown: phase !== "generic", deltaShown: phase === "personal" && c.gamesDelta !== 0 }));
}

export const leaderAt = (phase: Phase, candidates: readonly CandidateFixture[] = CANDIDATES) => rowsAt(phase, candidates)[0].hero;

/** "+6" / "−1" (true minus sign). Zero is never rendered as a change. */
export const signed = (n: number) => `${n > 0 ? "+" : "−"}${Math.abs(n)}`;

/** Does the story hold: the leader changes between the two reads, and the hero that rises is the one your games moved up. */
export function transition(candidates: readonly CandidateFixture[] = CANDIDATES) {
  const from = rowsAt("generic", candidates);
  const to = rowsAt("personal", candidates);
  const riser = to[0];
  return { from: from[0].hero, to: riser.hero, changed: from[0].hero !== riser.hero, riserFrom: from.find((r) => r.hero === riser.hero)?.rank ?? 0, cause: riser.gamesDelta };
}
