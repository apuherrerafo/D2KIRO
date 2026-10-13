// Coach Motion V2 production slice · authored pose tracks (pure, no three, no DOM).
//
// The Live Gold Master is not periodic: its free clock drives sines at 0.31 / 0.45 / 1.1 / 1.7 / 2.6 / 3.1 rad/s and a LINEAR ring spin
// (watching 0.08 rad/s, analyzing 0.9 rad/s). No window of it closes into a forward loop. These tracks keep the Live pose space, the Live
// amplitudes, the Live blink and the Live smoothing, and snap only the TIME PARAMETERS so the cycle closes:
//   WATCHING   8.4 s = exactly two Live blink periods (4.2 s); slow sines snapped to whole cycles; the ring SWAYS (see below).
//   ANALYZING  7.0 s; the ring turns exactly once (0.8976 rad/s vs Live 0.9), sines snapped to whole cycles.
//   POINTING   the Live `pointing` pose (body turned to the aim, eyes at the visor limit, a touch of lean, ring held at 0.2 rad) with a small sway so it is never frozen.
//   CONFIRMING the Live `confirming` pose once it has settled (head nearly front, eyes locked on the aim by TETHER, ring tight) with one blink; the Live's nod is the ENTRY transient.
// Every pose is then rendered by the real Gold Master stage (capture harness). Nothing is blended in image space.
//
// The authoring is GRAPH-DRIVEN: a loop is a `LoopDef` in LOOP_DEFS, a capture job names loops / edge ids, and the transition between two loops is computed from the two
// definitions. Adding a state = a LoopDef + a graph entry + generated frames; nothing in this file knows an edge by name.

import { EYE_LIMIT, NEUTRAL_POSE, addPose, blinkOpen, verbImpulse, type Aim, type MotionVerb, type Pose } from "../hero-loop/coach/motion";

export const FPS = 30;
export const SIM_HZ = 120;
export const WATCH_FRAMES = 252;
export const ANALYZE_FRAMES = 210;
export const POINT_FRAMES = 112;
export const CONFIRM_FRAMES = 112;
/** Default frames of an entry head (the first frames of a transition, one per source-loop entry phase); the graph states the real value per edge. */
export const HEAD_FRAMES = 10;
/** Default frames of an edge's shared tail (settling, ring contraction), after which the target loop starts at its enter frame. */
export const TAIL_FRAMES = 35;
export const TRANSITION_FRAMES = HEAD_FRAMES + TAIL_FRAMES;
/** The Live eases the smoothed terms only; the direct terms (ring spin/radius, squash) are eased over these frames so the ring does not pop. */
const DIRECT_EASE_FRAMES = 8;
const WARM_SECONDS = 3;

const TAU = Math.PI * 2;
const WATCH_T = WATCH_FRAMES / FPS;
const ANALYZE_T = ANALYZE_FRAMES / FPS;
const POINT_T = POINT_FRAMES / FPS;
const CONFIRM_T = CONFIRM_FRAMES / FPS;

/** The cues the Landing really sends (CUE_BY_PHASE): draft (WATCHING), reveal (ANALYZING, GATHER), recommendation / carry (POINTING, SETTLE), lock / settle (CONFIRMING, TETHER); aim "right" is this vector. */
export const WATCH_AIM: Aim = { x: 0, y: 0 };
export const ANALYZE_AIM: Aim = { x: 1, y: 0.15 };
export const POINT_AIM: Aim = ANALYZE_AIM;
export const CONFIRM_AIM: Aim = ANALYZE_AIM;
export const WATCH_AMPLITUDE = 0.6;
export const ANALYZE_AMPLITUDE = 0.8;
/** CUE_BY_PHASE amplitudes: recommendation 1 / carry 0.8 -> pointing; lock 1 / settle 0.9 -> confirming (the held state sits between its two beats, nearer the longer one). */
export const POINT_AMPLITUDE = 0.9;
export const CONFIRM_AMPLITUDE = 0.9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const mod = (a: number, n: number) => ((a % n) + n) % n;
const smooth01 = (x: number) => x * x * (3 - 2 * x);

