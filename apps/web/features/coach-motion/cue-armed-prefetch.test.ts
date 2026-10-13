import { describe, expect, test } from "bun:test";
import { chunkKey, headClipId } from "./production-manifest";
import { nearestHeadPhase } from "./sequencer";
import { ANALYZING_LOOP, FRAME_MS as FRAME, HEAD_PREFIX, TRANSITION_TAIL, WATCHING_LOOP, flush, playN, rig, tickN } from "./test-support";

const head = (phase: number) => chunkKey("384", headClipId(HEAD_PREFIX, phase), 0);
const tail = (chunk: number) => chunkKey("384", TRANSITION_TAIL, chunk);

describe("cue-armed prefetch · nothing about a transition is touched until one is requested", () => {
  test("idle WATCHING over three loop passes requests no entry head and no tail chunk", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 252 * 3);
    expect(r.io.count(HEAD_PREFIX)).toBe(0);
    expect(r.io.count(TRANSITION_TAIL)).toBe(0);
    expect(r.io.count(ANALYZING_LOOP)).toBe(0);
    expect(r.io.requested.every((k) => k.includes(WATCHING_LOOP))).toBe(true);
  });

  test("duplicate loop passes cause no extra fetch or decode: only the loop's own 18 chunks, once per pass, never two copies resident", async () => {
    const r = rig();
    await flush();
    for (let i = 0; i < 252 * 3; i += 1) {
      r.ctl.tick(FRAME + 0.01);
      await flush();
      const keys = r.io.open.map((b) => b.key);
      expect(new Set(keys).size).toBe(keys.length); // a key is never decoded twice while it is resident
    }
    // 3 passes x 18 chunks, plus the two chunks (current + next) the player already holds for the pass that is starting
    expect(r.io.made.length).toBeGreaterThanOrEqual(18 * 3);
    expect(r.io.made.length).toBeLessThanOrEqual(18 * 3 + 2);
    expect(r.ctl.stats.loads).toBe(r.io.requested.length);
  });

  test("a request arms exactly the nearest entry head, the tail opening and one hedge head", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 100);
    const upcoming = (r.ctl.shown!.frame + 1) % 252;
    const mark = r.io.requested.length;
    expect(r.ctl.cue("analyzing")).toBe(true);
    await flush();
    const armed = r.io.requested.slice(mark);
    const nearest = nearestHeadPhase(upcoming, 252, 6);
    const hedge = nearestHeadPhase((upcoming + 6) % 252, 252, 6);
    expect(armed.filter((k) => k.includes(HEAD_PREFIX)).sort()).toEqual([head(nearest), head(hedge)].sort());
    expect(armed.filter((k) => k.includes(TRANSITION_TAIL))).toEqual([tail(0)]);
    expect(armed).toHaveLength(3);
    // the request is taken at the next boundary and the whole armed set is used or released: nothing else was ever touched
    await playN(r.ctl, 60);
    expect(new Set(r.io.requested.slice(mark).filter((k) => k.includes(HEAD_PREFIX))).size).toBeLessThanOrEqual(3);
    expect(r.io.count("analyzing-")).toBe(0); // no destination chunk before the transition has begun
  });

  test("priority order at the cue: nearest head, then the tail opening, then the hedge head", async () => {
    const r = rig({ hold: [head(0), head(6), head(12), tail(0)] });
    await flush();
    await playN(r.ctl, 3); // frame 3 -> upcoming 4 -> nearest head 6, hedge 12
    const mark = r.io.requested.length;
    r.ctl.cue("analyzing");
    await flush();
    expect(r.io.requested.slice(mark)).toEqual([head(6), tail(0), head(12)]);
  });
});

