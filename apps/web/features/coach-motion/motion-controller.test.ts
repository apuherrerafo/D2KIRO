import { describe, expect, test } from "bun:test";
import { BitmapStore } from "./bitmap-store";
import { MotionController } from "./motion-controller";
import { ANALYZING_LOOP, TRANSITION_TAIL, WATCHING_LOOP, chunkKey, headClipId } from "./production-manifest";
import { MotionSequencer, nearestHeadPhase } from "./sequencer";
import { FakeBitmap, FakeLoader, fakeManifest, flush } from "./test-support";

const FRAME = 1000 / 30;
type Shown = { clip: string; frame: number; mode: string };

/** A controller on a synthetic pack. `paints` records every painted frame in order. */
function rig(opts: { scenario?: "watching" | "analyzing"; manifest?: unknown | Error; timeoutMs?: number } = {}) {
  const m = fakeManifest();
  const io = new FakeLoader(m);
  const paints: Shown[] = [];
  const events = { ready: 0, fail: [] as string[] };
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const ctl = new MotionController<FakeBitmap>({
    pack: m.pack,
    fetchManifest: () => (opts.manifest instanceof Error ? Promise.reject(opts.manifest) : Promise.resolve(opts.manifest ?? m)),
    makeLoad: () => io.load,
    paint: (_b, _m, _cell, shown) => void paints.push({ clip: shown.clip, frame: shown.frame, mode: shown.mode }),
    onReady: () => void (events.ready += 1),
    onFail: (r) => void events.fail.push(r),
    timeoutMs: opts.timeoutMs,
    schedule: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
  });
  ctl.start(opts.scenario ?? "watching");
  return { m, io, ctl, paints, events, timers };
}

const tickN = (ctl: { tick: (ms: number) => void }, n: number, ms = FRAME) => {
  for (let i = 0; i < n; i += 1) ctl.tick(ms);
};
/** Like tickN, but lets pending decodes land after every tick (what real time does between two rAF callbacks). */
const playN = async (ctl: { tick: (ms: number) => void }, n: number, ms = FRAME) => {
  for (let i = 0; i < n; i += 1) {
    ctl.tick(ms);
    await flush();
  }
};

describe("sequencer · continuity across chunks", () => {
  test("WATCHING plays every frame once, in order, across chunk boundaries and the loop seam", async () => {
    const r = rig();
    await flush();
    expect(r.events.ready).toBe(1);
    const n = r.m.clips[WATCHING_LOOP].frames;
    for (let i = 0; i < n + 40; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
    }
    const watch = r.paints.filter((p) => p.clip === WATCHING_LOOP).map((p) => p.frame);
    expect(watch.slice(0, 20)).toEqual(Array.from({ length: 20 }, (_, i) => i));
    expect(watch.length).toBe(n + 41); // first frame + one per tick
    for (let i = 1; i < watch.length; i += 1) expect(watch[i]).toBe((watch[i - 1] + 1) % n); // no duplicate, no skipped boundary frame
  });

  test("sub-frame time carries over: 20 ms ticks show frame k at k * 33.3 ms", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 50, 20); // 1000 ms
    expect(r.paints[r.paints.length - 1].frame).toBe(30);
  });
});

