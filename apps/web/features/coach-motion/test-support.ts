// Test doubles for the Coach Motion V2 production runtime (no DOM): a synthetic manifest with the real slice geometry and a chunk loader whose decodes the test releases by hand.
import type { Decoded } from "./bitmap-store";
import { ANALYZING_LOOP, TRANSITION_TAIL, WATCHING_LOOP, headClipId, type ChunkMeta, type ProdClipMeta, type ProdManifest } from "./production-manifest";

function chunks(frames: number, chunkFrames: number, cols: number, cell: { w: number; h: number }): ChunkMeta[] {
  const out: ChunkMeta[] = [];
  for (let at = 0; at < frames; at += chunkFrames) {
    const n = Math.min(chunkFrames, frames - at);
    const rows = Math.ceil(n / cols);
    out.push({ file: `c${out.length}.avif`, frames: n, rows, w: cols * cell.w, h: rows * cell.h, bytes: 1000 });
  }
  return out;
}

export function fakeManifest(pack = "384", cell = { w: 346, h: 354 }): ProdManifest {
  const chunkFrames = 14;
  const cols = 4;
  const clip = (frames: number, loop: boolean): ProdClipMeta => ({ frames, loop, chunks: chunks(frames, chunkFrames, cols, cell) });
  const clips: Record<string, ProdClipMeta> = { [WATCHING_LOOP]: clip(252, true), [ANALYZING_LOOP]: clip(210, true), [TRANSITION_TAIL]: clip(35, false) };
  for (let p = 0; p < 252; p += 6) clips[headClipId(p)] = clip(10, false);
  return {
    version: 3,
    pack,
    srcPx: 384,
    fps: 30,
    crop: { x: 15, y: 20, w: cell.w, h: cell.h },
    cell,
    chunkFrames,
    cols,
    headStride: 6,
    totalBytes: 0,
    encoder: { format: "avif", quality: 33, speed: 4, subsampling: "4:2:0", library: "test", libavif: "test" },
    clips,
  };
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
  readonly requested: string[] = [];
  readonly made: FakeBitmap[] = [];
  failing = new Set<string>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(readonly m: ProdManifest) {}

  load = (key: string): Promise<FakeBitmap> => {
    this.requested.push(key);
    const [clip, chunk] = [key.slice(key.indexOf("/") + 1, key.lastIndexOf("#")), Number(key.slice(key.lastIndexOf("#") + 1))];
    const meta = this.m.clips[clip].chunks[chunk];
    const make = () => {
      if (this.failing.has(key)) throw new Error(`decode failed: ${key}`);
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

  get open(): FakeBitmap[] {
    return this.made.filter((b) => b.closed === 0);
  }
}

export const flush = async () => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};
