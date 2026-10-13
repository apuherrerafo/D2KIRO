// Test doubles for the Coach Motion V2 production runtime (no DOM). The manifests are the REAL committed packs (real chunk geometry, real graph), never invented
// dimensions, and the chunk loader finishes decodes only when the test says so.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Decoded } from "./bitmap-store";
import { MotionController } from "./motion-controller";
import { headClipId, headPhases, parseManifest, type GraphEdge, type ProdClipMeta, type ProdManifest } from "./production-manifest";

export const WATCHING_LOOP = "WATCHING_LOOP";
export const ANALYZING_LOOP = "ANALYZING_LOOP";
export const TRANSITION_TAIL = "TAIL_WA";
export const HEAD_PREFIX = "ENTRY_HEAD_WA_";

export const MIB = 1048576;
export const FRAME_MS = 1000 / 30;

/** A fresh, parsed copy of the committed manifest of a pack (384 is the production baseline). */
export function realManifest(pack: "384" | "512" = "384"): ProdManifest {
  const path = fileURLToPath(new URL(`../../public/coach-motion-v2/prod/${pack}/manifest.json`, import.meta.url));
  return parseManifest(JSON.parse(readFileSync(path, "utf8")));
}

const cloneClip = (c: ProdClipMeta): ProdClipMeta => JSON.parse(JSON.stringify(c)) as ProdClipMeta;

/** The real pack plus a third loop POINTING (geometry cloned from ANALYZING) and three more edges, so one state (WATCHING) has TWO outgoing edges with different strides:
      watching>analyzing (stride 6, real)   watching>pointing (stride 3)   analyzing>pointing (stride 3)   pointing>watching (stride 6)
    Chunk files are not read by the fake loader, only their real w x h x frames. The result goes through parseManifest, so the graph rules apply to it too. */
export function graphManifest(pack: "384" | "512" = "384"): ProdManifest {
  const m = realManifest(pack);
  const watching = m.clips[WATCHING_LOOP].frames;
  const analyzing = m.clips[ANALYZING_LOOP].frames;
  m.clips.POINTING_LOOP = cloneClip(m.clips[ANALYZING_LOOP]);
  const edge = (id: string, from: string, to: string, fromFrames: number, stride: number, prefix: string, tailClip: string): GraphEdge => {
    m.clips[tailClip] = cloneClip(m.clips[TRANSITION_TAIL]);
    for (const p of headPhases(fromFrames, stride)) m.clips[headClipId(prefix, p)] = cloneClip(m.clips[headClipId(HEAD_PREFIX, 0)]);
    return { id, from, to, fps: m.fps, entry: { strategy: "nearest-head", stride, headClipPrefix: prefix, headFrames: 10, maxStepFrames: Math.floor(stride / 2), armHeads: 2 }, tail: { clip: tailClip, enterFrame: 0 }, lookaheadFrames: 2 * m.chunkFrames };
  };
  m.graph.loops.pointing = { clip: "POINTING_LOOP" };
  m.graph.edges.push(
    edge("watching>pointing", "watching", "pointing", watching, 3, "POINT_HEAD_", "POINT_TAIL"),
    edge("analyzing>pointing", "analyzing", "pointing", analyzing, 3, "APOINT_HEAD_", "APOINT_TAIL"),
    edge("pointing>watching", "pointing", "watching", analyzing, 6, "BACK_HEAD_", "BACK_TAIL"),
  );
  return parseManifest(JSON.parse(JSON.stringify(m)));
}

/** The authoring graph (scripts/coach-motion-v2/graph.json): the single source of the pack's loops, edges, strides and names. */
export interface AuthoringGraph {
  loops: Record<string, { clip: string; dir: string; frames: number; strideLimit: number; blinks?: number }>;
  edges: Array<{
    id: string;
    ns: string;
    from: string;
    to: string;
    fps: number;
    entry: { strategy: string; stride: number; headClipPrefix: string; headDirPrefix: string; headFrames: number; maxStepFrames: number; armHeads: number };
    tail: { clip: string; dir: string; frames: number; enterFrame: number };
    lookaheadFrames: number;
  }>;
  budget: { firstLoadBytes: number; firstLoadPath: string[]; packCeilingBytes: number; calibration: { bytesPerFrame: Record<string, number>; unmeasured?: string[] } };
}

