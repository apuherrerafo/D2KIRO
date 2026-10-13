// Coach Motion V2 production slice · authored pose tracks (pure, no three, no DOM).
//
// The Live Gold Master is not periodic: its free clock drives sines at 0.31 / 0.45 / 1.1 / 1.7 / 2.6 / 3.1 rad/s and a LINEAR ring spin
// (watching 0.08 rad/s, analyzing 0.9 rad/s). No window of it closes into a forward loop. These tracks keep the Live pose space, the Live
// amplitudes, the Live blink and the Live smoothing, and snap only the TIME PARAMETERS so the cycle closes:
//   WATCHING  8.4 s = exactly two Live blink periods (4.2 s); slow sines snapped to whole cycles; the ring SWAYS (see below).
//   ANALYZING 7.0 s; the ring turns exactly once (0.8976 rad/s vs Live 0.9), sines snapped to whole cycles.
// Every pose is then rendered by the real Gold Master stage (capture harness). Nothing is blended in image space.

import { EYE_LIMIT, NEUTRAL_POSE, addPose, blinkOpen, verbImpulse, type Aim, type Pose } from "../hero-loop/coach/motion";

export const FPS = 30;
export const SIM_HZ = 120;
export const WATCH_FRAMES = 252;
export const ANALYZE_FRAMES = 210;
/** Frames of the entry head (the first frames of the transition, one per WATCHING entry phase). */
export const HEAD_FRAMES = 10;
/** Frames of the shared tail (reveal settling, ring contraction), then the ANALYZING loop starts at its frame 0. */
export const TAIL_FRAMES = 35;
export const TRANSITION_FRAMES = HEAD_FRAMES + TAIL_FRAMES;
export const HEAD_STRIDE = 6;
/** The Live eases the smoothed terms only; the direct terms (ring spin/radius, squash) are eased over these frames so the ring does not pop. */
const DIRECT_EASE_FRAMES = 8;
const WARM_SECONDS = 3;

const TAU = Math.PI * 2;
const WATCH_T = WATCH_FRAMES / FPS;
const ANALYZE_T = ANALYZE_FRAMES / FPS;

/** The cues the Landing really sends here: draft (WATCHING) then reveal (ANALYZING, verb GATHER). Same values as CUE_BY_PHASE. */
export const WATCH_AIM: Aim = { x: 0, y: 0 };
export const ANALYZE_AIM: Aim = { x: 1, y: 0.15 };
export const WATCH_AMPLITUDE = 0.6;
export const ANALYZE_AMPLITUDE = 0.8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Frequencies of each authored component, with the Live value they replace (audited by loop-pose.test.ts). */
export const SNAPPED = {
  watching: { yaw: { live: 0.45, loop: TAU / WATCH_T }, pitch: { live: 0.31, loop: TAU / WATCH_T }, squash: { live: 1.1, loop: (2 * TAU) / WATCH_T } },
  analyzing: { scan: { live: 2.6, loop: (3 * TAU) / ANALYZE_T }, eyeZ: { live: 1.7, loop: (2 * TAU) / ANALYZE_T }, radius: { live: 3.1, loop: (3 * TAU) / ANALYZE_T }, spin: { live: 0.9, loop: TAU / ANALYZE_T } },
} as const;

/** Seconds into the loop at which the first blink starts (the loop must not open or close on a blink). */
const BLINK_AT = 0.9;

/** WATCHING base pose, loop time `t` (seconds). Period WATCH_T. */
export function watchingBase(t: number): Pose {
  const w = TAU / WATCH_T;
  const spinAmp = 0.08 / w; // peak ring speed = the Live's 0.08 rad/s, but it cannot rotate one way for ever inside an 8.4 s loop
  return {
    ...NEUTRAL_POSE,
    yaw: Math.sin(w * t) * 0.05,
    pitch: Math.sin(w * t + 1.3) * 0.02,
    eyeOpen: blinkOpen(t + (4.2 - BLINK_AT)),
    shardSpin: Math.sin(w * t + 0.9) * spinAmp,
    squash: 1 + Math.sin(2 * w * t + 0.5) * 0.008,
  };
}

/** ANALYZING base pose, loop time `t`. Period ANALYZE_T. The ring turns one way, exactly one revolution per loop. */
export function analyzingBase(t: number): Pose {
  const aim = ANALYZE_AIM;
  const scan = Math.sin(SNAPPED.analyzing.scan.loop * t);
  return {
    ...NEUTRAL_POSE,
    yaw: aim.x * 0.2 + scan * 0.1,
    pitch: 0.04,
    eyeX: clamp(aim.x * 0.5 + scan * 0.8, -1, 1) * EYE_LIMIT.x,
    eyeZ: Math.sin(SNAPPED.analyzing.eyeZ.loop * t + 0.7) * EYE_LIMIT.z * 0.5,
    eyeOpen: 0.8,
    shardSpin: SNAPPED.analyzing.spin.loop * t,
    shardRadius: 1 + Math.sin(SNAPPED.analyzing.radius.loop * t + 1.1) * 0.025,
  };
}

/** The Live stage's amplitude damping (live-stage.ts `damp`). */
export function damp(p: Pose, a: number): Pose {
  if (a >= 1) return p;
  return { ...p, yaw: p.yaw * a, pitch: p.pitch * a, eyeX: p.eyeX * a, eyeZ: p.eyeZ * a, lean: p.lean * a, squash: 1 + (p.squash - 1) * a, shardRadius: 1 + (p.shardRadius - 1) * a };
}

