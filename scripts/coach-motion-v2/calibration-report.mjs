// Re-projects the Coach Motion V2 pack from the bytes the real calibration encode MEASURED (calibrate.py), against graph.json's planning rates.
// usage: node scripts/coach-motion-v2/calibration-report.mjs --pack <calibration pack dir> [--json <file>]
// Two projections: (A) the planner's own model (plan.mjs estimatePack: a head costs its source loop's rate, a tail the mean of its two loops) with the measured pointing / confirming rates;
//                  (B) the same, but heads and tails priced at what the calibration measured for THEIR edge (a transition is not a loop: heads / tails can cost more or less per frame).
// Edges the calibration did not render (watching>analyzing) keep their graph.json rates in both.
import { readFileSync, writeFileSync } from "node:fs";
import { GRAPH_FILE, estimatePack, headPhases, loadGraph } from "./plan.mjs";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const packDir = arg("pack");
if (!packDir) throw new Error("--pack <calibration pack dir> is required");
const manifest = JSON.parse(readFileSync(`${packDir}/manifest.json`, "utf8"));
const graph = loadGraph(GRAPH_FILE);
const planRate = graph.budget.calibration.bytesPerFrame;
const clips = Object.values(manifest.clips);
const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
const perFrame = (xs) => sum(xs, (c) => c.bytes) / sum(xs, (c) => c.frames);

// measured rates
const loopRate = Object.fromEntries(Object.entries(manifest.loops).map(([id, clip]) => [id, manifest.clips[clip].bytesPerFrame]));
const edgeRate = {};
for (const s of manifest.scenarios) {
  const mine = clips.filter((c) => c.owner === s.edge);
  edgeRate[s.edge] = { head: perFrame(mine.filter((c) => c.kind === "head")), tail: perFrame(mine.filter((c) => c.kind === "tail")) };
}

// (A) the planner's model, pointing / confirming at their measured rate
const gA = structuredClone(graph);
for (const id of ["pointing", "confirming"]) gA.budget.calibration.bytesPerFrame[id] = Math.round(loopRate[id]);
gA.budget.calibration.unmeasured = [];
const A = estimatePack(gA);

// (B) per-edge measured head / tail rates
const rate = gA.budget.calibration.bytesPerFrame;
const edges = graph.edges.map((e) => {
  const heads = headPhases(graph.loops[e.from].frames, e.entry.stride).length;
  const m = edgeRate[e.id];
  const headRate = m ? m.head : rate[e.from];
  const tailRate = m ? m.tail : (rate[e.from] + rate[e.to]) / 2;
  return { id: e.id, heads, headRate, tailRate, headBytes: heads * e.entry.headFrames * headRate, tailBytes: e.tail.frames * tailRate, armedBytes: e.entry.armHeads * e.entry.headFrames * headRate, measured: Boolean(m) };
});
const loopBytes = Object.entries(graph.loops).map(([id, l]) => ({ id, bytes: l.frames * rate[id] }));
const totalB = sum(loopBytes, (l) => l.bytes) + sum(edges, (e) => e.headBytes + e.tailBytes);
const loopOf = Object.fromEntries(loopBytes.map((l) => [l.id, l.bytes]));
const pathBytes = (path) => path.slice(1).reduce((n, id, i) => { const e = edges.find((x) => x.id === `${path[i]}>${id}`); return n + e.armedBytes + e.tailBytes + loopOf[id]; }, loopOf[path[0]]);
const paths = { firstLoad: ["watching", "analyzing"], toPointing: ["watching", "analyzing", "pointing"], toConfirming: ["watching", "analyzing", "pointing", "confirming"] };
const pathB = Object.fromEntries(Object.entries(paths).map(([k, p]) => [k, pathBytes(p)]));
// the planner's model on the same paths
const pathA = Object.fromEntries(Object.entries(paths).map(([k, p]) => {
  const byEdge = Object.fromEntries(A.edges.map((e) => [e.id, e]));
  const byLoop = Object.fromEntries(A.loops.map((l) => [l.id, l.bytes]));
  return [k, p.slice(1).reduce((n, id, i) => { const e = byEdge[`${p[i]}>${id}`]; return n + e.armedBytes + e.tailBytes + byLoop[id]; }, byLoop[p[0]])];
}));

const mb = (n) => (n / 1e6).toFixed(2);
const kb = (n) => (n / 1000).toFixed(2);
const report = {
  planned: { pointing: planRate.pointing, confirming: planRate.confirming },
  measuredLoopBytesPerFrame: loopRate,
  measuredEdge: edgeRate,
  crossCheck: { watching: { committed: planRate.watching, calibration: loopRate.watching }, analyzing: { committed: planRate.analyzing, calibration: loopRate.analyzing } },
  projectionPlannerModel: { totalBytes: A.totals.total, loops: A.totals.loops, heads: A.totals.heads, tails: A.totals.tails, firstLoad: A.firstLoad.bytes, paths: pathA, status: A.status, reasons: A.reasons },
  projectionMeasuredEdges: { totalBytes: totalB, heads: sum(edges, (e) => e.headBytes), tails: sum(edges, (e) => e.tailBytes), edges, paths: pathB, status: totalB > graph.budget.packCeilingBytes ? "STOP" : "OK" },
  ceilingBytes: graph.budget.packCeilingBytes,
  planningPack: estimatePack(graph).totals.total,
};
console.log(`planned ${kb(planRate.pointing)} KB/frame (pointing, confirming)  ->  measured pointing ${kb(loopRate.pointing)}, confirming ${kb(loopRate.confirming)}`);
console.log(`cross-check at this crop: watching ${kb(loopRate.watching)} vs committed ${kb(planRate.watching)}, analyzing ${kb(loopRate.analyzing)} vs ${kb(planRate.analyzing)}`);
for (const e of edges) console.log(`${e.id.padEnd(22)} heads ${kb(e.headRate)} KB/f  tail ${kb(e.tailRate)} KB/f  ${e.measured ? "measured" : "graph rate"}  head cost/edge ${mb(e.headBytes)} MB  tail ${mb(e.tailBytes)} MB`);
console.log(`planning pack (graph.json as is): ${mb(report.planningPack)} MB`);
console.log(`(A) planner model, measured loop rates : ${mb(A.totals.total)} MB   (${A.status})`);
console.log(`(B) measured head / tail rates per edge: ${mb(totalB)} MB   (${report.projectionMeasuredEdges.status}; ceiling ${mb(report.ceilingBytes)} MB)`);
console.log(`first load  watching>analyzing         : A ${mb(pathA.firstLoad)} MB, B ${mb(pathB.firstLoad)} MB (limit ${mb(graph.budget.firstLoadBytes)} MB)`);
console.log(`common path to POINTING                : A ${mb(pathA.toPointing)} MB, B ${mb(pathB.toPointing)} MB`);
console.log(`common path to CONFIRMING              : A ${mb(pathA.toConfirming)} MB, B ${mb(pathB.toConfirming)} MB`);
if (arg("json")) writeFileSync(arg("json"), JSON.stringify(report, null, 1));
