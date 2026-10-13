// Coach Motion V2 production slice · decoded-chunk ownership.
// The store owns every decoded bitmap: it decodes what the player WANTS, in the player's priority order, closes what it no longer wants, and never closes a
// bitmap that is leased (being drawn). A decode that finishes after its key stopped being wanted is closed on arrival, so nothing leaks.
// REQUIRED keys are on the path of the frames about to be shown: they start at once, get one retry, and a failure after the retry is fatal (onFail).
// SPECULATIVE keys are prefetch hints (a cue's entry heads, its tail opening): they start in priority order behind a small in-flight cap, never retry on
// their own, and a failure is reported (onSpeculativeFail) but never fatal; if the key later becomes required it gets its one retry then.
// Generic over the bitmap type so the tests drive it with fakes; the browser instance uses ImageBitmap (createImageBitmap, explicit close()).

export interface Decoded {
  readonly width: number;
  readonly height: number;
  close(): void;
}

/** Fetch + decode one chunk by key. `attempt` is 1 for the first try and 2 for the retry (which should not trust a cached answer); `signal` aborts when the key is
    no longer wanted before it landed. Rejects on a network error, a non-OK status, a size mismatch or a decode error. */
export type LoadChunk<B extends Decoded> = (key: string, attempt: number, signal?: AbortSignal) => Promise<B>;

export interface WantItem {
  key: string;
  required: boolean;
}

export interface StoreOptions {
  /** speculative loads allowed in flight at once (required loads are never held back) */
  maxSpeculativeInflight?: number;
  /** wait before the one retry of a failed required load */
  retryDelayMs?: number;
  /** `schedule(fn, ms)` returns a cancel function (injectable for tests) */
  schedule?: (fn: () => void, ms: number) => () => void;
}

/** One attempt + one retry. */
const MAX_ATTEMPTS = 2;

type State = "queued" | "loading" | "retrying" | "ready" | "failed";
type Entry<B extends Decoded> = { state: State; bitmap: B | null; leases: number; wanted: boolean; required: boolean; attempts: number; error?: string; reported?: boolean; cancelRetry?: () => void; abort?: AbortController };

export interface Lease<B extends Decoded> {
  readonly bitmap: B;
  release(): void;
}

const defaultSchedule = (fn: () => void, ms: number) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class BitmapStore<B extends Decoded> {
  private readonly entries = new Map<string, Entry<B>>();
  private order: string[] = [];
  private disposed = false;
  /** load() calls made so far (attempts, retries included) */
  loads = 0;
  /** Fires once per key whose REQUIRED load failed for good (after its retry). */
  onFail: (key: string, error: string) => void = () => {};
  /** Fires when a SPECULATIVE load failed; informational. */
  onSpeculativeFail: (key: string, error: string) => void = () => {};
  /** Fires when a key becomes ready (the controller re-evaluates what it was waiting for). */
  onReady: (key: string) => void = () => {};
  private readonly maxSpec: number;
  private readonly retryDelayMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;

  constructor(
    private readonly load: LoadChunk<B>,
    opts: StoreOptions = {},
  ) {
    this.maxSpec = opts.maxSpeculativeInflight ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 250;
    this.schedule = opts.schedule ?? defaultSchedule;
  }

  /** The complete, priority-ordered set of keys that must be resident from now on; everything else is released (closed as soon as it is not leased). */
  want(items: readonly WantItem[]): void {
    if (this.disposed) return;
    const flags = new Map<string, boolean>();
    for (const it of items) flags.set(it.key, (flags.get(it.key) ?? false) || it.required);
    for (const [key, e] of this.entries) {
      if (flags.has(key)) continue;
      e.wanted = false;
      this.release(key, e);
    }
    this.order = [...flags.keys()];
    const fatal: Array<[string, string]> = [];
    for (const [key, required] of flags) {
      let e = this.entries.get(key);
      if (!e) {
        e = { state: "queued", bitmap: null, leases: 0, wanted: true, required, attempts: 0 };
        this.entries.set(key, e);
        continue;
      }
      e.wanted = true;
      e.required = required;
      // a failed key that has become required: its retry (if it has one left), or the end of the line
      if (required && e.state === "failed") {
        if (e.attempts < MAX_ATTEMPTS) e.state = "queued";
        else if (!e.reported) {
          e.reported = true;
          fatal.push([key, e.error ?? "failed"]);
        }
      }
    }
    this.pump();
    for (const [key, error] of fatal) this.onFail(key, error);
  }

  /** Start queued loads in priority order: required ones always, speculative ones while under the in-flight cap. */
  private pump(): void {
    if (this.disposed) return;
    let spec = 0;
    for (const e of this.entries.values()) if (e.state === "loading" && !e.required) spec += 1;
    for (const key of this.order) {
      const e = this.entries.get(key);
      if (!e || e.state !== "queued") continue;
      if (!e.required) {
        if (spec >= this.maxSpec) continue;
        spec += 1;
      }
      this.begin(key, e);
    }
  }

  private begin(key: string, e: Entry<B>): void {
    e.state = "loading";
    e.attempts += 1;
    this.loads += 1;
    const abort = new AbortController();
    e.abort = abort;
    let promise: Promise<B>;
    try {
      promise = this.load(key, e.attempts, abort.signal);
    } catch (error) {
      promise = Promise.reject(error);
    }
    promise.then(
      (bitmap) => {
        if (this.disposed || this.entries.get(key) !== e) {
          bitmap.close(); // dropped while it was in flight (or the store is gone): never keep it
          this.pump();
          return;
        }
        e.abort = undefined;
        e.state = "ready";
        e.bitmap = bitmap;
        this.onReady(key);
        this.pump();
      },
      (error: unknown) => {
        if (this.disposed || this.entries.get(key) !== e) return;
        e.abort = undefined;
        e.error = error instanceof Error ? error.message : String(error);
        if (e.required && e.attempts < MAX_ATTEMPTS) {
          e.state = "retrying";
          e.cancelRetry = this.schedule(() => {
            e.cancelRetry = undefined;
            if (this.disposed || this.entries.get(key) !== e || e.state !== "retrying") return;
            e.state = "queued";
            this.pump();
          }, this.retryDelayMs);
          return;
        }
        e.state = "failed";
        if (e.required) {
          e.reported = true;
          this.onFail(key, e.error);
        } else this.onSpeculativeFail(key, e.error);
        this.pump();
      },
    );
  }

  /** Drop an entry that is no longer wanted: close its bitmap unless leased, cancel a pending retry, abort an in-flight load (a late arrival is closed on arrival). */
  private release(key: string, e: Entry<B>): void {
    if (e.leases > 0) return; // still in use: released when the lease ends
    if (e.bitmap) {
      e.bitmap.close();
      e.bitmap = null;
    }
    e.cancelRetry?.();
    e.cancelRetry = undefined;
    e.abort?.abort();
    e.abort = undefined;
    this.entries.delete(key);
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
        else if (!e.wanted) this.release(key, e);
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
      e.cancelRetry?.();
      e.abort?.abort();
      if (e.bitmap && e.leases === 0) e.bitmap.close();
      e.bitmap = null;
    }
    this.entries.clear();
  }
}
