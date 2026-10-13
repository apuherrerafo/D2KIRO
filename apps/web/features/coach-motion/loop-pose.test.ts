import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { statePose } from "../hero-loop/coach/motion";
import { ANALYZE_AIM, ANALYZE_FRAMES, CONFIRM_FRAMES, FPS, HEAD_FRAMES, LOOP_DEFS, POINT_FRAMES, SNAPPED, TAIL_FRAMES, WATCH_AIM, WATCH_FRAMES, analyzingBase, confirmingBase, headPhases, jobPoses, pointingBase, poseDistance, watchingBase, type Job } from "./loop-pose";
import { authoringGraph } from "./test-support";

const graph = authoringGraph();
const loop = (id: string) => jobPoses({ kind: "loop", loop: id });
const watching = loop("watching");
const analyzing = loop("analyzing");
const pointing = loop("pointing");
const confirming = loop("confirming");
const range = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];
const stepsOf = (track: ReturnType<typeof loop>) => track.slice(1).map((p, i) => poseDistance(p, track[i]));

/** The jobs of one graph edge exactly as capture.mjs derives them (continuity parameters come from the edge). */
const edgeJobs = (id: string) => {
  const e = graph.edges.find((x) => x.id === id)!;
  const shared = { edge: e.id, from: e.from, to: e.to, headFrames: e.entry.headFrames, tailFrames: e.tail.frames };
  const tail = jobPoses({ kind: "tail", ...shared });
  const head = (phase: number) => jobPoses({ kind: "head", ...shared, phase });
  return { e, tail, head, phases: headPhases(graph.loops[e.from].frames, e.entry.stride) };
};
const WA = "watching>analyzing";

