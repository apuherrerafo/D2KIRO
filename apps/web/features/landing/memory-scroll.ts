/* LANDING-01B · Memory Strip on scroll (TSK-241). Scroll does not animate anything by itself: it is mapped,
   deterministically, to a WINDOW (handoff · hold · transition) and inside a transition to a local fraction, which
   is handed to the Phase C player as `scrub`. Holds are rests: the settled static scene, nothing moving.
   Pure — no DOM, no clock — so the order, the boundaries and reduced motion are testable without a browser. */

import type { CoachCue } from "./coach/coach-slot";
import { MEMORY_SCENE_ORDER, MEMORY_TRANSITIONS, type MemorySceneId, type MemoryTransitionId } from "./memory-strip";

export type MemoryBeat =
  | { readonly kind: "handoff"; readonly screens: number }
  | { readonly kind: "hold"; readonly scene: MemorySceneId; readonly screens: number }
  | { readonly kind: "transition"; readonly transition: MemoryTransitionId; readonly from: MemorySceneId; readonly to: MemorySceneId; readonly screens: number };

/* Scroll distance per beat, in stage heights ("screens"). Tuned by watching the pace, not to a vh target:
   a hold is long enough to read the annotation once; a transition is long enough that one flick does not skip
   its meaning. The longest transitions (contradiction, model) get the most room. */
export const HANDOFF_SCREENS = 0.15;
/* The handoff starts BEFORE the pin, while the bridge is still on screen: the stage's approach (`entry`, 0→1) carries
   this share of it, and the short pinned beat only settles the rest. `ENTRY_VIEWPORT` is how far down the viewport the
   stage's top is when the approach begins (the Puck seal is just peeking in), as a fraction of its height. */
export const HANDOFF_ENTRY_SHARE = 0.7;
export const ENTRY_VIEWPORT = 0.78;
const HOLD_SCREENS: Readonly<Record<MemorySceneId, number>> = {
  "match-01": 0.35, "match-08": 0.35, "match-24": 0.4, "match-56": 0.35, "player-model": 0.5,
};
const TRANSITION_SCREENS: Readonly<Record<MemoryTransitionId, number>> = {
  "match-01>match-08": 0.65, "match-08>match-24": 0.8, "match-24>match-56": 0.7, "match-56>player-model": 0.8,
};

export const MEMORY_BEATS_ON_SCROLL: readonly MemoryBeat[] = [
  { kind: "handoff", screens: HANDOFF_SCREENS },
  ...MEMORY_SCENE_ORDER.flatMap((scene): MemoryBeat[] => {
    const hold: MemoryBeat = { kind: "hold", scene, screens: HOLD_SCREENS[scene] };
    const next = MEMORY_TRANSITIONS.find((t) => t.from === scene);
    if (!next) return [hold];
    return [hold, { kind: "transition", transition: next.id, from: next.from, to: next.to, screens: TRANSITION_SCREENS[next.id] }];
  }),
];

/** Pinned scroll length, in stage heights. The track is one stage plus this (scaled per viewport in CSS). */
export const MEMORY_SCROLL_SCREENS = Math.round(MEMORY_BEATS_ON_SCROLL.reduce((sum, beat) => sum + beat.screens, 0) * 100) / 100;

export interface MemoryScrollView {
  /** Index into MEMORY_BEATS_ON_SCROLL. */
  readonly beat: number;
  readonly sceneId: MemorySceneId;
  /** Fraction of the transition INTO `sceneId` (0–1), or null when the scene is settled. */
  readonly scrub: number | null;
  /** 0 → 1: how much of Match 01 has joined the first retained decision (the handoff from the Hero). */
  readonly handoff: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const quantize = (n: number, steps: number) => Math.round(n * steps) / steps;

/** Which beat a pinned-scroll fraction falls in, and how far through it (0–1). Before the pin: handoff at 0; after: the last hold. */
export function beatAt(progress: number): { index: number; local: number } {
  if (!(progress > 0)) return { index: 0, local: 0 };
  let at = clamp01(progress) * MEMORY_SCROLL_SCREENS;
  for (const [index, beat] of MEMORY_BEATS_ON_SCROLL.entries()) {
    if (at < beat.screens) return { index, local: at / beat.screens };
    at -= beat.screens;
  }
  return { index: MEMORY_BEATS_ON_SCROLL.length - 1, local: 1 };
}

/**
 * Scroll fraction → what the player shows. Full motion scrubs the Phase C transition with the scroll.
 * Reduced motion never scrubs: each transition window flips to the next scene at its midpoint, and the
 * player's own reduced step (a short fade) carries the change.
 */
export function memoryScrollView(progress: number, reduced: boolean, entry = 0): MemoryScrollView {
  const { index, local } = beatAt(progress);
  const beat = MEMORY_BEATS_ON_SCROLL[index];
  if (beat.kind === "handoff") {
    /* Before the pin (`progress <= 0`) only the approach counts; once pinned, the beat finishes what the approach began. */
    const formed = progress > 0 ? HANDOFF_ENTRY_SHARE + (1 - HANDOFF_ENTRY_SHARE) * local : HANDOFF_ENTRY_SHARE * clamp01(entry);
    return { beat: index, sceneId: "match-01", scrub: null, handoff: reduced ? Number(formed >= 0.5) : quantize(formed, 100) };
  }
  if (beat.kind === "hold") return { beat: index, sceneId: beat.scene, scrub: null, handoff: 1 };
  if (reduced) return { beat: index, sceneId: local < 0.5 ? beat.from : beat.to, scrub: null, handoff: 1 };
  return { beat: index, sceneId: beat.to, scrub: quantize(local, 1000), handoff: 1 };
}

export const sameView = (a: MemoryScrollView, b: MemoryScrollView) =>
  a.beat === b.beat && a.sceneId === b.sceneId && a.scrub === b.scrub && a.handoff === b.handoff;

/** A readable name for the beat (`handoff`, `hold:match-08`, `transition:match-08>match-24`), for review and tests. */
export function beatName(beat: MemoryBeat) {
  if (beat.kind === "handoff") return "handoff";
  if (beat.kind === "hold") return `hold:${beat.scene}`;
  return `transition:${beat.transition}`;
}

/* ───────── Coach seam ─────────
   What a future Coach is doing while the memory builds, in the vocabulary the slot already speaks: it watches the
   handoff, is unsure while the evidence is thin (01, 08), analyses while evidence changes, watches the settled
   contradiction and context, and points once history has become a model. No character, no animation here. */
const WATCHING: CoachCue = { anchor: null, state: "watching" };
const ANALYZING: CoachCue = { anchor: null, state: "analyzing" };
const UNCERTAIN: CoachCue = { anchor: null, state: "uncertain" };
const POINTING: CoachCue = { anchor: null, state: "pointing" };
const HOLD_CUE: Readonly<Record<MemorySceneId, CoachCue>> = {
  "match-01": UNCERTAIN, "match-08": UNCERTAIN, "match-24": WATCHING, "match-56": WATCHING, "player-model": POINTING,
};

export function memoryCoachCue(beat: MemoryBeat): CoachCue {
  if (beat.kind === "handoff") return WATCHING;
  if (beat.kind === "transition") return ANALYZING;
  return HOLD_CUE[beat.scene];
}