describe("delayed decode · the clock never advances onto an undecoded frame", () => {
  test("NEXT chunk late: the current frame is held, no frame is skipped, no time banks up", async () => {
    const r = rig();
    r.io.auto = false; // everything after this point decodes only when released
    await flush();
    // chunk 0 and 1 of the loop were requested at start; release chunk 0 only
    const k0 = chunkKey("384", WATCHING_LOOP, 0);
    const k1 = chunkKey("384", WATCHING_LOOP, 1);
    r.io.release(k0);
    await flush();
    expect(r.events.ready).toBe(1);
    // play to the last frame of chunk 0 (frame 13); chunk 1 was never released
    tickN(r.ctl, 13);
    expect(r.paints[r.paints.length - 1].frame).toBe(13);
    const before = r.paints.length;
    tickN(r.ctl, 30); // one second of real time, NEXT still decoding
    expect(r.paints.length).toBe(before); // nothing painted, nothing skipped
    expect(r.ctl.shown?.frame).toBe(13);
    r.io.release(k1);
    await flush();
    r.ctl.tick(FRAME);
    expect(r.paints[r.paints.length - 1].frame).toBe(14); // continues exactly where it held (not 14 + 30)
    r.ctl.tick(FRAME);
    expect(r.paints[r.paints.length - 1].frame).toBe(15);
  });

  test("a cue whose entry head is still decoding keeps WATCHING visible, then starts the transition at head frame 0", async () => {
    const r = rig();
    // every entry head decodes only when released (set before the pack's first requests go out)
    for (let i = 0; i < 42; i += 1) r.io.holds.add(chunkKey("384", headClipId(i * 6), 0));
    await flush();
    await playN(r.ctl, 20);
    const at = r.ctl.shown!.frame;
    r.ctl.cue();
    const seen: Shown[] = [];
    for (let i = 0; i < 9; i += 1) {
      r.ctl.tick(FRAME);
      seen.push(r.paints[r.paints.length - 1]);
    }
    // while the head is missing the loop keeps playing (a valid visible state), and no transition frame is shown
    expect(seen.every((s) => s.clip === WATCHING_LOOP)).toBe(true);
    // release the head the planner will want for the next boundary
    const upcoming = (r.ctl.shown!.frame + 1) % 252;
    const phase = nearestHeadPhase(upcoming, 252, 6);
    r.io.release(chunkKey("384", headClipId(phase), 0));
    await flush();
    r.ctl.tick(FRAME);
    const first = r.paints[r.paints.length - 1];
    expect(first.clip).toBe(headClipId(phase));
    expect(first.frame).toBe(0);
    expect(first.mode).toBe("transition");
    expect(at).toBeGreaterThan(0);
  });

  test("the transition plays head 0..9, tail 0..34, then ANALYZING from its frame 0, with no skipped opening frames", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 33);
    r.ctl.cue();
    const startAt = r.paints.length;
    for (let i = 0; i < 10 + 35 + 5; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
    }
    const run = r.paints.slice(startAt);
    const head = run.slice(0, 10);
    expect(head.map((p) => p.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(head.map((p) => p.clip)).size).toBe(1);
    expect(head[0].clip.startsWith("ENTRY_HEAD_")).toBe(true);
    expect(run.slice(10, 45).map((p) => `${p.clip}:${p.frame}`)).toEqual(Array.from({ length: 35 }, (_, i) => `${TRANSITION_TAIL}:${i}`));
    expect(run.slice(45).map((p) => `${p.clip}:${p.frame}`)).toEqual(Array.from({ length: 5 }, (_, i) => `${ANALYZING_LOOP}:${i}`));
  });

  test("the entry head is the nearest one: the pose step at the cue is at most half a stride", async () => {
    const r = rig();
    await flush();
    for (const lead of [0, 1, 2, 3, 4, 5, 6, 50, 101, 250]) {
      const x = rig();
      await flush();
      await playN(x.ctl, lead);
      x.ctl.cue();
      x.ctl.tick(FRAME);
      expect(x.ctl.lastEntry, `lead ${lead}`).not.toBeNull();
      expect(x.ctl.lastEntry!.step).toBeLessThanOrEqual(3);
    }
    expect(r.ctl.lastEntry).toBeNull();
  });
});

describe("residency · CURRENT + NEXT, previous released", () => {
  test("WATCHING holds CURRENT, NEXT, two entry heads and the first tail chunk; moving on closes the rest", async () => {
    const r = rig();
    await flush();
    for (let i = 0; i < 252 + 20; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
      if (r.io.open.length > 5) throw new Error(`open: ${r.io.open.map((b) => b.key).join(", ")} @ ${r.ctl.shown?.frame}`);
    }
    expect(r.io.made.length - r.io.open.length).toBeGreaterThan(10); // earlier chunks were really closed
    for (const b of r.io.made) expect(b.closed).toBeLessThanOrEqual(1); // never closed twice
  });

  test("after the hand-off to ANALYZING the loop's chunks are the only ones held (CURRENT + NEXT)", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 10);
    r.ctl.cue();
    for (let i = 0; i < 90; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
    }
    expect(r.ctl.shown!.mode).toBe("analyzing");
    const keys = r.ctl.residency().keys;
    expect(keys.length).toBeLessThanOrEqual(2);
    expect(keys.every((k) => k.includes(ANALYZING_LOOP))).toBe(true);
  });

  test("decoded bytes at 512 stay inside a stated budget", async () => {
    const m = fakeManifest("512", { w: 461, h: 472 });
    const io = new FakeLoader(m);
    const ctl = new MotionController<FakeBitmap>({ pack: "512", fetchManifest: async () => m, makeLoad: () => io.load, paint: () => {} });
    ctl.start();
    await flush();
    let peak = 0;
    for (let i = 0; i < 400; i += 1) {
      ctl.tick(FRAME + 0.01);
      await flush();
      peak = Math.max(peak, ctl.residency().bytes);
    }
    expect(peak).toBeLessThan(70 * 1024 * 1024);
  });
});

