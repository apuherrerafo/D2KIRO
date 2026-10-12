// Pure, deterministic Coach motion (no three, no DOM): state pose, motion-grammar impulses, dissolve/reconstruction maths.
// Everything is a function of (state, time since the state began, aim) so the lab, the tests and any sprite capture agree.

export type CoachState = "watching" | "analyzing" | "confirming" | "pointing";
export type MotionVerb = "ATTRACT" | "REPEL" | "TETHER" | "GATHER" | "SETTLE" | "TRANSFER" | "MORPH";

export interface Aim {
  /** -1 (left) .. 1 (right), screen space, relative to the Coach */
  x: number;
  /** -1 (down) .. 1 (up) */
  y: number;
}

export interface Pose {
  yaw: number;
  pitch: number;
  /** eye slide inside the visor, Blender units (visor is +-0.746 wide, eyes are 0.215 wide) */
  eyeX: number;
  eyeZ: number;
  /** 1 = open, <1 = narrowed (blink / confirm) */
  eyeOpen: number;
  /** body scale on the vertical axis (squash & settle) */
  squash: number;
  /** orbit offset of the shard ring about the body's front axis (the ring faces the camera), radians */
  shardSpin: number;
  /** radial breathing of the shard ring, 1 = authored */
  shardRadius: number;
  /** lean toward the viewer (uniform scale bump) */
  lean: number;
}

export const EYE_LIMIT = { x: 0.24, z: 0.07 } as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const damped = (t: number, hz: number, decay: number) => Math.exp(-decay * t) * Math.cos(t * hz * Math.PI * 2);

export const NEUTRAL_POSE: Pose = { yaw: 0, pitch: 0, eyeX: 0, eyeZ: 0, eyeOpen: 1, squash: 1, shardSpin: 0, shardRadius: 1, lean: 0 };

/** Deterministic blink: every 4.2 s, 140 ms long. */
export function blinkOpen(t: number): number {
  const phase = t % 4.2;
  if (phase > 0.14) return 1;
  return 1 - 0.85 * Math.sin((phase / 0.14) * Math.PI);
}

/** Base pose of a semantic state. `t` = seconds since the state began, `clock` = free-running seconds (idle drift). */
export function statePose(state: CoachState, t: number, clock: number, rawAim: Aim, reduced = false): Pose {
  const aim: Aim = { x: clamp(rawAim.x, -1, 1), y: clamp(rawAim.y, -1, 1) };
  const drift = reduced ? 0 : 1;
  const base: Pose = { ...NEUTRAL_POSE };
  switch (state) {
    case "watching": {
      base.yaw = aim.x * 0.32 + Math.sin(clock * 0.45) * 0.05 * drift;
      base.pitch = -aim.y * 0.12 + Math.sin(clock * 0.31) * 0.02 * drift;
      base.eyeX = clamp(aim.x, -1, 1) * EYE_LIMIT.x * 0.7;
      base.eyeZ = clamp(aim.y, -1, 1) * EYE_LIMIT.z * 0.7;
      base.eyeOpen = reduced ? 1 : blinkOpen(clock);
      base.shardSpin = clock * 0.08 * drift;
      base.squash = 1 + Math.sin(clock * 1.1) * 0.008 * drift;
      return base;
    }
    case "analyzing": {
      const scan = reduced ? 0 : Math.sin(clock * 2.6);
      base.yaw = aim.x * 0.2 + scan * 0.1;
      base.pitch = 0.04;
      base.eyeX = clamp(aim.x * 0.5 + scan * 0.8, -1, 1) * EYE_LIMIT.x;
      base.eyeZ = Math.sin(clock * 1.7) * EYE_LIMIT.z * 0.5 * drift;
      base.eyeOpen = 0.8;
      base.shardSpin = clock * 0.9 * drift;
      base.shardRadius = 1 + Math.sin(clock * 3.1) * 0.025 * drift;
      return base;
    }
    case "confirming": {
      base.pitch = reduced ? 0 : -0.22 * Math.sin(Math.min(1, t / 0.18) * Math.PI) * Math.exp(-1.6 * t) - 0.1 * Math.exp(-2 * t);
      base.squash = reduced ? 1 : 1 - 0.07 * Math.exp(-3 * t) * Math.max(0, Math.cos(t * 7));
      base.eyeOpen = reduced ? 0.55 : 1 - 0.5 * Math.min(1, t / 0.12) * (t < 0.7 ? 1 : Math.exp(-(t - 0.7) * 2));
      base.yaw = aim.x * 0.12;
      base.eyeX = aim.x * EYE_LIMIT.x * 0.3;
      base.shardRadius = 1 + (reduced ? 0 : 0.05 * Math.exp(-3 * t));
      return base;
    }
    case "pointing": {
      const settle = reduced ? 1 : 1 - Math.exp(-6 * t);
      base.yaw = clamp(aim.x, -1, 1) * 0.62 * settle;
      base.pitch = -clamp(aim.y, -1, 1) * 0.28 * settle;
      base.eyeX = clamp(aim.x, -1, 1) * EYE_LIMIT.x * settle;
      base.eyeZ = clamp(aim.y, -1, 1) * EYE_LIMIT.z * settle;
      base.lean = 0.04 * settle;
      base.shardSpin = 0.2 * settle;
      return base;
    }
  }
}

