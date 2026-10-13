// Graph-driven planning of the Coach Motion V2 pack: validation of graph.json, the capture job list, and the size estimate with its STOP gates.
// Everything here derives from scripts/coach-motion-v2/graph.json; no state or edge is named in this file.
// usage: node scripts/coach-motion-v2/plan.mjs [--graph <graph.json>] [--json <report.json>]    (exit 2 when a budget gate says STOP)
// pack_manifest.py (validate_graph / clip_plan / check_graph) implements the same static rules for the Python side; authoring.test.ts runs both on the same mutations.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const GRAPH_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "graph.json");
export const ENTRY_STRATEGIES = ["nearest-head"];
export const CHUNK_FRAMES = 14;
export const pad3 = (n) => String(n).padStart(3, "0");
const isInt = (v, min = 0) => Number.isInteger(v) && v >= min;

export const loadGraph = (path = GRAPH_FILE) => JSON.parse(readFileSync(path, "utf8"));

/** Source-loop phases that have an entry head: 0, stride, 2 * stride, ... */
export function headPhases(loopFrames, stride) {
  const out = [];
  for (let p = 0; p < loopFrames; p += stride) out.push(p);
  return out;
}

/** The clip id / frame-folder name of every head of an edge (the ONLY names that edge owns under its prefixes). */
export const headClipIds = (graph, edge) => headPhases(graph.loops[edge.from].frames, edge.entry.stride).map((p) => edge.entry.headClipPrefix + pad3(p));
export const headDirNames = (graph, edge) => headPhases(graph.loops[edge.from].frames, edge.entry.stride).map((p) => edge.entry.headDirPrefix + pad3(p));

/** Every reason graph.json is not a valid authoring graph; empty = valid. Static rules only (no frames on disk, no pose tracks). */
export function validateGraph(graph) {
  const problems = [];
  const bad = (why) => problems.push(why);
  const loops = Object.entries(graph.loops ?? {});
  if (!loops.length) bad("graph has no loops");
  const clips = new Map(); // clip id -> owner
  const dirs = new Map();
  const claim = (map, name, owner, what) => {
    if (map.has(name)) bad(`${what} ${name} is used by both ${map.get(name)} and ${owner}`);
    else map.set(name, owner);
  };
  for (const [id, l] of loops) {
    if (typeof l.clip !== "string" || !l.clip || typeof l.dir !== "string" || !l.dir) bad(`loop ${id}: needs a clip id and a frames folder`);
    if (!isInt(l.frames, 1)) bad(`loop ${id}: bad frames ${l.frames}`);
    if (!isInt(l.strideLimit, 1)) bad(`loop ${id}: bad strideLimit ${l.strideLimit}`);
    if (l.blinks !== undefined && !isInt(l.blinks, 0)) bad(`loop ${id}: bad blinks ${l.blinks}`);
    claim(clips, l.clip, `loop ${id}`, "clip");
    claim(dirs, l.dir, `loop ${id}`, "folder");
  }
  const ids = new Set();
  const spaces = new Set();
  const edges = graph.edges ?? [];
  for (const e of edges) {
    if (ids.has(e.id)) bad(`duplicate edge ${e.id}`);
    ids.add(e.id);
    if (!/^[a-z][a-z0-9]{0,3}$/.test(e.ns ?? "")) bad(`edge ${e.id}: bad namespace ${e.ns}`);
    else if (spaces.has(e.ns)) bad(`edge ${e.id}: namespace ${e.ns} is used by another edge`);
    spaces.add(e.ns);
    const from = graph.loops[e.from];
    const to = graph.loops[e.to];
    if (!from || !to) {
      bad(`edge ${e.id}: unknown loop ${!from ? e.from : e.to}`);
      continue;
    }
    if (e.from === e.to) bad(`edge ${e.id}: from and to are the same loop`);
    if (e.id !== `${e.from}>${e.to}`) bad(`edge ${e.id}: id must be "${e.from}>${e.to}"`);
    if (!isInt(e.fps, 1)) bad(`edge ${e.id}: bad fps ${e.fps}`);
    const en = e.entry ?? {};
    if (!ENTRY_STRATEGIES.includes(en.strategy)) bad(`edge ${e.id}: unknown entry strategy ${en.strategy}`);
    if (!isInt(en.stride, 1) || en.stride > from.frames) bad(`edge ${e.id}: bad entry stride ${en.stride}`);
    else {
      if (en.stride > from.strideLimit) bad(`edge ${e.id}: stride ${en.stride} is coarser than ${e.from} supports (strideLimit ${from.strideLimit})`);
      if (en.maxStepFrames !== Math.floor(en.stride / 2)) bad(`edge ${e.id}: maxStepFrames ${en.maxStepFrames} must be floor(stride / 2) = ${Math.floor(en.stride / 2)}`);
    }
    if (!isInt(en.headFrames, 1) || !isInt(en.armHeads, 1)) bad(`edge ${e.id}: bad headFrames / armHeads`);
    if (typeof en.headClipPrefix !== "string" || !en.headClipPrefix || typeof en.headDirPrefix !== "string" || !en.headDirPrefix) bad(`edge ${e.id}: needs head prefixes`);
    const t = e.tail ?? {};
    if (!isInt(t.frames, 1)) bad(`edge ${e.id}: bad tail.frames ${t.frames}`);
    if (!isInt(t.enterFrame, 0) || t.enterFrame >= to.frames) bad(`edge ${e.id}: bad tail.enterFrame ${t.enterFrame}`);
    if (typeof t.clip !== "string" || !t.clip || typeof t.dir !== "string" || !t.dir) bad(`edge ${e.id}: needs a tail clip id and folder`);
    else {
      claim(clips, t.clip, `edge ${e.id} tail`, "clip");
      claim(dirs, t.dir, `edge ${e.id} tail`, "folder");
    }
    if (!isInt(e.lookaheadFrames, CHUNK_FRAMES)) bad(`edge ${e.id}: lookaheadFrames must be at least one chunk (${CHUNK_FRAMES})`);
  }
  // heads: every generated name is unique, and an edge's prefix reaches ONLY its own heads (nothing else in the pack starts with it)
  for (const e of edges) {
    const from = graph.loops[e.from];
    if (!from || !graph.loops[e.to] || !e.entry || typeof e.entry.headClipPrefix !== "string" || !isInt(e.entry.stride, 1)) continue;
    for (const [map, names, what] of [[clips, headClipIds(graph, e), "clip"], [dirs, headDirNames(graph, e), "folder"]]) {
      for (const n of names) claim(map, n, `edge ${e.id} head`, what);
    }
  }
  for (const e of edges) {
    if (!e.entry || typeof e.entry.headClipPrefix !== "string" || !graph.loops[e.from] || !isInt(e.entry.stride, 1)) continue;
    const own = new Set(headClipIds(graph, e));
    const ownDirs = new Set(headDirNames(graph, e));
    const strayClip = [...clips.keys()].find((c) => c.startsWith(e.entry.headClipPrefix) && !own.has(c));
    const strayDir = [...dirs.keys()].find((d) => d.startsWith(e.entry.headDirPrefix) && !ownDirs.has(d));
    if (strayClip) bad(`edge ${e.id}: head prefix ${e.entry.headClipPrefix} also matches ${strayClip}`);
    if (strayDir) bad(`edge ${e.id}: head folder prefix ${e.entry.headDirPrefix} also matches ${strayDir}`);
  }
  const b = graph.budget ?? {};
  if (!isInt(b.firstLoadBytes, 1) || !isInt(b.packCeilingBytes, 1)) bad("budget: firstLoadBytes and packCeilingBytes are required");
  if (!Array.isArray(b.firstLoadPath) || b.firstLoadPath.length < 1 || b.firstLoadPath.some((id) => !graph.loops?.[id])) bad("budget: firstLoadPath must name loops of the graph");
  for (const id of Object.keys(graph.loops ?? {})) if (!(b.calibration?.bytesPerFrame?.[id] > 0)) bad(`budget: no calibration bytesPerFrame for loop ${id}`);
  return problems;
}

