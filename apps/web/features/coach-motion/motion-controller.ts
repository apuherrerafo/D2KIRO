// Coach Motion V2 production slice · controller: manifest + decoded-chunk store + sequencer, no DOM and no rAF (the player calls `tick`).
// Failure contract: until the first frame is painted, and after any failure, the controller never touches the canvas; `onFail` fires once
// and the host keeps showing the static Coach. `onReady` fires after the first Motion V2 frame has been painted, never before.

import { BitmapStore, type Decoded, type LoadChunk } from "./bitmap-store";
import { chunkKey, chunkOf, parseManifest, type ProdManifest } from "./production-manifest";
import { MotionSequencer, type Mode } from "./sequencer";

export interface ControllerDeps<B extends Decoded> {
  pack: string;
  fetchManifest: () => Promise<unknown>;
  /** builds the chunk loader once the manifest is known (key = `${pack}/${clip}#${chunk}`) */
  makeLoad: (m: ProdManifest) => LoadChunk<B>;
  /** draws cell `cell` of the decoded chunk; called synchronously while the bitmap is leased */
  paint: (bitmap: B, m: ProdManifest, cell: number, shown: { clip: string; frame: number; mode: Mode }) => void;
  onReady?: () => void;
  onFail?: (reason: string) => void;
  /** initial-ready deadline; `schedule(fn, ms)` returns a cancel function (injectable for tests) */
  timeoutMs?: number;
  schedule?: (fn: () => void, ms: number) => () => void;
}

export type Status = "idle" | "loading" | "ready" | "failed" | "disposed";

/** Longest clock step the controller accepts in one tick (a slow frame, not a hidden tab: the player drops those). */
const MAX_DT_MS = 100;

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
  private scenario: "watching" | "analyzing" = "watching";
  private lastKeys = "";

  constructor(private readonly deps: ControllerDeps<B>) {}

  start(scenario: "watching" | "analyzing" = "watching"): void {
    if (this.status !== "idle") return;
    this.status = "loading";
    this.scenario = scenario;
    const schedule = this.deps.schedule ?? ((fn, ms) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });
    this.cancelTimeout = schedule(() => this.fail("timeout waiting for the first Motion V2 frame"), this.deps.timeoutMs ?? 8000);
    this.deps.fetchManifest().then(
      (raw) => {
        if (this.status !== "loading") return;
        try {
          const m = parseManifest(raw);
          this.manifest = m;
          this.store = new BitmapStore<B>(this.deps.makeLoad(m));
          this.store.onFail = (key, error) => this.fail(`${key}: ${error}`);
          this.store.onReady = () => this.pump();
          this.seq = new MotionSequencer(m, { ready: (clip, chunk) => this.store?.isReady(chunkKey(m.pack, clip, chunk)) ?? false });
          this.seq.start(this.scenario);
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
  goTo(scenario: "watching" | "analyzing"): void {
    this.scenario = scenario;
    if (!this.seq) return;
    this.seq.start(scenario);
    this.awaitingFirst = true;
    this.syncWanted(true);
    this.pump();
  }

  cue(): void {
    this.seq?.cue();
  }

  /** Advance the deterministic clock by `dtMs` of real time and paint if the frame changed. */
  tick(dtMs: number): void {
    const seq = this.seq;
    if (this.status !== "ready" || !seq) return;
    if (this.awaitingFirst) {
      this.pump();
      return;
    }
    const r = seq.tick(Math.min(dtMs, MAX_DT_MS));
    if (r.changed) {
      this.paintCurrent();
      this.syncWanted();
    }
  }

  /** Paint the frame on screen again (the canvas was resized and cleared). */
  repaint(): void {
    if (this.status === "ready" && !this.awaitingFirst) this.paintCurrent();
  }

  private syncWanted(force = false): void {
    if (!this.seq || !this.store) return;
    const keys = this.seq.wanted();
    const sig = keys.join("|");
    if (!force && sig === this.lastKeys) return;
    this.lastKeys = sig;
    this.store.want(keys);
  }

  /** A chunk arrived (or the cursor moved): first frame of a start/goTo, and re-checks a held clock. */
  private pump(): void {
    const seq = this.seq;
    const m = this.manifest;
    if (!seq || !m || !this.store) return;
    if (this.status !== "loading" && this.status !== "ready") return;
    if (!this.awaitingFirst) return;
    if (!this.store.isReady(chunkKey(m.pack, seq.cursor.clip, chunkOf(m, seq.cursor.frame)))) return;
    this.awaitingFirst = false;
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
      this.deps.paint(lease.bitmap, m, at.cell, { clip: seq.cursor.clip, frame: seq.cursor.frame, mode: seq.mode });
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

  get shown(): { clip: string; frame: number; mode: Mode; stalled: boolean } | null {
    return this.seq ? { clip: this.seq.cursor.clip, frame: this.seq.cursor.frame, mode: this.seq.mode, stalled: this.awaitingFirst } : null;
  }

  residency(): { keys: string[]; bytes: number } {
    return this.store?.residency() ?? { keys: [], bytes: 0 };
  }

  get lastEntry(): { phase: number; step: number } | null {
    return this.seq?.lastEntry ?? null;
  }

  dispose(): void {
    this.cancelTimeout?.();
    this.cancelTimeout = null;
    this.store?.dispose();
    this.store = null;
    this.status = "disposed";
  }
}