/** Frequencies of each authored component, with the Live value they replace (audited by loop-pose.test.ts). */
export const SNAPPED = {
  watching: { yaw: { live: 0.45, loop: TAU / WATCH_T }, pitch: { live: 0.31, loop: TAU / WATCH_T }, squash: { live: 1.1, loop: (2 * TAU) / WATCH_T } },
  analyzing: { scan: { live: 2.6, loop: (3 * TAU) / ANALYZE_T }, eyeZ: { live: 1.7, loop: (2 * TAU) / ANALYZE_T }, radius: { live: 3.1, loop: (3 * TAU) / ANALYZE_T }, spin: { live: 0.9, loop: TAU / ANALYZE_T } },
} as const;

/** Seconds into the loop at which the first blink starts (the loop must not open or close on a blink). */
const BLINK_AT = 0.9;
/** The single CONFIRMING blink (same 140 ms shape as the Live blink). */
const CONFIRM_BLINK_AT = 1.9;

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

/** POINTING base pose, period POINT_T: Live `pointing` (settled) + a calm sway. Directional and intentional: the body turns to the aim and the eyes lead, nothing celebrates. */
export function pointingBase(t: number): Pose {
  const aim = POINT_AIM;
  const w = TAU / POINT_T;
  const spinAmp = 0.08 / w; // the ring is held at the Live's 0.2 rad and sways at the same peak speed as WATCHING (0.08 rad/s)
  return {
    ...NEUTRAL_POSE,
    yaw: aim.x * 0.62 + Math.sin(w * t) * 0.03,
    pitch: -aim.y * 0.28 + Math.sin(w * t + 1.1) * 0.012,
    // just inside the visor limit (Live: exactly the limit) so the micro-drift is not clipped flat
    eyeX: aim.x * EYE_LIMIT.x * 0.94 + Math.sin(2 * w * t + 0.4) * 0.012,
    eyeZ: aim.y * EYE_LIMIT.z,
    lean: 0.04,
    shardSpin: 0.2 + Math.sin(w * t + 0.9) * spinAmp,
    squash: 1 + Math.sin(2 * w * t + 0.5) * 0.006,
  };
}

/** One blink of the Live shape, starting at `at` seconds. */
const blinkAt = (t: number, at: number): number => {
  const d = t - at;
  return d < 0 || d > 0.14 ? 1 : 1 - 0.85 * Math.sin((d / 0.14) * Math.PI);
};

/** CONFIRMING base pose, period CONFIRM_T: Live `confirming` after the nod has settled + a calm sway and one blink. Resolution, not victory: head nearly front, eyes locked (TETHER), ring tight. */
export function confirmingBase(t: number): Pose {
  const aim = CONFIRM_AIM;
  const w = TAU / CONFIRM_T;
  const spinAmp = 0.08 / w;
  return {
    ...NEUTRAL_POSE,
    yaw: aim.x * 0.12 + Math.sin(w * t) * 0.03,
    pitch: Math.sin(w * t + 1.3) * 0.015,
    eyeX: aim.x * EYE_LIMIT.x * 0.3 + Math.sin(2 * w * t + 0.4) * 0.008,
    eyeOpen: blinkAt(t, CONFIRM_BLINK_AT),
    shardSpin: Math.sin(w * t + 0.9) * spinAmp,
    squash: 1 + Math.sin(2 * w * t + 0.5) * 0.008,
  };
}