export function assertValidGraph(graph) {
  const problems = validateGraph(graph);
  if (problems.length) throw new Error(`graph.json is not a valid authoring graph:\n  - ${problems.join("\n  - ")}`);
  return graph;
}

/**
 * The capture jobs of a graph, in render order: every loop, then per edge its tail and one head per source-loop phase on the edge's stride grid.
 * `name` is the frames folder (the clip's `dir`); `job` is what the capture page turns into poses (loop-pose.ts `Job`).
 */
export function planJobs(graph) {
  assertValidGraph(graph);
  const jobs = [];
  for (const [id, l] of Object.entries(graph.loops)) jobs.push({ name: l.dir, clip: l.clip, loop: id, frames: l.frames, job: { kind: "loop", loop: id } });
  for (const e of graph.edges) {
    const shared = { edge: e.id, from: e.from, to: e.to, headFrames: e.entry.headFrames, tailFrames: e.tail.frames };
    jobs.push({ name: e.tail.dir, clip: e.tail.clip, edge: e.id, frames: e.tail.frames, job: { kind: "tail", ...shared } });
    for (const p of headPhases(graph.loops[e.from].frames, e.entry.stride)) {
      jobs.push({ name: e.entry.headDirPrefix + pad3(p), clip: e.entry.headClipPrefix + pad3(p), edge: e.id, frames: e.entry.headFrames, job: { kind: "head", ...shared, phase: p } });
    }
  }
  return jobs;
}

/** `--only` selector: a frames folder name, a loop id or an edge id. */
export const selectJobs = (jobs, only) => (only.length ? jobs.filter((j) => only.includes(j.name) || only.includes(j.loop) || only.includes(j.edge)) : jobs);

// ------------------------------------------------------------------ size estimate

