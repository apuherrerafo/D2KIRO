/**
 * Landing V2 Memory - the controlled force world.
 *
 * Deterministic by construction:
 *  - fixed 1/60 s step, no wall clock, no Math.random (spawn jitter comes from a seeded hash)
 *  - the story is a timeline on the SIM clock, so frame rate never changes the outcome
 *  - every node has a semantic anchor (forceX/forceY toward its region); physics only decides
 *    the LOCAL behaviour on the way there, art direction decides the composition.
 *
 * Forces: link spring, pairwise repulsion, collision, semantic anchor, contradiction field (REPEL),
 * focus nudge (Coach attention), pointer proximity. Cooling is a viscosity that rises as heat decays.
 */

import { LAYOUTS, LINKS, NODES, NODE_BY_ID, SCENES, SEED, anchorsFor, mapPoint } from './fixtures';
import type { CoachState, LayoutId, LinkDef, NodeId, Step, Tone, Vec } from './types';

export const FIXED_DT = 1 / 60;

const K_ANCHOR = 38;
const K_REPULSE = 1500;
const R_REPULSE = 112;
const K_COLLIDE = 900;
const COLLIDE_PAD = 16;
const DAMP_COOL = 13;
const DAMP_HOT = 3;
const HEAT_TAU = 0.8;
const FOCUS_TAU = 0.5;
const NODE_FADE_MS = 520;
const LINK_DRAW_MS = 700;
const SETTLE_SPEED = 2.2;
const SETTLE_FRAMES = 15;
const SETTLE_HEAT = 0.15;
const POINTER_RADIUS = 120;
const POINTER_STRENGTH = 420;

