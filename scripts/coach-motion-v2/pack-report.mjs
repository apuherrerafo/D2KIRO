// MEASURED size report of an encoded Coach Motion V2 pack (the manifest's real chunk bytes, not the planner's per-frame rates) and its size gates.
// usage: node scripts/coach-motion-v2/pack-report.mjs [--pack apps/web/public/coach-motion-v2/prod/384] [--graph graph.json] [--json report.json]     exit 1 when a gate fails
// Everything is derived from the manifest's graph and graph.json's budget; no state or edge is named here.
//   LOOPS / HEADS BY EDGE / TAILS BY EDGE / TOTAL     sum of chunk bytes per clip kind
//   first animated frame   manifest + the chunks the player requests before its first paint (the first loop's current + next chunk)
//   path milestones        along budget.firstLoadPath and then along the longest common path the graph allows from it: the first loop (one full lap), then per hop the armed
//                          entry heads, the WHOLE tail and one full lap of the target loop. A chunk counts once (immutable URLs: the HTTP cache answers a repeat).
//   gates                  total <= budget.packCeilingBytes (STOP), firstLoadPath milestone <= budget.firstLoadBytes
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GRAPH_FILE, headPhases, loadGraph, pad3 } from "./plan.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

/** The measured report of one pack directory against an authoring graph. `path` = the loops to walk for the milestones (defaults to the budget path). */
export function packReport(packDir, graph, path = graph.budget.firstLoadPath) {
  const manifestFile = `${packDir}/manifest.json`;
  const m = JSON.parse(readFileSync(manifestFile, "utf8"));
  const manifestBytes = statSync(manifestFile).size;
  const bytesOf = (clip) => m.clips[clip].chunks.reduce((n, c) => n + c.bytes, 0);
  const loops = Object.fromEntries(Object.entries(m.graph.loops).map(([id, l]) => [id, { clip: l.clip, frames: m.clips[l.clip].frames, bytes: bytesOf(l.clip), bytesPerFrame: bytesOf(l.clip) / m.clips[l.clip].frames }]));
  const edges = m.graph.edges.map((e) => {
    const heads = headPhases(m.clips[m.graph.loops[e.from].clip].frames, e.entry.stride).map((p) => e.entry.headClipPrefix + pad3(p));
    const headBytes = heads.reduce((n, c) => n + bytesOf(c), 0);
    return { id: e.id, heads: heads.length, headBytes, headBytesPerFrame: headBytes / (heads.length * e.entry.headFrames), tail: e.tail.clip, tailBytes: bytesOf(e.tail.clip), armHeads: e.entry.armHeads, maxHeadBytes: Math.max(...heads.map(bytesOf)) };
  });
  const sum = (xs, f) => xs.reduce((n, x) => n + f(x), 0);
  const totals = { loops: sum(Object.values(loops), (l) => l.bytes), heads: sum(edges, (e) => e.headBytes), tails: sum(edges, (e) => e.tailBytes) };
  totals.total = totals.loops + totals.heads + totals.tails;
  const allChunks = Object.values(m.clips).flatMap((c) => c.chunks);
  const chunkBytes = allChunks.reduce((n, c) => n + c.bytes, 0);

  // first animated frame: the controller requests the first loop's current + next chunk (both REQUIRED) and paints when the first one is decoded
  const first = m.clips[loops[path[0]].clip].chunks.slice(0, 2);
  const firstFrame = manifestBytes + first[0].bytes;
  const firstFrameWithNext = manifestBytes + first.reduce((n, c) => n + c.bytes, 0);

  // milestones: one lap of each loop on the path, per hop the WORST armed heads (the largest armHeads of that edge), the tail and the target loop
  const seen = new Set();
  let running = manifestBytes;
  const take = (clip) => {
    if (seen.has(clip)) return;
    seen.add(clip);
    running += bytesOf(clip);
  };
  const milestones = [];
  take(loops[path[0]].clip);
  milestones.push({ at: `${path[0]} lap`, bytes: running });
  for (let i = 1; i < path.length; i += 1) {
    const e = edges.find((x) => x.id === `${path[i - 1]}>${path[i]}`);
    if (!e) throw new Error(`path hop ${path[i - 1]}>${path[i]} is not an edge of the pack`);
    const edge = m.graph.edges.find((x) => x.id === e.id);
    const heads = headPhases(m.clips[m.graph.loops[edge.from].clip].frames, edge.entry.stride)
      .map((p) => edge.entry.headClipPrefix + pad3(p))
      .sort((a, b) => bytesOf(b) - bytesOf(a))
      .slice(0, edge.entry.armHeads);
    for (const h of heads) running += bytesOf(h);
    milestones.push({ at: `${e.id} ready (worst ${edge.entry.armHeads} armed heads + tail opening)`, bytes: running + m.clips[edge.tail.clip].chunks[0].bytes });
    take(edge.tail.clip);
    take(loops[path[i]].clip);
    milestones.push({ at: `through ${path[i]} (tail + one lap)`, bytes: running });
  }
  return { pack: relative(ROOT, packDir).split("\\").join("/"), manifestBytes, totalBytes: m.totalBytes, chunkFiles: allChunks.length, chunkBytes, loops, edges, totals, firstFrame, firstFrameWithNext, path, milestones };
}

