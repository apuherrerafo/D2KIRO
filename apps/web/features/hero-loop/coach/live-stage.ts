// Live Gold Master stage for the DESKTOP Hero only. A trimmed CoachStage (coach-feasibility/engine.ts): one canvas, one view,
// no GPU timers, no draw-call merging (feasibility showed merging does not move the relevant bottleneck), no dissolve.
// Pose = f(state, time since state began, free clock, aim) from motion.ts, plus the additive motion-verb impulse.

import { PerspectiveCamera, Quaternion, Scene, Vector3, WebGLRenderer, Group } from "three";
import { buildCoachHero, type CoachHero } from "./gold-master/build-hero";
import { GLOW, areaLightIntensity } from "./gold-master/constants";
import { backgroundColor, configureHeroCamera, configureRenderer, createPostChain, installEnvironment, type PostChain } from "./gold-master/rig";
import type { CoachRuntimeData, LightName } from "./gold-master/types";
import { NEUTRAL_POSE, addPose, statePose, verbImpulse, type Aim, type CoachState, type MotionVerb, type Pose } from "./motion";

/** lite = direct transparent render (MSAA, no bloom); full = the Gold Master chain (HDR MSAA x4 + bloom). */
export type StageQuality = "lite" | "full";

/** Product dark rig from the approved feasibility pass: same five area lights, re-balanced for the dark backdrop. */
const DARK_PRODUCT = { env: 0.7, lights: { Key: 1.0, Fill: 0.9, TopSoft: 1.0, RimCyan: 1.9, PinkSecondary: 1.5 } satisfies Record<LightName, number> };

/** Approved bloom tuning (the lab DEFAULT_TUNING takes these straight from GLOW). */
const BLOOM = { glowCap: GLOW.cap, glowStrength: GLOW.strength, glowRadius: GLOW.radius, glowThreshold: GLOW.threshold };
const WRAP = { gain: 0.4, tilt: 0.6 };

