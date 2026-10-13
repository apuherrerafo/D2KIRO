import { describe, expect, test } from "bun:test";
import { BitmapStore, type WantItem } from "./bitmap-store";
import { DEFAULT_STALL_MS } from "./motion-controller";
import { chunkKey, headClipId } from "./production-manifest";
import { nearestHeadPhase } from "./sequencer";
import { ANALYZING_LOOP, FRAME_MS as FRAME, FakeBitmap, HEAD_PREFIX, TRANSITION_TAIL, WATCHING_LOOP, flush, manualTimers, playN, rig, tickN } from "./test-support";

const head = (phase: number) => chunkKey("384", headClipId(HEAD_PREFIX, phase), 0);
const tail = (chunk: number) => chunkKey("384", TRANSITION_TAIL, chunk);
const watch = (chunk: number) => chunkKey("384", WATCHING_LOOP, chunk);
const req = (...keys: string[]): WantItem[] => keys.map((key) => ({ key, required: true }));
const spec = (...keys: string[]): WantItem[] => keys.map((key) => ({ key, required: false }));

/** A store over a loader the test settles by hand: `settle(key)` resolves, `reject(key, why)` fails the oldest pending attempt of that key. */
function handStore(opts: { maxSpeculativeInflight?: number } = {}) {
  const calls: Array<{ key: string; attempt: number; signal?: AbortSignal }> = [];
  const pending = new Map<string, Array<{ resolve: (b: FakeBitmap) => void; reject: (e: Error) => void }>>();
  const made: FakeBitmap[] = [];
  const timers = manualTimers();
  const store = new BitmapStore<FakeBitmap>(
    (key, attempt, signal) =>
      new Promise((resolve, reject) => {
        calls.push({ key, attempt, signal });
        pending.set(key, [...(pending.get(key) ?? []), { resolve, reject }]);
      }),
    { ...opts, retryDelayMs: 250, schedule: timers.schedule },
  );
  const fatal: string[] = [];
  const speculative: string[] = [];
  store.onFail = (k, e) => void fatal.push(`${k}: ${e}`);
  store.onSpeculativeFail = (k) => void speculative.push(k);
  const take = (key: string) => pending.get(key)!.shift()!;
  return {
    store, calls, made, timers, fatal, speculative,
    settle: async (key: string) => {
      const b = new FakeBitmap(key, 10, 10);
      made.push(b);
      take(key).resolve(b);
      await flush();
    },
    fail: async (key: string, why = "boom") => {
      take(key).reject(new Error(why));
      await flush();
    },
    started: () => calls.map((c) => c.key),
  };
}

describe("BitmapStore · priority queue", () => {
  test("loads start in the order of the want list; speculative ones wait behind a cap of 2 in flight", async () => {
    const h = handStore();
    h.store.want(spec("a", "b", "c", "d"));
    expect(h.started()).toEqual(["a", "b"]);
    await h.settle("a");
    expect(h.started()).toEqual(["a", "b", "c"]); // a slot freed: the next in priority order starts
    await h.settle("b");
    expect(h.started()).toEqual(["a", "b", "c", "d"]);
  });

  test("a required key starts at once even when the speculative cap is full, and jumps the queue of speculative ones", async () => {
    const h = handStore();
    h.store.want(spec("s1", "s2", "s3"));
    expect(h.started()).toEqual(["s1", "s2"]);
    h.store.want([...spec("s1", "s2", "s3"), ...req("r")]);
    expect(h.started()).toEqual(["s1", "s2", "r"]); // r did not wait for s1 / s2, and s3 is still queued behind the cap
    h.store.want([...req("r"), ...spec("s3", "s1", "s2")]); // re-prioritised: s3 first, but the cap is still full of s1 + s2
    expect(h.started()).toEqual(["s1", "s2", "r"]);
    await h.settle("s1");
    expect(h.started()).toEqual(["s1", "s2", "r", "s3"]);
  });

  test("a key that stops being wanted while in flight is aborted, frees its slot, and is closed when it lands anyway", async () => {
    const h = handStore();
    h.store.want(spec("a", "b", "c"));
    const a = h.calls[0];
    h.store.want(spec("b", "c"));
    expect(a.signal?.aborted).toBe(true);
    expect(h.started()).toEqual(["a", "b", "c"]); // c took a's slot
    await h.settle("a"); // an aborted fetch that still resolved
    expect(h.made[0].closed).toBe(1);
    expect(h.store.residency().keys).toEqual([]);
  });
});