/** The Live stage's per-step smoothing (live-stage.ts `update`): yaw/pitch/eyes/lean lag (tau 50 ms), eyeOpen lags at twice the rate, squash/spin/radius are direct. */
export function smoothPose(p: Pose, target: Pose, dt: number): Pose {
  const k = 1 - Math.exp(-dt * 20);
  return {
    yaw: p.yaw + (target.yaw - p.yaw) * k,
    pitch: p.pitch + (target.pitch - p.pitch) * k,
    eyeX: p.eyeX + (target.eyeX - p.eyeX) * k,
    eyeZ: p.eyeZ + (target.eyeZ - p.eyeZ) * k,
    eyeOpen: p.eyeOpen + (target.eyeOpen - p.eyeOpen) * Math.min(1, k * 2),
    squash: target.squash,
    shardSpin: target.shardSpin,
    shardRadius: target.shardRadius,
    lean: p.lean + (target.lean - p.lean) * k,
  };
}

const watchTarget = (t: number): Pose => damp(watchingBase(t), WATCH_AMPLITUDE);
/** `verbT` = seconds since the reveal cue (GATHER); a large value is the verb's settled state. */
const analyzeTarget = (t: number, verbT: number): Pose => damp(addPose(analyzingBase(t), verbImpulse("GATHER", verbT, ANALYZE_AIM)), ANALYZE_AMPLITUDE);

const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth01 = (x: number) => x * x * (3 - 2 * x);
const dt = 1 / SIM_HZ;
const perFrame = SIM_HZ / FPS;

export type Job = { kind: "watching" } | { kind: "analyzing" } | { kind: "head"; phase: number } | { kind: "tail" };

export function headPhases(): number[] {
  const out: number[] = [];
  for (let p = 0; p < WATCH_FRAMES; p += HEAD_STRIDE) out.push(p);
  return out;
}

/** Analyzing-loop clock at the first transition frame, so that the transition ends exactly on ANALYZING frame 0. */
const A0 = mod(-TRANSITION_FRAMES / FPS, ANALYZE_T);

/** `frames` poses of a periodic target, after a warm-up long enough for the smoothing to be in its steady cycle. */
function loopTrack(target: (t: number) => Pose, frames: number): Pose[] {
  let pose = target(-WARM_SECONDS);
  const steps = Math.round(WARM_SECONDS * SIM_HZ);
  for (let k = -steps + 1; k <= 0; k += 1) pose = smoothPose(pose, target(k * dt), dt);
  const out: Pose[] = [{ ...pose }];
  for (let k = 1; out.length < frames; k += 1) {
    pose = smoothPose(pose, target(k * dt), dt);
    if (k % perFrame === 0) out.push({ ...pose });
  }
  return out;
}

/** Canonical transition poses (TRANSITION_FRAMES) entered from WATCHING loop frame `phase`. Frame 0 is the pure WATCHING pose of that phase. */
function transitionTrack(phase: number): Pose[] {
  const t0 = phase / FPS;
  let pose = watchTarget(t0 - WARM_SECONDS);
  const steps = Math.round(WARM_SECONDS * SIM_HZ);
  for (let k = -steps + 1; k <= 0; k += 1) pose = smoothPose(pose, watchTarget(t0 + k * dt), dt);
  const out: Pose[] = [{ ...pose }];
  const ease = DIRECT_EASE_FRAMES / FPS;
  for (let k = 1; out.length < TRANSITION_FRAMES; k += 1) {
    const tau = k * dt;
    const a = analyzeTarget(A0 + tau, tau);
    const w = watchTarget(t0 + tau);
    const s = smooth01(clamp(tau / ease, 0, 1));
    const mixed: Pose = { ...a, squash: w.squash + (a.squash - w.squash) * s, shardSpin: w.shardSpin + (a.shardSpin - w.shardSpin) * s, shardRadius: w.shardRadius + (a.shardRadius - w.shardRadius) * s };
    pose = smoothPose(pose, mixed, dt);
    if (k % perFrame === 0) out.push({ ...pose });
  }
  return out;
}

/** Poses of every output frame of a capture job (30 fps). */
export function jobPoses(job: Job): Pose[] {
  switch (job.kind) {
    case "watching":
      return loopTrack(watchTarget, WATCH_FRAMES);
    case "analyzing":
      return loopTrack((t) => analyzeTarget(t, 1e3), ANALYZE_FRAMES);
    case "head":
      return transitionTrack(job.phase).slice(0, HEAD_FRAMES);
    case "tail":
      return transitionTrack(0).slice(HEAD_FRAMES);
  }
}

/** Pixel-ish weights (same spirit as the pose scan used to pick the first prototype's idle window): pose distance in "screen units". */
const WEIGHT: Record<keyof Pose, number> = { yaw: 90, pitch: 90, squash: 160, shardSpin: 110, eyeOpen: 40, eyeX: 60, eyeZ: 60, lean: 200, shardRadius: 110 };
export function poseDistance(a: Pose, b: Pose): number {
  let s = 0;
  for (const key of Object.keys(WEIGHT) as (keyof Pose)[]) {
    let d = a[key] - b[key];
    if (key === "shardSpin") d = mod(d + Math.PI, TAU) - Math.PI; // the ring is a rotation: 2 pi is the same picture
    s += (WEIGHT[key] * d) ** 2;
  }
  return Math.sqrt(s);
}