/**
 * Projected bytes of the pack from loop durations, strides, head counts and tail durations, at the calibrated bytes-per-frame of each loop:
 * a head costs the rate of its SOURCE loop, a tail the mean of its two loops. Returns the planning tables and the gate status.
 */
export function estimatePack(graph) {
  assertValidGraph(graph);
  const rate = graph.budget.calibration.bytesPerFrame;
  const loops = Object.entries(graph.loops).map(([id, l]) => ({ id, frames: l.frames, seconds: l.frames / 30, bytesPerFrame: rate[id], bytes: l.frames * rate[id], measured: !(graph.budget.calibration.unmeasured ?? []).includes(id) }));
  const edges = graph.edges.map((e) => {
    const src = graph.loops[e.from];
    const heads = headPhases(src.frames, e.entry.stride).length;
    const headBytes = heads * e.entry.headFrames * rate[e.from];
    const tailBytes = e.tail.frames * ((rate[e.from] + rate[e.to]) / 2);
    return { id: e.id, sourceLoopFrames: src.frames, stride: e.entry.stride, strategy: e.entry.strategy, heads, headFrames: e.entry.headFrames, headBytes, tailFrames: e.tail.frames, tailBytes, armHeads: e.entry.armHeads, armedBytes: e.entry.armHeads * e.entry.headFrames * rate[e.from] };
  });
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
  const totals = { loops: sum(loops, (l) => l.bytes), heads: sum(edges, (e) => e.headBytes), tails: sum(edges, (e) => e.tailBytes), frames: sum(loops, (l) => l.frames) + sum(edges, (e) => e.heads * e.headFrames + e.tailFrames) };
  totals.total = totals.loops + totals.heads + totals.tails;
  // first load: the first loop, then per hop of the path the armed heads, the tail and the target loop
  const path = graph.budget.firstLoadPath;
  const byId = Object.fromEntries(loops.map((l) => [l.id, l]));
  let firstLoad = byId[path[0]].bytes;
  const problems = [];
  for (let i = 1; i < path.length; i += 1) {
    const edge = edges.find((e) => e.id === `${path[i - 1]}>${path[i]}`);
    if (!edge) problems.push(`firstLoadPath hop ${path[i - 1]}>${path[i]} is not an edge`);
    else firstLoad += edge.armedBytes + edge.tailBytes + byId[path[i]].bytes;
  }
  const reasons = [...problems];
  if (totals.total > graph.budget.packCeilingBytes) reasons.push(`projected pack ${totals.total} bytes exceeds the ${graph.budget.packCeilingBytes} byte STOP ceiling`);
  if (firstLoad > graph.budget.firstLoadBytes) reasons.push(`projected first load ${firstLoad} bytes exceeds ${graph.budget.firstLoadBytes}`);
  return { loops, edges, totals, firstLoad: { path, bytes: firstLoad, limit: graph.budget.firstLoadBytes }, ceiling: graph.budget.packCeilingBytes, status: reasons.length ? "STOP" : "OK", reasons };
}

const mb = (n) => (n / 1e6).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);

/** Plain-text planning tables of an estimate. */
export function renderPlan(est) {
  const lines = [];
  lines.push("EDGE".padEnd(24) + "SRC FRAMES  STRIDE  ENTRY          HEADS  HEAD MB  TAIL FRAMES  TAIL MB");
  for (const e of est.edges) lines.push(pad(e.id, 24) + pad(e.sourceLoopFrames, 12) + pad(e.stride, 8) + pad(e.strategy, 15) + pad(e.heads, 7) + pad(mb(e.headBytes), 9) + pad(e.tailFrames, 13) + mb(e.tailBytes));
  lines.push("");
  lines.push("LOOP".padEnd(14) + "FRAMES  SECONDS  KB/FRAME  MB     RATE");
  for (const l of est.loops) lines.push(pad(l.id, 14) + pad(l.frames, 8) + pad(l.seconds.toFixed(2), 9) + pad((l.bytesPerFrame / 1000).toFixed(2), 10) + pad(mb(l.bytes), 7) + (l.measured ? "measured" : "ESTIMATE"));
  lines.push("");
  lines.push(`loops ${mb(est.totals.loops)} MB + heads ${mb(est.totals.heads)} MB + tails ${mb(est.totals.tails)} MB = ${mb(est.totals.total)} MB over ${est.totals.frames} frames (STOP ceiling ${mb(est.ceiling)} MB)`);
  lines.push(`first load (${est.firstLoad.path.join(" > ")}): ${mb(est.firstLoad.bytes)} MB (limit ${mb(est.firstLoad.limit)} MB)`);
  lines.push(est.status === "OK" ? "STATUS: OK" : `STATUS: STOP - ${est.reasons.join("; ")}`);
  return lines.join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const est = estimatePack(loadGraph(arg("graph") ?? GRAPH_FILE));
  console.log(renderPlan(est));
  if (arg("json")) writeFileSync(arg("json"), JSON.stringify(est, null, 1));
  process.exit(est.status === "OK" ? 0 : 2);
}
