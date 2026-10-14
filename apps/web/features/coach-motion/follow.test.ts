import { describe, expect, test } from "bun:test";
import { COACH_HOPS, nextHop } from "./follow";
import { edgeBetween } from "./production-manifest";
import { realManifest } from "./test-support";

describe("following a semantic target over the pack's graph", () => {
  const m = realManifest("384");
  const states = Object.keys(COACH_HOPS) as Array<keyof typeof COACH_HOPS>;

  test("every hop the follower may cue is a real edge of the committed pack, and every edge of the pack is a hop", () => {
    for (const from of states) for (const to of COACH_HOPS[from]) expect(edgeBetween(m, from, to)).toBeDefined();
    expect(m.graph.edges.length).toBe(states.reduce((n, s) => n + COACH_HOPS[s].length, 0));
  });

  test("the approved cycle is one hop at a time", () => {
    const cycle = ["watching", "analyzing", "pointing", "confirming", "pointing", "watching"] as const;
    for (let i = 1; i < cycle.length; i += 1) expect(nextHop(cycle[i - 1], cycle[i])).toBe(cycle[i]);
  });

  test("a target further away is reached through the graph; the current state needs no hop", () => {
    expect(nextHop("watching", "pointing")).toBe("analyzing");
    expect(nextHop("watching", "confirming")).toBe("analyzing");
    expect(nextHop("confirming", "watching")).toBe("pointing");
    expect(nextHop("analyzing", "watching")).toBe("pointing");
    expect(nextHop("pointing", "pointing")).toBeNull();
  });

  test("every state reaches every other", () => {
    for (const a of states) for (const b of states) if (a !== b) expect(nextHop(a, b)).not.toBeNull();
  });
});
