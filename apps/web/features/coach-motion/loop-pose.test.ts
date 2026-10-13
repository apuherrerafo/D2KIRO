import { describe, expect, test } from "bun:test";
import { statePose } from "../hero-loop/coach/motion";
import { ANALYZE_AIM, ANALYZE_FRAMES, FPS, HEAD_FRAMES, SNAPPED, TAIL_FRAMES, WATCH_AIM, WATCH_FRAMES, analyzingBase, headPhases, jobPoses, poseDistance, watchingBase } from "./loop-pose";

const watching = jobPoses({ kind: "watching" });
const analyzing = jobPoses({ kind: "analyzing" });
const range = (xs: number[]) => [Math.min(...xs), Math.max(...xs)];

describe("authored loop poses", () => {
  test("frame counts", () => {
    expect(watching).toHaveLength(WATCH_FRAMES);
    expect(analyzing).toHaveLength(ANALYZE_FRAMES);
    expect(jobPoses({ kind: "head", phase: 42 })).toHaveLength(HEAD_FRAMES);
    expect(jobPoses({ kind: "tail" })).toHaveLength(TAIL_FRAMES);
  });

  test("both loops close: the step across the seam is an ordinary step", () => {
    for (const [name, track, base] of [["watching", watching, watchingBase], ["analyzing", analyzing, analyzingBase]] as const) {
      const seamStep = poseDistance(track[track.length - 1], track[0]);
      const steps = track.slice(1).map((p, i) => poseDistance(p, track[i]));
      const biggest = Math.max(...steps);
      expect(seamStep, name).toBeLessThanOrEqual(biggest);
      // and the continuation of the cycle really is frame 0 (the authored base is periodic in the loop length)
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
    expect(blinks).toBe(2);
    expect(open[0]).toBeGreaterThan(0.99);
    expect(open[open.length - 1]).toBeGreaterThan(0.99);
  });

  test("a held state never freezes: some pose term moves in every 500 ms window", () => {
    for (const track of [watching, analyzing]) {
      for (let i = 0; i + 15 < track.length; i += 1) {
        let moved = 0;
        for (let j = i; j < i + 15; j += 1) moved += poseDistance(track[j + 1], track[j]);
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

describe("WATCHING -> ANALYZING transition poses", () => {
  test("every entry head starts on the pure WATCHING pose of its phase", () => {
    for (const p of headPhases()) {
      const head = jobPoses({ kind: "head", phase: p });
      expect(poseDistance(head[0], watching[p]), `phase ${p}`).toBeLessThan(1e-6);
    }
  });

  test("heads exist at stride 6 and cover the whole loop", () => {
    const phases = headPhases();
    expect(phases).toHaveLength(WATCH_FRAMES / 6);
    expect(phases[0]).toBe(0);
    expect(phases[phases.length - 1]).toBe(WATCH_FRAMES - 6);
  });

  test("a head splices into the shared tail with a normal step, from any entry phase", () => {
    const tail = jobPoses({ kind: "tail" });
    const steps = tail.slice(1).map((p, i) => poseDistance(p, tail[i]));
    const limit = Math.max(...steps) * 1.25;
    for (const p of headPhases()) {
      const head = jobPoses({ kind: "head", phase: p });
      expect(poseDistance(tail[0], head[head.length - 1]), `phase ${p}`).toBeLessThanOrEqual(limit);
    }
  });

  test("the transition really passes through intermediate poses and ends on the ANALYZING loop", () => {
    const run = [...jobPoses({ kind: "head", phase: 0 }), ...jobPoses({ kind: "tail" })];
    expect(run).toHaveLength(HEAD_FRAMES + TAIL_FRAMES);
    // monotone-ish departure from the watching eye state: eyes narrow to 0.8 through intermediate values
    const eyes = run.map((p) => p.eyeOpen);
    expect(eyes.some((e) => e > 0.82 && e < 0.99)).toBe(true);
    const end = run[run.length - 1];
    const next = analyzing[0];
    const loopStep = Math.max(...analyzing.slice(1).map((p, i) => poseDistance(p, analyzing[i])));
    expect(poseDistance(next, end)).toBeLessThanOrEqual(loopStep * 1.5);
  });
});
