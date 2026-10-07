/* Counterfactual personalization on scroll. Scroll does not animate anything by itself: it is mapped, deterministically,
   to a STAGE and, inside the three transforming stages, to a local 0–1. The page writes those as CSS variables; the
   CSS draws the picture. Pure — no DOM, no clock — so the order, the boundaries and reduced motion are testable.
   Shorter than the Memory Strip on purpose: one transformation, not five states. */

import type { CoachCue } from "../coach/coach-slot";
import { COUNTERFACTUAL_STAGES, type CounterfactualStage } from "./types";

/* Scroll distance per stage, in stage heights ("screens"). Rests are long enough to read once; the reorder gets the most room. */
export const STAGE_SCREENS: Readonly<Record<CounterfactualStage, number>> = {
  generic: 0.3, context: 0.45, reinterpret: 0.45, reorder: 0.6, personal: 0.4,
};

export const COUNTERFACTUAL_SCROLL_SCREENS = Math.round(COUNTERFACTUAL_STAGES.reduce((sum, stage) => sum + STAGE_SCREENS[stage], 0) * 100) / 100;

export interface CounterfactualView {
  readonly stage: CounterfactualStage;
  /** The model's contour compresses into the chip and the model activates (0 → 1, during `context`, eased). */
  readonly context: number;
  /** The generic reading loosens and the player's evidence challenges it (0 → 1, during `reinterpret`). */
  readonly reinterpret: number;
  /** The ranking moves from the generic slots to the personal ones (0 → 1, during `reorder`, eased). */
  readonly reorder: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const quantize = (n: number) => Math.round(n * 1000) / 1000;
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** Which stage a pinned-scroll fraction falls in, and how far through it (0–1). Before the pin: generic; after: personal. */
export function stageAt(progress: number): { stage: CounterfactualStage; local: number } {
  if (!(progress > 0)) return { stage: "generic", local: 0 };
  let at = clamp01(progress) * COUNTERFACTUAL_SCROLL_SCREENS;
  for (const stage of COUNTERFACTUAL_STAGES) {
    if (at < STAGE_SCREENS[stage]) return { stage, local: at / STAGE_SCREENS[stage] };
    at -= STAGE_SCREENS[stage];
  }
  return { stage: "personal", local: 1 };
}

/**
 * Scroll fraction → what the stage shows. Full motion scrubs each transforming stage with the scroll; reduced motion
 * never scrubs: every variable is 0 or 1, so each stage is a discrete state and the order simply changes.
 */
export function counterfactualView(progress: number, reduced: boolean): CounterfactualView {
  const { stage, local } = stageAt(progress);
  const at = COUNTERFACTUAL_STAGES.indexOf(stage);
  const phase = (own: CounterfactualStage) => {
    const index = COUNTERFACTUAL_STAGES.indexOf(own);
    if (at > index) return 1;
    if (at < index) return 0;
    return reduced ? 1 : local;
  };
  return {
    stage,
    context: quantize(smoothstep(phase("context"))),
    reinterpret: quantize(phase("reinterpret")),
    reorder: quantize(smoothstep(phase("reorder"))),
  };
}

export const sameView = (a: CounterfactualView, b: CounterfactualView) =>
  a.stage === b.stage && a.context === b.context && a.reinterpret === b.reinterpret && a.reorder === b.reorder;

/* ───────── Coach seam ─────────
   What a future Coach is doing while the call changes, in the vocabulary the slot already speaks: it watches the
   generic reading settle, analyses while the model enters and the evidence is re-read, and points once the ranking
   has moved and the call for this player is made. No character, no animation here. */
const WATCHING: CoachCue = { anchor: null, state: "watching" };
const ANALYZING: CoachCue = { anchor: null, state: "analyzing" };
const POINTING: CoachCue = { anchor: "turn", state: "pointing" };

export function counterfactualCoachCue(stage: CounterfactualStage): CoachCue {
  if (stage === "generic") return WATCHING;
  if (stage === "personal") return POINTING;
  return ANALYZING;
}
