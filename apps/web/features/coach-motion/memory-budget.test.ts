// Decoded-memory budgets of the Motion V2 player, asserted on the REAL committed geometry (chunk and head sizes read from the shipped manifests), through the
// real controller + store. A decoded chunk is w x h x 4 bytes; the budgets below are what docs/coach-motion-v2/FOUNDATION_HARDENING.md states.
import { describe, expect, test } from "bun:test";
import { decodedBytes, type GraphEdge, type ProdManifest } from "./production-manifest";
import { ANALYZING_LOOP, FRAME_MS as FRAME, HEAD_PREFIX, MIB, TRANSITION_TAIL, WATCHING_LOOP, flush, graphManifest, playN, realManifest, rig } from "./test-support";

const biggest = (m: ProdManifest, clip: string) => Math.max(...m.clips[clip].chunks.map(decodedBytes));
const edgeById = (m: ProdManifest, id: string): GraphEdge => m.graph.edges.find((e) => e.id === id)!;

/** IDLE LOOP: the loop's current + next chunk. */
const idleBudget = (m: ProdManifest, loopClip: string) => 2 * biggest(m, loopClip);
/** ARMED SINGLE EDGE: the idle loop + the armed entry heads + the tail's first chunk. */
const armedBudget = (m: ProdManifest, loopClip: string, e: GraphEdge) => idleBudget(m, loopClip) + e.entry.armHeads * biggest(m, `${e.entry.headClipPrefix}000`) + decodedBytes(m.clips[e.tail.clip].chunks[0]);

async function peakOver(r: ReturnType<typeof rig>, ticks: number, step = FRAME + 0.01) {
  let peak = 0;
  for (let i = 0; i < ticks; i += 1) {
    r.ctl.tick(step);
    await flush();
    peak = Math.max(peak, r.ctl.residency().bytes);
  }
  return peak;
}

describe("memory budgets · real 384 geometry", () => {
  const m = realManifest("384");
  const e = edgeById(m, "watching>analyzing");

  test("the budget formulas, in numbers (384 px: 1304 x 1440 loop chunk, 1304 x 1080 head)", () => {
    expect(biggest(m, WATCHING_LOOP) / MIB).toBeCloseTo(7.16, 2);
    expect(biggest(m, `${HEAD_PREFIX}000`) / MIB).toBeCloseTo(5.37, 2);
    expect(idleBudget(m, WATCHING_LOOP) / MIB).toBeCloseTo(14.33, 2);
    expect(armedBudget(m, WATCHING_LOOP, e) / MIB).toBeCloseTo(32.23, 2);
  });

  test("IDLE LOOP: two full WATCHING passes never hold more than CURRENT + NEXT (14.3 MiB), against 32.2 MiB steady before", async () => {
    const r = rig();
    await flush();
    const peak = await peakOver(r, 252 * 2);
    expect(peak).toBeLessThanOrEqual(idleBudget(m, WATCHING_LOOP));
    expect(peak).toBeGreaterThan(idleBudget(m, WATCHING_LOOP) - 1 * MIB); // the budget is tight, not slack
  });

  test("IDLE ANALYZING: the same two-chunk bound", async () => {
    const r = rig({ loop: "analyzing" });
    await flush();
    const peak = await peakOver(r, 210 * 2);
    expect(peak).toBeLessThanOrEqual(idleBudget(m, ANALYZING_LOOP));
  });

  test("ARMED SINGLE EDGE: from the request until the transition starts, residency stays inside loop + 2 heads + tail opening (32.2 MiB)", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 50);
    r.ctl.cue("analyzing");
    await flush();
    const peakArmed = r.ctl.residency().bytes;
    expect(peakArmed).toBeLessThanOrEqual(armedBudget(m, WATCHING_LOOP, e));
    expect(peakArmed).toBeGreaterThan(armedBudget(m, WATCHING_LOOP, e) - 8 * MIB);
    const peakRest = await peakOver(r, 10 + 35 + 30);
    expect(peakRest).toBeLessThanOrEqual(armedBudget(m, WATCHING_LOOP, e));
  });

  test("the transition itself stays inside the armed budget, and once ANALYZING plays the idle bound holds again", async () => {
    const r = rig();
    await flush();
    await playN(r.ctl, 50);
    r.ctl.cue("analyzing");
    await flush();
    const inTransition = await peakOver(r, 10 + 35);
    expect(inTransition).toBeLessThanOrEqual(armedBudget(m, WATCHING_LOOP, e));
    const after = await peakOver(r, 210);
    expect(after).toBeLessThanOrEqual(idleBudget(m, ANALYZING_LOOP));
  });

  test("STATE WITH TWO OUTGOING EDGES: idle costs the same as with one, and arming either edge stays inside that edge's armed budget (the other edge adds nothing)", async () => {
    const g = graphManifest("384");
    const single = rig();
    await flush();
    const idleSingle = await peakOver(single, 252);
    const two = rig({ m: g });
    await flush();
    const idleTwo = await peakOver(two, 252);
    expect(idleTwo).toBe(idleSingle); // an edge nobody asked for costs no memory
    expect(idleTwo).toBeLessThanOrEqual(idleBudget(g, WATCHING_LOOP));

    for (const id of ["watching>analyzing", "watching>pointing"]) {
      const edge = edgeById(g, id);
      const r = rig({ m: g });
      await flush();
      await playN(r.ctl, 50);
      r.ctl.cue(edge.to);
      await flush();
      let peak = r.ctl.residency().bytes;
      peak = Math.max(peak, await peakOver(r, 10 + 35 + 40));
      expect(peak, id).toBeLessThanOrEqual(armedBudget(g, WATCHING_LOOP, edge));
      // never both edges' heads: only the requested edge's prefix was ever requested
      const other = g.graph.edges.filter((x) => x.from === "watching" && x.id !== id)[0].entry.headClipPrefix;
      expect(r.io.count(other), id).toBe(0);
    }
  });

  test("what arming BOTH outgoing edges would have cost (the unbounded alternative this design avoids)", () => {
    const g = graphManifest("384");
    const both = idleBudget(g, WATCHING_LOOP) + g.graph.edges.filter((x) => x.from === "watching").reduce((n, x) => n + x.entry.armHeads * biggest(g, `${x.entry.headClipPrefix}000`) + decodedBytes(g.clips[x.tail.clip].chunks[0]), 0);
    expect(both / MIB).toBeCloseTo(14.33 + 2 * (2 * 5.37 + 7.16), 1);
    expect(both).toBeGreaterThan(armedBudget(g, WATCHING_LOOP, edgeById(g, "watching>analyzing")));
  });
});

describe("memory budgets · real 512 geometry (not the default; stated for the record)", () => {
  const m = realManifest("512");
  const e = edgeById(m, "watching>analyzing");

  test("idle 25.3 MiB and armed 57.0 MiB: the armed figure equals what the old design held at all times", async () => {
    expect(idleBudget(m, WATCHING_LOOP) / MIB).toBeCloseTo(25.32, 1);
    expect(armedBudget(m, WATCHING_LOOP, e) / MIB).toBeCloseTo(57.0, 1);
    const r = rig({ m });
    await flush();
    const peak = await peakOver(r, 252);
    expect(peak).toBeLessThanOrEqual(idleBudget(m, WATCHING_LOOP));
    expect(m.clips[TRANSITION_TAIL].chunks[0].w).toBeLessThanOrEqual(2048);
  });
});
