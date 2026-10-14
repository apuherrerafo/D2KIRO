/* LANDING V3 · living decision graph, the model. Pure data and pure functions: no DOM.
   The stage is a pure function of the beat (k = 1..6), so a fast scroll flick that skips beats simply lands in the right state.
   Motion language per beat: ATTRACT · REPEL · TETHER · GATHER · SCATTER · SETTLE (see the stage for how each is drawn).
   Colour: cyan = evidence · magenta = pressure / losing support · lime = personal resolution (first appears at beat 6). */

import type { CandidateId } from "../fixture";

export const BEAT_COUNT = 6;
export type Beat = 1 | 2 | 3 | 4 | 5 | 6;
export type StageKind = "wide" | "tall";

export const clamp = (x: number, a: number, b: number): number => Math.min(b, Math.max(a, x));

/** Scroll progress through the sticky story (0..1) → the beat that is showing. A small band around the current beat
    stops it flickering back and forth at a boundary. */
export function beatForProgress(p: number, current: number): Beat {
  const k = clamp(Math.floor(p * BEAT_COUNT) + 1, 1, BEAT_COUNT) as Beat;
  if (k === current) return k;
  if (current > 0 && p >= (current - 1) / BEAT_COUNT - 0.02 && p <= current / BEAT_COUNT + 0.02) return current as Beat;
  return k;
}

/** The scroll position (as progress 0..1) at the middle of beat k: where a rail button scrolls to. */
export function progressForBeat(k: number): number {
  return (clamp(k, 1, BEAT_COUNT) - 0.5) / BEAT_COUNT;
}

export type SubTone = "" | "pink" | "cyan" | "lime" | "faint";
/** Row sub-line per candidate and beat: [text, tone]. */
export const SUB: Record<CandidateId, ReadonlyArray<readonly [string, SubTone?]>> = {
  qop: [["Strong into this draft"], ["Strong into this draft"], ["Strong into this draft"], ["−1 · Some history"], ["Lead losing support", "pink"], ["−1 · Some history"]],
  puck: [["Strong into this draft"], ["Strong into this draft"], ["Pairs with supports", "cyan"], ["+6 · Often played", "cyan"], ["Evidence gathering", "cyan"], ["Your call", "lime"]],
  vs: [["Fits the matchups"], ["Support loosening", "pink"], ["Support loosening", "pink"], ["No history yet", "faint"], ["No history yet", "faint"], ["No history yet", "faint"]],
};

export type RowState = "" | "ev" | "lost" | "loose" | "win";
export const ROW_STATE: Record<CandidateId, readonly RowState[]> = {
  qop: ["", "", "", "", "lost", ""],
  puck: ["", "", "ev", "ev", "ev", "win"],
  vs: ["", "loose", "loose", "loose", "loose", "loose"],
};

export type InputId = "you" | "axe" | "slark" | "sup" | "games";
/** Node visibility per beat: x hidden · o on · q quiet · d dim. Slark is in the draft from the start: quiet at beat 1, active at beat 2. */
export const NODE_VISIBILITY: Record<InputId, string> = { you: "oooooo", axe: "oooddd", slark: "qooddd", sup: "xxoood", games: "xxxood" };

/** x off · n neutral · w weak evidence · e evidence · s strong evidence · d dim · g ghost · p pressure · t unfinished tether · l resolution */
export type EdgeState = "x" | "n" | "w" | "e" | "s" | "d" | "g" | "p" | "t" | "l";
export type EdgeKind = "soft" | "draw";
export interface EdgeSpec {
  id: string;
  from: InputId;
  to: CandidateId;
  kind: EdgeKind;
  /** state per beat 1..6 */
  states: string;
  halo?: boolean;
}

