// Coach Motion V2 production slice · deterministic frame sequencer (pure: no DOM, no rAF, no fetch). It interprets the manifest's GRAPH; it knows no clip names.
// One timeline: LOOP (forward) -> [request] -> entry head -> edge tail -> TARGET LOOP (forward).
// The clock only advances by whole frames and only onto a frame whose chunk is decoded; while it is not, the current frame stays and the clock is held (no frames
// are skipped, no sub-frame time banks up). A request is taken at a frame boundary, never mid-frame, and only when the nearest entry head AND the first chunk of the
// edge's tail are decoded, so a transition never starts unless its opening is guaranteed; until then the loop keeps playing.
// CUE-ARMED PREFETCH: while no request is pending `wanted()` names only the chunks the default path touches (current + next). The entry heads and the tail opening are
// named only once a request is pending, and only for that edge.

import { cellOf, chunkKey, chunkOf, edgeBetween, headClipId, loopClip, type GraphEdge, type ProdManifest } from "./production-manifest";

export interface Cursor {
  clip: string;
  frame: number;
}

/** Where the cursor is in the graph: playing a loop, or inside an edge (its entry head, then its tail). */
export type Where = { kind: "loop"; loop: string } | { kind: "edge"; edge: GraphEdge; stage: "head" | "tail" };

export interface SeqHost {
  /** is this chunk decoded right now */
  ready(clip: string, chunk: number): boolean;
}

export interface TickResult {
  /** a new frame must be painted */
  changed: boolean;
  /** the clock is held on the current frame because the next chunk is not decoded */
  stalled: boolean;
  /** key of the chunk the held clock is waiting for */
  waitingOn: string | null;
}

/** A chunk the player wants, most urgent first. Required = on the path of frames about to be shown; speculative = armed for a pending request. */
export interface WantedChunk {
  key: string;
  required: boolean;
}

/** Entry phase (a multiple of the stride, circular over the loop) nearest to loop frame `frame`; a tie goes to the later phase. */
export function nearestHeadPhase(frame: number, loopFrames: number, stride: number): number {
  const phases = Math.ceil(loopFrames / stride);
  let best = 0;
  let bestDist = Infinity;
  for (let k = 0; k < phases; k += 1) {
    const p = k * stride;
    const forward = (((p - frame) % loopFrames) + loopFrames) % loopFrames;
    const dist = Math.min(forward, loopFrames - forward);
    if (dist < bestDist || (dist === bestDist && forward <= loopFrames / 2 && forward > 0)) {
      best = p;
      bestDist = dist;
    }
  }
  return best;
}

export class MotionSequencer {
  where: Where;
  cursor: Cursor;
  /** ms accumulated towards the next frame */
  acc = 0;
  /** the edge a request asked for; the loop keeps playing until its entry is decoded */
  pending: GraphEdge | null = null;
  /** entry phase the current/last transition started from, and how far the first head frame is from the frame it replaced (in frames) */
  lastEntry: { edge: string; phase: number; step: number } | null = null;
  private readonly frameMs: number;

  constructor(
    private readonly m: ProdManifest,
    private readonly host: SeqHost,
    initialLoop: string,
  ) {
    this.frameMs = 1000 / m.fps;
    this.where = { kind: "loop", loop: initialLoop };
    this.cursor = { clip: loopClip(m, initialLoop), frame: 0 };
  }

  /** "transition" while inside an edge, otherwise the id of the loop being played. */
  get mode(): string {
    return this.where.kind === "loop" ? this.where.loop : "transition";
  }

  /** The semantic state the picture shows: the loop being played, or the target of the edge being played. */
  get state(): string {
    return this.where.kind === "loop" ? this.where.loop : this.where.edge.to;
  }

  /** Jump to frame 0 of a loop. The caller makes sure that chunk is decoded. */
  start(loop: string): void {
    this.where = { kind: "loop", loop };
    this.cursor = { clip: loopClip(this.m, loop), frame: 0 };
    this.acc = 0;
    this.pending = null;
    this.lastEntry = null;
  }

  /** Ask for the edge from the loop being played to `target`. Returns false (and changes nothing) when no such edge leaves this loop or a transition is playing. */
  request(target: string): boolean {
    if (this.where.kind !== "loop") return false;
    const edge = edgeBetween(this.m, this.where.loop, target);
    if (!edge) return false;
    this.pending = edge;
    return true;
  }

  private ok(c: Cursor): boolean {
    return this.host.ready(c.clip, chunkOf(this.m, c.frame));
  }

