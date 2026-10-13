import { describe, expect, test } from "bun:test";
import { jobPoses } from "./loop-pose";
import { FORWARD_WAIT_ALLOWANCE_FRAMES, NATURAL_STEP_FACTOR, chooseEntryStrategy, probeLoops, recommendStride, studyEntryStrategies, validateGraphStrides, type GraphForProbe } from "./stride-probe";
import { authoringGraph } from "./test-support";

const probes = probeLoops();
const graph = authoringGraph();
const at = (loop: string, stride: number) => probes[loop].strides.find((s) => s.stride === stride)!;
const fresh = () => JSON.parse(JSON.stringify(graph)) as GraphForProbe & typeof graph;

describe("entry-stride probe · real authored pose tracks", () => {
  test("ANALYZING moves at a constant, much higher speed than WATCHING (so stride 6 cannot be a universal constant)", () => {
    expect(probes.analyzing.step.median).toBeGreaterThan(10 * probes.watching.step.median);
    expect(probes.analyzing.step.max / probes.analyzing.step.median).toBeLessThan(1.05); // steady ring spin: velocity is the same at every phase
  });

  test("the entry jump of ANALYZING grows with the frames the nearest head is off: stride 2/3 = one natural step, 4/5 = two, 6 = three", () => {
    const step = probes.analyzing.step.max;
    expect(at("analyzing", 2).maxJump).toBeCloseTo(step, 1);
    expect(at("analyzing", 3).maxJump).toBeCloseTo(step, 1);
    expect(at("analyzing", 4).maxJump / step).toBeCloseTo(2, 1);
    expect(at("analyzing", 6).maxJump / step).toBeCloseTo(3, 1);
    expect(at("analyzing", 6).maxFramesOff).toBe(3);
    expect(at("analyzing", 3).maxFramesOff).toBe(1);
  });

  test("the rule that accepts the approved WATCHING stride 6 picks ANALYZING 3, POINTING 3 and CONFIRMING 6 (measured on the real tracks, one rule for every source loop)", () => {
    expect(NATURAL_STEP_FACTOR).toBe(1.5);
    expect(recommendStride(probes.watching)).toBe(6);
    expect(recommendStride(probes.analyzing)).toBe(3);
    expect(recommendStride(probes.pointing)).toBe(3);
    expect(recommendStride(probes.confirming)).toBe(6);
  });

  test("the cost of the grid is stated by the probe: heads per source loop", () => {
    expect(at("analyzing", 3).heads).toBe(70);
    expect(at("analyzing", 6).heads).toBe(35);
    expect(at("watching", 6).heads).toBe(42);
    expect(at("pointing", 3).heads).toBe(38);
    expect(at("confirming", 6).heads).toBe(19);
  });

  test("POINTING is calm (a slow sway) but, unlike WATCHING, has no blink to widen its p95: stride 4 is already two natural steps and fails the rule", () => {
    expect(at("pointing", 3).p95Jump).toBeLessThanOrEqual(NATURAL_STEP_FACTOR * probes.pointing.step.p95);
    expect(at("pointing", 4).p95Jump).toBeGreaterThan(NATURAL_STEP_FACTOR * probes.pointing.step.p95);
    expect(probes.pointing.step.max).toBeLessThan(0.5);
  });
});