export const EDGES: readonly EdgeSpec[] = [
  { id: "y_q", from: "you", to: "qop", kind: "soft", states: "nnnnpg" },
  { id: "y_p", from: "you", to: "puck", kind: "soft", states: "nnnnnx" },
  { id: "y_v", from: "you", to: "vs", kind: "soft", states: "nggggg" },
  { id: "a_q", from: "axe", to: "qop", kind: "soft", states: "nnnnpg" },
  { id: "a_p", from: "axe", to: "puck", kind: "draw", states: "nwwwed" },
  { id: "a_v", from: "axe", to: "vs", kind: "soft", states: "nggggg" },
  { id: "s_p", from: "slark", to: "puck", kind: "draw", states: "nwwwed" },
  { id: "s_v", from: "slark", to: "vs", kind: "soft", states: "nppggx" },
  { id: "sup_p", from: "sup", to: "puck", kind: "draw", states: "xxseed" },
  { id: "g_p", from: "games", to: "puck", kind: "draw", states: "xxxssd" },
  { id: "g_q", from: "games", to: "qop", kind: "draw", states: "xxxwwd" },
  { id: "g_v", from: "games", to: "vs", kind: "soft", states: "xxxttt" },
  { id: "l_y", from: "you", to: "puck", kind: "draw", states: "xxxxxl", halo: true },
];

/** The narrow (phone) stage draws only the 2–3 edges that carry each beat. */
export const TALL_EDGES: ReadonlyArray<readonly string[]> = [
  ["y_q", "a_q"],
  ["s_v", "s_p"],
  ["sup_p", "a_p"],
  ["g_p", "g_q", "g_v"],
  ["a_p", "sup_p", "g_p"],
  ["l_y", "g_p"],
];

export type TagTone = "cyan" | "pink" | "mut" | "faint";
export interface TagSpec {
  edge: string;
  at: number;
  text: string;
  tone: TagTone;
  beats: readonly number[];
}
/** Edge labels (wide stage only; the narrow stage carries the same words in the row sub-lines). */
export const TAGS: readonly TagSpec[] = [
  { edge: "s_v", at: 0.55, text: "Pressure", tone: "pink", beats: [2] },
  { edge: "sup_p", at: 0.6, text: "Pairs with your supports", tone: "cyan", beats: [3, 5] },
  { edge: "g_p", at: 0.62, text: "+6 · Often played by you", tone: "cyan", beats: [4, 5] },
  { edge: "g_q", at: 0.5, text: "−1 · Some history", tone: "mut", beats: [4] },
  { edge: "g_v", at: 0.58, text: "No history yet", tone: "faint", beats: [4] },
  { edge: "a_p", at: 0.56, text: "Holds up vs the enemy picks", tone: "cyan", beats: [5] },
];

/** Coach stills the graph can show (Coach Web Pack, memory set). */
export const COACH_POSES = ["watching-r", "watching-c", "analyzing-r", "analyzing-ru", "analyzing-ld", "pointing-rd", "pointing-l"] as const;
export type CoachPose = (typeof COACH_POSES)[number];
export const coachUrl = (pose: CoachPose): string => `/coach-web-pack/memory/${pose}.webp`;

/** Coach centre and pose per beat. Wide: free in the field between inputs and ranking. Tall: a right-edge rail beside the graph. */
export const COACH: Record<StageKind, ReadonlyArray<readonly [number, number, CoachPose]>> = {
  wide: [[470, 566, "watching-r"], [640, 566, "analyzing-ru"], [455, 372, "analyzing-ld"], [470, 500, "analyzing-ld"], [590, 120, "analyzing-r"], [700, 72, "pointing-rd"]],
  tall: [[327, 92, "watching-c"], [327, 200, "analyzing-ld"], [327, 392, "analyzing-ld"], [327, 452, "analyzing-ld"], [327, 262, "analyzing-ld"], [327, 148, "pointing-l"]],
};

/** Ranking rows: which slot (0..2) each candidate occupies before (anyone) and after (you) the personal reading. */
export function rowSlot(id: CandidateId, k: number): number {
  const slots: Record<CandidateId, readonly [number, number]> = { qop: [0, 1], puck: [1, 0], vs: [2, 2] };
  return slots[id][k === 6 ? 1 : 0];
}

export function rowFit(id: CandidateId, k: number): number {
  const fit: Record<CandidateId, readonly [number, number]> = { qop: [84, 83], puck: [82, 88], vs: [77, 77] };
  return fit[id][k === 6 ? 1 : 0];
}

/** The caption / still states the reduced-motion page shows: beat 1, beat 4, beat 6. */
export const STILL_BEATS: readonly Beat[] = [1, 4, 6];

export const easeInOut = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