export class HeroCoachStage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera();
  readonly hero: CoachHero;
  readonly pivot = new Group();

  state: CoachState = "watching";
  verb: MotionVerb | null = null;
  aim: Aim = { x: 0, y: 0 };
  reduced = false;
  /** 0..1 motion amplitude (hierarchy through motion, not palette): scales how far the pose and verb impulses travel. */
  amplitude = 1;

  private readonly disposeEnv: () => void;
  private readonly bg: ReturnType<typeof backgroundColor>;
  private readonly eyeCz: number[];
  private readonly shardBase: { p: Vector3; q: Quaternion }[];
  private post: PostChain | null = null;
  private postPx = 0;
  private quality: StageQuality;
  private stateStart = 0;
  private verbStart = 0;
  private pose: Pose = { ...NEUTRAL_POSE };
  private lastT = 0;
  private px = 0;

  constructor(canvas: HTMLCanvasElement, data: CoachRuntimeData, quality: StageQuality = "lite") {
    this.quality = quality;
    this.bg = backgroundColor(data.manifest);
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, premultipliedAlpha: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(1);
    configureRenderer(this.renderer);
    this.hero = buildCoachHero(data);
    this.hero.setWrap(WRAP.gain, WRAP.tilt);
    this.hero.setBakedAO(1);
    this.pivot.add(this.hero.root);
    this.scene.add(this.pivot);
    this.disposeEnv = installEnvironment(this.renderer, this.scene, data.manifest);
    configureHeroCamera(this.camera, data.manifest, "HERO");

    this.scene.environmentIntensity = DARK_PRODUCT.env;
    (Object.keys(this.hero.lights) as LightName[]).forEach((n) => {
      const base = areaLightIntensity(data.manifest.lights[n].energy_w, data.manifest.lights[n].size);
      this.hero.lights[n].intensity = base * DARK_PRODUCT.lights[n];
    });
    this.shardBase = this.hero.shardGroups.map((g) => ({ p: g.position.clone(), q: g.quaternion.clone() }));
    this.eyeCz = [data.eyeL, data.eyeR].map((e) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 2; i < e.positions.length; i += 3) {
        lo = Math.min(lo, e.positions[i]);
        hi = Math.max(hi, e.positions[i]);
      }
      return (lo + hi) / 2;
    });
  }

  /** Square render target in device pixels. */
  resize(px: number): void {
    const next = Math.max(64, Math.round(px));
    if (next === this.px) return;
    this.px = next;
    this.renderer.setSize(next, next, false);
  }

  setState(state: CoachState, t: number): void {
    if (state === this.state) return;
    this.state = state;
    this.stateStart = t;
  }

  /** SCATTER belongs to the interface (the evidence disperses); the Coach has no answer to it, and there is no MORPH here. */
  triggerVerb(verb: MotionVerb | "SCATTER" | null, t: number): void {
    this.verb = verb === "SCATTER" || verb === "MORPH" ? null : verb;
    this.verbStart = t;
  }

  private applyPose(p: Pose): void {
    this.pivot.rotation.set(p.pitch, p.yaw, 0, "YXZ");
    const s = 1 + p.lean;
    this.pivot.scale.set(s, s * p.squash, s);
    this.hero.eyes.forEach((e, i) => {
      // slide along the visor's curvature (rotate about the body axis): a flat slide goes behind the curved visor
      e.rotation.z = p.eyeX / 0.8;
      e.scale.z = Math.max(0.05, p.eyeOpen);
      e.position.z = p.eyeZ + this.eyeCz[i] * (1 - Math.max(0.05, p.eyeOpen));
    });
    const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), p.shardSpin);
    this.hero.shardGroups.forEach((g, i) => {
      const b = this.shardBase[i];
      g.position.copy(b.p).multiplyScalar(p.shardRadius).applyQuaternion(spin);
      g.quaternion.copy(spin).multiply(b.q);
    });
  }

  private damp(p: Pose): Pose {
    const a = this.amplitude;
    if (a >= 1) return p;
    return { ...p, yaw: p.yaw * a, pitch: p.pitch * a, eyeX: p.eyeX * a, eyeZ: p.eyeZ * a, lean: p.lean * a, squash: 1 + (p.squash - 1) * a, shardRadius: 1 + (p.shardRadius - 1) * a };
  }

  /** Advance to absolute time t (seconds). Deterministic: pose = f(state, t - stateStart, t, aim). */
  update(t: number): void {
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    let target = statePose(this.state, t - this.stateStart, t, this.aim, this.reduced);
    if (this.verb) target = addPose(target, verbImpulse(this.verb, t - this.verbStart, this.aim, this.reduced));
    target = this.damp(target);
    if (dt > 0 && dt < 0.5) {
      const k = 1 - Math.exp(-dt * 20);
      const p = this.pose;
      p.yaw += (target.yaw - p.yaw) * k;
      p.pitch += (target.pitch - p.pitch) * k;
      p.eyeX += (target.eyeX - p.eyeX) * k;
      p.eyeZ += (target.eyeZ - p.eyeZ) * k;
      p.eyeOpen += (target.eyeOpen - p.eyeOpen) * Math.min(1, k * 2);
      p.squash = target.squash;
      p.shardSpin = target.shardSpin;
      p.shardRadius = target.shardRadius;
      p.lean += (target.lean - p.lean) * k;
    } else {
      this.pose = target;
    }
    this.applyPose(this.pose);
  }

  render(): void {
    const gl = this.renderer;
    const px = this.px;
    if (px === 0) return;
    if (this.quality === "full") {
      if (!this.post || this.postPx !== px) {
        this.post?.dispose();
        this.post = createPostChain(gl, this.scene, this.camera, px, px, BLOOM);
        this.postPx = px;
      }
      gl.setClearColor(this.bg, 0);
      this.post.composer.render();
      return;
    }
    gl.setRenderTarget(null);
    gl.setClearColor(0x000000, 0);
    gl.clear();
    gl.render(this.scene, this.camera);
  }

  dispose(): void {
    this.post?.dispose();
    this.disposeEnv();
    this.hero.dispose();
    this.renderer.dispose();
  }
}