describe("BitmapStore · one retry for a needed chunk, never a fatal speculative failure", () => {
  test("a required load that fails is retried once (attempt 2, after the retry delay) and then lands", async () => {
    const h = handStore();
    h.store.want(req("a"));
    await h.fail("a");
    expect(h.timers.live().map((t) => t.ms)).toEqual([250]);
    expect(h.started()).toEqual(["a"]); // not yet: the retry waits
    h.timers.fire(250);
    expect(h.calls.map((c) => [c.key, c.attempt])).toEqual([["a", 1], ["a", 2]]);
    await h.settle("a");
    expect(h.store.isReady("a")).toBe(true);
    expect(h.fatal).toEqual([]);
  });

  test("a required load that fails twice is fatal exactly once, however often it is asked for again", async () => {
    const h = handStore();
    h.store.want(req("a"));
    await h.fail("a", "first");
    h.timers.fire(250);
    await h.fail("a", "second");
    expect(h.fatal).toEqual(["a: second"]);
    h.store.want(req("a"));
    h.store.want(req("a"));
    expect(h.fatal).toHaveLength(1);
    expect(h.calls).toHaveLength(2); // no third attempt
  });

  test("a speculative failure is reported, never fatal, never retried on its own", async () => {
    const h = handStore();
    h.store.want(spec("h"));
    await h.fail("h");
    expect(h.speculative).toEqual(["h"]);
    expect(h.fatal).toEqual([]);
    expect(h.timers.live()).toHaveLength(0);
    h.store.want(spec("h")); // still wanted: still failed, no hammering
    h.store.want(spec("h"));
    expect(h.calls).toHaveLength(1);
  });

  test("a speculative key that failed and then becomes required gets its one retry, and is fatal only if that fails too", async () => {
    const h = handStore();
    h.store.want(spec("h"));
    await h.fail("h");
    h.store.want(req("h"));
    expect(h.calls.map((c) => [c.key, c.attempt])).toEqual([["h", 1], ["h", 2]]);
    await h.fail("h", "again");
    expect(h.fatal).toEqual(["h: again"]);
  });

  test("a pending retry is cancelled when the key is dropped, and when the store is disposed", async () => {
    const h = handStore();
    h.store.want(req("a", "b"));
    await h.fail("a");
    await h.fail("b");
    expect(h.timers.live()).toHaveLength(2);
    h.store.want(req("b")); // a dropped
    expect(h.timers.live()).toHaveLength(1);
    h.store.dispose();
    expect(h.timers.live()).toHaveLength(0);
    expect(h.calls).toHaveLength(2);
  });
});

describe("controller · mid-session failure", () => {
  test("a needed chunk that fails once is retried once and playback continues without a skipped frame", async () => {
    const r = rig();
    r.io.failOnce.add(watch(3));
    await flush();
    for (let i = 0; i < 60; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
      r.timers.fire(250); // the retry delay passes while the clock is held (a ~0.25 s hiccup)
      await flush();
    }
    expect(r.events.fail).toEqual([]);
    expect(r.ctl.status).toBe("ready");
    expect(r.io.attempts.filter(([k]) => k === watch(3)).map(([, a]) => a)).toEqual([1, 2]);
    const frames = r.paints.map((p) => p.frame);
    for (let i = 1; i < frames.length; i += 1) expect(frames[i]).toBe((frames[i - 1] + 1) % 252);
    expect(frames[frames.length - 1]).toBeGreaterThan(40);
  });

  test("a needed chunk that fails after its retry falls back to the static Coach: onFail once, no canvas write afterwards", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 5);
    r.io.failing.add(watch(3));
    for (let i = 0; i < 60; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
      r.timers.fire(250);
      await flush();
    }
    expect(r.events.fail).toHaveLength(1);
    expect(r.events.fail[0]).toContain(watch(3));
    expect(r.ctl.status).toBe("failed");
    const painted = r.paints.length;
    tickN(r.ctl, 20);
    expect(r.paints.length).toBe(painted);
    expect(r.ctl.residency().keys).toEqual([]); // every bitmap was released
    for (const b of r.io.made) expect(b.closed).toBe(1);
  });

  test("speculative failure is non-fatal: with every entry head failing, Motion V2 keeps playing WATCHING and the heads are not hammered", async () => {
    const r = rig();
    for (let p = 0; p < 252; p += 6) r.io.failing.add(head(p));
    await flush();
    await playN(r.ctl, 20);
    r.ctl.cue("analyzing");
    await flush();
    for (let i = 0; i < 40; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
      r.timers.fire(250); // would be a retry timer, if a head were ever retried
    }
    expect(r.ctl.status).toBe("ready");
    expect(r.events.fail).toEqual([]);
    expect(r.ctl.stats.speculativeFailures).toBeGreaterThan(0);
    for (const [k, attempt] of r.io.attempts) if (k.includes(HEAD_PREFIX)) expect(attempt).toBe(1);
    // and the loop is still alive underneath
    const w = r.paints.filter((p) => p.mode === "watching").map((p) => p.frame);
    for (let i = 1; i < w.length; i += 1) expect(w[i]).toBe((w[i - 1] + 1) % 252);
  });

  test("one failed head is stepped over: the neighbouring head takes the request within a stride and the transition completes", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 20);
    const upcoming = (r.ctl.shown!.frame + 1) % 252;
    r.io.failing.add(head(nearestHeadPhase(upcoming, 252, 6)));
    r.ctl.cue("analyzing");
    await flush();
    for (let i = 0; i < 10 + 35 + 10; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
    expect(r.ctl.status).toBe("ready");
    expect(r.ctl.shown!.mode).toBe("analyzing");
    expect(r.events.fail).toEqual([]);
  });

  test("the tail opening is required for a request: if it fails after its retry the player falls back instead of leaving a request unanswered", async () => {
    const r = rig();
    r.io.failing.add(tail(0));
    await flush();
    await playN(r.ctl, 10);
    r.ctl.cue("analyzing");
    await flush();
    r.timers.fire(250);
    await flush();
    expect(r.events.fail).toHaveLength(1);
    expect(r.events.fail[0]).toContain(TRANSITION_TAIL);
  });
});