export function authoringGraph(): AuthoringGraph {
  return JSON.parse(readFileSync(fileURLToPath(new URL("../../../../scripts/coach-motion-v2/graph.json", import.meta.url)), "utf8")) as AuthoringGraph;
}

/** A placeholder clip of `frames` frames with the real pack's atlas geometry (cell size, columns, chunking) and a valid content-addressed name. */
function synthClip(m: ProdManifest, name: string, frames: number, loop: boolean): ProdClipMeta {
  const chunks = [];
  for (let at = 0, i = 0; at < frames; at += m.chunkFrames, i += 1) {
    const n = Math.min(m.chunkFrames, frames - at);
    const rows = Math.ceil(n / m.cols);
    const sha256 = `${(i + 1).toString(16).padStart(2, "0")}${name.split("").map((c) => c.charCodeAt(0).toString(16)).join("")}`.padEnd(64, "0").slice(0, 64);
    chunks.push({ file: `${name.toLowerCase()}-${i}.${sha256.slice(0, 12)}.avif`, frames: n, rows, w: m.cols * m.cell.w, h: rows * m.cell.h, bytes: 1000, sha256 });
  }
  return { frames, loop, chunks };
}

/**
 * The pack the committed graph.json describes, with placeholder geometry where the frames are not generated yet (every loop, tail and head of every edge, at the real atlas geometry).
 * The manifest block is derived from the graph exactly as pack_manifest.manifest_graph does, so this exercises graph.json + the generic runtime together: the runtime must traverse
 * whatever the graph says without knowing a state. `edit` lets a test extend / alter the authoring graph first (a hypothetical future state).
 */
export function fullGraphManifest(edit?: (g: AuthoringGraph) => void): ProdManifest {
  const g = authoringGraph();
  edit?.(g);
  const m = realManifest("384");
  m.clips = {};
  for (const l of Object.values(g.loops)) m.clips[l.clip] = synthClip(m, l.clip, l.frames, true);
  for (const e of g.edges) {
    m.clips[e.tail.clip] = synthClip(m, e.tail.clip, e.tail.frames, false);
    for (const p of headPhases(g.loops[e.from].frames, e.entry.stride)) m.clips[headClipId(e.entry.headClipPrefix, p)] = synthClip(m, headClipId(e.entry.headClipPrefix, p), e.entry.headFrames, false);
  }
  m.graph = {
    loops: Object.fromEntries(Object.entries(g.loops).map(([k, l]) => [k, { clip: l.clip }])),
    edges: g.edges.map((e) => {
      const entry = Object.fromEntries(Object.entries(e.entry).filter(([k]) => k !== "headDirPrefix"));
      return { id: e.id, from: e.from, to: e.to, fps: e.fps, entry: entry as GraphEdge["entry"], tail: { clip: e.tail.clip, enterFrame: e.tail.enterFrame }, lookaheadFrames: e.lookaheadFrames };
    }),
  };
  return parseManifest(JSON.parse(JSON.stringify(m)));
}

export class FakeBitmap implements Decoded {
  closed = 0;
  constructor(
    readonly key: string,
    readonly width: number,
    readonly height: number,
  ) {}
  close(): void {
    this.closed += 1;
  }
}

/** Chunk loader whose decodes finish when the test says so. `auto` (default) resolves on the next microtask. */
export class FakeLoader {
  auto = true;
  /** keys whose decode is held until release(key) */
  readonly holds = new Set<string>();
  /** every load() call, in order, with the attempt number the store passed */
  readonly requested: string[] = [];
  readonly attempts: Array<[string, number]> = [];
  readonly made: FakeBitmap[] = [];
  /** keys that always fail */
  failing = new Set<string>();
  /** keys whose FIRST attempt fails */
  failOnce = new Set<string>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(readonly m: ProdManifest) {}