describe("authored loop poses", () => {
  test("frame counts: every loop has the length graph.json says, edges the head / tail lengths graph.json says", () => {
    for (const [id, l] of Object.entries(graph.loops)) {
      expect(LOOP_DEFS[id].frames, id).toBe(l.frames);
      expect(loop(id), id).toHaveLength(l.frames);
    }
    expect([WATCH_FRAMES, ANALYZE_FRAMES, POINT_FRAMES, CONFIRM_FRAMES]).toEqual([252, 210, 112, 112]);
    for (const e of graph.edges) {
      const j = edgeJobs(e.id);
      expect(j.head(0), e.id).toHaveLength(e.entry.headFrames);
      expect(j.tail, e.id).toHaveLength(e.tail.frames);
    }
    expect(edgeJobs(WA).head(0)).toHaveLength(HEAD_FRAMES);
    expect(edgeJobs(WA).tail).toHaveLength(TAIL_FRAMES);
  });

  test("every loop closes: the step across the seam is an ordinary step, and the authored base is periodic in the loop length", () => {
    const bases = { watching: watchingBase, analyzing: analyzingBase, pointing: pointingBase, confirming: confirmingBase };
    for (const [name, base] of Object.entries(bases)) {
      const track = loop(name);
      const seamStep = poseDistance(track[track.length - 1], track[0]);
      const biggest = Math.max(...stepsOf(track));
      expect(seamStep, name).toBeLessThanOrEqual(biggest);
      const t = track.length / FPS;
      expect(poseDistance(base(t), base(0)), name).toBeLessThan(1e-6);
    }
  });

  test("ANALYZING ring turns one way, one revolution, never reverses", () => {
    const spin = analyzing.map((p) => p.shardSpin);
    for (let i = 1; i < spin.length; i += 1) expect(spin[i]).toBeGreaterThan(spin[i - 1]);
    expect(analyzingBase(ANALYZE_FRAMES / FPS).shardSpin - analyzingBase(0).shardSpin).toBeCloseTo(Math.PI * 2, 9);
  });

  test("WATCHING has two real blinks, nowhere near the seam", () => {
    const open = watching.map((p) => p.eyeOpen);
    expect(Math.min(...open)).toBeLessThan(0.4);
    const blinks = open.reduce((n, v, i) => n + (v < 0.9 && (i === 0 || open[i - 1] >= 0.9) ? 1 : 0), 0);
    expect(blinks).toBe(graph.loops.watching.blinks!);
    expect(open[0]).toBeGreaterThan(0.99);
    expect(open[open.length - 1]).toBeGreaterThan(0.99);
  });

  test("the blinks graph.json declares are the blinks the tracks hold (guards.py checks the same counts on the rendered frames)", () => {
    for (const [id, l] of Object.entries(graph.loops)) {
      if (l.blinks === undefined) continue;
      const open = loop(id).map((p) => p.eyeOpen);
      const blinks = open.reduce((n, v, i) => n + (v < 0.9 && (i === 0 || open[i - 1] >= 0.9) ? 1 : 0), 0);
      expect(blinks, id).toBe(l.blinks);
    }
  });

  test("a held state never freezes: some pose term moves in every 500 ms window", () => {
    for (const track of [watching, analyzing, pointing, confirming]) {
      for (let i = 0; i + 15 < track.length; i += 1) {
        let moved = 0;
        for (let j = i; j < i + 15; j += 1) moved += poseDistance(track[j + 1] ?? track[0], track[j]);
        expect(moved).toBeGreaterThan(0.2);
      }
    }
  });

  test("snapped amplitudes equal the Live's: only the time parameters changed", () => {
    // Live reference over a long free-running clock (aim as the cue sends it)
    const live = (state: "watching" | "analyzing", aim: typeof WATCH_AIM) => {
      const xs = Array.from({ length: 12000 }, (_, i) => statePose(state, i / 100, i / 100, aim));
      return (k: keyof (typeof xs)[number]) => range(xs.map((p) => p[k]));
    };
    const lw = live("watching", WATCH_AIM);
    const wBase = Array.from({ length: 840 }, (_, i) => watchingBase(i / 100));
    expect(range(wBase.map((p) => p.yaw))[1]).toBeCloseTo(lw("yaw")[1], 2);
    expect(range(wBase.map((p) => p.pitch))[1]).toBeCloseTo(lw("pitch")[1], 2);
    expect(range(wBase.map((p) => p.squash))[1]).toBeCloseTo(lw("squash")[1], 2);
    expect(range(wBase.map((p) => p.eyeOpen))[0]).toBeCloseTo(lw("eyeOpen")[0], 1);
    const la = live("analyzing", ANALYZE_AIM);
    const aBase = Array.from({ length: 700 }, (_, i) => analyzingBase(i / 100));
    for (const k of ["yaw", "eyeX", "eyeZ", "shardRadius"] as const) {
      const [lo, hi] = range(aBase.map((p) => p[k]));
      expect(lo).toBeGreaterThanOrEqual(la(k)[0] - 1e-3);
      expect(hi).toBeLessThanOrEqual(la(k)[1] + 1e-3);
      expect(hi - lo).toBeGreaterThan((la(k)[1] - la(k)[0]) * 0.8);
    }
    // the audit table: the two slowest WATCHING sways (peak 1.7 deg / 0.7 deg after amplitude damping) get faster, 0.45 -> 0.75 and 0.31 -> 0.75 rad/s;
    // the WATCHING breath (0.8 % squash) 1.1 -> 1.5 rad/s; every other snapped component moved at most 16 %, the ANALYZING ring spin 0.3 %
    const slow = new Set([SNAPPED.watching.yaw, SNAPPED.watching.pitch]);
    for (const group of Object.values(SNAPPED)) for (const f of Object.values(group)) expect(Math.abs(f.loop / f.live - 1)).toBeLessThan(slow.has(f as never) ? 1.5 : f === SNAPPED.watching.squash ? 0.4 : 0.16);
    expect(Math.abs(SNAPPED.analyzing.spin.loop / SNAPPED.analyzing.spin.live - 1)).toBeLessThan(0.005);
  });
});