/** The Live `confirming` nod: a quick dip of the head, a small squash, the eyes narrow and recover, the ring gives a short swell. The ENTRY transient of CONFIRMING (faded out before the tail ends). */
function confirmingNod(p: Pose, tau: number): Pose {
  return {
    ...p,
    pitch: p.pitch - 0.22 * Math.sin(Math.min(1, tau / 0.18) * Math.PI) * Math.exp(-1.6 * tau) - 0.1 * Math.exp(-2 * tau),
    squash: p.squash - 0.07 * Math.exp(-3 * tau) * Math.max(0, Math.cos(tau * 7)),
    eyeOpen: p.eyeOpen - 0.5 * Math.min(1, tau / 0.12) * (tau < 0.7 ? 1 : Math.exp(-(tau - 0.7) * 2)),
    shardRadius: p.shardRadius + 0.05 * Math.exp(-3 * tau),
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

// ------------------------------------------------------------------ loop definitions

/** The terms the Live smooths (tau 50 ms): a target ramp on them is a head / eye movement; squash, spin and radius are direct. */
const SMOOTHED = ["yaw", "pitch", "eyeX", "eyeZ", "eyeOpen", "lean"] as const;

export interface LoopDef {
  id: string;
  /** loop length at 30 fps; equals `loops.<id>.frames` of scripts/coach-motion-v2/graph.json (audited by tests) */
  frames: number;
  aim: Aim;
  amplitude: number;
  /** periodic base pose, loop time `t` seconds, period frames / FPS */
  base: (t: number) => Pose;
  /** the verb of the beat that enters this state; its settled value is part of the loop, its transient is part of the transition */
  verb: MotionVerb | null;
  /** seconds over which the SMOOTHED terms of a transition leave the source loop's rest pose for this loop's target (0 = the Live's immediate target) */
  ramp: number;
  /** how the ring reaches this loop's angle: "forward" keeps the plain difference (the ring spins up the way ANALYZING turns), "shortest" takes the short way round (the ring settles) */
  spin: "forward" | "shortest";
  /** entry transient on top of the settled target; faded out over the last 40 % of the transition so it closes exactly on the loop */
  enter?: (p: Pose, tau: number) => Pose;
}

export const LOOP_DEFS: Record<string, LoopDef> = {
  watching: { id: "watching", frames: WATCH_FRAMES, aim: WATCH_AIM, amplitude: WATCH_AMPLITUDE, base: watchingBase, verb: null, ramp: 0.4, spin: "shortest" },
  analyzing: { id: "analyzing", frames: ANALYZE_FRAMES, aim: ANALYZE_AIM, amplitude: ANALYZE_AMPLITUDE, base: analyzingBase, verb: "GATHER", ramp: 0, spin: "forward" },
  pointing: { id: "pointing", frames: POINT_FRAMES, aim: POINT_AIM, amplitude: POINT_AMPLITUDE, base: pointingBase, verb: "SETTLE", ramp: 0.35, spin: "shortest" },
  confirming: { id: "confirming", frames: CONFIRM_FRAMES, aim: CONFIRM_AIM, amplitude: CONFIRM_AMPLITUDE, base: confirmingBase, verb: "TETHER", ramp: 0.12, spin: "shortest", enter: confirmingNod },
};

/** Verb age that stands for "settled" (large, finite: 0 * Infinity would be NaN). */
const SETTLED = 1e3;

const mixPose = (a: Pose, b: Pose, s: number): Pose => {
  const out = { ...a };
  for (const key of Object.keys(a) as (keyof Pose)[]) out[key] = a[key] + (b[key] - a[key]) * s;
  return out;
};

/** Target pose of a loop at loop time `t`; `age` = seconds since the beat that entered it (SETTLED for the loop itself); `transSeconds` = length of the transition that is entering it. */
export function loopTarget(def: LoopDef, t: number, age: number, transSeconds = Infinity): Pose {
  let p = def.base(t);
  if (def.verb) p = addPose(p, verbImpulse(def.verb, age, def.aim));
  if (def.enter && Number.isFinite(transSeconds) && age < transSeconds) {
    const fade = 1 - smooth01(clamp((age - 0.6 * transSeconds) / (0.4 * transSeconds), 0, 1));
    p = mixPose(p, def.enter(p, age), fade);
  }
  return damp(p, def.amplitude);
}

const dt = 1 / SIM_HZ;
const perFrame = SIM_HZ / FPS;

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

/** Mean of the smoothed terms over one source loop: the phase-independent pose a ramped transition leaves from (every head must converge on the same trajectory). */
function restPose(def: LoopDef): Pose {
  const sum: Pose = { ...NEUTRAL_POSE };
  for (const key of SMOOTHED) sum[key] = 0;
  for (let f = 0; f < def.frames; f += 1) {
    const p = loopTarget(def, f / FPS, SETTLED);
    for (const key of SMOOTHED) sum[key] += p[key] / def.frames;
  }
  return sum;
}

/** The ring never reverses on arrival at a "forward" loop; on a "shortest" loop it takes the short way round. Returns the whole turns to add to the destination angle. */
function spinTurns(policy: LoopDef["spin"], from: number, to: number): number {
  if (policy === "forward") {
    const k = Math.ceil((from - to - 0.6) / TAU); // a back-step of up to 0.6 rad is tolerated before a whole extra turn is taken; 0 for every WATCHING -> ANALYZING phase
    return k === 0 ? 0 : TAU * k;
  }
  return TAU * Math.round((from - to) / TAU);
}

/**
 * Poses of the transition `from` -> `to` entered at source-loop frame `phase`, `headFrames + tailFrames` of them. Frame 0 is the pure source pose of that phase; the target is the
 * destination loop's own target at the clock that makes the LAST transition frame precede the destination's frame 0, so the tail closes on the loop. The source only leaves
 * its mark through the filter state and the direct terms (eased over DIRECT_EASE_FRAMES), which is what makes every head of an edge converge on the same tail.
 */
function transitionTrack(from: LoopDef, to: LoopDef, phase: number, headFrames: number, tailFrames: number): Pose[] {
  const total = headFrames + tailFrames;
  const seconds = total / FPS;
  const clock = mod(-seconds, to.frames / FPS); // destination clock at the first transition frame
  const src = (t: number) => loopTarget(from, t, SETTLED);
  const dst = (tau: number) => loopTarget(to, clock + tau, tau, seconds);
  const t0 = phase / FPS;
  let pose = src(t0 - WARM_SECONDS);
  const steps = Math.round(WARM_SECONDS * SIM_HZ);
  for (let k = -steps + 1; k <= 0; k += 1) pose = smoothPose(pose, src(t0 + k * dt), dt);
  const out: Pose[] = [{ ...pose }];
  const ease = DIRECT_EASE_FRAMES / FPS;
  const turns = spinTurns(to.spin, src(t0).shardSpin, dst(0).shardSpin);
  const rest = to.ramp > 0 ? restPose(from) : null;
  for (let k = 1; out.length < total; k += 1) {
    const tau = k * dt;
    const a = dst(tau);
    const w = src(t0 + tau);
    const s = smooth01(clamp(tau / ease, 0, 1));
    const spin = a.shardSpin + turns;
    const mixed: Pose = { ...a, squash: w.squash + (a.squash - w.squash) * s, shardSpin: w.shardSpin + (spin - w.shardSpin) * s, shardRadius: w.shardRadius + (a.shardRadius - w.shardRadius) * s };
    if (rest) {
      const r = smooth01(clamp(tau / to.ramp, 0, 1));
      for (const key of SMOOTHED) mixed[key] = rest[key] + (a[key] - rest[key]) * r;
    }
    pose = smoothPose(pose, mixed, dt);
    if (k % perFrame === 0) out.push({ ...pose });
  }
  return out;
}

/**
 * A capture job, as capture.mjs derives it from graph.json. `loop` jobs render one semantic loop; `head` / `tail` jobs render an edge's transition (`edge` is the graph edge id,
 * `from` / `to` its loops). The job carries the continuity parameters of the edge, so no frame count in this file is tied to a particular edge.
 */
export type Job =
  | { kind: "loop"; loop: string }
  | { kind: "head"; edge: string; from: string; to: string; phase: number; headFrames: number; tailFrames: number }
  | { kind: "tail"; edge: string; from: string; to: string; headFrames: number; tailFrames: number };

/** Source-loop phases that have an entry head: 0, stride, 2 * stride, ... */
export function headPhases(loopFrames: number, stride: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < loopFrames; p += stride) out.push(p);
  return out;
}

function def(defs: Record<string, LoopDef>, id: string): LoopDef {
  const d = defs[id];
  if (!d) throw new Error(`loop-pose: no pose definition for loop "${id}" (known: ${Object.keys(defs).join(", ")})`);
  return d;
}

/** Poses of every output frame of a capture job (30 fps). `defs` is LOOP_DEFS unless a test authors a hypothetical state. */
export function jobPoses(job: Job, defs: Record<string, LoopDef> = LOOP_DEFS): Pose[] {
  switch (job.kind) {
    case "loop": {
      const d = def(defs, job.loop);
      return loopTrack((t) => loopTarget(d, t, SETTLED), d.frames);
    }
    case "head":
      return transitionTrack(def(defs, job.from), def(defs, job.to), job.phase, job.headFrames, job.tailFrames).slice(0, job.headFrames);
    case "tail":
      return transitionTrack(def(defs, job.from), def(defs, job.to), 0, job.headFrames, job.tailFrames).slice(job.headFrames);
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
