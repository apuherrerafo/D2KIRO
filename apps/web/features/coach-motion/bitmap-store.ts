// Coach Motion V2 production slice · decoded-chunk ownership.
// The store owns every decoded bitmap: it decodes what the player WANTS (CURRENT + NEXT + cue extras), closes what it no longer wants, and never closes a
// bitmap that is leased (being drawn). A decode that finishes after its key stopped being wanted is closed on arrival, so nothing leaks.
// Generic over the bitmap type so the tests drive it with fakes; the browser instance uses ImageBitmap (createImageBitmap, explicit close()).

export interface Decoded {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** Fetch + decode one chunk by key. Rejects on a network error, a non-OK status or a decode error. */
export type LoadChunk<B extends Decoded> = (key: string) => Promise<B>;

type Entry<B extends Decoded> = { state: "loading" | "ready" | "failed"; bitmap: B | null; leases: number; wanted: boolean; error?: string };

export interface Lease<B extends Decoded> {
  readonly bitmap: B;
  release(): void;
}

export class BitmapStore<B extends Decoded> {
  private readonly entries = new Map<string, Entry<B>>();
  private disposed = false;
  /** Fires once per key that failed (fetch or decode). */
  onFail: (key: string, error: string) => void = () => {};
  /** Fires when a key becomes ready (the controller re-evaluates what it was waiting for). */
  onReady: (key: string) => void = () => {};

  constructor(private readonly load: LoadChunk<B>) {}

  /** The complete set of keys that must be resident from now on; everything else is released (closed as soon as it is not leased). */
  want(keys: readonly string[]): void {
    if (this.disposed) return;
    const set = new Set(keys);
    for (const [key, e] of this.entries) {
      if (set.has(key)) continue;
      e.wanted = false;
      if (e.state === "failed") this.entries.delete(key);
      else this.closeIfFree(key, e);
    }
    for (const key of keys) {
      const e = this.entries.get(key);
      if (e) {
        e.wanted = true;
        continue;
      }
      this.begin(key);
    }
  }

  private begin(key: string): void {
    const e: Entry<B> = { state: "loading", bitmap: null, leases: 0, wanted: true };
    this.entries.set(key, e);
    let promise: Promise<B>;
    try {
      promise = this.load(key);
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (bitmap) => {
        if (this.disposed || this.entries.get(key) !== e || !e.wanted) {
          bitmap.close(); // no longer wanted (or the store is gone): never keep it
          if (this.entries.get(key) === e) this.entries.delete(key);
          return;
        }
        e.state = "ready";
        e.bitmap = bitmap;
        this.onReady(key);
      },
      (error: unknown) => {
        if (this.disposed || this.entries.get(key) !== e) return;
        e.state = "failed";
        e.error = error instanceof Error ? error.message : String(error);
        this.onFail(key, e.error);
      },
    );
  }

  private closeIfFree(key: string, e: Entry<B>): void {
    if (e.leases > 0) return; // still in use: released when the lease ends
    if (e.bitmap) {
      e.bitmap.close();
      e.bitmap = null;
    }
    // a still-loading entry stays in the map, flagged unwanted: its bitmap is closed on arrival
    if (e.state !== "loading") this.entries.delete(key);
  }

  isReady(key: string): boolean {
    return this.entries.get(key)?.state === "ready";
  }

  hasFailed(): boolean {
    for (const e of this.entries.values()) if (e.state === "failed") return true;
    return false;
  }

  /** Borrow a ready bitmap. Release it in a finally block; it cannot be closed while borrowed. */
  lease(key: string): Lease<B> | null {
    const e = this.entries.get(key);
    if (!e || e.state !== "ready" || !e.bitmap) return null;
    e.leases += 1;
    let done = false;
    const bitmap = e.bitmap;
    return {
      bitmap,
      release: () => {
        if (done) return;
        done = true;
        e.leases -= 1;
        if (e.leases > 0) return;
        if (this.disposed) bitmap.close();
        else if (!e.wanted) this.closeIfFree(key, e);
      },
    };
  }

  /** Keys currently holding a decoded bitmap (and how many bytes at 4 bytes per pixel). */
  residency(): { keys: string[]; bytes: number } {
    const keys: string[] = [];
    let bytes = 0;
    for (const [key, e] of this.entries) {
      if (e.bitmap) {
        keys.push(key);
        bytes += e.bitmap.width * e.bitmap.height * 4;
      }
    }
    return { keys, bytes };
  }

  dispose(): void {
    this.disposed = true;
    for (const e of this.entries.values()) {
      if (e.bitmap && e.leases === 0) e.bitmap.close();
      e.bitmap = null;
    }
    this.entries.clear();
  }
}
