// The generic runtime against the REAL authoring graph (scripts/coach-motion-v2/graph.json): every loop, edge, stride, head grid and tail of the five-edge semantic graph, with
// placeholder atlas geometry where the frames are not generated yet. The runtime (player / sequencer / controller) is not edited for POINTING or CONFIRMING: if these pass,
// the semantic states are data.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { edgeBetween, edgesFrom, headClipId, headPhases, parseManifest } from "./production-manifest";
import { FRAME_MS as FRAME, flush, fullGraphManifest, playN, rig } from "./test-support";

const SEQUENCE = ["watching", "analyzing", "pointing", "confirming", "pointing", "watching"];

async function until(r: ReturnType<typeof rig>, done: () => boolean, max = 600) {
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

describe("the full semantic graph is data the runtime already understands", () => {
  test("the manifest block derived from graph.json parses: 4 loops, 5 edges, every head and tail present", () => {
    const m = fullGraphManifest();
    expect(Object.keys(m.graph.loops)).toEqual(["watching", "analyzing", "pointing", "confirming"]);
    expect(m.graph.edges.map((e) => e.id)).toEqual(["watching>analyzing", "analyzing>pointing", "pointing>confirming", "confirming>pointing", "pointing>watching"]);
    for (const e of m.graph.edges) {
      const src = m.clips[m.graph.loops[e.from].clip].frames;
      expect(headPhases(src, e.entry.stride).every((p) => m.clips[headClipId(e.entry.headClipPrefix, p)]?.frames === e.entry.headFrames), e.id).toBe(true);
    }
  });

  test("WATCHING -> ANALYZING -> POINTING -> CONFIRMING -> POINTING -> WATCHING: each hop plays its own head (on its own stride grid) and tail, then lands on the target loop", async () => {
    const r = rig({ m: fullGraphManifest() });
    await flush();
    await playN(r.ctl, 17);
    for (let i = 1; i < SEQUENCE.length; i += 1) {
      const e = edgeBetween(r.m, SEQUENCE[i - 1], SEQUENCE[i])!;
      expect(e, SEQUENCE[i]).toBeDefined();
      expect(r.ctl.shown!.mode).toBe(SEQUENCE[i - 1]);
      expect(r.ctl.cue(SEQUENCE[i])).toBe(true);
      const seen = await until(r, () => r.ctl.shown!.mode === SEQUENCE[i]);
      const heads = seen.filter((c) => c.startsWith(e.entry.headClipPrefix));
      expect(heads, e.id).toHaveLength(1);
      expect(Number(heads[0].slice(e.entry.headClipPrefix.length)) % e.entry.stride, e.id).toBe(0);
      expect(seen.slice(-2), e.id).toEqual([e.tail.clip, r.m.graph.loops[SEQUENCE[i]].clip]);
      expect(seen.some((c) => c.includes("HEAD") && !c.startsWith(e.entry.headClipPrefix)), `${e.id} played another edge's head`).toBe(false);
      expect(r.ctl.lastEntry!.edge).toBe(e.id);
      expect(r.ctl.lastEntry!.step).toBeLessThanOrEqual(e.entry.maxStepFrames);
      await playN(r.ctl, 23 + i);
    }
    expect(r.ctl.shown).toMatchObject({ state: "watching" });
    expect(r.events.fail).toEqual([]);
  });

  test("POINTING has two outgoing edges (-> confirming, -> watching) and each arms only its own heads", async () => {
    expect(edgesFrom(fullGraphManifest(), "pointing").map((e) => e.to)).toEqual(["confirming", "watching"]);
    for (const [target, prefix, other] of [["confirming", "ENTRY_HEAD_PC_", "ENTRY_HEAD_PW_"], ["watching", "ENTRY_HEAD_PW_", "ENTRY_HEAD_PC_"]] as const) {
      const r = rig({ m: fullGraphManifest(), loop: "pointing" });
      await flush();
      await playN(r.ctl, 30);
      expect(r.ctl.cue(target)).toBe(true);
      await playN(r.ctl, 60);
      expect(r.io.count(prefix), target).toBeGreaterThan(0);
      expect(r.io.count(other), target).toBe(0);
    }
  });

  test("a hop the graph does not contain is refused (no WATCHING -> CONFIRMING, no ANALYZING -> WATCHING)", async () => {
    const r = rig({ m: fullGraphManifest() });
    await flush();
    await playN(r.ctl, 5);
    expect(r.ctl.cue("confirming")).toBe(false);
    expect(r.ctl.pendingEdge).toBeNull();
  });

  test("the runtime source names no semantic clip or state", () => {
    const dir = (f: string) => fileURLToPath(new URL(f, import.meta.url));
    for (const f of ["CoachMotionPlayer.tsx", "motion-controller.ts", "sequencer.ts", "production-manifest.ts", "chunk-loader.ts", "bitmap-store.ts"]) {
      const code = readFileSync(dir(f), "utf8")
        .split("\n")
        .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
        .join("\n");
      expect(code, f).not.toMatch(/POINTING|CONFIRMING|WATCHING_LOOP|ANALYZING_LOOP|ENTRY_HEAD|TAIL_|"pointing"|"confirming"/);
    }
  });
});

describe("extensibility: a hypothetical future state is pose definition + graph entry + generated assets, with no runtime change", () => {
  test("adding a loop 'doubting' with two edges to the authoring graph yields a manifest the unchanged runtime traverses", async () => {
    const m = fullGraphManifest((g) => {
      g.loops.doubting = { clip: "DOUBTING_LOOP", dir: "doubting", frames: 126, strideLimit: 4 };
      g.edges.push(
        { id: "watching>doubting", ns: "wd", from: "watching", to: "doubting", fps: 30, entry: { strategy: "nearest-head", stride: 4, headClipPrefix: "ENTRY_HEAD_WD_", headDirPrefix: "head-wd-", headFrames: 10, maxStepFrames: 2, armHeads: 2 }, tail: { clip: "TAIL_WD", dir: "tail-wd", frames: 30, enterFrame: 0 }, lookaheadFrames: 28 },
        { id: "doubting>watching", ns: "dw", from: "doubting", to: "watching", fps: 30, entry: { strategy: "nearest-head", stride: 4, headClipPrefix: "ENTRY_HEAD_DW_", headDirPrefix: "head-dw-", headFrames: 10, maxStepFrames: 2, armHeads: 2 }, tail: { clip: "TAIL_DW", dir: "tail-dw", frames: 30, enterFrame: 0 }, lookaheadFrames: 28 },
      );
    });
    expect(Object.keys(m.graph.loops)).toContain("doubting");
    const r = rig({ m });
    await flush();
    await playN(r.ctl, 10);
    expect(r.ctl.cue("doubting")).toBe(true);
    const there = await until(r, () => r.ctl.shown!.mode === "doubting");
    expect(there.slice(-2)).toEqual(["TAIL_WD", "DOUBTING_LOOP"]);
    await playN(r.ctl, 20);
    expect(r.ctl.cue("watching")).toBe(true);
    const back = await until(r, () => r.ctl.shown!.mode === "watching");
    expect(back.slice(-2)).toEqual(["TAIL_DW", "WATCHING_LOOP"]);
    expect(r.events.fail).toEqual([]);
  });

  test("the same graph edit is rejected by the build-time rules when it is careless (a head prefix that swallows another edge's heads)", () => {
    expect(() =>
      fullGraphManifest((g) => {
        g.edges[1].entry.headClipPrefix = "ENTRY_HEAD_"; // a bare prefix would also match every other edge's heads
      }),
    ).toThrow(/head prefix ENTRY_HEAD_ also matches/);
  });

  test("the player's manifest check rejects namespaces that overlap even when every clip exists", () => {
    const m = JSON.parse(JSON.stringify(fullGraphManifest()));
    m.graph.edges[1].entry.headClipPrefix = "ENTRY_HEAD_WA_X_";
    for (const p of headPhases(210, 3)) m.clips[`ENTRY_HEAD_WA_X_${String(p).padStart(3, "0")}`] = m.clips[`ENTRY_HEAD_AP_${String(p).padStart(3, "0")}`];
    expect(() => parseManifest(m)).toThrow(/head prefix ENTRY_HEAD_WA_ also matches ENTRY_HEAD_WA_X_/);
  });
});
