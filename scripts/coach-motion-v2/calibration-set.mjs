// The clip set of the real-render calibration (calibration.json) resolved against graph.json. Shared by capture (--only list) and the report.
// usage: node scripts/coach-motion-v2/calibration-set.mjs [--graph graph.json]     prints the comma-separated capture.mjs --only list
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_FILE, assertValidGraph, loadGraph, pad3 } from "./plan.mjs";

export const CALIBRATION_FILE = resolve(dirname(fileURLToPath(import.meta.url)), "calibration.json");
export const loadCalibration = (path = CALIBRATION_FILE) => JSON.parse(readFileSync(path, "utf8"));

/** Every scenario against the graph: the edge, its head phases (all on the stride grid, canonical among them) and the frame folders / clip ids it needs. */
export function resolveCalibration(graph, cal = loadCalibration()) {
  assertValidGraph(graph);
  return cal.scenarios.map((s) => {
    const edge = graph.edges.find((e) => e.id === s.edge);
    if (!edge) throw new Error(`calibration: unknown edge ${s.edge}`);
    const src = graph.loops[edge.from];
    for (const p of s.headPhases) if (p % edge.entry.stride !== 0 || p >= src.frames) throw new Error(`calibration ${s.edge}: head phase ${p} is not on the stride-${edge.entry.stride} grid of ${edge.from}`);
    if (!s.headPhases.includes(s.canonicalHead)) throw new Error(`calibration ${s.edge}: canonicalHead ${s.canonicalHead} is not one of headPhases`);
    return {
      ...s,
      from: edge.from,
      to: edge.to,
      stride: edge.entry.stride,
      headFrames: edge.entry.headFrames,
      tail: { clip: edge.tail.clip, dir: edge.tail.dir, frames: edge.tail.frames, enterFrame: edge.tail.enterFrame },
      heads: s.headPhases.map((p) => ({ phase: p, clip: edge.entry.headClipPrefix + pad3(p), dir: edge.entry.headDirPrefix + pad3(p) })),
    };
  });
}

/** Loops (as graph ids) the calibration touches: both ends of every scenario. */
export const calibrationLoops = (scenarios) => [...new Set(scenarios.flatMap((s) => [s.from, s.to]))];

/** The frames folders to capture, in --only form. */
export function calibrationFolders(graph, cal = loadCalibration()) {
  const sc = resolveCalibration(graph, cal);
  return [...calibrationLoops(sc).map((id) => graph.loops[id].dir), ...sc.flatMap((s) => [s.tail.dir, ...s.heads.map((h) => h.dir)])];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const graph = loadGraph(arg("graph") ?? GRAPH_FILE);
  // --json <file>: the resolved set for the Python side (calibrate.py / calibration-guards.py), which re-implements none of this
  if (arg("json")) {
    const scenarios = resolveCalibration(graph);
    const loops = calibrationLoops(scenarios).map((id) => ({ id, ...graph.loops[id] }));
    writeFileSync(arg("json"), JSON.stringify({ px: loadCalibration().px, loops, scenarios }, null, 1));
  }
  console.log(calibrationFolders(graph).join(","));
}