  load = (key: string, attempt = 1): Promise<FakeBitmap> => {
    this.requested.push(key);
    this.attempts.push([key, attempt]);
    const [clip, chunk] = [key.slice(key.indexOf("/") + 1, key.lastIndexOf("#")), Number(key.slice(key.lastIndexOf("#") + 1))];
    const meta = this.m.clips[clip].chunks[chunk];
    const make = () => {
      if (this.failing.has(key) || (attempt === 1 && this.failOnce.has(key))) throw new Error(`decode failed: ${key}`);
      const b = new FakeBitmap(key, meta.w, meta.h);
      this.made.push(b);
      return b;
    };
    return new Promise((resolve, reject) => {
      const finish = () => {
        try {
          resolve(make());
        } catch (e) {
          reject(e);
        }
      };
      if (this.auto && !this.holds.has(key)) queueMicrotask(finish);
      else this.waiting.set(key, [...(this.waiting.get(key) ?? []), finish]);
    });
  };

  release(key: string): void {
    this.holds.delete(key);
    for (const f of this.waiting.get(key) ?? []) f();
    this.waiting.delete(key);
  }

  count(match: string | RegExp): number {
    return this.requested.filter((k) => (typeof match === "string" ? k.includes(match) : match.test(k))).length;
  }

  get open(): FakeBitmap[] {
    return this.made.filter((b) => b.closed === 0);
  }
}

export const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

export type Paint = { clip: string; frame: number; mode: string; state: string };

/** A controller on a real-geometry pack with a hand-driven loader and hand-fired timers. `paints` records every painted frame in order. */
export function rig(opts: { loop?: string; m?: ProdManifest; manifest?: unknown; fetchError?: Error; timeoutMs?: number; stallMs?: number; retryDelayMs?: number; hold?: Iterable<string> } = {}) {
  const m = opts.m ?? realManifest();
  const io = new FakeLoader(m);
  for (const k of opts.hold ?? []) io.holds.add(k);
  const timers = manualTimers();
  const paints: Paint[] = [];
  const events = { ready: 0, fail: [] as string[] };
  const ctl = new MotionController<FakeBitmap>({
    pack: m.pack,
    fetchManifest: () => (opts.fetchError ? Promise.reject(opts.fetchError) : Promise.resolve(opts.manifest ?? m)),
    makeLoad: () => io.load,
    paint: (_b, _m, _cell, shown) => void paints.push({ clip: shown.clip, frame: shown.frame, mode: shown.mode, state: shown.state }),
    onReady: () => void (events.ready += 1),
    onFail: (r) => void events.fail.push(r),
    timeoutMs: opts.timeoutMs,
    stallMs: opts.stallMs,
    retryDelayMs: opts.retryDelayMs,
    schedule: timers.schedule,
  });
  ctl.start(opts.loop ?? "watching");
  return { m, io, ctl, paints, events, timers };
}

export const tickN = (ctl: { tick: (ms: number) => void }, n: number, ms = FRAME_MS) => {
  for (let i = 0; i < n; i += 1) ctl.tick(ms);
};
/** Like tickN, but lets pending decodes land after every tick (what real time does between two rAF callbacks). */
export const playN = async (ctl: { tick: (ms: number) => void }, n: number, ms = FRAME_MS) => {
  for (let i = 0; i < n; i += 1) {
    ctl.tick(ms);
    await flush();
  }
};

/** A scheduler the test fires by hand: `schedule` for the controller / store, `fire(ms)` runs every live timer of that delay. */
export function manualTimers() {
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  return {
    timers,
    schedule: (fn: () => void, ms: number) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
    live: () => timers.filter((t) => t.live),
    fire(ms: number) {
      for (const t of timers.filter((x) => x.live && x.ms === ms)) {
        t.live = false;
        t.fn();
      }
    },
  };
}
