// The authoring pipeline is graph-driven: capture planning (plan.mjs), the Python rules (pack_manifest.py: clip_plan / check_graph / validate_graph), the guards (guards.py, run on
// synthetic frames of a tiny graph) and the pack-size gate all derive from graph.json. The JS and Python validators must agree, mutation by mutation.
import { afterAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error plain ESM module without types
import { CHUNK_FRAMES, estimatePack, headClipIds, headDirNames, headPhases, loadGraph, planJobs, renderPlan, selectJobs, validateGraph } from "./plan.mjs";
// @ts-expect-error plain ESM module without types
import { gates, packReport } from "./pack-report.mjs";

const DIR = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(DIR, "../..");
const made: string[] = [];
afterAll(() => made.forEach((d) => rmSync(d, { recursive: true, force: true })));

type G = any;
const fresh = (): G => JSON.parse(JSON.stringify(loadGraph()));
const edge = (g: G, id: string) => g.edges.find((e: G) => e.id === id);

/** Runs a Python snippet with pack_manifest importable; the snippet reads the graph JSON from `g` and prints one JSON line. */
function py(body: string, input: unknown): any {
  const code = `import sys, json\nsys.path.insert(0, ${JSON.stringify(DIR)})\nimport pack_manifest as pm\nd = json.load(sys.stdin)\n${body}\n`;
  const r = spawnSync("python", ["-I", "-c", code], { input: JSON.stringify(input), encoding: "utf8" });
  if (r.status !== 0) return { error: `${r.stdout}${r.stderr}`.trim() };
  return JSON.parse(r.stdout.trim().split("\n").pop()!);
}
const pyProblems = (g: G): string[] => py("print(json.dumps(pm.graph_problems(d)))", g);

describe("graph-driven capture planning", () => {
  const g = loadGraph();
  const jobs = planJobs(g);

  test("the committed graph is valid for both validators", () => {
    expect(validateGraph(g)).toEqual([]);
    expect(pyProblems(g)).toEqual([]);
  });

  test("jobs are derived from the graph: every loop, then per edge its tail and one head per phase of ITS stride grid", () => {
    const loops = jobs.filter((j: G) => j.job.kind === "loop");
    expect(loops.map((j: G) => [j.name, j.frames])).toEqual(Object.values(g.loops).map((l: G) => [l.dir, l.frames]));
    for (const e of g.edges) {
      const mine = jobs.filter((j: G) => j.edge === e.id);
      const heads = mine.filter((j: G) => j.job.kind === "head");
      const src = g.loops[e.from].frames;
      expect(heads, e.id).toHaveLength(Math.ceil(src / e.entry.stride));
      expect(heads.map((j: G) => j.job.phase), e.id).toEqual(headPhases(src, e.entry.stride));
      expect(mine.filter((j: G) => j.job.kind === "tail"), e.id).toHaveLength(1);
      for (const j of mine) expect(j.job).toMatchObject({ edge: e.id, from: e.from, to: e.to, headFrames: e.entry.headFrames, tailFrames: e.tail.frames });
    }
    expect(jobs).toHaveLength(4 + 5 + 42 + 70 + 38 + 19 + 38);
    expect(jobs.reduce((n: number, j: G) => n + j.frames, 0)).toBe(2931);
  });

  test("a job carries its source loop, target loop / edge, kind, phase and timing", () => {
    const j = jobs.find((x: G) => x.name === "head-ap-063");
    expect(j).toMatchObject({ clip: "ENTRY_HEAD_AP_063", edge: "analyzing>pointing", frames: 10, job: { kind: "head", from: "analyzing", to: "pointing", phase: 63, headFrames: 10, tailFrames: 35 } });
  });

  test("--only selects a frames folder, a loop or a whole edge", () => {
    expect(selectJobs(jobs, ["pointing"]).map((j: G) => j.name)).toEqual(["pointing"]);
    expect(selectJobs(jobs, ["pointing>watching"])).toHaveLength(1 + 38);
    expect(selectJobs(jobs, ["tail-wa"])).toHaveLength(1);
    expect(selectJobs(jobs, [])).toHaveLength(jobs.length);
  });

  test("capture.mjs and the guards name no state or clip", () => {
    for (const f of ["capture.mjs", "guards.py", "plan.mjs"]) {
      const code = readFileSync(join(DIR, f), "utf8").split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
      expect(code, f).not.toMatch(/WATCHING|ANALYZING|POINTING|CONFIRMING|TRANSITION_TAIL|ENTRY_HEAD|"watching"|"analyzing"|"pointing"|"confirming"/);
    }
  });
});

describe("unique edge namespaces", () => {
  const g = loadGraph();

  test("every edge owns a distinct namespace and its prefixes reach only its own heads", () => {
    expect(g.edges.map((e: G) => e.ns)).toEqual(["wa", "ap", "pc", "cp", "pw"]);
    const all = g.edges.flatMap((e: G) => headClipIds(g, e));
    expect(new Set(all).size).toBe(all.length);
    for (const e of g.edges) {
      const own = new Set(headClipIds(g, e));
      const reached = [...all, ...Object.values(g.loops).map((l: G) => l.clip), ...g.edges.map((x: G) => x.tail.clip)].filter((c) => c.startsWith(e.entry.headClipPrefix));
      expect(new Set(reached), e.id).toEqual(own);
      const dirs = new Set(headDirNames(g, e));
      for (const other of g.edges) if (other !== e) for (const d of headDirNames(g, other)) expect(dirs.has(d) || d.startsWith(e.entry.headDirPrefix), `${e.id} globs ${d}`).toBe(false);
    }
  });

  test("a bare 'head-' prefix (the old scheme) is rejected by BOTH validators, as is a shared or nested namespace", () => {
    const bare = fresh();
    bare.edges[1].entry.headClipPrefix = "ENTRY_HEAD_";
    bare.edges[1].entry.headDirPrefix = "head-";
    for (const problems of [validateGraph(bare), pyProblems(bare)]) {
      expect(problems.some((p: string) => /head prefix ENTRY_HEAD_ also matches ENTRY_HEAD_/.test(p))).toBe(true);
      expect(problems.some((p: string) => /head folder prefix head- also matches head-/.test(p))).toBe(true);
    }
    const dup = fresh();
    dup.edges[2].ns = "ap";
    expect(validateGraph(dup).some((p: string) => /namespace ap is used by another edge/.test(p))).toBe(true);
    expect(pyProblems(dup).some((p: string) => /namespace ap is used by another edge/.test(p))).toBe(true);
    const nested = fresh();
    nested.edges[3].entry.headClipPrefix = "ENTRY_HEAD_WA_X_";
    expect(validateGraph(nested).some((p: string) => /head prefix ENTRY_HEAD_WA_ also matches ENTRY_HEAD_WA_X_/.test(p))).toBe(true);
    expect(pyProblems(nested).some((p: string) => /head prefix ENTRY_HEAD_WA_ also matches ENTRY_HEAD_WA_X_/.test(p))).toBe(true);
  });

  test("a stray clip under an edge's prefix is caught by check_graph: one edge's heads cannot satisfy or hide another's", () => {
    const clips = py(
      "clips = {l['clip']: dict(frames=l['frames'], loop=True, chunks=[]) for l in d['loops'].values()}\nfor e in d['edges']:\n    clips[e['tail']['clip']] = dict(frames=e['tail']['frames'], loop=False, chunks=[])\n    for c in pm.head_clip_ids(d, e):\n        clips[c] = dict(frames=e['entry']['headFrames'], loop=False, chunks=[])\nprint(json.dumps(clips))",
      g,
    );
    const run = (mut: string) => py(`clips = d['clips']\nexec(d['mut'])\ntry:\n    pm.check_graph(d['g'], clips, 30)\n    print(json.dumps('ok'))\nexcept SystemExit as e:\n    print(json.dumps(str(e)))`, { g, clips, mut });
    // a head of edge ap sitting under wa's prefix (the old-scheme collision): unaccounted for -> rejected
    expect(run("clips['ENTRY_HEAD_WA_999'] = dict(frames=10, loop=False, chunks=[])")).toMatch(/clips the graph does not account for/);
    // the pw edge's head 009 missing is NOT papered over by any other edge's head 009
    expect(run("del clips['ENTRY_HEAD_PW_009']")).toMatch(/edge pointing>watching head: no clip ENTRY_HEAD_PW_009/);
    expect(run("clips['ENTRY_HEAD_PC_006']['frames'] = 9")).toMatch(/edge pointing>confirming head: ENTRY_HEAD_PC_006 has 9 frames \(loop=False\), expected 10/);
  });
});

describe("clip_plan and check_graph with 5 edges (Python)", () => {
  const g = loadGraph();

  test("clip_plan lists exactly the clips the graph derives: 4 loops + 5 tails + 207 heads, loops first, per edge tail then heads", () => {
    const plan = py("print(json.dumps(pm.clip_plan(d)))", g) as [string, string, boolean][];
    expect(plan).toHaveLength(4 + 5 + 42 + 70 + 38 + 19 + 38);
    expect(plan.filter((p) => p[2]).map((p) => p[0])).toEqual(["WATCHING_LOOP", "ANALYZING_LOOP", "POINTING_LOOP", "CONFIRMING_LOOP"]);
    expect(plan[4]).toEqual(["TAIL_WA", "tail-wa", false]);
    expect(plan[5]).toEqual(["ENTRY_HEAD_WA_000", "head-wa-000", false]);
    const heads = (p: string) => plan.filter((x) => x[0].startsWith(p)).length;
    expect([heads("ENTRY_HEAD_WA_"), heads("ENTRY_HEAD_AP_"), heads("ENTRY_HEAD_PC_"), heads("ENTRY_HEAD_CP_"), heads("ENTRY_HEAD_PW_")]).toEqual([42, 70, 38, 19, 38]);
    expect(new Set(plan.map((p) => p[0])).size).toBe(plan.length);
    // the plan does not depend on what is on disk: it is derived, not globbed
    expect(py("print(json.dumps(pm.expected_frames(d)['head-pw-111']))", g)).toBe(10);
  });

  test("clip_plan refuses an invalid graph instead of planning it", () => {
    const bad = fresh();
    edge(bad, "pointing>confirming").entry.stride = 6;
    edge(bad, "pointing>confirming").entry.maxStepFrames = 3;
    expect(py("print(json.dumps(pm.clip_plan(d)))", bad).error).toMatch(/stride 6 is coarser than pointing supports \(strideLimit 3\)/);
  });

  test("check_graph: the generated clip set passes; a wrong head grid, a wrong frame count, a loop flag, a missing tail and an fps mismatch each fail with the edge named", () => {
    const clips = py(
      "clips = {l['clip']: dict(frames=l['frames'], loop=True, chunks=[]) for l in d['loops'].values()}\nfor e in d['edges']:\n    clips[e['tail']['clip']] = dict(frames=e['tail']['frames'], loop=False, chunks=[])\n    for c in pm.head_clip_ids(d, e):\n        clips[c] = dict(frames=e['entry']['headFrames'], loop=False, chunks=[])\nprint(json.dumps(clips))",
      g,
    );
    const run = (mut: string, gg: G = g, fps = 30) => py(`clips = d['clips']\nexec(d['mut'])\ntry:\n    pm.check_graph(d['g'], clips, ${fps})\n    print(json.dumps('ok'))\nexcept SystemExit as e:\n    print(json.dumps(str(e)))`, { g: gg, clips, mut });
    expect(run("")).toBe("ok");
    expect(run("del clips['ENTRY_HEAD_AP_207']")).toMatch(/edge analyzing>pointing head: no clip ENTRY_HEAD_AP_207/);
    expect(run("clips['TAIL_PC']['frames'] = 30")).toMatch(/edge pointing>confirming tail: TAIL_PC has 30 frames/);
    expect(run("clips['POINTING_LOOP']['loop'] = False")).toMatch(/loop pointing: POINTING_LOOP/);
    expect(run("del clips['TAIL_CP']")).toMatch(/edge confirming>pointing tail: no clip TAIL_CP/);
    expect(run("", g, 24)).toMatch(/fps 30 differs from the pack's 24/);
    const wrongStride = fresh();
    edge(wrongStride, "analyzing>pointing").entry.stride = 6; // heads of the stride-3 grid now include off-grid ones
    edge(wrongStride, "analyzing>pointing").entry.maxStepFrames = 3;
    expect(run("", wrongStride)).toMatch(/stride 6 is coarser than analyzing supports/);
  });

  test("per-edge stride and entry strategy are data: validation rejects bad strides, bad budgets and unknown strategies in JS and Python alike", () => {
    const cases: [string, (g: G) => void, RegExp][] = [
      ["stride above the loop's limit", (g) => void (edge(g, "pointing>watching").entry.stride = 6), /stride 6 is coarser than pointing supports/],
      ["budget not floor(stride / 2)", (g) => void (edge(g, "analyzing>pointing").entry.maxStepFrames = 2), /maxStepFrames 2 must be floor\(stride \/ 2\) = 1/],
      ["stride beyond the loop", (g) => void (edge(g, "watching>analyzing").entry.stride = 999), /bad entry stride 999/],
      ["unknown strategy", (g) => void (edge(g, "watching>analyzing").entry.strategy = "canonical"), /unknown entry strategy canonical/],
      ["tail enter frame outside the target", (g) => void (edge(g, "pointing>confirming").tail.enterFrame = 999), /bad tail.enterFrame 999/],
      ["edge id not from>to", (g) => void (edge(g, "pointing>confirming").id = "pc"), /id must be "pointing>confirming"/],
      ["unknown loop", (g) => void (edge(g, "pointing>confirming").to = "nowhere"), /unknown loop nowhere/],
      ["no calibration for a loop", (g) => void delete g.budget.calibration.bytesPerFrame.pointing, /no calibration bytesPerFrame for loop pointing/],
      ["firstLoadPath names a missing loop", (g) => void (g.budget.firstLoadPath = ["watching", "ghost"]), /firstLoadPath must name loops/],
    ];
    for (const [name, mutate, re] of cases) {
      const g2 = fresh();
      mutate(g2);
      expect(validateGraph(g2).some((p: string) => re.test(p)), `js: ${name}`).toBe(true);
      expect(pyProblems(g2).some((p: string) => re.test(p)), `py: ${name}`).toBe(true);
    }
  });
});

describe("pack budget estimate and the 24 MB STOP gate", () => {
  const g = loadGraph();

  test("the committed pack calibrates the estimate: every loop's bytes per frame match the measured pack within 1 %, none is left unmeasured", () => {
    const m = JSON.parse(readFileSync(join(REPO, "apps/web/public/coach-motion-v2/prod/384/manifest.json"), "utf8"));
    expect(g.budget.calibration.unmeasured ?? []).toEqual([]);
    for (const [loop, { clip }] of Object.entries(m.graph.loops) as [string, { clip: string }][]) {
      const c = m.clips[clip];
      const perFrame = c.chunks.reduce((n: number, k: G) => n + k.bytes, 0) / c.frames;
      expect(Math.abs(g.budget.calibration.bytesPerFrame[loop] / perFrame - 1), loop).toBeLessThan(0.01);
    }
    // and the head cost the estimate assumes (head bytes per frame ~ the loop's) holds on the committed heads
    const heads = Object.entries(m.clips).filter(([k]) => k.startsWith("ENTRY_HEAD_WA_")) as [string, G][];
    const perHeadFrame = heads.reduce((n, [, c]) => n + c.chunks.reduce((s: number, k: G) => s + k.bytes, 0), 0) / (heads.length * 10);
    expect(perHeadFrame / g.budget.calibration.bytesPerFrame.watching).toBeGreaterThan(0.95);
    expect(perHeadFrame / g.budget.calibration.bytesPerFrame.watching).toBeLessThan(1.6);
  });

  test("the 5-edge plan: totals, first-load path and status", () => {
    const est = estimatePack(g);
    expect(est.edges.map((e: G) => [e.id, e.stride, e.heads, e.tailFrames])).toEqual([
      ["watching>analyzing", 6, 42, 35],
      ["analyzing>pointing", 3, 70, 35],
      ["pointing>confirming", 3, 38, 35],
      ["confirming>pointing", 6, 19, 35],
      ["pointing>watching", 3, 38, 35],
    ]);
    expect(est.totals.frames).toBe(2931);
    expect(est.totals.total).toBeGreaterThan(est.totals.loops + est.totals.heads);
    expect(est.totals.total).toBeLessThan(g.budget.packCeilingBytes);
    expect(est.firstLoad.bytes).toBeLessThan(8_000_000);
    expect(est.status).toBe("OK");
    expect(renderPlan(est)).toContain("STATUS: OK");
  });

  test("a projection above 24 MB is STOP: through a larger pack, through a finer stride, and through a bigger measured rate", () => {
    const rate = fresh();
    rate.budget.calibration.bytesPerFrame.pointing = 40_000;
    const r = estimatePack(rate);
    expect(r.status).toBe("STOP");
    expect(r.reasons.join(" ")).toMatch(/exceeds the 24000000 byte STOP ceiling/);
    const big = fresh();
    big.budget.packCeilingBytes = 18_000_000; // the committed graph projects ~19.1 MB
    expect(estimatePack(big).status).toBe("STOP");
    const first = fresh();
    first.budget.firstLoadBytes = 3_000_000;
    expect(estimatePack(first)).toMatchObject({ status: "STOP" });
    expect(renderPlan(estimatePack(big))).toMatch(/STATUS: STOP - projected pack/);
  });

  test("plan.mjs exits 2 on STOP and capture.mjs refuses to start (before launching a browser)", () => {
    const dir = mkdtempSync(join(tmpdir(), "cm-plan-"));
    made.push(dir);
    const bad = fresh();
    bad.budget.packCeilingBytes = 10_000_000;
    const file = join(dir, "graph.json");
    writeFileSync(file, JSON.stringify(bad));
    const plan = spawnSync("node", [join(DIR, "plan.mjs"), "--graph", file], { encoding: "utf8" });
    expect(plan.status).toBe(2);
    expect(plan.stdout).toContain("STATUS: STOP");
    const cap = spawnSync("node", [join(DIR, "capture.mjs"), "--out", join(dir, "frames"), "--graph", file], { encoding: "utf8" });
    expect(cap.status).not.toBe(0);
    expect(`${cap.stdout}${cap.stderr}`).toMatch(/STOP: projected pack/);
    const ok = spawnSync("node", [join(DIR, "capture.mjs"), "--out", join(dir, "frames"), "--plan-only"], { encoding: "utf8" });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("216 capture jobs, 2931 frames");
  });

  test("the MEASURED committed pack passes its gates and the planner's projection is within 5 % of it", () => {
    const rep = packReport(join(REPO, "apps/web/public/coach-motion-v2/prod/384"), g);
    expect(gates(rep, g).filter((x: G) => !x.ok)).toEqual([]);
    expect(rep.totals.total).toBe(rep.totalBytes);
    expect(Math.abs(estimatePack(g).totals.total / rep.totals.total - 1)).toBeLessThan(0.05);
    // a tighter ceiling turns the same measured pack into a failed gate
    const tight = fresh();
    tight.budget.packCeilingBytes = rep.totals.total - 1;
    expect(gates(rep, tight).find((x: G) => /packCeilingBytes/.test(x.gate)).ok).toBe(false);
  });

  test("encode refuses a finished pack above the ceiling (check_budget)", () => {
    expect(py("pm.check_budget(d, 23_000_000)\nprint(json.dumps('ok'))", g)).toBe("ok");
    expect(py("pm.check_budget(d, 24_000_001)\nprint(json.dumps('ok'))", g).error).toMatch(/STOP: the pack is 24000001 bytes/);
  });
});

describe("graph-driven guards on synthetic frames", () => {
  // two 12-frame loops on one circle, one edge (stride 4, 3-frame heads, 4-frame tail) whose heads converge on a shared tail; sizes are tiny so the test is fast
  const SCRIPT = `
import sys, json, os, math
sys.path.insert(0, ${JSON.stringify(DIR)})
import numpy as np
from PIL import Image
import pack_manifest as pm
import guards
root, mutate = sys.argv[1], sys.argv[2]
N, S, R, H, T = 12, 2 * math.pi / 12, 18, 3, 4
SIG = 4.0
def img(theta, eye=1.0):
    # a soft blob at a sub-pixel position: antialiased like a real render, so equal steps are equal distances
    yy, xx = np.mgrid[0:64, 0:64]
    cx, cy = 32 + R * math.cos(theta), 32 + R * math.sin(theta)
    al = np.exp(-(((xx - cx) ** 2 + (yy - cy) ** 2) / (2 * SIG ** 2)))
    a = np.zeros((64, 64, 4), np.uint8)
    a[..., 0], a[..., 1], a[..., 2] = 200, 120, 40
    a[..., 3] = (al * 255).astype(np.uint8)
    return Image.fromarray(a, "RGBA")
def put(d, thetas):
    os.makedirs(f"{root}/{d}", exist_ok=True)
    for i, t in enumerate(thetas):
        img(t).save(f"{root}/{d}/f{i:04d}.png")
graph = {
  "loops": {"a": {"clip": "A_LOOP", "dir": "a", "frames": N, "strideLimit": 4}, "b": {"clip": "B_LOOP", "dir": "b", "frames": N, "strideLimit": 4}},
  "edges": [{"id": "a>b", "ns": "ab", "from": "a", "to": "b", "fps": 30, "entry": {"strategy": "nearest-head", "stride": 4, "headClipPrefix": "H_AB_", "headDirPrefix": "head-ab-", "headFrames": H, "maxStepFrames": 2, "armHeads": 2}, "tail": {"clip": "T_AB", "dir": "tail-ab", "frames": T, "enterFrame": 0}, "lookaheadFrames": 28}],
  "budget": {"firstLoadBytes": 1000, "firstLoadPath": ["a", "b"], "packCeilingBytes": 100000, "calibration": {"bytesPerFrame": {"a": 10, "b": 10}}},
}
C0 = 1.0
conv = lambda k: C0 + k * S
put("a", [i * S for i in range(N)])
put("b", [conv(H + T) + i * S for i in range(N)])
put("tail-ab", [conv(H + k) for k in range(T)])
for p in pm.head_phases(N, 4):
    ths = []
    for k in range(H):
        w = k / (H - 1)
        ths.append((p + k) * S * (1 - w) + conv(k) * w)
    put(f"head-ab-{p:03d}", ths)
exec(mutate)
try:
    rep, fails = guards.run(root, graph)
    print(json.dumps(dict(fails=fails, edge=rep["edges"]["a>b"], loops=rep["loops"])))
except SystemExit as e:
    print(json.dumps(dict(exit=str(e))))
`;
  function guard(mutate = "") {
    const dir = mkdtempSync(join(tmpdir(), "cm-guards-"));
    made.push(dir);
    const r = spawnSync("python", ["-I", "-c", SCRIPT, dir, mutate], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`${r.stdout}${r.stderr}`);
    return JSON.parse(r.stdout.trim().split("\n").pop()!);
  }

  test("a clean synthetic edge passes every loop and edge guard, and the report is per loop / per edge", () => {
    const r = guard();
    expect(r.fails).toEqual([]);
    expect(Object.keys(r.loops)).toEqual(["a", "b"]);
    expect(r.edge).toMatchObject({ heads: 3, stride: 4, headFrames: 3, tailFrames: 4 });
    expect(r.edge.headFrame0VsSource.maxMad).toBe(0);
  });

  test("head frame 0 must equal its SOURCE loop's phase: a head built from another phase fails", () => {
    const r = guard("put('head-ab-004', [5 * S + k * S for k in range(H)])");
    expect(r.fails.join("|")).toMatch(/edge a>b: a head's frame 0 differs from its source-loop phase/);
  });

  test("head -> tail seam: a head that does not converge on the shared tail fails", () => {
    const r = guard("put('head-ab-008', [(8 + k) * S for k in range(H)])");
    expect(r.fails.join("|")).toMatch(/edge a>b: head -> tail seam/);
  });

  test("tail -> destination seam: a tail that ends far from the destination loop fails", () => {
    const r = guard("SIG = 14.0; put('b', [conv(H + T) + i * S for i in range(N)]); SIG = 4.0");
    expect(r.fails.join("|")).toMatch(/tail -> b seam/);
  });

  test("a frozen loop and a loop whose seam jumps fail", () => {
    expect(guard("guards.MAX_HELD_FRAMES = 8; put('a', [0.0] * N)").fails.join("|")).toMatch(/loop a: held 11 frames/);
    expect(guard("put('b', [i * S * 0.8 for i in range(N)])").fails.join("|")).toMatch(/loop b: loop seam/);
  });

  test("the head grid and counts come from the graph: a missing head or a wrong head length is an error naming the folder", () => {
    expect(guard("import shutil; shutil.rmtree(f'{root}/head-ab-004')").exit).toMatch(/frames folder head-ab-004: 0 frames, the graph expects 3/);
    expect(guard("import shutil; shutil.rmtree(f'{root}/head-ab-004'); put('head-ab-004', [4 * S, conv(1)])").exit).toMatch(/frames folder head-ab-004: 2 frames, the graph expects 3/);
  });

  test("a stray folder under the old bare 'head-' prefix is ignored, never read as one of this edge's heads", () => {
    const r = guard("put('head-999', [0.0] * 7)");
    expect(r.fails).toEqual([]);
    expect(r.edge.heads).toBe(3);
  });

  test("the chunk constant the plan relies on is the encoder's", () => {
    expect(CHUNK_FRAMES).toBe(14);
    expect(readFileSync(join(DIR, "encode.py"), "utf8")).toMatch(/CHUNK_FRAMES, COLS, PAD = 14, 4, 2/);
  });
});
