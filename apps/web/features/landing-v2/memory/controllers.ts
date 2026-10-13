/**
 * Landing V2 Memory - controllers.
 *
 * Two ways to drive the SAME frame model:
 *  - LiveController: the controlled force world, fixed timestep, story on the sim clock.
 *  - ReducedController: no force simulation at all - direct spatial interpolation between the
 *    precomputed settled compositions, with a restrained crossfade for what enters.
 */

import { LINKS, NODES, SCENES } from './fixtures';
import { MemoryWorld, settledSnapshot, FIXED_DT } from './world';
import type { GhostSeg, WorldSnapshot } from './world';
import type { CoachState, LayoutId, NodeId, Tone } from './types';

export interface NodeView {
  x: number;
  y: number;
  a: number;
  tone: Tone;
}
export interface LinkView {
  p: number;
  stretch: number;
}
export interface Layers {
  soft: number;
  crisp: number;
  caption: number;
  ghost: number;
  /** transfer trails (final scene): present while the nodes travel, gone once they rest. */
  trail: number;
}
export interface Frame {
  nodes: Record<NodeId, NodeView>;
  links: Record<string, LinkView>;
  ghost: GhostSeg[];
  /** where each node started the current scene; only set for `transfer` scenes. */
  origins: Partial<Record<NodeId, { x: number; y: number }>> | null;
  layers: Layers;
  coach: { state: CoachState; focus: NodeId[] };
  settled: boolean;
}

export interface ControllerEvents {
  onCoach: (state: CoachState, focus: NodeId[], reconstruct?: boolean) => void;
  onDone: (scene: number) => void;
}

export interface Controller {
  frame: Frame;
  /** `snap`: land on the scene's settled composition without playing it (the pin released while the story was behind). */
  goTo(scene: number, snap?: boolean): void;
  tick(dtMs: number): void;
  /** Playback speed relative to the approved choreography (1 = in step with the scroll, >1 = catching up). */
  setPace(pace: number): void;
  setPointer(p: { x: number; y: number } | null): void;
  pin(id: NodeId, x: number, y: number): void;
  release(id: NodeId): void;
}

function emptyFrame(): Frame {
  const nodes = {} as Record<NodeId, NodeView>;
  for (const n of NODES) nodes[n.id] = { x: 0, y: 0, a: 0, tone: n.tone };
  const links: Record<string, LinkView> = {};
  for (const l of LINKS) links[l.id] = { p: 0, stretch: 0 };
  return { nodes, links, ghost: [], origins: null, layers: { soft: 0, crisp: 0, caption: 0, ghost: 0, trail: 0 }, coach: { state: 'watching', focus: [] }, settled: false };
}

function approach(cur: number, target: number, dtMs: number, tauMs: number): number {
  return target + (cur - target) * Math.exp(-dtMs / tauMs);
}

function stepLayers(layers: Layers, scene: number, dtMs: number, settled: boolean): void {
  const def = SCENES[Math.max(0, scene)];
  const t = def.layers;
  layers.soft = approach(layers.soft, t.soft, dtMs, 420);
  layers.crisp = approach(layers.crisp, t.crisp, dtMs, 520);
  layers.caption = approach(layers.caption, t.caption, dtMs, 380);
  // The undertrace is loud while the system is out of balance and decays to a residue once it rests.
  const ghostGoal = settled ? t.ghost : (def.ghostLive ?? t.ghost);
  layers.ghost = approach(layers.ghost, ghostGoal, dtMs, settled ? 1400 : 600);
  layers.trail = approach(layers.trail, def.transfer && !settled ? 1 : 0, dtMs, settled ? 800 : 300);
}

const MAX_CATCHUP_MS = 400;
const MAX_PACE_STEPS = 12;
const MAX_STEPS_PER_FRAME = Math.ceil((MAX_CATCHUP_MS / 1000 / FIXED_DT) * MAX_PACE_STEPS) + 1;

export class LiveController implements Controller {
  frame = emptyFrame();
  private world: MemoryWorld;
  private acc = 0;
  private pointer: { x: number; y: number } | null = null;
  private scene = -1;
  private pace = 1;

  constructor(
    private readonly layout: LayoutId,
    private readonly events: ControllerEvents,
  ) {
    this.world = this.freshWorld();
  }

  private freshWorld(): MemoryWorld {
    const w = new MemoryWorld(this.layout);
    w.setHandlers({ onCoach: this.events.onCoach, onDone: this.events.onDone });
    w.pointer = this.pointer;
    return w;
  }

  setPace(pace: number): void {
    this.pace = Math.max(1, pace);
  }

  goTo(scene: number, snap = false): void {
    if (snap) {
      this.world = this.freshWorld();
      this.world.restore(settledSnapshot(this.layout, scene));
      this.scene = scene;
      this.acc = 0;
      this.frame.layers = { ...SCENES[scene].layers, trail: 0 };
      this.syncFrame();
      this.frame.origins = null;
      this.events.onCoach(SCENES[scene].restCoach.state, SCENES[scene].restCoach.focus);
      this.events.onDone(scene);
      return;
    }
    const continues = scene === this.scene + 1 && this.world.done && this.scene >= 0;
    if (!continues) {
      this.world = this.freshWorld();
      if (scene > 0) this.world.restore(settledSnapshot(this.layout, scene - 1));
      this.frame.layers = { ...SCENES[Math.max(0, scene - 1)].layers, trail: 0 };
      if (scene === 0) this.frame.layers = { soft: 0, crisp: 0, caption: 0, ghost: 0, trail: 0 };
    }
    this.scene = scene;
    this.acc = 0;
    this.world.loadScene(scene);
    this.syncFrame();
    this.frame.origins = null;
    if (SCENES[scene].transfer) {
      this.frame.origins = {};
      for (const n of NODES) this.frame.origins[n.id] = { x: this.frame.nodes[n.id].x, y: this.frame.nodes[n.id].y };
    }
  }

