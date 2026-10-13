// Coach Motion V2 · entry-stride probe (pure). An entry head for source-loop phase p starts with the exact pose of that phase; a request taken at loop frame f enters
// the head of the NEAREST phase, so the picture jumps from pose(f) to pose(p). That jump is what the stride controls, and it scales with how fast the source loop moves:
// a calm WATCHING tolerates stride 6, a faster loop needs a smaller one. The probe measures the jump with the real authored pose tracks (loop-pose.ts, the tracks the
// Gold Master frames are rendered from) and the same pose-distance metric the guards use, so no head needs to be rendered to choose a stride.
//
// It is generic over the loops of LOOP_DEFS: every SOURCE loop of the graph is probed with the same rule, and `validateGraphStrides` fails a graph.json whose strides or
// continuity budgets are not what the probe supports.

import { LOOP_DEFS, jobPoses, poseDistance, type LoopDef } from "./loop-pose";
import { nearestHeadPhase } from "./sequencer";
import type { Pose } from "../hero-loop/coach/motion";

export interface StrideReport {
  stride: number;
  heads: number;
  /** worst pose jump over every possible entry frame, in "screen units" (poseDistance) */
  maxJump: number;
  meanJump: number;
  p95Jump: number;
  /** worst jump measured in source frames (<= ceil(stride / 2)) */
  maxFramesOff: number;
  /** maxJump relative to the loop's own largest / median frame-to-frame step */
  jumpOverMaxStep: number;
  jumpOverMedianStep: number;
}

export interface LoopProbe {
  loop: string;
  frames: number;
  /** frame-to-frame pose step of the loop at 30 fps */
  step: { median: number; p95: number; max: number };
  strides: StrideReport[];
}

const percentile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1) + 0.5))];

export function probeLoop(loop: string, poses: Pose[], strides: number[]): LoopProbe {
  const n = poses.length;
  const steps = poses.map((p, i) => poseDistance(p, poses[(i + 1) % n])).sort((a, b) => a - b);
  const step = { median: percentile(steps, 0.5), p95: percentile(steps, 0.95), max: steps[steps.length - 1] };
  const reports = strides.map((stride): StrideReport => {
    const jumps: number[] = [];
    let off = 0;
    for (let f = 0; f < n; f += 1) {
      const phase = nearestHeadPhase(f, n, stride);
      jumps.push(poseDistance(poses[f], poses[phase]));
      const forward = (((phase - f) % n) + n) % n;
      off = Math.max(off, Math.min(forward, n - forward));
    }
    jumps.sort((a, b) => a - b);
    const maxJump = jumps[jumps.length - 1];
    return {
      stride,
      heads: Math.ceil(n / stride),
      maxJump,
      meanJump: jumps.reduce((a, b) => a + b, 0) / n,
      p95Jump: percentile(jumps, 0.95),
      maxFramesOff: off,
      jumpOverMaxStep: maxJump / step.max,
      jumpOverMedianStep: maxJump / step.median,
    };
  });
  return { loop, frames: n, step, strides: reports };
}

export const PROBE_STRIDES = [1, 2, 3, 4, 5, 6, 8, 10];

/** The probe over every loop of `defs` (default: the shipped ones), each from its own authored pose track. */
export function probeLoops(strides = PROBE_STRIDES, defs: Record<string, LoopDef> = LOOP_DEFS): Record<string, LoopProbe> {
  const out: Record<string, LoopProbe> = {};
  for (const id of Object.keys(defs)) out[id] = probeLoop(id, jobPoses({ kind: "loop", loop: id }, defs), strides);
  return out;
}

/** Entry jumps up to this many times the loop's own typical (p95) frame-to-frame step read as ordinary motion, not as a seam. With it the approved WATCHING stride (6) comes out. */
export const NATURAL_STEP_FACTOR = 1.5;

/** Largest probed stride (fewest heads) whose p95 entry jump stays within `factor` natural steps; null when none does. The blink of WATCHING is excluded on purpose:
    its worst jumps are the eyelid itself moving, not the entry. */
export function recommendStride(probe: LoopProbe, factor = NATURAL_STEP_FACTOR): number | null {
  const ok = probe.strides.filter((s) => s.p95Jump <= factor * probe.step.p95).map((s) => s.stride);
  return ok.length ? Math.max(...ok) : null;
}

// ------------------------------------------------------------------ entry strategies

export type StudiedStrategy = "nearest" | "forward-skip" | "forward-wait";

export interface StrategyStudy {
  strategy: StudiedStrategy;
  /** worst |head phase - upcoming frame| in source frames (the continuity budget `maxStepFrames` bounds this) */
  maxMismatchFrames: number;
  /** largest pose step across the entry (source frame on screen -> first head frame), absolute and in natural (max) loop steps */
  maxSeamStep: number;
  maxSeamOverNaturalStep: number;
  /** frames the request is delayed by before the head starts (the loop keeps playing meanwhile) */
  meanWaitFrames: number;
  maxWaitFrames: number;
  /** entries whose first head frame repeats the picture already on screen (a one-frame hold) */
  holds: number;
  /** entries whose first head frame is BEHIND the picture on screen (the motion steps backwards) */
  reversals: number;
  withinBudget: boolean;
}

/**
 * Compares how a request taken at every loop frame can enter a stride grid of heads:
 *   nearest       the head of the phase nearest to the upcoming frame (no wait; the picture may repeat or skip by up to stride / 2 frames)
 *   forward-skip  the first head at or after the upcoming frame, entered at once (never behind, but it skips up to stride - 1 frames ahead)
 *   forward-wait  the same head, but the loop keeps playing until it is reached (never behind, never skips; the request waits up to stride - 1 frames)
 */