export function gates(rep, graph) {
  const out = [];
  out.push({ gate: `total ${rep.totals.total} <= packCeilingBytes ${graph.budget.packCeilingBytes}`, ok: rep.totals.total <= graph.budget.packCeilingBytes });
  out.push({ gate: "totalBytes == sum of chunk bytes", ok: rep.totalBytes === rep.chunkBytes && rep.chunkBytes === rep.totals.total });
  const budgetPath = graph.budget.firstLoadPath;
  const hop = rep.milestones.find((x) => x.at === `through ${budgetPath[budgetPath.length - 1]} (tail + one lap)`) ?? rep.milestones[0];
  out.push({ gate: `first load (${budgetPath.join(" > ")}) ${hop.bytes} <= firstLoadBytes ${graph.budget.firstLoadBytes}`, ok: hop.bytes <= graph.budget.firstLoadBytes });
  return out;
}

const mb = (n) => (n / 1e6).toFixed(3);

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const graph = loadGraph(arg("graph", GRAPH_FILE));
  const pack = resolve(arg("pack", `${ROOT}/apps/web/public/coach-motion-v2/prod/384`));
  const budget = packReport(pack, graph);
  // the longest common path the cycle takes, for the extra milestones: the budget path, then on along the edges (each loop once)
  const cycle = [...graph.budget.firstLoadPath];
  for (;;) {
    const next = graph.edges.find((e) => e.from === cycle[cycle.length - 1] && !cycle.includes(e.to));
    if (!next) break;
    cycle.push(next.to);
  }
  const common = packReport(pack, graph, cycle);
  const g = gates(budget, graph);
  const lines = [];
  lines.push("LOOP          FRAMES  BYTES       MB      B/FRAME");
  for (const [id, l] of Object.entries(budget.loops)) lines.push(`${id.padEnd(14)}${String(l.frames).padEnd(8)}${String(l.bytes).padEnd(12)}${mb(l.bytes).padEnd(8)}${l.bytesPerFrame.toFixed(0)}`);
  lines.push("", "EDGE                  HEADS  HEAD BYTES   HEAD MB  B/FRAME  TAIL BYTES  TAIL MB");
  for (const e of budget.edges) lines.push(`${e.id.padEnd(22)}${String(e.heads).padEnd(7)}${String(e.headBytes).padEnd(13)}${mb(e.headBytes).padEnd(9)}${e.headBytesPerFrame.toFixed(0).padEnd(9)}${String(e.tailBytes).padEnd(12)}${mb(e.tailBytes)}`);
  lines.push("", `TOTAL loops ${mb(budget.totals.loops)} MB + heads ${mb(budget.totals.heads)} MB + tails ${mb(budget.totals.tails)} MB = ${mb(budget.totals.total)} MB (${budget.totals.total} bytes, ${budget.chunkFiles} chunk files)`);
  lines.push(`first animated frame: ${mb(budget.firstFrame)} MB (manifest ${budget.manifestBytes} B + first chunk); with the next chunk the player asks for at the same time: ${mb(budget.firstFrameWithNext)} MB`);
  for (const s of common.milestones) lines.push(`common path · ${s.at}: ${mb(s.bytes)} MB`);
  for (const x of g) lines.push(`${x.ok ? "PASS" : "FAIL"} ${x.gate}`);
  console.log(lines.join("\n"));
  if (arg("json")) writeFileSync(arg("json"), `${JSON.stringify({ budgetPath: budget, commonPath: common, gates: g }, null, 1)}\n`);
  process.exit(g.every((x) => x.ok) ? 0 : 1);
}