  tick(dtMs: number): void {
    // The sim clock follows real time even on a slow frame (the world is 13 nodes: catching up is
    // cheap). Only a stall longer than MAX_CATCHUP_MS (tab hidden, debugger) is allowed to skip time.
    // Catching up scales the sim clock, never the fixed step: the same deterministic frames, just sooner.
    const sim = Math.min(dtMs, MAX_CATCHUP_MS) * this.pace;
    this.acc += sim / 1000;
    let n = 0;
    while (this.acc >= FIXED_DT && n < MAX_STEPS_PER_FRAME) {
      this.world.step();
      this.acc -= FIXED_DT;
      n++;
    }
    if (n === MAX_STEPS_PER_FRAME) this.acc = 0;
    stepLayers(this.frame.layers, this.scene, sim, this.world.settled);
    this.syncFrame();
  }

  private syncFrame(): void {
    const w = this.world;
    for (const [id, n] of w.nodes) {
      const v = this.frame.nodes[id];
      v.x = n.x;
      v.y = n.y;
      v.a = n.present ? n.alpha : 0;
      v.tone = n.tone;
    }
    for (const l of w.links) {
      const v = this.frame.links[l.def.id];
      v.p = l.progress;
      v.stretch = Math.min(1, Math.max(0, (l.tension - 1.15) / 0.6)) * l.progress * l.progress;
    }
    this.frame.ghost = w.ghostSegs;
    this.frame.coach = w.coach;
    this.frame.settled = w.settled;
  }

  setPointer(p: { x: number; y: number } | null): void {
    this.pointer = p;
    this.world.pointer = p;
  }
  pin(id: NodeId, x: number, y: number): void {
    this.world.pin(id, x, y);
  }
  release(id: NodeId): void {
    this.world.release(id);
  }
}

const REDUCED_MS = 520;

function smooth(p: number): number {
  const c = Math.min(1, Math.max(0, p));
  return c * c * (3 - 2 * c);
}

export class ReducedController implements Controller {
  frame = emptyFrame();
  private from: Record<NodeId, NodeView> | null = null;
  private target: WorldSnapshot | null = null;
  private t = REDUCED_MS;
  private scene = 0;
  private coachTimer = 0;
  private pendingCoach: { state: CoachState; focus: NodeId[] } | null = null;
  private doneFired = true;
  private pace = 1;

  constructor(
    private readonly layout: LayoutId,
    private readonly events: ControllerEvents,
  ) {}

  setPace(pace: number): void {
    this.pace = Math.max(1, pace);
  }

  goTo(scene: number): void {
    this.from = {} as Record<NodeId, NodeView>;
    for (const n of NODES) this.from[n.id] = { ...this.frame.nodes[n.id] };
    this.target = settledSnapshot(this.layout, scene);
    this.scene = scene;
    this.t = 0;
    this.doneFired = false;
    this.coachTimer = 0;
    this.pendingCoach = SCENES[scene].restCoach;
    this.frame.coach = { state: 'watching', focus: [] };
    this.events.onCoach('watching', []);
    this.tick(0);
  }

  tick(rawMs: number): void {
    const target = this.target;
    if (!target) return;
    const dtMs = rawMs * this.pace;
    this.t = Math.min(REDUCED_MS, this.t + dtMs);
    const e = smooth(this.t / REDUCED_MS);
    const born = new Set(target.linksBorn);
    for (const tn of target.nodes) {
      const v = this.frame.nodes[tn.id];
      const f = this.from?.[tn.id];
      const wasThere = f ? f.a > 0.5 : false;
      v.tone = tn.tone;
      if (!tn.present) {
        v.a = 0;
        continue;
      }
      if (wasThere && f) {
        v.x = f.x + (tn.x - f.x) * e;
        v.y = f.y + (tn.y - f.y) * e;
        v.a = 1;
      } else {
        v.x = tn.x;
        v.y = tn.y;
        v.a = e;
      }
    }
    for (const l of LINKS) {
      const v = this.frame.links[l.id];
      const goal = born.has(l.id) ? 1 : 0;
      v.p = approach(v.p, goal, dtMs, 160);
      v.stretch = 0;
    }
    this.frame.ghost = target.ghost;
    this.frame.origins = null;
    this.frame.settled = this.t >= REDUCED_MS;
    stepLayers(this.frame.layers, this.scene, dtMs, true);

    if (this.pendingCoach) {
      this.coachTimer += dtMs;
      if (this.coachTimer >= 220) {
        const c = this.pendingCoach;
        this.pendingCoach = null;
        this.frame.coach = c;
        this.events.onCoach(c.state, c.focus);
      }
    }
    if (!this.doneFired && this.t >= REDUCED_MS && !this.pendingCoach) {
      this.doneFired = true;
      this.events.onDone(this.scene);
    }
  }

  setPointer(): void {}
  pin(): void {}
  release(): void {}
}
