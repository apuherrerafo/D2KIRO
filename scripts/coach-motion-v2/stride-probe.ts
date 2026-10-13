// Entry-stride probe over the shipped WATCHING / ANALYZING pose tracks (see apps/web/features/coach-motion/stride-probe.ts). No rendering, no GPU.
// usage: bun scripts/coach-motion-v2/stride-probe.ts [report.json]
import { writeFileSync } from "node:fs";
import { NATURAL_STEP_FACTOR, probeSlice, recommendStride } from "../../apps/web/features/coach-motion/stride-probe";

const probe = probeSlice([1, 2, 3, 4, 5, 6, 8]);
const report = {
  what: "Entry mismatch of a request taken at loop frame f: the nearest entry head starts with the exact pose of its phase, so the picture jumps from pose(f) to pose(nearest phase). Distances are loop-pose.poseDistance (the metric of guards.py).",
  rule: `recommended stride = largest probed stride whose p95 entry jump is <= ${NATURAL_STEP_FACTOR} x the loop's own p95 frame-to-frame step (it reproduces the approved WATCHING stride 6)`,
  watching: { ...probe.watching, recommended: recommendStride(probe.watching) },
  analyzing: { ...probe.analyzing, recommended: recommendStride(probe.analyzing) },
};
for (const l of [report.watching, report.analyzing]) {
  console.log(`${l.loop}: step median ${l.step.median.toFixed(3)} p95 ${l.step.p95.toFixed(3)} max ${l.step.max.toFixed(3)} -> recommended stride ${l.recommended}`);
  for (const s of l.strides) console.log(`  stride ${s.stride}: ${s.heads} heads, worst ${s.maxFramesOff} frames off, max jump ${s.maxJump.toFixed(2)} (${s.jumpOverMaxStep.toFixed(2)} x max step), p95 ${s.p95Jump.toFixed(2)}`);
}
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 1));