describe("graph.json strides are the probe's, and a bad author choice fails validation", () => {
  test("the committed graph is valid: strideLimit = the probe's recommendation per loop, stride <= strideLimit, maxStepFrames = floor(stride / 2), frames = the pose track", () => {
    expect(validateGraphStrides(graph, probes)).toEqual([]);
    expect(Object.fromEntries(Object.entries(graph.loops).map(([k, l]) => [k, l.strideLimit]))).toEqual({ watching: 6, analyzing: 3, pointing: 3, confirming: 6 });
    expect(Object.fromEntries(graph.edges.map((e) => [e.id, [e.entry.stride, e.entry.maxStepFrames]]))).toEqual({
      "watching>analyzing": [6, 3],
      "analyzing>pointing": [3, 1],
      "pointing>confirming": [3, 1],
      "confirming>pointing": [6, 3],
      "pointing>watching": [3, 1],
    });
  });

  test("a stride coarser than its source loop supports fails (POINTING exits at 6, ANALYZING exit at 4)", () => {
    const g = fresh();
    g.edges.find((e) => e.id === "pointing>confirming")!.entry.stride = 6;
    g.edges.find((e) => e.id === "pointing>confirming")!.entry.maxStepFrames = 3;
    g.edges.find((e) => e.id === "analyzing>pointing")!.entry.stride = 4;
    g.edges.find((e) => e.id === "analyzing>pointing")!.entry.maxStepFrames = 2;
    const problems = validateGraphStrides(g, probes);
    expect(problems).toContain("edge pointing>confirming: stride 6 is coarser than pointing supports (strideLimit 3)");
    expect(problems).toContain("edge analyzing>pointing: stride 4 is coarser than analyzing supports (strideLimit 3)");
  });

  test("a continuity budget that is not floor(stride / 2), a stale strideLimit and a wrong frame count fail", () => {
    const g = fresh();
    g.edges[0].entry.maxStepFrames = 5;
    g.loops.watching.strideLimit = 8;
    g.loops.pointing.frames = 120;
    const problems = validateGraphStrides(g, probes);
    expect(problems.some((p) => /edge watching>analyzing: maxStepFrames 5 must be floor\(stride \/ 2\) = 3/.test(p))).toBe(true);
    expect(problems.some((p) => /loop watching: strideLimit 8 is not the probe's recommendation 6/.test(p))).toBe(true);
    expect(problems.some((p) => /loop pointing: graph says 120 frames, the pose track has 112/.test(p))).toBe(true);
  });

  test("a loop with no pose definition cannot be validated", () => {
    const g = fresh();
    g.loops.hypothetical = { ...g.loops.watching };
    expect(validateGraphStrides(g, probes)).toContain("loop hypothetical: no pose definition to probe");
  });
});

describe("entry strategy · nearest vs forward-only on the fast ANALYZING loop (stride 3)", () => {
  const analyzing = jobPoses({ kind: "loop", loop: "analyzing" });
  const studies = studyEntryStrategies(analyzing, 3, 1);
  const by = (s: string) => studies.find((x) => x.strategy === s)!;

  test("nearest: at most one frame off, a one-frame HOLD on a third of the entries and a one-frame skip on another third, never a backward step", () => {
    const n = by("nearest");
    expect(n.maxMismatchFrames).toBe(1);
    expect(n.holds).toBe(70); // 210 entry frames / 3
    expect(n.reversals).toBe(0);
    expect(n.meanWaitFrames).toBe(0);
    expect(n.maxSeamOverNaturalStep).toBeCloseTo(2, 1); // the other third skips one frame ahead: a two-step seam, never backwards
    expect(n.withinBudget).toBe(true);
  });

  test("forward-skip never holds or reverses but skips up to 2 frames ahead: past the 1-frame budget", () => {
    const f = by("forward-skip");
    expect(f.holds + f.reversals).toBe(0);
    expect(f.maxMismatchFrames).toBe(2);
    expect(f.withinBudget).toBe(false);
    expect(f.maxSeamOverNaturalStep).toBeCloseTo(3, 1);
  });

  test("forward-wait removes the hold and keeps the step at exactly one natural step, at the price of a mean 1 / max 2 frames of wait", () => {
    const w = by("forward-wait");
    expect(w.holds + w.reversals).toBe(0);
    expect(w.maxMismatchFrames).toBe(0);
    expect(w.withinBudget).toBe(true);
    expect(w.maxSeamOverNaturalStep).toBeCloseTo(1, 1);
    expect(w.meanWaitFrames).toBeCloseTo(1, 5);
    expect(w.maxWaitFrames).toBe(2);
  });

  test("the frozen rule keeps nearest-head: the worst-case wait (2 frames) is above the 1-frame allowance, and what nearest does is a hold, not a reversal", () => {
    expect(FORWARD_WAIT_ALLOWANCE_FRAMES).toBe(1);
    const choice = chooseEntryStrategy(studies);
    expect(choice.strategy).toBe("nearest-head");
    expect(choice.why).toMatch(/up to 2 frames of wait \(mean 1\.00\)/);
  });

  test("a grid whose nearest entry never repeats a picture (stride 2) keeps nearest, whatever forward entry would cost", () => {
    const s2 = studyEntryStrategies(analyzing, 2, 1);
    expect(s2.find((x) => x.strategy === "nearest")!.holds).toBe(0);
    expect(chooseEntryStrategy(s2)).toMatchObject({ strategy: "nearest-head", why: expect.stringMatching(/never repeats or reverses/) });
  });

  test("every edge of graph.json uses the strategy the rule chooses for its source loop at its stride (a pose change that makes forward entry attractive fails here)", () => {
    for (const e of graph.edges) {
      const poses = jobPoses({ kind: "loop", loop: e.from });
      const choice = chooseEntryStrategy(studyEntryStrategies(poses, e.entry.stride, e.entry.maxStepFrames));
      expect(choice.strategy, e.id).toBe(e.entry.strategy === "nearest-head" ? "nearest-head" : "nearest-forward");
    }
  });
});
