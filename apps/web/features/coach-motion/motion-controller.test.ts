import { describe, expect, test } from "bun:test";
import { BitmapStore } from "./bitmap-store";
import { chunkKey, headClipId } from "./production-manifest";
import { MotionSequencer, nearestHeadPhase } from "./sequencer";
import { ANALYZING_LOOP, FRAME_MS as FRAME, FakeBitmap, HEAD_PREFIX, TRANSITION_TAIL, WATCHING_LOOP, flush, playN, realManifest, rig, tickN, type Paint } from "./test-support";

const allHeads = (pack = "384") => Array.from({ length: 42 }, (_, i) => chunkKey(pack, headClipId(HEAD_PREFIX, i * 6), 0));

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
    tickN(r.ctl, 30); // one second of real time, NEXT still decoding (inside the stall budget)
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
    const r = rig({ hold: allHeads() });
    await flush();
    await playN(r.ctl, 20);
    const at = r.ctl.shown!.frame;
    expect(r.ctl.cue("analyzing")).toBe(true);
    const seen: Paint[] = [];
    for (let i = 0; i < 9; i += 1) {
      r.ctl.tick(FRAME);
      seen.push(r.paints[r.paints.length - 1]);
    }
    // while the head is missing the loop keeps playing (a valid visible state), and no transition frame is shown
    expect(seen.every((s) => s.clip === WATCHING_LOOP)).toBe(true);
    // release the head the planner will want for the next boundary (it is among the armed ones)
    const upcoming = (r.ctl.shown!.frame + 1) % 252;
    const phase = nearestHeadPhase(upcoming, 252, 6);
    const key = chunkKey("384", headClipId(HEAD_PREFIX, phase), 0);
    expect(r.io.requested).toContain(key);
    r.io.release(key);
    await flush();
    r.ctl.tick(FRAME);
    const first = r.paints[r.paints.length - 1];
    expect(first.clip).toBe(headClipId(HEAD_PREFIX, phase));
    expect(first.frame).toBe(0);
    expect(first.mode).toBe("transition");
    expect(at).toBeGreaterThan(0);
  });

  test("the transition plays head 0..9, tail 0..34, then ANALYZING from its frame 0, with no skipped opening frames", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 33);
    r.ctl.cue("analyzing");
    await flush(); // the armed entry head and tail opening decode (they were not resident while the cue was not pending)
    const startAt = r.paints.length;
    for (let i = 0; i < 10 + 35 + 5; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
    }
    const run = r.paints.slice(startAt);
    const head = run.slice(0, 10);
    expect(head.map((p) => p.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(head.map((p) => p.clip)).size).toBe(1);
    expect(head[0].clip.startsWith(HEAD_PREFIX)).toBe(true);
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
      x.ctl.cue("analyzing");
      await flush(); // the armed head decodes
      x.ctl.tick(FRAME);
      await flush();
      x.ctl.tick(FRAME); // a head that had not landed by the first boundary lands for the second
      expect(x.ctl.lastEntry, `lead ${lead}`).not.toBeNull();
      expect(x.ctl.lastEntry!.step).toBeLessThanOrEqual(3);
    }
    expect(r.ctl.lastEntry).toBeNull();
  });

  test("the semantic state follows the target as soon as the transition begins", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 5);
    r.ctl.cue("analyzing");
    await flush();
    await playN(r.ctl, 3);
    const t = r.paints.find((p) => p.mode === "transition");
    expect(t?.state).toBe("analyzing");
    expect(r.paints[0].state).toBe("watching");
  });
});

