// Coach Motion V2 production slice · controller: manifest + decoded-chunk store + sequencer, no DOM and no rAF (the player calls `tick`).
// Failure contract: until the first frame is painted, and after any failure, the controller never touches the canvas; `onFail` fires once
// and the host keeps showing the static Coach. `onReady` fires after the first Motion V2 frame has been painted, never before.
// What fails Motion V2: the first frame never arriving (timeout), a REQUIRED chunk failing after its retry, or the animation not being able to progress for
// `stallMs` of visible ticks (a held clock, a loop switch that never lands, a request whose entry never decodes). A failed prefetch alone never does.

import { BitmapStore, type Decoded, type LoadChunk } from "./bitmap-store";
import { chunkKey, chunkOf, parseManifest, type ProdManifest } from "./production-manifest";
import { MotionSequencer } from "./sequencer";

export interface Shown {
  clip: string;
  frame: number;
  /** "transition" while inside an edge, otherwise the loop id */
  mode: string;
  /** the semantic state of the picture: the loop being played, or the target of the edge being played */
  state: string;
}

export interface ControllerDeps<B extends Decoded> {
  pack: string;
  fetchManifest: () => Promise<unknown>;
  /** builds the chunk loader once the manifest is known (key = `${pack}/${clip}#${chunk}`) */
  makeLoad: (m: ProdManifest) => LoadChunk<B>;
  /** draws cell `cell` of the decoded chunk; called synchronously while the bitmap is leased */
  paint: (bitmap: B, m: ProdManifest, cell: number, shown: Shown) => void;
  onReady?: () => void;
  onFail?: (reason: string) => void;
  /** initial-ready deadline; `schedule(fn, ms)` returns a cancel function (injectable for tests) */
  timeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
  /** visible-tick time without progress before Motion V2 gives up (default 2500) */
  stallMs?: number;
  /** wait before the one retry of a failed required chunk (default 250) */
  retryDelayMs?: number;
}

export type Status = "idle" | "loading" | "ready" | "failed" | "disposed";

/** Longest clock step the controller accepts in one tick (a slow frame, not a hidden tab: the player drops those). */
const MAX_DT_MS = 100;
export const DEFAULT_STALL_MS = 2500;

export class MotionController<B extends Decoded> {
  status: Status = "idle";
  failure: string | null = null;
  manifest: ProdManifest | null = null;
  private seq: MotionSequencer | null = null;
  private store: BitmapStore<B> | null = null;
  private cancelTimeout: (() => void) | null = null;
  /** the cursor's first frame has not been painted yet (start / goTo): the previous picture stays on screen, the clock waits */
  private awaitingFirst = false;
  private painted = false;
  private loop = "";
  private lastKeys = "";
  /** visible ms the animation could not progress, and visible ms a request has been waiting for its entry */
  private heldMs = 0;
  private requestMs = 0;
  private speculativeFailures = 0;

  constructor(private readonly deps: ControllerDeps<B>) {}

  private get schedule(): (fn: () => void, ms: number) => () => void {
    return (
      this.deps.schedule ??
      ((fn, ms) => {
        const id = setTimeout(fn, ms);
        return () => clearTimeout(id);
      })
    );
  }

  start(loop: string): void {
    if (this.status !== "idle") return;
    this.status = "loading";
    this.loop = loop;
    this.cancelTimeout = this.schedule(() => this.fail("timeout waiting for the first Motion V2 frame"), this.deps.timeoutMs ?? 8000);
    this.deps.fetchManifest().then(
      (raw) => {
        if (this.status !== "loading") return;
        try {
          const m = parseManifest(raw);
          if (!m.graph.loops[loop]) throw new Error(`coach motion manifest: no loop ${loop}`);
          this.manifest = m;
          this.store = new BitmapStore<B>(this.deps.makeLoad(m), { schedule: this.deps.schedule, retryDelayMs: this.deps.retryDelayMs });
          this.store.onFail = (key, error) => this.fail(`${key}: ${error}`);
          this.store.onSpeculativeFail = () => void (this.speculativeFailures += 1);
          this.store.onReady = () => this.pump();
          this.seq = new MotionSequencer(m, { ready: (clip, chunk) => this.store?.isReady(chunkKey(m.pack, clip, chunk)) ?? false }, loop);
          this.awaitingFirst = true;
          this.syncWanted();
        } catch (error) {
          this.fail(error instanceof Error ? error.message : String(error));
        }
      },
      (error: unknown) => this.fail(error instanceof Error ? error.message : "manifest failed"),
    );
  }

  /** Back to frame 0 of a loop. The picture on screen stays until that loop's first chunk is decoded. */
  goTo(loop: string): void {
    this.loop = loop;
    if (!this.seq || !this.manifest?.graph.loops[loop]) return;
    this.seq.start(loop);
    this.awaitingFirst = true;
    this.heldMs = 0;
    this.requestMs = 0;
    this.syncWanted(true);
    this.pump();
  }