describe("controller · stall watchdog", () => {
  test("a required chunk that never lands: the frame is held (never skipped, never frozen forever) and Motion V2 gives up after the budget", async () => {
    const r = rig({ stallMs: 2500 });
    await flush();
    await playN(r.ctl, 13); // last frame of chunk 0
    r.io.holds.add(watch(2));
    // chunk 1 is resident; make the player need chunk 2, which never lands
    for (let i = 0; i < 14; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
    const held = r.ctl.shown!.frame;
    expect(r.ctl.status).toBe("ready");
    for (let i = 0; i < 70; i += 1) r.ctl.tick(FRAME); // 2.3 s held
    expect(r.ctl.status).toBe("ready");
    expect(r.ctl.shown!.frame).toBe(held); // the held frame stays on screen
    for (let i = 0; i < 10; i += 1) r.ctl.tick(FRAME); // past 2.5 s
    expect(r.ctl.status).toBe("failed");
    expect(r.events.fail).toHaveLength(1);
    expect(r.events.fail[0]).toContain("stalled");
    expect(r.events.fail[0]).toContain(watch(2));
    const painted = r.paints.length;
    tickN(r.ctl, 10);
    expect(r.paints.length).toBe(painted); // no more canvas writes: the host shows the static Coach
  });

  test("a stall that resolves in time costs nothing, and the budget starts over for the next one", async () => {
    const r = rig({ stallMs: 2500 });
    await flush();
    await playN(r.ctl, 13);
    for (const round of [1, 2, 3]) {
      const next = (Math.floor(r.ctl.shown!.frame / 14) + 1) * 14; // first frame of the next chunk
      const key = watch(Math.floor((next + 14) / 14) % 18);
      r.io.holds.add(key);
      // play up to the boundary of the chunk whose successor is held
      let guard = 0;
      while (r.ctl.shown!.frame < next + 13 && guard++ < 200) {
        r.ctl.tick(FRAME);
        await flush();
      }
      for (let i = 0; i < 60; i += 1) r.ctl.tick(FRAME); // 2.0 s held, inside the budget
      expect(r.ctl.status, `round ${round}`).toBe("ready");
      r.io.release(key);
      await flush();
      await playN(r.ctl, 2);
    }
    expect(r.events.fail).toEqual([]);
  });

  test("a clock step is clamped: one huge tick (a long frame) counts for 100 ms, not for the whole gap", async () => {
    const r = rig({ stallMs: 2500 });
    await flush();
    await playN(r.ctl, 13);
    r.io.holds.add(watch(2));
    for (let i = 0; i < 14; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
    r.ctl.tick(60_000);
    expect(r.ctl.status).toBe("ready");
  });

  test("a loop switch whose first chunk never lands falls back after the budget (the previous picture stays until then)", async () => {
    const r = rig({ stallMs: 2000 });
    await flush();
    tickN(r.ctl, 12);
    const painted = r.paints.length;
    r.io.holds.add(chunkKey("384", ANALYZING_LOOP, 0));
    r.ctl.goTo("analyzing");
    for (let i = 0; i < 55; i += 1) r.ctl.tick(FRAME); // 1.8 s
    expect(r.ctl.status).toBe("ready");
    expect(r.paints.length).toBe(painted);
    for (let i = 0; i < 10; i += 1) r.ctl.tick(FRAME);
    expect(r.ctl.status).toBe("failed");
    expect(r.events.fail[0]).toContain("first frame of analyzing");
  });

  test("a request whose entry never decodes falls back after the budget, even though the loop keeps painting", async () => {
    const r = rig({ stallMs: 2000, hold: Array.from({ length: 42 }, (_, i) => head(i * 6)) });
    await flush();
    await playN(r.ctl, 10);
    r.ctl.cue("analyzing");
    await flush();
    for (let i = 0; i < 55; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
    expect(r.ctl.status).toBe("ready");
    for (let i = 0; i < 10; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
    expect(r.ctl.status).toBe("failed");
    expect(r.events.fail[0]).toContain("entry of watching>analyzing");
  });

  test("the default budget is inside the 2-3 s window", () => {
    expect(DEFAULT_STALL_MS).toBeGreaterThanOrEqual(2000);
    expect(DEFAULT_STALL_MS).toBeLessThanOrEqual(3000);
  });
});