describe("residency · CURRENT + NEXT, previous released", () => {
  test("idle WATCHING holds CURRENT and NEXT only; moving on closes the rest", async () => {
    const r = rig();
    await flush();
    for (let i = 0; i < 252 + 20; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
      if (r.io.open.length > 2) throw new Error(`open: ${r.io.open.map((b) => b.key).join(", ")} @ ${r.ctl.shown?.frame}`);
    }
    expect(r.io.made.length - r.io.open.length).toBeGreaterThan(10); // earlier chunks were really closed
    for (const b of r.io.made) expect(b.closed).toBeLessThanOrEqual(1); // never closed twice
  });

  test("after the hand-off to ANALYZING the loop's chunks are the only ones held (CURRENT + NEXT)", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 10);
    r.ctl.cue("analyzing");
    for (let i = 0; i < 90; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
    }
    expect(r.ctl.shown!.state).toBe("analyzing");
    expect(r.ctl.shown!.mode).toBe("analyzing");
    const keys = r.ctl.residency().keys;
    expect(keys.length).toBeLessThanOrEqual(2);
    expect(keys.every((k) => k.includes(ANALYZING_LOOP))).toBe(true);
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
  const req = (...keys: string[]) => keys.map((key) => ({ key, required: true }));

  test("a leased bitmap is not closed when it stops being wanted; it is closed when the lease ends", async () => {
    const { store, made } = mk();
    store.want(req("a", "b"));
    await flush();
    const lease = store.lease("a")!;
    store.want(req("b"));
    expect(made.find((x) => x.key === "a")!.closed).toBe(0);
    lease.release();
    expect(made.find((x) => x.key === "a")!.closed).toBe(1);
    lease.release(); // idempotent
    expect(made.find((x) => x.key === "a")!.closed).toBe(1);
  });

  test("a decode that lands after its key was dropped is closed on arrival", async () => {
    const { store, made, holds } = mk();
    holds.set("late", () => {});
    store.want(req("late"));
    store.want([]);
    holds.get("late")!();
    await flush();
    expect(made).toHaveLength(1);
    expect(made[0].closed).toBe(1);
    expect(store.residency().keys).toEqual([]);
  });

  test("dispose closes everything not leased, once", async () => {
    const { store, made } = mk();
    store.want(req("a", "b", "c"));
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
    const r = rig({ fetchError: new Error("404") });
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

  test("a stale v3 manifest is rejected (a new player never reads old-shaped packs)", async () => {
    const r = rig({ manifest: { ...realManifest(), version: 3 } });
    await flush();
    expect(r.events.fail).toHaveLength(1);
    expect(r.events.fail[0]).toContain("expected 4");
  });

  test("first chunk fails to decode -> one retry, then fallback, never ready", async () => {
    const r = rig();
    const k0 = chunkKey("384", WATCHING_LOOP, 0);
    r.io.failing.add(k0);
    await flush();
    r.timers.fire(250); // the one retry
    await flush();
    r.ctl.tick(FRAME);
    expect(r.events.fail).toHaveLength(1);
    expect(r.events.fail[0]).toContain("decode failed");
    expect(r.io.attempts.filter(([k]) => k === k0)).toEqual([[k0, 1], [k0, 2]]);
    expect(r.paints).toHaveLength(0);
    expect(r.events.ready).toBe(0);
  });

  test("the first frame never arrives -> the timeout fails it and nothing is painted", async () => {
    const r = rig({ timeoutMs: 50, hold: [chunkKey("384", WATCHING_LOOP, 0)] });
    await flush();
    const t = r.timers.live().find((x) => x.ms === 50)!;
    expect(t).toBeDefined();
    t.fn();
    expect(r.events.fail).toEqual(["timeout waiting for the first Motion V2 frame"]);
    expect(r.paints).toHaveLength(0);
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
    expect(r.paints[painted]).toEqual({ clip: ANALYZING_LOOP, frame: 0, mode: "analyzing", state: "analyzing" }); // its frame 0 is the first thing painted
  });
});

describe("sequencer · direct", () => {
  test("a request from a loop with no such edge, or during a transition, is ignored", () => {
    const m = realManifest();
    const seq = new MotionSequencer(m, { ready: () => true }, "analyzing");
    expect(seq.request("watching")).toBe(false); // the real graph has only watching>analyzing
    expect(seq.pending).toBeNull();
    const w = new MotionSequencer(m, { ready: () => true }, "watching");
    expect(w.request("analyzing")).toBe(true);
    w.tick(FRAME * 2);
    expect(w.mode).toBe("transition");
    expect(w.request("analyzing")).toBe(false);
  });
});
