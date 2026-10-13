import { describe, expect, test } from "bun:test";
import { MAX_ATLAS_PX, colsOf, edgeBetween, edgesFrom, headClipId, headPhases, parseManifest, type ProdManifest } from "./production-manifest";
import { chunkKey } from "./production-manifest";
import { nearestHeadPhase } from "./sequencer";
import { FRAME_MS as FRAME, HEAD_PREFIX, flush, graphManifest, playN, realManifest, rig } from "./test-support";

const fresh = (m: ProdManifest) => JSON.parse(JSON.stringify(m)) as ProdManifest;
const rejects = (mutate: (m: ProdManifest) => void, message: RegExp | string) => {
  const m = fresh(realManifest());
  mutate(m);
  expect(() => parseManifest(m)).toThrow(message);
};

describe("manifest v4 · the graph is data", () => {
  test("both committed packs parse, with the production edge's stride, head count and tail declared in the manifest", () => {
    for (const pack of ["384", "512"] as const) {
      const m = realManifest(pack);
      expect(Object.keys(m.graph.loops)).toEqual(["watching", "analyzing"]);
      const [e] = m.graph.edges;
      expect(e).toMatchObject({ id: "watching>analyzing", from: "watching", to: "analyzing", fps: 30, tail: { clip: "TAIL_WA", enterFrame: 0 } });
      expect(e.entry).toMatchObject({ strategy: "nearest-head", stride: 6, headClipPrefix: HEAD_PREFIX, headFrames: 10, armHeads: 2 });
      expect(headPhases(m.clips.WATCHING_LOOP.frames, e.entry.stride)).toHaveLength(42);
      expect(m.packHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("stride is per edge: a synthetic graph carries strides 6, 3, 3 and 6, each with exactly its own heads", () => {
    const m = graphManifest();
    expect(m.graph.edges.map((e) => [e.id, e.entry.stride])).toEqual([["watching>analyzing", 6], ["watching>pointing", 3], ["analyzing>pointing", 3], ["pointing>watching", 6]]);
    const heads = (prefix: string) => Object.keys(m.clips).filter((c) => c.startsWith(prefix)).length;
    expect(heads(HEAD_PREFIX)).toBe(42); // 252 / 6
    expect(heads("POINT_HEAD_")).toBe(84); // 252 / 3
    expect(heads("APOINT_HEAD_")).toBe(70); // 210 / 3
    expect(heads("BACK_HEAD_")).toBe(35); // 210 / 6
    expect(edgesFrom(m, "watching").map((e) => e.to)).toEqual(["analyzing", "pointing"]);
    expect(edgeBetween(m, "analyzing", "watching")).toBeUndefined();
  });

  test("a stride that cannot hold the edge's continuity budget is rejected", () => {
    rejects((m) => void (m.graph.edges[0].entry.stride = 8), /stride 8 allows an entry mismatch of 4 frames, above maxStepFrames 3/);
    const ok = fresh(realManifest());
    ok.graph.edges[0].entry.maxStepFrames = 2; // stride 6 -> 3 frames
    expect(() => parseManifest(ok)).toThrow(/above maxStepFrames 2/);
  });

  test("a head grid that does not exist in the pack is rejected (stride 3 on a pack that only has stride-6 heads)", () => {
    rejects((m) => {
      m.graph.edges[0].entry.stride = 3;
    }, /missing ENTRY_HEAD_WA_003/);
  });

  test("unusable graphs are rejected with a reason", () => {
    rejects((m) => void (m.graph.edges[0].entry.strategy = "canonical" as never), /unknown entry strategy canonical/);
    rejects((m) => void (m.graph.edges[0].to = "pointing"), /unknown loop pointing/);
    rejects((m) => void (m.graph.edges[0].to = "watching"), /same loop/);
    rejects((m) => void (m.graph.edges[0].fps = 24), /mixed-fps edges are not supported/);
    rejects((m) => void m.graph.edges.push({ ...m.graph.edges[0] }), /duplicate edge/);
    rejects((m) => void (m.graph.edges[0].tail.clip = "NOPE"), /missing tail clip/);
    rejects((m) => void (m.graph.edges[0].tail.enterFrame = 999), /bad tail.enterFrame/);
    rejects((m) => void (m.graph.edges[0].lookaheadFrames = 3), /lookaheadFrames/);
    rejects((m) => void (m.graph.loops.watching.clip = "TAIL_WA"), /not a loop/);
    rejects((m) => void (m.clips.ENTRY_HEAD_WA_006.frames = 9), /chunks hold|must be a 10-frame/);
    rejects((m) => void delete m.clips.ENTRY_HEAD_WA_246, /missing ENTRY_HEAD_WA_246/);
  });

  test("a v3 manifest, a missing hash, and a file name that is not content-addressed are rejected", () => {
    rejects((m) => void ((m as { version: number }).version = 3), /expected 4/);
    rejects((m) => void (m.clips.WATCHING_LOOP.chunks[0].sha256 = ""), /missing sha256/);
    rejects((m) => void (m.clips.WATCHING_LOOP.chunks[0].file = "watching-00.avif"), /not content-addressed/);
  });

  test("the atlas cap is enforced: an oversized chunk or a limit above 2048 is rejected", () => {
    expect(MAX_ATLAS_PX).toBe(2048);
    rejects((m) => void (m.limits.maxAtlasPx = 4096), /outside 1\.\.2048/);
    rejects((m) => void (m.limits.maxAtlasPx = 1400), /exceeds 1400 px/); // 384 chunks are 1304 x 1440
    for (const pack of ["384", "512"] as const) {
      const m = realManifest(pack);
      for (const clip of Object.values(m.clips)) for (const c of clip.chunks) expect(Math.max(c.w, c.h)).toBeLessThanOrEqual(2048);
    }
  });

  test("a clip may use fewer columns than the pack: its atlas geometry is checked against its own cols", () => {
    const m = fresh(realManifest());
    const clip = m.clips.ENTRY_HEAD_WA_000;
    clip.cols = 2;
    const c = clip.chunks[0];
    c.rows = 5;
    c.w = 2 * m.cell.w;
    c.h = 5 * m.cell.h;
    const parsed = parseManifest(m);
    expect(colsOf(parsed, "ENTRY_HEAD_WA_000")).toBe(2);
    expect(colsOf(parsed, "ENTRY_HEAD_WA_006")).toBe(4);
    clip.cols = 3; // geometry no longer matches
    expect(() => parseManifest(m)).toThrow(/does not match 3 cols/);
  });
});

describe("graph traversal · the sequencer interprets the manifest, it knows no clip names", () => {
  /** plays until the predicate holds, returning the clips painted on the way (consecutive duplicates collapsed) */
  async function until(r: ReturnType<typeof rig>, done: () => boolean, max = 400) {
    const seen: string[] = [];
    for (let i = 0; i < max && !done(); i += 1) {
      r.ctl.tick(FRAME);
      await flush();
      const c = r.ctl.shown!.clip;
      if (seen[seen.length - 1] !== c) seen.push(c);
    }
    expect(done()).toBe(true);
    return seen;
  }

  test("watching -> analyzing -> pointing -> watching: each edge plays its OWN heads and tail, at its own stride, and lands on its target loop's enter frame", async () => {
    const r = rig({ m: graphManifest() });
    await flush();
    await playN(r.ctl, 17);
    const phases = (clips: string[], prefix: string) => clips.filter((c) => c.startsWith(prefix)).map((c) => Number(c.slice(prefix.length)));

    expect(r.ctl.cue("analyzing")).toBe(true);
    const a = await until(r, () => r.ctl.shown!.mode === "analyzing");
    expect(a.filter((c) => c.startsWith(HEAD_PREFIX))).toHaveLength(1);
    expect(phases(a, HEAD_PREFIX)[0] % 6).toBe(0);
    expect(a.slice(-2)).toEqual(["TAIL_WA", "ANALYZING_LOOP"]);
    await playN(r.ctl, 23);

    expect(r.ctl.cue("pointing")).toBe(true);
    const b = await until(r, () => r.ctl.shown!.mode === "pointing");
    expect(phases(b, "APOINT_HEAD_")[0] % 3).toBe(0);
    expect(b.some((c) => c.startsWith(HEAD_PREFIX) || c.startsWith("POINT_HEAD_"))).toBe(false);
    expect(b.slice(-2)).toEqual(["APOINT_TAIL", "POINTING_LOOP"]);
    expect(r.ctl.lastEntry!.edge).toBe("analyzing>pointing");
    expect(r.ctl.lastEntry!.step).toBeLessThanOrEqual(1); // stride 3: at most one frame off
    await playN(r.ctl, 11);

    expect(r.ctl.cue("watching")).toBe(true);
    const c = await until(r, () => r.ctl.shown!.mode === "watching");
    expect(phases(c, "BACK_HEAD_")[0] % 6).toBe(0);
    expect(c.slice(-2)).toEqual(["BACK_TAIL", "WATCHING_LOOP"]);
    expect(r.ctl.shown).toMatchObject({ clip: "WATCHING_LOOP", frame: 0, state: "watching" });
    expect(r.events.fail).toEqual([]);
  });

  test("a request for a target that has no edge from the loop being played is refused and changes nothing", async () => {
    const r = rig({ m: graphManifest() });
    await flush();
    await playN(r.ctl, 5);
    const loads = r.ctl.stats.loads;
    expect(r.ctl.cue("confirming")).toBe(false); // not a loop of this graph
    expect(r.ctl.cue("watching")).toBe(false); // the loop being played
    expect(r.ctl.pendingEdge).toBeNull();
    await flush();
    expect(r.ctl.stats.loads).toBe(loads);
  });

  test("a state with two outgoing edges arms only the requested one: the other edge's heads are never touched", async () => {
    for (const [target, prefix, other] of [["analyzing", HEAD_PREFIX, "POINT_HEAD_"], ["pointing", "POINT_HEAD_", HEAD_PREFIX]] as const) {
      const r = rig({ m: graphManifest() });
      await flush();
      await playN(r.ctl, 40);
      expect(r.ctl.cue(target)).toBe(true);
      await playN(r.ctl, 60);
      expect(r.io.count(prefix)).toBeGreaterThan(0);
      expect(r.io.count(other), target).toBe(0);
    }
  });

  test("a request can still be changed before it is taken: the first edge's heads are released and the new edge's are armed", async () => {
    const m = graphManifest();
    const held = [...headPhases(252, 6).map((p) => chunkKey("384", headClipId(HEAD_PREFIX, p), 0)), ...headPhases(252, 3).map((p) => chunkKey("384", headClipId("POINT_HEAD_", p), 0))];
    const r = rig({ m, hold: held });
    await flush();
    await playN(r.ctl, 20);
    r.ctl.cue("analyzing");
    await flush();
    expect(r.ctl.pendingEdge).toBe("watching>analyzing");
    r.ctl.cue("pointing");
    await flush();
    expect(r.ctl.pendingEdge).toBe("watching>pointing");
    const upcoming = (r.ctl.shown!.frame + 1) % 252;
    expect(r.io.requested).toContain(chunkKey("384", headClipId("POINT_HEAD_", nearestHeadPhase(upcoming, 252, 3)), 0));
    // nothing of the abandoned edge is resident (its heads were still decoding and were dropped)
    expect(r.ctl.residency().keys.some((k) => k.includes(HEAD_PREFIX))).toBe(false);
  });
});