/**
 * Static pose of a state for pre-rendered frames (Coach Web Pack). The still has no motion to say "analyzing" or "confirming",
 * so the shapes carry it: ring turned + eyes half-narrowed, nod + narrowed eyes, head turned toward the evidence.
 * Every state answers the aim on both axes (eyes slide inside the visor; the body turns a little).
 */
export function stillPose(state: CoachState, rawAim: Aim): Pose {
  const aim: Aim = { x: clamp(rawAim.x, -1, 1), y: clamp(rawAim.y, -1, 1) };
  const p = statePose(state, 3, 0, aim, true);
  const eyes = (gain: number) => {
    p.eyeX = aim.x * EYE_LIMIT.x * gain;
    p.eyeZ = aim.y * EYE_LIMIT.z * gain;
  };
  switch (state) {
    case "watching":
      break;
    case "analyzing":
      eyes(0.85);
      p.yaw = aim.x * 0.2;
      p.pitch = 0.04 - aim.y * 0.1;
      p.eyeOpen = 0.78;
      p.shardSpin = 0.5;
      p.shardRadius = 1.035;
      break;
    case "confirming":
      eyes(0.5);
      p.yaw = aim.x * 0.14;
      p.pitch = -0.1 - aim.y * 0.05;
      p.eyeOpen = 0.5;
      p.shardRadius = 1.02;
      break;
    case "pointing":
      break;
  }
  return p;
}

/** The Coach never executes a verb physically; it answers it. Additive delta on top of the state pose. */
export function verbImpulse(verb: MotionVerb, t: number, aim: Aim, reduced = false): Partial<Pose> {
  if (reduced) return {};
  const e = Math.exp(-4 * t);
  switch (verb) {
    case "ATTRACT": // orient and lean toward the incoming node
      return { yaw: aim.x * 0.25 * (1 - e), eyeX: aim.x * 0.1, lean: 0.05 * (1 - e) };
    case "REPEL": // recoil and flare the ring
      return { squash: -0.06 * e * Math.cos(t * 9), shardRadius: 0.12 * e, pitch: 0.1 * e };
    case "TETHER": // eyes lock onto the link, ring tightens
      return { eyeX: aim.x * 0.15, shardRadius: -0.04 * (1 - e) };
    case "GATHER": // ring contracts toward the body
      return { shardRadius: -0.1 * (1 - Math.exp(-2.5 * t)), shardSpin: 0.6 * t * e };
    case "SETTLE": // damped squash, ring relaxes
      return { squash: -0.05 * damped(t, 1.8, 3), shardRadius: 0.03 * damped(t, 1.2, 2.5) };
    case "TRANSFER": // ring pulses outward toward the receiver, quick spin burst
      return { shardSpin: 1.4 * (1 - Math.exp(-3 * t)) * Math.exp(-0.6 * t), shardRadius: 0.08 * Math.sin(Math.min(1, t * 2.5) * Math.PI) };
    case "MORPH":
      return {};
  }
}

export function addPose(a: Pose, d: Partial<Pose>): Pose {
  return {
    yaw: a.yaw + (d.yaw ?? 0),
    pitch: a.pitch + (d.pitch ?? 0),
    eyeX: clamp(a.eyeX + (d.eyeX ?? 0), -EYE_LIMIT.x, EYE_LIMIT.x),
    eyeZ: clamp(a.eyeZ + (d.eyeZ ?? 0), -EYE_LIMIT.z, EYE_LIMIT.z),
    eyeOpen: a.eyeOpen,
    squash: a.squash + (d.squash ?? 0),
    shardSpin: a.shardSpin + (d.shardSpin ?? 0),
    shardRadius: a.shardRadius + (d.shardRadius ?? 0),
    lean: a.lean + (d.lean ?? 0),
  };
}

// ------------------------------------------------------------------ dissolve / reconstruction (modular, per-atom)

/** easeInOutCubic */
export const ease = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

export interface DissolveParams {
  /** seconds for the whole transition */
  duration: number;
  /** fraction of the transition spent staggering atom start times */
  stagger: number;
}

export const DISSOLVE: DissolveParams = { duration: 1.6, stagger: 0.55 };

/** Per-atom progress 0..1 given global progress g in 0..1 and the atom's stagger rank r in 0..1 (0 = first to go). */
export function atomProgress(g: number, rank: number, params: DissolveParams = DISSOLVE): number {
  const span = 1 - params.stagger;
  return clamp((g - rank * params.stagger) / span, 0, 1);
}

/** Dissolve envelope of one atom: out along its radial, tumble, shrink. Reconstruction plays it backwards (p -> 1 - p). */
export function atomDisplacement(p: number): { out: number; scale: number; tumble: number } {
  const q = ease(p);
  return { out: q * q, scale: 1 - ease(clamp((p - 0.45) / 0.55, 0, 1)), tumble: q };
}

/** Stagger rank 0..1: top-down when dissolving, bottom-up when rebuilding. `h` = atom height in -1..1, `salt` = atom id (deterministic jitter). */
export function staggerRank(h: number, salt: number, rebuild: boolean): number {
  const base = (clamp(h, -1, 1) + 1) / 2;
  const jitter = ((Math.imul(salt, 2654435761) >>> 0) % 1000) / 1000;
  return clamp((rebuild ? base : 1 - base) * 0.75 + jitter * 0.25, 0, 1);
}