export function hashSeed(text: string, seed: number): number {
  let h = (2166136261 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function seededUnit(text: string, seed: number): number {
  let a = hashSeed(text, seed);
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export interface NodeState {
  id: NodeId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  present: boolean;
  bornAt: number;
  kA: number;
  kOverride: { k: number; until: number } | null;
  focusHeat: number;
  pinned: boolean;
  tone: Tone;
  alpha: number;
}

export interface LinkState {
  def: LinkDef;
  born: boolean;
  bornAt: number;
  progress: number;
  tension: number;
}

interface ActiveField {
  from: NodeId;
  targets: Array<[NodeId, number]>;
  strength: number;
  radius: number;
  t0: number;
  duration: number;
}

export interface GhostSeg {
  ax: number;
  ay: number;
  bx: number;
  by: number;
}

export interface WorldSnapshot {
  scene: number;
  nodes: Array<{ id: NodeId; x: number; y: number; ax: number; ay: number; present: boolean; tone: Tone }>;
  linksBorn: string[];
  ghost: GhostSeg[];
}

export interface WorldHandlers {
  onCoach?: (state: CoachState, focus: NodeId[], reconstruct?: boolean) => void;
  onDone?: (scene: number) => void;
}

export interface SceneMetrics {
  maxTension: number;
  peakSpeed: number;
  maxAnchorError: number;
}

function ease(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return 1 - (1 - c) * (1 - c) * (1 - c);
}

export class MemoryWorld {
  readonly layout: LayoutId;
  readonly seed: number;
  readonly s: number;
  readonly w: number;
  readonly h: number;

  t = 0;
  scene = -1;
  sceneT = 0;
  heat = 0;
  settled = false;
  done = false;
  ghostSegs: GhostSeg[] = [];
  coach: { state: CoachState; focus: NodeId[] } = { state: 'watching', focus: [] };
  metrics: SceneMetrics = { maxTension: 1, peakSpeed: 0, maxAnchorError: 0 };

  readonly nodes = new Map<NodeId, NodeState>();
  readonly links: LinkState[] = [];
  pointer: { x: number; y: number } | null = null;

  private fields: ActiveField[] = [];
  private finalAnchors: Record<NodeId, Vec>;
  private timed: Step[] = [];
  private afterSettle: Step[] = [];
  private timedIdx = 0;
  private settleIdx = 0;
  private settleAt: number | null = null;
  private settledFrames = 0;
  private slack: { factor: number; until: number } | null = null;
  private handlers: WorldHandlers;

  constructor(layout: LayoutId, seed: number = SEED, handlers: WorldHandlers = {}) {
    this.layout = layout;
    this.seed = seed;
    this.s = LAYOUTS[layout].scale;
    this.w = LAYOUTS[layout].w;
    this.h = LAYOUTS[layout].h;
    this.handlers = handlers;
    this.finalAnchors = anchorsFor(layout, 0);
    for (const def of NODES) {
      this.nodes.set(def.id, {
        id: def.id,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        ax: 0,
        ay: 0,
        present: false,
        bornAt: 0,
        kA: K_ANCHOR,
        kOverride: null,
        focusHeat: 0,
        pinned: false,
        tone: def.tone,
        alpha: 0,
      });
    }
    for (const def of LINKS) {
      this.links.push({ def, born: false, bornAt: 0, progress: 0, tension: 1 });
    }
  }

  setHandlers(handlers: WorldHandlers): void {
    this.handlers = handlers;
  }

  /** Begin a scene live, carrying over whatever state the world is in. */
  loadScene(i: number): void {
    const scene = SCENES[i];
    this.scene = i;
    this.sceneT = 0;
    this.done = false;
    this.settled = false;
    this.settledFrames = 0;
    this.settleAt = null;
    this.timedIdx = 0;
    this.settleIdx = 0;
    this.fields = [];
    this.slack = null;
    this.finalAnchors = anchorsFor(this.layout, i);
    this.timed = scene.timed.map((st, order) => ({ st, order })).sort((a, b) => a.st.at - b.st.at || a.order - b.order).map((e) => e.st);
    this.afterSettle = [...scene.afterSettle].sort((a, b) => a.at - b.at);
    this.metrics = { maxTension: 1, peakSpeed: 0, maxAnchorError: 0 };
    this.runDueSteps();
  }

  snapshot(): WorldSnapshot {
    return {
      scene: this.scene,
      nodes: [...this.nodes.values()].map((n) => ({ id: n.id, x: n.x, y: n.y, ax: n.ax, ay: n.ay, present: n.present, tone: n.tone })),
      linksBorn: this.links.filter((l) => l.born).map((l) => l.def.id),
      ghost: this.ghostSegs.map((g) => ({ ...g })),
    };
  }

  restore(snap: WorldSnapshot): void {
    for (const n of snap.nodes) {
      const node = this.nodes.get(n.id);
      if (!node) continue;
      node.x = n.x;
      node.y = n.y;
      node.ax = n.ax;
      node.ay = n.ay;
      node.vx = 0;
      node.vy = 0;
      node.present = n.present;
      node.tone = n.tone;
      node.bornAt = this.t - 100000;
      node.alpha = n.present ? 1 : 0;
      node.kA = K_ANCHOR;
      node.kOverride = null;
      node.focusHeat = 0;
      node.pinned = false;
    }
    const born = new Set(snap.linksBorn);
    for (const l of this.links) {
      l.born = born.has(l.def.id);
      l.bornAt = this.t - 100000;
      l.progress = l.born ? 1 : 0;
      l.tension = 1;
    }
    this.ghostSegs = snap.ghost.map((g) => ({ ...g }));
    this.heat = 0;
    this.fields = [];
    this.scene = snap.scene;
    this.finalAnchors = anchorsFor(this.layout, Math.max(0, snap.scene));
    this.settled = true;
    this.done = true;
    this.coach = { state: 'watching', focus: [] };
  }

  // ---------------------------------------------------------------- steps

  private nodeFinalAnchor(id: NodeId): Vec {
    return this.finalAnchors[id] ?? this.finalAnchors.you ?? [this.w / 2, this.h / 2];
  }

  private runDueSteps(): void {
    while (this.timedIdx < this.timed.length && this.timed[this.timedIdx].at <= this.sceneT) {
      this.apply(this.timed[this.timedIdx]);
      this.timedIdx++;
    }
    if (this.settleAt !== null) {
      while (this.settleIdx < this.afterSettle.length && this.afterSettle[this.settleIdx].at <= this.sceneT - this.settleAt) {
        this.apply(this.afterSettle[this.settleIdx]);
        this.settleIdx++;
      }
    }
  }

  private apply(step: Step): void {
    switch (step.kind) {
      case 'spawn': {
        for (const id of step.ids) {
          const n = this.nodes.get(id);
          if (!n) continue;
          const anchorOverride = step.anchor?.[id];
          const anchor = anchorOverride ? mapPoint(this.layout, anchorOverride) : this.nodeFinalAnchor(id);
          n.ax = anchor[0];
          n.ay = anchor[1];
          const from = step.from[id];
          let px = anchor[0];
          let py = anchor[1];
          if (from && 'p' in from) {
            const p = mapPoint(this.layout, from.p);
            px = p[0];
            py = p[1];
          } else if (from && 'near' in from) {
            const ref = this.nodes.get(from.near);
            const ang = seededUnit(`spawn:${id}`, this.seed) * Math.PI * 2;
            px = (ref?.x ?? anchor[0]) + Math.cos(ang) * from.dist * this.s;
            py = (ref?.y ?? anchor[1]) + Math.sin(ang) * from.dist * this.s;
          }
          n.x = px;
          n.y = py;
          const dx = anchor[0] - px;
          const dy = anchor[1] - py;
          const d = Math.hypot(dx, dy) || 1;
          const speed = (step.speed ?? 0) * this.s;
          n.vx = (dx / d) * speed;
          n.vy = (dy / d) * speed;
          n.present = true;
          n.bornAt = this.t;
          n.kA = step.k ?? K_ANCHOR;
        }
        break;
      }
      case 'tether': {
        for (const l of this.links) {
          if (step.links.includes(l.def.id)) {
            l.born = true;
            l.bornAt = this.t;
          }
        }
        break;
      }
      case 'repel': {
        this.fields.push({
          from: step.from,
          targets: step.targets,
          strength: step.strength * this.s,
          radius: step.radius * this.s,
          t0: this.sceneT,
          duration: step.duration,
        });
        break;
      }
      case 'reheat':
        this.heat = Math.min(1, this.heat + step.amount);
        break;
      case 'loosen': {
        for (const id of step.ids) {
          const n = this.nodes.get(id);
          if (n) n.kOverride = { k: step.k, until: this.sceneT + step.duration };
        }
        break;
      }
      case 'slack':
        this.slack = { factor: step.factor, until: this.sceneT + step.duration };
        break;
      case 'rebalance': {
        for (const n of this.nodes.values()) {
          if (step.ids && !step.ids.includes(n.id)) continue;
          const a = this.finalAnchors[n.id];
          if (!a) continue;
          n.ax = a[0];
          n.ay = a[1];
        }
        break;
      }
      case 'ghost': {
        const segs: GhostSeg[] = [];
        for (const l of this.links) {
          if (!step.links.includes(l.def.id)) continue;
          const a = this.nodes.get(l.def.a);
          const b = this.nodes.get(l.def.b);
          if (a && b) segs.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
        }
        this.ghostSegs = segs;
        break;
      }
      case 'coach': {
        this.coach = { state: step.state, focus: step.focus };
        // a reconstruct beat is presentation only: it must not nudge the graph a second time
        if (!step.reconstruct) this.heatFocus(step.focus);
        this.handlers.onCoach?.(step.state, step.focus, step.reconstruct);
        break;
      }
      case 'tone': {
        const n = this.nodes.get(step.id);
        if (n) n.tone = step.tone;
        break;
      }
    }
  }

  /** Coach attention: a SMALL local reheat for nodes near what the Coach is looking at. */
  private heatFocus(ids: NodeId[]): void {
    const c = this.focusPoint(ids);
    if (!c) return;
    const r = 150 * this.s;
    for (const n of this.nodes.values()) {
      if (!n.present) continue;
      if (Math.hypot(n.x - c[0], n.y - c[1]) < r) n.focusHeat = 1;
    }
  }

  focusPoint(ids: NodeId[]): Vec | null {
    let sx = 0;
    let sy = 0;
    let c = 0;
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (n && n.present) {
        sx += n.x;
        sy += n.y;
        c++;
      }
    }
    if (c === 0) return null;
    return [sx / c, sy / c];
  }

  // ---------------------------------------------------------------- physics

  step(): void {
    const dt = FIXED_DT;
    this.t += dt * 1000;
    this.sceneT += dt * 1000;
    this.runDueSteps();

    const present: NodeState[] = [];
    for (const n of this.nodes.values()) {
      if (n.present) present.push(n);
    }
    const fx = new Map<NodeId, number>();
    const fy = new Map<NodeId, number>();
    for (const n of present) {
      fx.set(n.id, 0);
      fy.set(n.id, 0);
    }
    const add = (id: NodeId, x: number, y: number): void => {
      fx.set(id, (fx.get(id) ?? 0) + x);
      fy.set(id, (fy.get(id) ?? 0) + y);
    };

    // semantic anchor (forceX / forceY)
    for (const n of present) {
      let k = n.kA;
      if (n.kOverride) {
        if (this.sceneT < n.kOverride.until) k = n.kOverride.k;
        else n.kOverride = null;
      }
      add(n.id, (n.ax - n.x) * k * NODE_BY_ID[n.id].mass, (n.ay - n.y) * k * NODE_BY_ID[n.id].mass);
    }

    if (this.slack && this.sceneT >= this.slack.until) this.slack = null;
    const slack = this.slack ? this.slack.factor : 1;

    // link springs (rest length follows the anchors: tension-free at the composed equilibrium)
    for (const l of this.links) {
      if (!l.born) continue;
      const a = this.nodes.get(l.def.a);
      const b = this.nodes.get(l.def.b);
      if (!a || !b || !a.present || !b.present) continue;
      const rest = Math.max(28 * this.s, Math.hypot(a.ax - b.ax, a.ay - b.ay));
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 0.001;
      const f = (d - rest) * l.def.k * l.progress * slack;
      const ux = dx / d;
      const uy = dy / d;
      add(a.id, ux * f, uy * f);
      add(b.id, -ux * f, -uy * f);
      l.tension = d / rest;
      if (l.tension > this.metrics.maxTension) this.metrics.maxTension = l.tension;
    }

    // repulsion + collision
    const R = R_REPULSE * this.s;
    for (let i = 0; i < present.length; i++) {
      for (let j = i + 1; j < present.length; j++) {
        const a = present[i];
        const b = present[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const ux = dx / d;
        const uy = dy / d;
        const defA = NODE_BY_ID[a.id];
        const defB = NODE_BY_ID[b.id];
        let f = 0;
        if (d < R) {
          const q = 1 - d / R;
          f += K_REPULSE * this.s * defA.charge * defB.charge * q * q;
        }
        const minD = defA.r + defB.r + COLLIDE_PAD;
        if (d < minD) f += K_COLLIDE * (minD - d);
        if (f !== 0) {
          add(a.id, -ux * f, -uy * f);
          add(b.id, ux * f, uy * f);
        }
      }
    }

    // contradiction field (REPEL)
    this.fields = this.fields.filter((f) => this.sceneT < f.t0 + f.duration);
    for (const field of this.fields) {
      const src = this.nodes.get(field.from);
      if (!src) continue;
      const p = (this.sceneT - field.t0) / field.duration;
      const env = p < 0.18 ? p / 0.18 : 1 - (p - 0.18) / 0.82;
      for (const [id, mult] of field.targets) {
        const n = this.nodes.get(id);
        if (!n || !n.present) continue;
        const dx = n.x - src.x;
        const dy = n.y - src.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d > field.radius) continue;
        const f = field.strength * mult * (1 - d / field.radius) * env * NODE_BY_ID[id].mass;
        add(id, (dx / d) * f, (dy / d) * f);
      }
    }

    // Coach attention: a very small, decaying, deterministic nudge
    for (const n of present) {
      if (n.focusHeat > 0.02) {
        const ph = seededUnit(`focus:${n.id}`, this.seed) * Math.PI * 2;
        const tt = this.t / 1000;
        add(n.id, Math.cos(tt * 2.3 + ph) * 26 * n.focusHeat * this.s, Math.sin(tt * 1.9 + ph) * 26 * n.focusHeat * this.s);
        n.focusHeat *= Math.exp(-dt / FOCUS_TAU);
      } else {
        n.focusHeat = 0;
      }
    }

    // pointer proximity (desktop mouse only; set by the stage)
    if (this.pointer) {
      const pr = POINTER_RADIUS * this.s;
      for (const n of present) {
        if (n.pinned) continue;
        const dx = n.x - this.pointer.x;
        const dy = n.y - this.pointer.y;
        const d = Math.hypot(dx, dy) || 0.001;
        if (d < pr) {
          const q = 1 - d / pr;
          const f = POINTER_STRENGTH * this.s * q * q * NODE_BY_ID[n.id].mass;
          add(n.id, (dx / d) * f, (dy / d) * f);
        }
      }
    }

    // integrate (semi-implicit; viscosity rises as heat cools -> overshoot while hot, rest when cool)
    this.heat *= Math.exp(-dt / HEAT_TAU);
    if (this.heat < 0.002) this.heat = 0;
    const damp = DAMP_COOL + (DAMP_HOT - DAMP_COOL) * this.heat;
    const keep = Math.exp(-damp * dt);
    let maxSpeed = 0;
    let maxErr = 0;
    for (const n of present) {
      if (n.pinned) {
        n.vx = 0;
        n.vy = 0;
        continue;
      }
      const m = NODE_BY_ID[n.id].mass;
      n.vx = (n.vx + ((fx.get(n.id) ?? 0) / m) * dt) * keep;
      n.vy = (n.vy + ((fy.get(n.id) ?? 0) / m) * dt) * keep;
      n.x += n.vx * dt;
      n.y += n.vy * dt;
      const sp = Math.hypot(n.vx, n.vy);
      if (sp > maxSpeed) maxSpeed = sp;
      const err = Math.hypot(n.ax - n.x, n.ay - n.y);
      if (err > maxErr) maxErr = err;
    }
    if (maxSpeed > this.metrics.peakSpeed) this.metrics.peakSpeed = maxSpeed;
    if (maxErr > this.metrics.maxAnchorError) this.metrics.maxAnchorError = maxErr;

    // presentation clocks
    for (const n of present) n.alpha = ease((this.t - n.bornAt) / NODE_FADE_MS);
    for (const l of this.links) l.progress = l.born ? ease((this.t - l.bornAt) / LINK_DRAW_MS) : 0;

    // settle detection
    const timedDone = this.timedIdx >= this.timed.length;
    // Hover never blocks settling: the pointer only displaces nodes, it cannot keep the story waiting.
    const quiet0 = timedDone && this.fields.length === 0 && present.every((n) => !n.kOverride && !n.pinned);
    if (quiet0 && maxSpeed < SETTLE_SPEED && this.heat < SETTLE_HEAT) this.settledFrames++;
    else this.settledFrames = 0;
    if (this.settledFrames >= SETTLE_FRAMES) {
      if (!this.settled) {
        this.settled = true;
        for (const n of present) {
          n.vx = 0;
          n.vy = 0;
        }
        if (this.settleAt === null) this.settleAt = this.sceneT;
      }
    } else if (this.settledFrames === 0) {
      this.settled = false;
    }
    const lastAfter = this.afterSettle.length ? this.afterSettle[this.afterSettle.length - 1].at : 0;
    const stepsDone = this.settleAt !== null && this.settleIdx >= this.afterSettle.length;
    if (!this.done && stepsDone && this.sceneT - (this.settleAt ?? 0) >= lastAfter + 700) {
      this.done = true;
      this.handlers.onDone?.(this.scene);
    }
  }

  /** Advance headlessly until the scene is done (or the safety cap). Returns sim ms elapsed. */
  runUntilDone(maxMs = 20000): number {
    const t0 = this.sceneT;
    while (!this.done && this.sceneT - t0 < maxMs) this.step();
    return this.sceneT - t0;
  }

  // ---------------------------------------------------------------- interaction

  pin(id: NodeId, x: number, y: number): void {
    const n = this.nodes.get(id);
    if (!n) return;
    n.pinned = true;
    n.x = x;
    n.y = y;
    this.done = false;
    this.settled = false;
  }

  release(id: NodeId): void {
    const n = this.nodes.get(id);
    if (n) n.pinned = false;
  }
}

const snapshotCache = new Map<string, WorldSnapshot>();

/** The settled composition of scene `i`, replayed from empty with the fixed seed. Cached. */
export function settledSnapshot(layout: LayoutId, i: number, seed: number = SEED): WorldSnapshot {
  const key = `${layout}:${seed}:${i}`;
  const hit = snapshotCache.get(key);
  if (hit) return hit;
  const world = new MemoryWorld(layout, seed);
  let snap: WorldSnapshot | null = null;
  for (let k = 0; k <= i; k++) {
    world.loadScene(k);
    world.runUntilDone();
    snap = world.snapshot();
  }
  const result = snap as WorldSnapshot;
  snapshotCache.set(key, result);
  return result;
}

export function sceneMetrics(layout: LayoutId, i: number, seed: number = SEED): SceneMetrics {
  const world = new MemoryWorld(layout, seed);
  for (let k = 0; k < i; k++) {
    world.loadScene(k);
    world.runUntilDone();
  }
  world.loadScene(i);
  world.runUntilDone();
  return world.metrics;
}

export type { LinkDef };
