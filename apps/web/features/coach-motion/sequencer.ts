// Coach Motion V2 production slice · deterministic frame sequencer (pure: no DOM, no rAF, no fetch).
// One timeline: WATCHING loop (forward) -> [cue] -> entry head -> transition tail -> ANALYZING loop (forward).
// The clock only advances by whole frames and only onto a frame whose chunk is decoded; while it is not, the current frame stays and the
// clock is held (no frames are skipped, no sub-frame time banks up). The cue is taken at a frame boundary, never mid-frame, and only when
// its entry head is decoded; until then WATCHING keeps playing, so a late decode can never drop transition opening frames.

import { ANALYZING_LOOP, TRANSITION_TAIL, WATCHING_LOOP, cellOf, chunkKey, chunkOf, headClipId, type ProdManifest } from "./production-manifest";

export type Mode = "watching" | "transition" | "analyzing";
export interface Cursor {
  clip: string;
  frame: number;
}

export interface SeqHost {
  /** is this chunk decoded right now */
  ready(clip: string, chunk: number): boolean;
}

export interface TickResult {
  /** a new frame must be painted */
  changed: boolean;
  /** the clock is held on the current frame because the next chunk is not decoded */
  stalled: boolean;
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
  mode: Mode = "watching";
  cursor: Cursor = { clip: WATCHING_LOOP, frame: 0 };
  /** ms accumulated towards the next frame */
  acc = 0;
  cuePending = false;
  /** entry phase the current/last transition started from, and how far the first head frame is from the frame it replaced (in frames) */
  lastEntry: { phase: number; step: number } | null = null;
  private readonly frameMs: number;

  constructor(
    private readonly m: ProdManifest,
    private readonly host: SeqHost,
  ) {
    this.frameMs = 1000 / m.fps;
  }

  /** Jump to frame 0 of a loop. The caller makes sure that chunk is decoded. */
  start(mode: "watching" | "analyzing"): void {
    this.mode = mode;
    this.cursor = { clip: mode === "watching" ? WATCHING_LOOP : ANALYZING_LOOP, frame: 0 };
    this.acc = 0;
    this.cuePending = false;
    this.lastEntry = null;
  }

  /** The reveal cue. Only meaningful while WATCHING; it is taken at the next frame boundary at which the nearest entry head is decoded. */
  cue(): void {
    if (this.mode === "watching") this.cuePending = true;
  }

  private count(clip: string): number {
    return this.m.clips[clip].frames;
  }

  private ok(c: Cursor): boolean {
    return this.host.ready(c.clip, chunkOf(this.m, c.frame));
  }

  /** The cursor the default path (no cue) shows after `at`. */
  private step(at: Cursor, mode: Mode): { cursor: Cursor; mode: Mode } {
    const { clip, frame } = at;
    if (clip === WATCHING_LOOP || clip === ANALYZING_LOOP) return { cursor: { clip, frame: (frame + 1) % this.count(clip) }, mode };
    if (clip === TRANSITION_TAIL) {
      if (frame + 1 < this.count(clip)) return { cursor: { clip, frame: frame + 1 }, mode };
      return { cursor: { clip: ANALYZING_LOOP, frame: 0 }, mode: "analyzing" };
    }
    if (frame + 1 < this.count(clip)) return { cursor: { clip, frame: frame + 1 }, mode };
    return { cursor: { clip: TRANSITION_TAIL, frame: 0 }, mode };
  }

  private nextFrame(): { cursor: Cursor; mode: Mode; entry?: { phase: number; step: number } } {
    if (this.mode === "watching" && this.cuePending) {
      const n = this.count(WATCHING_LOOP);
      const upcoming = (this.cursor.frame + 1) % n;
      const phase = nearestHeadPhase(upcoming, n, this.m.headStride);
      const head: Cursor = { clip: headClipId(phase), frame: 0 };
      if (this.ok(head)) {
        const forward = (((phase - upcoming) % n) + n) % n;
        return { cursor: head, mode: "transition", entry: { phase, step: Math.min(forward, n - forward) } };
      }
    }
    return this.step(this.cursor, this.mode);
  }

  tick(dtMs: number): TickResult {
    this.acc += dtMs;
    let changed = false;
    let stalled = false;
    while (this.acc + 1e-9 >= this.frameMs) {
      const n = this.nextFrame();
      if (!this.ok(n.cursor)) {
        this.acc = this.frameMs - 1e-3; // hold the clock: the frame is due the moment its chunk lands, but the stall banks no extra frames
        stalled = true;
        break;
      }
      this.acc -= this.frameMs;
      this.cursor = n.cursor;
      this.mode = n.mode;
      if (n.entry) {
        this.cuePending = false;
        this.lastEntry = n.entry;
      }
      changed = true;
    }
    return { changed, stalled };
  }

  /** Chunks the default path touches in the next `lookahead` frames (CURRENT + NEXT), plus, while WATCHING, what a cue would need
      (the entry heads for the next two entry phases, the first tail chunk). Ordered by urgency. */
  wanted(lookaheadFrames = this.m.chunkFrames): string[] {
    const keys: string[] = [];
    const add = (clip: string, chunk: number) => {
      const k = chunkKey(this.m.pack, clip, chunk);
      if (!keys.includes(k)) keys.push(k);
    };
    let at = this.cursor;
    let mode = this.mode;
    add(at.clip, chunkOf(this.m, at.frame));
    for (let i = 0; i < lookaheadFrames; i += 1) {
      const s = this.step(at, mode);
      at = s.cursor;
      mode = s.mode;
      add(at.clip, chunkOf(this.m, at.frame));
    }
    if (this.mode === "watching") {
      const n = this.count(WATCHING_LOOP);
      const upcoming = (this.cursor.frame + 1) % n;
      add(headClipId(nearestHeadPhase(upcoming, n, this.m.headStride)), 0);
      add(headClipId(nearestHeadPhase((upcoming + this.m.headStride) % n, n, this.m.headStride)), 0);
      add(TRANSITION_TAIL, 0);
    }
    return keys;
  }

  /** (clip, frame) -> atlas coordinates of the frame on screen. */
  locate(): { clip: string; chunk: number; cell: number } {
    return { clip: this.cursor.clip, chunk: chunkOf(this.m, this.cursor.frame), cell: cellOf(this.m, this.cursor.frame) };
  }
}
