// Coach Motion V2 · entry-stride probe (pure). An entry head for source-loop phase p starts with the exact pose of that phase; a request taken at loop frame f enters
// the head of the NEAREST phase, so the picture jumps from pose(f) to pose(p). That jump is what the stride controls, and it scales with how fast the source loop moves:
// a calm WATCHING tolerates stride 6, a faster loop needs a smaller one. The probe measures the jump with the real authored pose tracks (loop-pose.ts, the tracks the
// Gold Master frames are rendered from) and the same pose-distance metric the guards use, so no head needs to be rendered to choose a stride.

import { SIM_HZ, jobPoses, poseDistance } from "./loop-pose";
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

/** The probe over the shipped WATCHING and ANALYZING loops (the same tracks the production frames were rendered from). */
export function probeSlice(strides = [2, 3, 4, 5, 6, 8]): { simHz: number; watching: LoopProbe; analyzing: LoopProbe } {
  return { simHz: SIM_HZ, watching: probeLoop("watching", jobPoses({ kind: "watching" }), strides), analyzing: probeLoop("analyzing", jobPoses({ kind: "analyzing" }), strides) };
}

/** Entry jumps up to this many times the loop's own typical (p95) frame-to-frame step read as ordinary motion, not as a seam. With it the approved WATCHING stride (6) comes out. */
export const NATURAL_STEP_FACTOR = 1.5;

/** Largest probed stride (fewest heads) whose p95 entry jump stays within `factor` natural steps; null when none does. The blink of WATCHING is excluded on purpose:
    its worst jumps are the eyelid itself moving, not the entry. */
export function recommendStride(probe: LoopProbe, factor = NATURAL_STEP_FACTOR): number | null {
  const ok = probe.strides.filter((s) => s.p95Jump <= factor * probe.step.p95).map((s) => s.stride);
  return ok.length ? Math.max(...ok) : null;
}
