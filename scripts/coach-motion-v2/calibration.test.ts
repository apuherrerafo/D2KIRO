// The real-render calibration set (calibration.json) is a subset of the graph's own jobs: it names no clip, edge or frame count of its own.
import { describe, expect, test } from "bun:test";
import { jobPoses } from "../../apps/web/features/coach-motion/loop-pose";
// @ts-expect-error plain ESM module without types
import { loadGraph, planJobs, selectJobs } from "./plan.mjs";
// @ts-expect-error plain ESM module without types
import { calibrationFolders, calibrationLoops, loadCalibration, resolveCalibration } from "./calibration-set.mjs";
import { scanEdge } from "./transition-scan";

const graph = loadGraph();
const cal = loadCalibration();

describe("calibration set", () => {
  const scenarios = resolveCalibration(graph, cal);

  test("every scenario is an edge of the graph, its heads sit on the stride grid and the canonical head is one of them", () => {
    expect(scenarios.map((s: { edge: string }) => s.edge)).toEqual(cal.scenarios.map((s: { edge: string }) => s.edge));
    for (const s of scenarios) {
      expect(s.headPhases.every((p: number) => p % s.stride === 0)).toBe(true);
      expect(s.headPhases).toContain(s.canonicalHead);
    }
  });

  test("a head off the stride grid or an unknown edge is refused", () => {
    const bad = (mutate: (c: typeof cal) => void) => {
      const c = JSON.parse(JSON.stringify(cal));
      mutate(c);
      return () => resolveCalibration(graph, c);
    };
    expect(bad((c) => (c.scenarios[0].headPhases[0] = 1))).toThrow(/stride/);
    expect(bad((c) => (c.scenarios[0].canonicalHead = 2))).toThrow(/canonicalHead/);
    expect(bad((c) => (c.scenarios[0].edge = "nope>nowhere"))).toThrow(/unknown edge/);
  });

  test("the capture folders are exactly graph jobs, and the capture page's poses for each match the graph's frame count", () => {
    const folders: string[] = calibrationFolders(graph, cal);
    const jobs = selectJobs(planJobs(graph), folders);
    expect(jobs.map((j: { name: string }) => j.name).sort()).toEqual([...folders].sort());
    for (const j of jobs) expect(jobPoses(j.job)).toHaveLength(j.frames);
  });

  test("it covers both new loops and the loops at the far ends of the four transitions, and renders no whole entry grid", () => {
    expect(calibrationLoops(scenarios).sort()).toEqual(["analyzing", "confirming", "pointing", "watching"]);
    const heads = planJobs(graph).filter((j: { job: { kind: string } }) => j.job.kind === "head").length;
    const calHeads = scenarios.reduce((n: number, s: { heads: unknown[] }) => n + s.heads.length, 0);
    expect(calHeads).toBeLessThan(heads / 8);
  });
});

describe("transition scan", () => {
  test("is deterministic, covers the whole stride grid and puts the candidate edges beside the accepted one", () => {
    const [wa, ap] = ["watching>analyzing", "analyzing>pointing"].map((id) => scanEdge(graph.edges.find((e: { id: string }) => e.id === id)));
    expect(wa.heads).toBe(42);
    expect(ap.heads).toBe(70);
    expect(scanEdge(graph.edges.find((e: { id: string }) => e.id === "analyzing>pointing"))).toEqual(ap);
    // the ring of ANALYZING -> POINTING never moves faster per frame than the accepted WATCHING -> ANALYZING spin-up
    expect(ap.ringMax).toBeLessThan(wa.ringMax);
  });
});
