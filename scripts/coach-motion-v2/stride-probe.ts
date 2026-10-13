// Entry-stride and entry-strategy probe over the authored pose tracks of EVERY loop in graph.json (see apps/web/features/coach-motion/stride-probe.ts). No rendering, no GPU.
// usage: bun scripts/coach-motion-v2/stride-probe.ts [report.json]      (exit 1 when graph.json disagrees with the probe)
import { readFileSync, writeFileSync } from "node:fs";
import { jobPoses } from "../../apps/web/features/coach-motion/loop-pose";
import { NATURAL_STEP_FACTOR, chooseEntryStrategy, probeLoops, recommendStride, studyEntryStrategies, validateGraphStrides, type GraphForProbe } from "../../apps/web/features/coach-motion/stride-probe";

const graph = JSON.parse(readFileSync(new URL("./graph.json", import.meta.url), "utf8")) as GraphForProbe & { edges: Array<{ id: string; from: string; entry: { stride: number; maxStepFrames: number; strategy: string } }> };
const probes = probeLoops();
const report = {
  what: "Entry mismatch of a request taken at loop frame f: the nearest entry head starts with the exact pose of its phase, so the picture jumps from pose(f) to pose(nearest phase). Distances are loop-pose.poseDistance (the metric of guards.py).",
  rule: `stride = largest probed stride whose p95 entry jump is <= ${NATURAL_STEP_FACTOR} x the loop's own p95 frame-to-frame step (it reproduces the approved WATCHING stride 6)`,
  loops: Object.fromEntries(Object.entries(probes).map(([id, p]) => [id, { ...p, recommended: recommendStride(p) }])),
  strategies: {} as Record<string, unknown>,
};
for (const p of Object.values(report.loops)) {
  console.log(`${p.loop}: ${p.frames} frames, step median ${p.step.median.toFixed(3)} p95 ${p.step.p95.toFixed(3)} max ${p.step.max.toFixed(3)} -> recommended stride ${p.recommended}`);
  for (const s of p.strides) console.log(`  stride ${s.stride}: ${s.heads} heads, worst ${s.maxFramesOff} frames off, p95 jump ${s.p95Jump.toFixed(2)} (${(s.p95Jump / p.step.p95).toFixed(2)} x p95 step)`);
}
for (const e of graph.edges) {
  const studies = studyEntryStrategies(jobPoses({ kind: "loop", loop: e.from }), e.entry.stride, e.entry.maxStepFrames);
  const choice = chooseEntryStrategy(studies);
  report.strategies[e.id] = { stride: e.entry.stride, committed: e.entry.strategy, rule: choice, studies };
  console.log(`${e.id}: committed ${e.entry.strategy}; rule -> ${choice.strategy} (${choice.why})`);
  for (const s of studies) console.log(`    ${s.strategy.padEnd(13)} off<=${s.maxMismatchFrames}f  seam ${s.maxSeamOverNaturalStep.toFixed(2)} steps  wait mean ${s.meanWaitFrames.toFixed(2)} max ${s.maxWaitFrames}  holds ${s.holds}  reversals ${s.reversals}`);
}
const problems = validateGraphStrides(graph, probes);
if (problems.length) console.log(`GRAPH vs PROBE:\n  - ${problems.join("\n  - ")}`);
else console.log("graph.json strides, strideLimits, budgets and frame counts agree with the probe");
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 1));
process.exit(problems.length ? 1 : 0);