describe("BitmapStore ownership", () => {
  const mk = () => {
    const made: FakeBitmap[] = [];
    const holds = new Map<string, () => void>();
    const store = new BitmapStore<FakeBitmap>((key) => new Promise((res) => {
      const done = () => {
        const b = new FakeBitmap(key, 10, 10);
        made.push(b);
        res(b);
      };
      if (holds.has(key)) holds.set(key, done);
      else queueMicrotask(done);
    }));
    return { store, made, holds };
  };

  test("a leased bitmap is not closed when it stops being wanted; it is closed when the lease ends", async () => {
    const { store, made } = mk();
    store.want(["a", "b"]);
    await flush();
    const lease = store.lease("a")!;
    store.want(["b"]);
    expect(made.find((x) => x.key === "a")!.closed).toBe(0);
    lease.release();
    expect(made.find((x) => x.key === "a")!.closed).toBe(1);
    lease.release(); // idempotent
    expect(made.find((x) => x.key === "a")!.closed).toBe(1);
  });

  test("a decode that lands after its key was dropped is closed on arrival", async () => {
    const { store, made, holds } = mk();
    holds.set("late", () => {});
    store.want(["late"]);
    store.want([]);
    holds.get("late")!();
    await flush();
    expect(made).toHaveLength(1);
    expect(made[0].closed).toBe(1);
    expect(store.residency().keys).toEqual([]);
  });

  test("dispose closes everything not leased, once", async () => {
    const { store, made } = mk();
    store.want(["a", "b", "c"]);
    await flush();
    const lease = store.lease("c")!;
    store.dispose();
    expect(made.filter((b) => b.closed === 1).map((b) => b.key).sort()).toEqual(["a", "b"]);
    lease.release();
    expect(made.find((b) => b.key === "c")!.closed).toBe(1);
  });
});

describe("static fallback contract · Motion V2 failing never paints and reports once", () => {
  test("manifest fetch fails -> onFail once, no paint, no ready", async () => {
    const r = rig({ manifest: new Error("404") });
    await flush();
    r.ctl.tick(FRAME);
    expect(r.events.fail).toHaveLength(1);
    expect(r.paints).toHaveLength(0);
    expect(r.events.ready).toBe(0);
    expect(r.ctl.status).toBe("failed");
  });

  test("manifest is not a manifest -> fails without painting", async () => {
    const r = rig({ manifest: { version: 2 } });
    await flush();
    expect(r.events.fail).toHaveLength(1);
    expect(r.paints).toHaveLength(0);
  });

  test("first chunk fails to decode (AVIF decode error) -> fallback, never ready", async () => {
    const m = fakeManifest();
    const io = new FakeLoader(m);
    io.failing.add(chunkKey("384", WATCHING_LOOP, 0));
    const paints: number[] = [];
    const fails: string[] = [];
    const ctl = new MotionController<FakeBitmap>({ pack: "384", fetchManifest: async () => m, makeLoad: () => io.load, paint: () => void paints.push(1), onFail: (x) => void fails.push(x) });
    ctl.start();
    await flush();
    ctl.tick(FRAME);
    expect(fails).toHaveLength(1);
    expect(fails[0]).toContain("decode failed");
    expect(paints).toHaveLength(0);
  });

  test("the first frame never arrives -> the timeout fails it and nothing is painted", async () => {
    const r = rig();
    r.io.auto = false;
    const m2 = rig({ timeoutMs: 50 });
    m2.io.auto = false;
    await flush();
    const t = m2.timers.find((x) => x.live)!;
    expect(t.ms).toBe(50);
    t.fn();
    expect(m2.events.fail).toEqual(["timeout waiting for the first Motion V2 frame"]);
    expect(m2.paints).toHaveLength(0);
  });

  test("a chunk that fails mid-play stops the player (the host then shows the static Coach)", async () => {
    const r = rig();
    await flush();
    r.io.failing.add(chunkKey("384", WATCHING_LOOP, 2));
    tickN(r.ctl, 5);
    for (let i = 0; i < 60; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
    expect(r.events.fail).toHaveLength(1);
    const painted = r.paints.length;
    tickN(r.ctl, 20);
    expect(r.paints.length).toBe(painted); // stopped: no more canvas writes
  });

  test("goTo() while the new loop's chunk is still decoding keeps the previous picture and paints nothing", async () => {
    const r = rig();
    await flush();
    tickN(r.ctl, 12);
    const painted = r.paints.length;
    r.io.auto = false;
    r.ctl.goTo("analyzing");
    tickN(r.ctl, 20);
    expect(r.paints.length).toBe(painted);
    r.io.release(chunkKey("384", ANALYZING_LOOP, 0));
    await flush();
    expect(r.paints[painted]).toEqual({ clip: ANALYZING_LOOP, frame: 0, mode: "analyzing" }); // its frame 0 is the first thing painted
  });
});

describe("sequencer · direct", () => {
  test("a cue during the transition or in ANALYZING is ignored", () => {
    const m = fakeManifest();
    const seq = new MotionSequencer(m, { ready: () => true });
    seq.start("analyzing");
    seq.cue();
    expect(seq.cuePending).toBe(false);
  });
});