  /** Ask for the transition from the loop being played to `target`. False when the graph has no such edge from here (or a transition is playing). */
  cue(target: string): boolean {
    if (this.status !== "ready" || !this.seq) return false;
    const taken = this.seq.request(target);
    if (taken) this.syncWanted(); // the request arms its entry heads and tail opening now, not at the next frame change
    return taken;
  }

  /** Advance the deterministic clock by `dtMs` of real time and paint if the frame changed. */
  tick(dtMs: number): void {
    const seq = this.seq;
    if (this.status !== "ready" || !seq) return;
    const dt = Math.min(dtMs, MAX_DT_MS);
    const stallMs = this.deps.stallMs ?? DEFAULT_STALL_MS;
    if (this.awaitingFirst) {
      this.pump();
      if (this.awaitingFirst) {
        this.heldMs += dt;
        if (this.heldMs >= stallMs) this.fail(`stalled ${Math.round(this.heldMs)} ms waiting for the first frame of ${this.loop}`);
      }
      return;
    }
    const r = seq.tick(dt);
    if (r.changed) {
      this.heldMs = 0;
      this.paintCurrent();
      this.syncWanted();
    } else if (r.stalled) {
      this.heldMs += dt;
      if (this.heldMs >= stallMs) this.fail(`stalled ${Math.round(this.heldMs)} ms waiting for ${r.waitingOn}`);
    }
    if (this.status !== "ready") return;
    // a request whose entry never decodes leaves the loop playing, which is not a held clock but is just as stuck
    this.requestMs = seq.pending ? this.requestMs + dt : 0;
    if (this.requestMs >= stallMs) this.fail(`stalled ${Math.round(this.requestMs)} ms waiting for the entry of ${seq.pending?.id}`);
  }

  /** Paint the frame on screen again (the canvas was resized and cleared). */
  repaint(): void {
    if (this.status === "ready" && !this.awaitingFirst) this.paintCurrent();
  }

  private syncWanted(force = false): void {
    if (!this.seq || !this.store) return;
    const items = this.seq.wanted();
    const sig = items.map((i) => (i.required ? "!" : "?") + i.key).join("|");
    if (!force && sig === this.lastKeys) return;
    this.lastKeys = sig;
    this.store.want(items);
  }

  /** A chunk arrived (or the cursor moved): first frame of a start/goTo. */
  private pump(): void {
    const seq = this.seq;
    const m = this.manifest;
    if (!seq || !m || !this.store) return;
    if (this.status !== "loading" && this.status !== "ready") return;
    if (!this.awaitingFirst) return;
    if (!this.store.isReady(chunkKey(m.pack, seq.cursor.clip, chunkOf(m, seq.cursor.frame)))) return;
    this.awaitingFirst = false;
    this.heldMs = 0;
    this.paintCurrent();
    if (this.status === "loading") {
      this.status = "ready";
      this.cancelTimeout?.();
      this.cancelTimeout = null;
      this.painted = true;
      this.deps.onReady?.();
    }
    this.syncWanted();
  }

  private paintCurrent(): void {
    const seq = this.seq;
    const m = this.manifest;
    if (!seq || !m || !this.store) return;
    const at = seq.locate();
    const lease = this.store.lease(chunkKey(m.pack, at.clip, at.chunk));
    if (!lease) return;
    try {
      this.deps.paint(lease.bitmap, m, at.cell, { clip: seq.cursor.clip, frame: seq.cursor.frame, mode: seq.mode, state: seq.state });
    } finally {
      lease.release();
    }
  }

  private fail(reason: string): void {
    if (this.status === "failed" || this.status === "disposed") return;
    this.status = "failed";
    this.failure = reason;
    this.cancelTimeout?.();
    this.cancelTimeout = null;
    this.store?.dispose();
    this.store = null;
    this.deps.onFail?.(reason);
  }

  /** True once a Motion V2 frame has actually been painted. */
  get hasPainted(): boolean {
    return this.painted;
  }

  get shown(): (Shown & { stalled: boolean }) | null {
    return this.seq ? { clip: this.seq.cursor.clip, frame: this.seq.cursor.frame, mode: this.seq.mode, state: this.seq.state, stalled: this.awaitingFirst } : null;
  }

  residency(): { keys: string[]; bytes: number } {
    return this.store?.residency() ?? { keys: [], bytes: 0 };
  }

  /** Counters for the lab read-out and the tests. */
  get stats(): { loads: number; speculativeFailures: number } {
    return { loads: this.store?.loads ?? 0, speculativeFailures: this.speculativeFailures };
  }

  get lastEntry(): { edge: string; phase: number; step: number } | null {
    return this.seq?.lastEntry ?? null;
  }

  /** The edge a request is waiting on, or null. */
  get pendingEdge(): string | null {
    return this.seq?.pending?.id ?? null;
  }

  dispose(): void {
    this.cancelTimeout?.();
    this.cancelTimeout = null;
    this.store?.dispose();
    this.store = null;
    this.status = "disposed";
  }
}
