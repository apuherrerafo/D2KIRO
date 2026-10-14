/* LANDING V3 · Hero, the 8 s loop as pure functions of loop time (seconds). No DOM.
   Semantics: magenta = enemy pressure · cyan = evidence and reasoning · lime = personal resolution.
   The Hero shows the generic draft and never resolves it, so the loop contains no lime: it ends with a cyan trace that goes to the
   "reading the evidence" state, and one thread that leaves the stage toward the decision graph.
   The Coach follows two cues (watching / analyzing); the picture of those states is the approved Coach Motion V2 on supported desktop. */

export const LOOP_MS = 8000;

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));
export const ramp = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const ease = (x: number): number => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const smooth = (x: number): number => x * x * (3 - 2 * x);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export type HeroCue = "watching" | "analyzing";

/** The semantic state the Coach picture should be in: the Hero goes to look at the evidence at 2.2 s and comes back at 6 s. */
export function coachCue(t: number): HeroCue {
  return t >= 2.2 && t < 6 ? "analyzing" : "watching";
}

/** The word on the state pill: it changes once the picture has visibly turned (a little after the cue). */
export function poseLabel(t: number): "Watching" | "Analyzing" {
  if (t >= 2.2 && t < 3) return ease(ramp(t, 2.2, 2.9)) > 0.4 ? "Analyzing" : "Watching";
  if (t >= 3 && t < 6) return "Analyzing";
  if (t >= 6 && t < 6.8) return ease(ramp(t, 6, 6.7)) > 0.5 ? "Watching" : "Analyzing";
  return "Watching";
}

/** 0 = at home, 1 = out in the field (the Coach walks whole, it never deforms on the way). */
export function walkAmount(t: number): number {
  return ease(ramp(t, 3, 4.4)) - ease(ramp(t, 4.8, 6));
}

export function bezier(a: readonly [number, number], c: readonly [number, number], b: readonly [number, number], u: number): [number, number] {
  return [(1 - u) * (1 - u) * a[0] + 2 * u * (1 - u) * c[0] + u * u * b[0], (1 - u) * (1 - u) * a[1] + 2 * u * (1 - u) * c[1] + u * u * b[1]];
}

/** Loop time (s) for a virtual clock in ms. */
export const loopTime = (ms: number): number => (ms % LOOP_MS) / 1000;