describe("POINTING and CONFIRMING · the Live grammar, restrained", () => {
  const settledLive = (state: "pointing" | "confirming") => statePose(state, 60, 0, ANALYZE_AIM);

  test("POINTING is directional: the body and the eyes turn to the aim, further than any other state, with a touch of lean and the ring held", () => {
    const yaw = pointing.map((p) => p.yaw);
    const live = settledLive("pointing");
    // the authored (amplitude-damped) pose stays on the Live pointing pose
    expect(range(yaw)[0]).toBeGreaterThan(0.9 * LOOP_DEFS.pointing.amplitude * live.yaw - 0.04);
    expect(range(yaw)[1]).toBeLessThan(live.yaw + 0.04);
    expect(Math.min(...yaw)).toBeGreaterThan(Math.max(...analyzing.map((p) => p.yaw), ...watching.map((p) => p.yaw), ...confirming.map((p) => p.yaw)));
    expect(Math.min(...pointing.map((p) => p.eyeX))).toBeGreaterThan(0.17); // eyes lead, inside the visor limit (0.24)
    expect(Math.max(...pointing.map((p) => p.eyeX))).toBeLessThanOrEqual(0.24);
    expect(Math.min(...pointing.map((p) => p.lean))).toBeGreaterThan(0.02);
    const [spinLo, spinHi] = range(pointing.map((p) => p.shardSpin));
    expect(spinHi - spinLo).toBeLessThan(0.25); // a held ring, not a spinning one
  });

  test("POINTING is not celebratory or theatrical: no bounce, no nod, no blink, no ring burst, a calm sway", () => {
    expect(Math.max(...pointing.map((p) => Math.abs(p.squash - 1)))).toBeLessThan(0.01);
    expect(Math.max(...pointing.map((p) => Math.abs(p.pitch)))).toBeLessThan(0.08);
    expect(Math.min(...pointing.map((p) => p.eyeOpen))).toBe(1);
    expect(Math.max(...pointing.map((p) => Math.abs(p.shardRadius - 1)))).toBeLessThan(0.01);
    expect(Math.max(...stepsOf(pointing))).toBeLessThan(0.5); // never faster than a slow sway
  });

  test("CONFIRMING is resolution, not victory: head nearly front, eyes locked on the aim, ring drawn in, one blink, tiny breath", () => {
    const yaw = confirming.map((p) => p.yaw);
    expect(Math.max(...yaw)).toBeLessThan(0.15); // the head comes back to front (POINTING turned 0.5+)
    expect(Math.max(...yaw)).toBeLessThan(Math.min(...pointing.map((p) => p.yaw)) / 2);
    expect(Math.min(...confirming.map((p) => p.eyeX))).toBeGreaterThan(0.15); // TETHER: the eyes lock on the link
    expect(Math.max(...confirming.map((p) => p.shardRadius))).toBeLessThan(0.99); // ring tightened
    expect(Math.max(...confirming.map((p) => Math.abs(p.squash - 1)))).toBeLessThan(0.01);
    expect(Math.max(...confirming.map((p) => Math.abs(p.pitch)))).toBeLessThan(0.05);
    const open = confirming.map((p) => p.eyeOpen);
    expect(Math.min(...open)).toBeLessThan(0.4);
    expect(open.filter((v) => v < 0.9).length).toBeLessThanOrEqual(5); // one 140 ms blink
  });

  test("the nod belongs to the ENTRY into CONFIRMING (pc edge): the head dips, the body squashes a little, the eyes narrow, then everything closes on the loop", () => {
    const { head, tail } = edgeJobs("pointing>confirming");
    const run = [...head(0), ...tail];
    const loopPitch = Math.max(...confirming.map((p) => Math.abs(p.pitch)));
    expect(Math.min(...run.map((p) => p.pitch))).toBeLessThan(-0.08);
    expect(Math.min(...run.map((p) => p.pitch))).toBeLessThan(-loopPitch);
    expect(Math.min(...run.map((p) => p.squash))).toBeLessThan(0.99);
    expect(Math.min(...run.map((p) => p.squash))).toBeGreaterThan(0.93); // a small settle, not a bounce
    expect(Math.min(...run.map((p) => p.eyeOpen))).toBeLessThan(0.7);
    expect(Math.min(...run.map((p) => p.eyeOpen))).toBeGreaterThan(0.3);
    // and it is gone before the tail ends
    const end = tail[tail.length - 1];
    expect(poseDistance(end, confirming[0])).toBeLessThan(Math.max(...stepsOf(confirming)) * 0.5);
  });
});