  /** The cursor the default path (no request) shows after `at`. */
  private step(at: Cursor, where: Where): { cursor: Cursor; where: Where } {
    const clip = this.m.clips[at.clip];
    if (at.frame + 1 < clip.frames) return { cursor: { clip: at.clip, frame: at.frame + 1 }, where };
    if (where.kind === "loop") return { cursor: { clip: at.clip, frame: 0 }, where };
    if (where.stage === "head") return { cursor: { clip: where.edge.tail.clip, frame: 0 }, where: { kind: "edge", edge: where.edge, stage: "tail" } };
    return { cursor: { clip: loopClip(this.m, where.edge.to), frame: where.edge.tail.enterFrame }, where: { kind: "loop", loop: where.edge.to } };
  }

  private nextFrame(): { cursor: Cursor; where: Where; entry?: { edge: string; phase: number; step: number } } {
    if (this.where.kind === "loop" && this.pending) {
      const edge = this.pending;
      const n = this.m.clips[this.cursor.clip].frames;
      const upcoming = (this.cursor.frame + 1) % n;
      const phase = nearestHeadPhase(upcoming, n, edge.entry.stride);
      const head: Cursor = { clip: headClipId(edge.entry.headClipPrefix, phase), frame: 0 };
      if (this.ok(head) && this.ok({ clip: edge.tail.clip, frame: 0 })) {
        const forward = (((phase - upcoming) % n) + n) % n;
        return { cursor: head, where: { kind: "edge", edge, stage: "head" }, entry: { edge: edge.id, phase, step: Math.min(forward, n - forward) } };
      }
    }
    return this.step(this.cursor, this.where);
  }

  tick(dtMs: number): TickResult {
    this.acc += dtMs;
    let changed = false;
    let stalled = false;
    let waitingOn: string | null = null;
    while (this.acc + 1e-9 >= this.frameMs) {
      const n = this.nextFrame();
      if (!this.ok(n.cursor)) {
        this.acc = this.frameMs - 1e-3; // hold the clock: the frame is due the moment its chunk lands, but the stall banks no extra frames
        stalled = true;
        waitingOn = chunkKey(this.m.pack, n.cursor.clip, chunkOf(this.m, n.cursor.frame));
        break;
      }
      this.acc -= this.frameMs;
      this.cursor = n.cursor;
      this.where = n.where;
      if (n.entry) {
        this.pending = null;
        this.lastEntry = n.entry;
      }
      changed = true;
    }
    return { changed, stalled, waitingOn };
  }

  /** Chunks to hold resident, most urgent first.
      Required: the ones the default path touches in the next `lookahead` frames (the loop's current + next chunk; inside an edge, its `lookaheadFrames`).
      Only while a request is pending: the nearest entry head (speculative: a neighbouring head can stand in for it), the tail's first chunk (required: the edge cannot
      start without it), then the next entry head(s) as a latency hedge (speculative). */
  wanted(): WantedChunk[] {
    const out: WantedChunk[] = [];
    const seen = new Set<string>();
    const add = (clip: string, chunk: number, required: boolean) => {
      const key = chunkKey(this.m.pack, clip, chunk);
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ key, required });
    };
    const lookahead = this.where.kind === "edge" ? this.where.edge.lookaheadFrames : this.m.chunkFrames;
    let at = this.cursor;
    let where = this.where;
    add(at.clip, chunkOf(this.m, at.frame), true);
    for (let i = 0; i < lookahead; i += 1) {
      const s = this.step(at, where);
      at = s.cursor;
      where = s.where;
      add(at.clip, chunkOf(this.m, at.frame), true);
    }
    if (this.where.kind === "loop" && this.pending) {
      const edge = this.pending;
      const n = this.m.clips[this.cursor.clip].frames;
      const upcoming = (this.cursor.frame + 1) % n;
      const phases: number[] = [];
      for (let i = 0; i < edge.entry.armHeads; i += 1) {
        const p = nearestHeadPhase((upcoming + i * edge.entry.stride) % n, n, edge.entry.stride);
        if (!phases.includes(p)) phases.push(p);
      }
      add(headClipId(edge.entry.headClipPrefix, phases[0]), 0, false);
      add(edge.tail.clip, 0, true); // the edge cannot start without its tail opening, and no other head can stand in for it
      for (const p of phases.slice(1)) add(headClipId(edge.entry.headClipPrefix, p), 0, false);
    }
    return out;
  }

  /** (clip, frame) -> atlas coordinates of the frame on screen. */
  locate(): { clip: string; chunk: number; cell: number } {
    return { clip: this.cursor.clip, chunk: chunkOf(this.m, this.cursor.frame), cell: cellOf(this.m, this.cursor.frame) };
  }
}