export function studyEntryStrategies(poses: Pose[], stride: number, maxStepFrames: number): StrategyStudy[] {
  const n = poses.length;
  const natural = Math.max(...poses.map((p, i) => poseDistance(p, poses[(i + 1) % n])));
  const mod = (a: number) => ((a % n) + n) % n;
  const signed = (d: number) => (mod(d) > n / 2 ? mod(d) - n : mod(d)); // circular difference in (-n/2, n/2]
  return (["nearest", "forward-skip", "forward-wait"] as const).map((strategy): StrategyStudy => {
    let maxMismatch = 0;
    let maxSeam = 0;
    let waitSum = 0;
    let maxWait = 0;
    let holds = 0;
    let reversals = 0;
    for (let f = 0; f < n; f += 1) {
      const u = mod(f + 1);
      let phase: number;
      let wait = 0;
      if (strategy === "nearest") phase = nearestHeadPhase(u, n, stride);
      else {
        wait = mod(Math.ceil(u / stride) * stride - u) % n; // frames until the next phase on the grid, circular (the grid restarts at 0)
        phase = mod(u + wait);
        if (strategy === "forward-skip") wait = 0;
      }
      const shown = strategy === "forward-wait" ? mod(f + wait) : f; // the picture on screen when the head starts
      const d = signed(phase - mod(shown + 1));
      maxMismatch = Math.max(maxMismatch, Math.abs(d));
      maxSeam = Math.max(maxSeam, poseDistance(poses[shown], poses[phase]));
      waitSum += wait;
      maxWait = Math.max(maxWait, wait);
      if (d === -1) holds += 1;
      else if (d < -1) reversals += 1;
    }
    return { strategy, maxMismatchFrames: maxMismatch, maxSeamStep: maxSeam, maxSeamOverNaturalStep: maxSeam / natural, meanWaitFrames: waitSum / n, maxWaitFrames: maxWait, holds, reversals, withinBudget: maxMismatch <= maxStepFrames };
  });
}

/** The extra wait a forward-only entry may add before it is worth its latency: about one frame (33 ms). */
export const FORWARD_WAIT_ALLOWANCE_FRAMES = 1;

/** The frozen decision rule for a fast unidirectional source loop: take forward-wait only when it removes every hold / reversal of `nearest`, stays within the continuity budget
    and its WORST added wait is within the allowance; otherwise keep nearest. */
export function chooseEntryStrategy(studies: StrategyStudy[]): { strategy: "nearest-head" | "nearest-forward"; why: string } {
  const nearest = studies.find((s) => s.strategy === "nearest")!;
  const fwd = studies.find((s) => s.strategy === "forward-wait")!;
  if (nearest.holds + nearest.reversals === 0) return { strategy: "nearest-head", why: "nearest never repeats or reverses a picture on this grid" };
  if (!fwd.withinBudget) return { strategy: "nearest-head", why: "forward entry exceeds the continuity budget" };
  if (fwd.maxWaitFrames > FORWARD_WAIT_ALLOWANCE_FRAMES) return { strategy: "nearest-head", why: `forward entry removes the ${nearest.holds} one-frame holds / ${nearest.reversals} reversals but adds up to ${fwd.maxWaitFrames} frames of wait (mean ${fwd.meanWaitFrames.toFixed(2)}), above the ${FORWARD_WAIT_ALLOWANCE_FRAMES}-frame allowance` };
  return { strategy: "nearest-forward", why: "forward entry removes the hold / reversal within budget and within the wait allowance" };
}

// ------------------------------------------------------------------ graph.json validation against the probe

export interface GraphForProbe {
  loops: Record<string, { frames: number; strideLimit: number }>;
  edges: Array<{ id: string; from: string; entry: { stride: number; maxStepFrames: number } }>;
}

/** Every reason a graph.json (authoring input) disagrees with the pose tracks and the stride rule; empty = valid. A stride coarser than the source loop supports must fail here. */
export function validateGraphStrides(graph: GraphForProbe, probes: Record<string, LoopProbe>): string[] {
  const problems: string[] = [];
  for (const [id, loop] of Object.entries(graph.loops)) {
    const probe = probes[id];
    if (!probe) {
      problems.push(`loop ${id}: no pose definition to probe`);
      continue;
    }
    if (probe.frames !== loop.frames) problems.push(`loop ${id}: graph says ${loop.frames} frames, the pose track has ${probe.frames}`);
    const rec = recommendStride(probe);
    if (rec === null) problems.push(`loop ${id}: no probed stride keeps the entry jump within ${NATURAL_STEP_FACTOR} natural steps`);
    else if (loop.strideLimit !== rec) problems.push(`loop ${id}: strideLimit ${loop.strideLimit} is not the probe's recommendation ${rec}`);
  }
  for (const e of graph.edges) {
    const loop = graph.loops[e.from];
    if (!loop) continue;
    if (e.entry.stride > loop.strideLimit) problems.push(`edge ${e.id}: stride ${e.entry.stride} is coarser than ${e.from} supports (strideLimit ${loop.strideLimit})`);
    if (e.entry.maxStepFrames !== Math.floor(e.entry.stride / 2)) problems.push(`edge ${e.id}: maxStepFrames ${e.entry.maxStepFrames} must be floor(stride / 2) = ${Math.floor(e.entry.stride / 2)}`);
  }
  return problems;
}