describe("transitions are computed from the graph's edges, for every edge", () => {
  test("every entry head of every edge starts on the pure pose of its source-loop phase (the frame it replaces)", () => {
    for (const e of graph.edges) {
      const { head, phases } = edgeJobs(e.id);
      const src = loop(e.from);
      for (const p of phases) expect(poseDistance(head(p)[0], src[p]), `${e.id} phase ${p}`).toBeLessThan(1e-6);
    }
  });

  test("heads sit on each edge's own stride grid and cover the whole source loop", () => {
    for (const e of graph.edges) {
      const { phases } = edgeJobs(e.id);
      const n = graph.loops[e.from].frames;
      expect(phases, e.id).toHaveLength(Math.ceil(n / e.entry.stride));
      expect(phases[0]).toBe(0);
      expect(phases[phases.length - 1]).toBeLessThan(n);
      expect(phases[phases.length - 1]).toBeGreaterThanOrEqual(n - e.entry.stride);
    }
    expect(edgeJobs(WA).phases).toHaveLength(WATCH_FRAMES / 6);
  });

  test("a head splices into its edge's shared tail with a normal step, from any entry phase", () => {
    for (const e of graph.edges) {
      const { tail, head, phases } = edgeJobs(e.id);
      // a head ends inside the SOURCE loop's motion: the seam may be as large as that loop's ordinary step (ANALYZING spins at ~3.4 per frame)
      const limit = Math.max(Math.max(...stepsOf(tail)), Math.max(...stepsOf(loop(e.from)))) * 1.25;
      for (const p of phases) {
        const h = head(p);
        expect(poseDistance(tail[0], h[h.length - 1]), `${e.id} phase ${p}`).toBeLessThanOrEqual(limit);
      }
    }
  });

  test("a tail closes on the destination loop: the step into its enter frame is an ordinary step of that loop", () => {
    for (const e of graph.edges) {
      const { tail } = edgeJobs(e.id);
      const dest = loop(e.to);
      const ordinary = Math.max(...stepsOf(dest));
      expect(poseDistance(dest[e.tail.enterFrame], tail[tail.length - 1]), e.id).toBeLessThanOrEqual(ordinary * 1.5);
    }
  });

  test("the WATCHING -> ANALYZING transition really passes through intermediate poses and ends on the ANALYZING loop", () => {
    const { head, tail } = edgeJobs(WA);
    const run = [...head(0), ...tail];
    expect(run).toHaveLength(HEAD_FRAMES + TAIL_FRAMES);
    // monotone-ish departure from the watching eye state: eyes narrow to 0.8 through intermediate values
    const eyes = run.map((p) => p.eyeOpen);
    expect(eyes.some((e) => e > 0.82 && e < 0.99)).toBe(true);
    const end = run[run.length - 1];
    const loopStep = Math.max(...stepsOf(analyzing));
    expect(poseDistance(analyzing[0], end)).toBeLessThanOrEqual(loopStep * 1.5);
  });

  test("the ring never whirls backwards into an ANALYZING loop, and settles by the short way into the others (never more than half a turn)", () => {
    for (const e of graph.edges) {
      const { head, phases } = edgeJobs(e.id);
      for (const p of phases) {
        const spin = head(p).map((q) => q.shardSpin);
        const travel = spin[spin.length - 1] - spin[0];
        if (LOOP_DEFS[e.to].spin === "forward") expect(travel, `${e.id} phase ${p}`).toBeGreaterThan(-0.7);
        else expect(Math.abs(travel), `${e.id} phase ${p}`).toBeLessThanOrEqual(Math.PI + 0.5);
      }
    }
  });

  test("the approved WATCHING -> ANALYZING poses are bit-identical to the ones the committed pack was rendered from (fingerprint of both loops, the tail and all 42 heads)", () => {
    const all: Record<string, unknown> = { watching, analyzing, tail: edgeJobs(WA).tail };
    for (const p of edgeJobs(WA).phases) all[`head-${p}`] = edgeJobs(WA).head(p);
    // sha256 of JSON.stringify(all) taken from the pre-generalisation jobPoses (one commit earlier); the pack was rendered from exactly these poses
    expect(createHash("sha256").update(JSON.stringify(all)).digest("hex")).toBe("bb92e0eecc925db1f03d8d5641488349012dd912f99cb70a0939fe74f861e736");
  });
});

describe("jobs are plain data (they travel from graph.json to the capture page)", () => {
  test("a job round-trips through JSON and an unknown loop is an error naming it", () => {
    const j: Job = { kind: "head", edge: "pointing>confirming", from: "pointing", to: "confirming", phase: 9, headFrames: 10, tailFrames: 35 };
    expect(jobPoses(JSON.parse(JSON.stringify(j)) as Job)).toEqual(jobPoses(j));
    expect(() => jobPoses({ kind: "loop", loop: "nowhere" })).toThrow(/no pose definition for loop "nowhere"/);
  });
});
