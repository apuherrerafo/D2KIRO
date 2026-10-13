// Pose-space motion of EVERY head of EVERY edge of graph.json (head + tail, per-frame steps), straight from loop-pose.ts: no render, no browser, deterministic.
// Complements the real-render calibration (calibration-guards.py): a few rendered heads say what a transition looks like, this says how the rest of the stride grid compares,
// and puts a candidate edge next to an edge that is already accepted (the baseline column).
// usage: bun run scripts/coach-motion-v2/transition-scan.ts [--baseline watching>analyzing] [--json <file>]
import { writeFileSync } from "node:fs";
import graph from "./graph.json";
import { headPhases, jobPoses, type Job } from "../../apps/web/features/coach-motion/loop-pose";

const TAU = Math.PI * 2;
const wrap = (d: number) => ((((d + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

interface Row { phase: number; ring: number; radius: number; visor: number; eyes: number; eyeOpen: number }
interface EdgeScan { heads: number; ringMax: number; ringMedian: number; ringWorstPhase: number; radiusMax: number; visorMax: number; eyesMax: number; eyeOpenMax: number }

export function scanEdge(e: (typeof graph.edges)[number]): EdgeScan {
  const from = (graph.loops as Record<string, { frames: number }>)[e.from];
  const base = { edge: e.id, from: e.from, to: e.to, headFrames: e.entry.headFrames, tailFrames: e.tail.frames };
  const tail = jobPoses({ kind: "tail", ...base } as Job);
  const rows: Row[] = headPhases(from.frames, e.entry.stride).map((phase) => {
    const seq = [...jobPoses({ kind: "head", ...base, phase } as Job), ...tail];
    const r: Row = { phase, ring: 0, radius: 0, visor: 0, eyes: 0, eyeOpen: 0 };
    for (let i = 0; i + 1 < seq.length; i += 1) {
      const a = seq[i];
      const b = seq[i + 1];
      r.ring = Math.max(r.ring, Math.abs(wrap(b.shardSpin - a.shardSpin)));
      r.radius = Math.max(r.radius, Math.abs(b.shardRadius - a.shardRadius));
      r.visor = Math.max(r.visor, Math.abs(b.yaw - a.yaw), Math.abs(b.pitch - a.pitch));
      r.eyes = Math.max(r.eyes, Math.abs(b.eyeX - a.eyeX), Math.abs(b.eyeZ - a.eyeZ));
      r.eyeOpen = Math.max(r.eyeOpen, Math.abs(b.eyeOpen - a.eyeOpen));
    }
    return r;
  });
  const max = (k: keyof Row) => Math.max(...rows.map((r) => r[k]));
  const sorted = rows.map((r) => r.ring).sort((a, b) => a - b);
  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    heads: rows.length, ringMax: r3(max("ring")), ringMedian: r3(sorted[Math.floor(sorted.length / 2)]), ringWorstPhase: rows.reduce((a, b) => (b.ring > a.ring ? b : a)).phase,
    radiusMax: r3(max("radius")), visorMax: r3(max("visor")), eyesMax: r3(max("eyes")), eyeOpenMax: r3(max("eyeOpen")),
  };
}

if (import.meta.main) {
  const scan = Object.fromEntries(graph.edges.map((e) => [e.id, scanEdge(e)]));
  const baseline = arg("baseline");
  console.log("max per-frame step over head + tail of every head of the grid (radians; eyes / radius in pose units)");
  console.log("edge".padEnd(24) + "heads  ringMax ringMed worst  visor  eyes   eyeOpen  vs " + (baseline ?? "-"));
  for (const [id, s] of Object.entries(scan)) {
    const rel = baseline && scan[baseline] ? `ring ${(s.ringMax / scan[baseline].ringMax).toFixed(2)}x visor ${(s.visorMax / scan[baseline].visorMax).toFixed(2)}x` : "";
    console.log(id.padEnd(24) + String(s.heads).padEnd(7) + String(s.ringMax).padEnd(8) + String(s.ringMedian).padEnd(8) + String(s.ringWorstPhase).padEnd(7) + String(s.visorMax).padEnd(7) + String(s.eyesMax).padEnd(7) + String(s.eyeOpenMax).padEnd(9) + rel);
  }
  const out = arg("json");
  if (out) writeFileSync(out, JSON.stringify(scan, null, 1));
}