describe("slow loaders · deterministic, nothing is skipped and nothing freezes mid-transition because a low-priority load won the race", () => {
  const rolling = async (r: ReturnType<typeof rig>, n: number) => {
    for (let i = 0; i < n; i += 1) {
      r.ctl.tick(FRAME);
      await flush();
    }
  };

  test("slow entry head: WATCHING keeps playing in order, then the transition starts at head frame 0 once it lands", async () => {
    const heads = Array.from({ length: 42 }, (_, i) => head(i * 6));
    const r = rig({ hold: heads });
    await flush();
    await playN(r.ctl, 20);
    r.ctl.cue("analyzing");
    await rolling(r, 30); // ~1 s of a slow head decode (inside the stall budget)
    const watch = r.paints.filter((p) => p.mode === "watching").map((p) => p.frame);
    for (let i = 1; i < watch.length; i += 1) expect(watch[i]).toBe((watch[i - 1] + 1) % 252);
    expect(r.paints.some((p) => p.mode === "transition")).toBe(false);
    const upcoming = (r.ctl.shown!.frame + 1) % 252;
    const phase = nearestHeadPhase(upcoming, 252, 6);
    r.io.release(head(phase));
    await flush();
    r.ctl.tick(FRAME);
    expect(r.paints[r.paints.length - 1]).toMatchObject({ clip: headClipId(HEAD_PREFIX, phase), frame: 0, mode: "transition" });
    expect(r.events.fail).toEqual([]);
  });

  test("slow tail opening: the request is NOT taken until the tail's first chunk is decoded, so the transition never starts to freeze", async () => {
    const r = rig({ hold: [tail(0)] });
    await flush();
    await playN(r.ctl, 20);
    r.ctl.cue("analyzing");
    await rolling(r, 36); // 1.2 s: the head has long landed, the tail has not
    expect(r.paints.some((p) => p.mode === "transition")).toBe(false);
    expect(r.ctl.pendingEdge).toBe("watching>analyzing");
    r.io.release(tail(0));
    await flush();
    await rolling(r, 12);
    expect(r.paints.filter((p) => p.mode === "transition").length).toBeGreaterThanOrEqual(10);
    expect(r.events.fail).toEqual([]);
  });

  test("slow tail chunk 1: the clock holds on tail frame 13, nothing is skipped, and it resumes at frame 14", async () => {
    const r = rig({ hold: [tail(1)] });
    await flush();
    await playN(r.ctl, 20);
    r.ctl.cue("analyzing");
    await flush();
    await rolling(r, 10 + 14 + 30); // head, tail chunk 0, then 1 s waiting on chunk 1
    const last = r.paints[r.paints.length - 1];
    expect(last).toMatchObject({ clip: TRANSITION_TAIL, frame: 13 });
    const before = r.paints.length;
    await rolling(r, 20);
    expect(r.paints.length).toBe(before);
    r.io.release(tail(1));
    await flush();
    r.ctl.tick(FRAME);
    expect(r.paints[r.paints.length - 1]).toMatchObject({ clip: TRANSITION_TAIL, frame: 14 });
    expect(r.events.fail).toEqual([]);
  });

  test("slow destination loop: the tail plays to its last frame, holds, and ANALYZING starts at frame 0 when it lands", async () => {
    const r = rig({ hold: [chunkKey("384", ANALYZING_LOOP, 0)] });
    await flush();
    await playN(r.ctl, 20);
    r.ctl.cue("analyzing");
    await flush();
    await rolling(r, 10 + 35 + 30);
    expect(r.paints[r.paints.length - 1]).toMatchObject({ clip: TRANSITION_TAIL, frame: 34 });
    r.io.release(chunkKey("384", ANALYZING_LOOP, 0));
    await flush();
    r.ctl.tick(FRAME);
    expect(r.paints[r.paints.length - 1]).toMatchObject({ clip: ANALYZING_LOOP, frame: 0, mode: "analyzing", state: "analyzing" });
    expect(r.events.fail).toEqual([]);
  });

  test("a slow low-priority hedge head never delays a required load: required chunks start immediately even when the speculative cap is full", async () => {
    // both armed heads held (speculative, cap 2 in flight); the tail opening is required and must still be requested at once
    const r = rig({ hold: Array.from({ length: 42 }, (_, i) => head(i * 6)) });
    await flush();
    await playN(r.ctl, 20);
    const mark = r.io.requested.length;
    r.ctl.cue("analyzing");
    await flush();
    expect(r.io.requested.slice(mark).filter((k) => k.includes(TRANSITION_TAIL))).toEqual([tail(0)]);
    expect(r.ctl.residency().keys).toContain(tail(0));
  });
});

describe("transition lead time · what the transition needs is requested well before it is shown", () => {
  test("every chunk of the transition is requested at least 24 frames (0.8 s) before its first frame, the tail opening before the transition even starts", async () => {
    const r = rig();
    let now = 0;
    const at = new Map<string, number>();
    const inner = r.io.load;
    r.io.load = (key, attempt) => {
      if (!at.has(key)) at.set(key, now);
      return inner(key, attempt);
    };
    await flush();
    for (let i = 0; i < 40; i += 1) {
      now += 1;
      r.ctl.tick(FRAME);
      await flush();
    }
    now += 1;
    r.ctl.cue("analyzing");
    const cueAt = now;
    await flush();
    const firstUse = new Map<string, number>();
    for (let i = 0; i < 10 + 35 + 20; i += 1) {
      now += 1;
      r.ctl.tick(FRAME);
      const s = r.ctl.shown!;
      if (s.clip === TRANSITION_TAIL || s.clip === ANALYZING_LOOP || s.clip.startsWith(HEAD_PREFIX)) {
        const key = chunkKey("384", s.clip, Math.floor(s.frame / 14));
        if (!firstUse.has(key)) firstUse.set(key, now);
      }
      await flush();
    }
    const lead = (key: string) => firstUse.get(key)! - at.get(key)!;
    expect(lead(tail(0))).toBeGreaterThanOrEqual(10); // requested at the cue, used after the 10 head frames (and the frames until the head was taken)
    expect(at.get(tail(0))!).toBe(cueAt);
    expect(lead(tail(1))).toBeGreaterThanOrEqual(24);
    expect(lead(tail(2))).toBeGreaterThanOrEqual(24);
    expect(lead(chunkKey("384", ANALYZING_LOOP, 0))).toBeGreaterThanOrEqual(24);
  });
});

describe("hidden / off-screen / paused · the controller is only driven while the player is active", () => {
  test("no ticks, no work: a pending request and a held chunk neither load more nor fail while nothing ticks", async () => {
    const r = rig({ hold: [tail(0)] });
    await flush();
    await playN(r.ctl, 10);
    r.ctl.cue("analyzing");
    await flush();
    const loads = r.ctl.stats.loads;
    // (the player stops calling tick() when hidden / off-screen / paused; hours may pass)
    await flush();
    expect(r.ctl.stats.loads).toBe(loads);
    expect(r.ctl.status).toBe("ready");
    expect(r.events.fail).toEqual([]);
    tickN(r.ctl, 3); // and it resumes cleanly
    expect(r.ctl.status).toBe("ready");
  });
});
