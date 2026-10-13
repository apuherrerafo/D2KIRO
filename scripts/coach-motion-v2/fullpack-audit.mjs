// Headless playback audit of the FULL semantic pack in /lab/coach-motion-v2/full-pack (the production player on the real 384 manifest). Never headed.
// usage: SESSION_SECRET=... CM_BASE=http://127.0.0.1:<port> node scripts/coach-motion-v2/fullpack-audit.mjs [--out report.json] [--runs 2] [--theme dark|light] [--live 0|1]
// Per run it presses "Play full cycle" (the lab cues every hop of its cycle through the player) and records every painted frame (window.__cmTrace), the lab's cue / arrive
// events, the player's resident chunks (snapshot every 50 ms) and every chunk request (CDP). From the manifest's graph (no state is named here) it checks:
//   successor   every paint is the graph successor of the previous one (loop +1 / wrap, head +1, head -> tail 0, tail -> target loop enterFrame, loop -> head 0 of the
//               cued edge within maxStepFrames of the loop frame): duplicated and skipped authored frames, skipped transition openings
//   timing      paint intervals (median / p95 / p99 / max, > 50 / > 100 / > 150 ms) of PLAYBACK; the wait before the first paint of the run is reported apart (loading)
//   seams       intervals at every loop wrap, head -> tail and tail -> loop handover; frozen stretches >= 500 ms
//   cues        cue -> first head frame delay (the loop keeps playing while the entry decodes), target loop reached
//   ownership   resident chunks per mode (bounded), no entry head / tail requested while no cue is pending (cue-armed only, no idle head churn)
import { writeFileSync } from "node:fs";
import { BASE, launch } from "./lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const RUNS = Number(arg("runs", "2"));
const THEME = arg("theme", "dark");
const LIVE = arg("live", "0");
const OUT = arg("out");
const LAB = `${BASE}/lab/coach-motion-v2/full-pack?theme=${THEME}&live=${LIVE}`;

const pct = (xs, p) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
};
const timing = (xs) => ({ n: xs.length, median: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: xs.length ? Math.max(...xs) : null, over50: xs.filter((x) => x > 50).length, over100: xs.filter((x) => x > 100).length, over150: xs.filter((x) => x > 150).length });
const r1 = (x) => (x == null ? x : Math.round(x * 10) / 10);

/** Classifies the step a -> b of the painted stream against the graph. Returns null when b is a legal successor of a, otherwise why not. */
function judge(m, a, b, cued) {
  const loopOf = Object.fromEntries(Object.entries(m.graph.loops).map(([id, l]) => [l.clip, id]));
  const clip = (c) => m.clips[c];
  const headEdge = (c) => m.graph.edges.find((e) => c.startsWith(e.entry.headClipPrefix));
  const tailEdge = (c) => m.graph.edges.find((e) => e.tail.clip === c);
  if (a.clip === b.clip && a.frame === b.frame) return "duplicate";
  if (loopOf[a.clip]) {
    const n = clip(a.clip).frames;
    if (b.clip === a.clip) return b.frame === (a.frame + 1) % n ? null : `skipped ${(b.frame - a.frame - 1 + n) % n} loop frames`;
    const e = headEdge(b.clip);
    if (!e || e.from !== loopOf[a.clip]) return `left loop ${a.clip} for ${b.clip}`;
    if (b.frame !== 0) return `transition opened at head frame ${b.frame} (skipped opening)`;
    if (cued && cued !== e.id) return `played ${e.id}, cued ${cued}`;
    const phase = Number(b.clip.slice(e.entry.headClipPrefix.length));
    const up = (a.frame + 1) % n;
    const d = Math.min((phase - up + n) % n, (up - phase + n) % n);
    return d <= e.entry.maxStepFrames ? null : `entry head ${phase} is ${d} frames from loop frame ${up} (> maxStepFrames ${e.entry.maxStepFrames})`;
  }
  const he = headEdge(a.clip);
  if (he) {
    if (b.clip === a.clip) return b.frame === a.frame + 1 ? null : `skipped head frames ${a.frame} -> ${b.frame}`;
    if (a.frame !== clip(a.clip).frames - 1) return `head left at frame ${a.frame}`;
    return b.clip === he.tail.clip && b.frame === 0 ? null : `head -> ${b.clip}#${b.frame} (want ${he.tail.clip}#0)`;
  }
  const te = tailEdge(a.clip);
  if (te) {
    if (b.clip === a.clip) return b.frame === a.frame + 1 ? null : `skipped tail frames ${a.frame} -> ${b.frame}`;
    if (a.frame !== clip(a.clip).frames - 1) return `tail left at frame ${a.frame}`;
    return b.clip === m.graph.loops[te.to].clip && b.frame === te.tail.enterFrame ? null : `tail -> ${b.clip}#${b.frame} (want ${m.graph.loops[te.to].clip}#${te.tail.enterFrame})`;
  }
  return `unknown clip ${a.clip}`;
}

const { browser, ctx } = await launch({ colorScheme: THEME === "light" ? "light" : "dark" });
const report = { base: BASE, lab: LAB, runs: [], checks: {} };
const failures = [];
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(ok ? "PASS" : "FAIL", name, detail ?? "");
  if (!ok) failures.push(name);
};

const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const reqs = new Map();
cdp.on("Network.requestWillBeSent", (e) => {
  if (e.request.url.includes("/coach-motion-v2/prod/") && !e.request.url.includes("?skew")) reqs.set(e.requestId, { url: e.request.url, file: e.request.url.split("/").pop(), t: e.timestamp * 1000, bytes: 0, cached: false });
});
cdp.on("Network.requestServedFromCache", (e) => void (reqs.get(e.requestId) && (reqs.get(e.requestId).cached = true)));
cdp.on("Network.responseReceived", (e) => {
  const r = reqs.get(e.requestId);
  if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache)) r.cached = true;
});
cdp.on("Network.loadingFinished", (e) => void (reqs.get(e.requestId) && (reqs.get(e.requestId).bytes = e.encodedDataLength)));
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => (window.__cmTrace = []));
const t0 = Date.now();
await page.goto(LAB);
await page.waitForSelector('[data-testid="panel-384"][data-motion-status="motion"]', { timeout: 30000 });
report.firstMotionMs = Date.now() - t0;
{
  // CDP request timestamps are monotonic-clock ms; the page's performance.now() counts from its time origin: measure the offset with a probe request
  const probe = new Promise((res) => cdp.once("Network.requestWillBeSent", (e) => res(e.timestamp * 1000)));
  const pageT = await page.evaluate(() => {
    const t = performance.now();
    void fetch("/coach-motion-v2/prod/384/manifest.json?skew", { cache: "no-store" });
    return t;
  });
  report.clockSkew = (await probe) - pageT;
}
const m = await page.evaluate(async () => (await fetch("/coach-motion-v2/prod/384/manifest.json", { cache: "no-cache" })).json());
const kindOf = (file) => {
  for (const e of m.graph.edges) {
    if (m.clips[e.tail.clip].chunks.some((c) => c.file === file)) return "tail";
    if (Object.entries(m.clips).some(([id, c]) => id.startsWith(e.entry.headClipPrefix) && c.chunks.some((k) => k.file === file))) return "head";
  }
  return file === "manifest.json" ? "manifest" : "loop";
};

for (let run = 0; run < RUNS; run += 1) {
  await page.evaluate(() => {
    window.__cmTrace.length = 0;
  });
  const before = new Set(reqs.keys());
  await page.click('[data-testid="btn-cycle"]');
  // ownership: the player's resident chunk keys, mode and pending edge every 50 ms, sampled in the page (no CDP round trip skew)
  await page.evaluate(() => {
    window.__own = [];
    window.__ownTimer = setInterval(() => {
      const s = window.__fullPack?.snapshot();
      if (s) window.__own.push([performance.now(), s.mode, s.pendingEdge, s.residentKeys.length, s.residentBytes]);
    }, 50);
  });
  await page.waitForFunction(() => window.__fullPack && window.__fullPack.events.some((e) => e.kind === "done" || e.kind === "error"), null, { timeout: 90000 });
  const data = await page.evaluate(() => {
    clearInterval(window.__ownTimer);
    return { trace: window.__cmTrace.slice(), events: window.__fullPack.events.slice(), own: window.__own.slice() };
  });
  const runReqs = [...reqs.entries()].filter(([id]) => !before.has(id)).map(([, r]) => ({ ...r, kind: kindOf(r.file) }));
  const ev = data.events;
  const start = ev.find((e) => e.kind === "start");
  const trace = data.trace.filter((x) => x[0] === "384" && x[3] >= start.t).map(([, clip, frame, t]) => ({ clip, frame, t }));
  const cues = ev.filter((e) => e.kind === "cue");
  // successor check over the whole run (the first paint after the cycle's goTo is frame 0 of the first loop: a jump, not a step)
  const bad = [];
  let dupes = 0;
  let skipped = 0;
  for (let i = 1; i < trace.length; i += 1) {
    const cue = cues.filter((c) => c.t <= trace[i].t).pop();
    const why = judge(m, trace[i - 1], trace[i], cue ? `${cue.from}>${cue.to}` : null);
    if (why) {
      bad.push({ at: i, from: `${trace[i - 1].clip}#${trace[i - 1].frame}`, to: `${trace[i].clip}#${trace[i].frame}`, why });
      if (why === "duplicate") dupes += 1;
      if (/skipped/.test(why)) skipped += 1;
    }
  }
  const intervals = trace.slice(1).map((x, i) => x.t - trace[i].t);
  // seams: the interval INTO the first frame of a loop wrap, an entry head, a tail, and a loop entered from a tail
  const seamInt = { loopWrap: [], loopToHead: [], headToTail: [], tailToLoop: [] };
  const loopClips = new Set(Object.values(m.graph.loops).map((l) => l.clip));
  const tailClips = new Set(m.graph.edges.map((e) => e.tail.clip));
  for (let i = 1; i < trace.length; i += 1) {
    const [a, b] = [trace[i - 1], trace[i]];
    const dt = b.t - a.t;
    if (loopClips.has(a.clip) && a.clip === b.clip && b.frame === 0) seamInt.loopWrap.push(dt);
    else if (tailClips.has(b.clip) && b.frame === 0) seamInt.headToTail.push(dt);
    else if (tailClips.has(a.clip) && loopClips.has(b.clip)) seamInt.tailToLoop.push(dt);
    else if (loopClips.has(a.clip) && !loopClips.has(b.clip)) seamInt.loopToHead.push(dt);
  }
  const cueRows = cues.map((c) => {
    const e = m.graph.edges.find((x) => x.from === c.from && x.to === c.to);
    const h = trace.find((x) => x.t >= c.t && x.clip.startsWith(e.entry.headClipPrefix));
    const arrive = ev.find((x) => x.kind === "arrive" && x.t >= c.t && x.to === c.to);
    return { edge: e.id, taken: c.taken, cueToHeadMs: h ? r1(h.t - c.t) : null, loopFramesWhileArming: trace.filter((x) => x.t >= c.t && h && x.t < h.t).length, head: h?.clip ?? null, reachedTarget: !!arrive, cueToTargetLoopMs: arrive ? r1(arrive.t - c.t) : null };
  });
  // head / tail requests made while NO cue was pending (between an arrival and the next cue): idle churn
  const windows = [];
  let open = start.t;
  for (const e of ev) {
    if (e.kind === "cue") windows.push([open, e.t]);
    if (e.kind === "arrive") open = e.t;
  }
  windows.push([open, Infinity]);
  const toPage = (r) => r.t - report.clockSkew;
  const edgeReqs = runReqs.filter((r) => r.kind === "head" || r.kind === "tail");
  const idleHeadTail = edgeReqs.filter((r) => windows.some(([a, b]) => toPage(r) > a + 5 && toPage(r) < b - 5));
  // positive control for the clock mapping: every head / tail request must fall inside a cue -> arrival window (else the idle check above would be vacuous)
  const pendingWindows = cues.map((c) => [c.t, ev.find((x) => x.kind === "arrive" && x.t >= c.t)?.t ?? Infinity]);
  const armedHeadTail = edgeReqs.filter((r) => pendingWindows.some(([a, b]) => toPage(r) >= a - 5 && toPage(r) <= b + 5));
  // ownership per mode
  const own = data.own.filter((o) => o[0] >= start.t);
  const byMode = {};
  for (const [, mode, pending, n, bytes] of own) {
    const k = mode === "transition" ? "transition" : pending ? "armed" : "loop";
    byMode[k] = { maxChunks: Math.max(byMode[k]?.maxChunks ?? 0, n), maxBytes: Math.max(byMode[k]?.maxBytes ?? 0, bytes) };
  }
  report.runs.push({
    run,
    paints: trace.length,
    firstPaintAfterCycleStartMs: trace[0] ? r1(trace[0].t - start.t) : null,
    playback: Object.fromEntries(Object.entries(timing(intervals)).map(([k, v]) => [k, r1(v)])),
    frozenOver500: intervals.filter((x) => x >= 500).length,
    seams: Object.fromEntries(Object.entries(seamInt).map(([k, v]) => [k, { n: v.length, max: r1(v.length ? Math.max(...v) : null), median: r1(pct(v, 50)) }])),
    successorViolations: bad.slice(0, 20),
    successorViolationCount: bad.length,
    duplicates: dupes,
    skips: skipped,
    cues: cueRows,
    ownership: byMode,
    idleHeadTailRequests: idleHeadTail.map((r) => r.file),
    headTailRequests: { total: edgeReqs.length, insideCueWindows: armedHeadTail.length },
    network: { requests: runReqs.length, overNetwork: runReqs.filter((r) => !r.cached).length, bytesOverNetwork: runReqs.reduce((n, r) => n + (r.cached ? 0 : r.bytes), 0), byKind: Object.fromEntries(["manifest", "loop", "head", "tail"].map((k) => [k, runReqs.filter((r) => r.kind === k).length])) },
    events: ev.map((e) => ({ ...e, t: r1(e.t - start.t) })),
  });
  await page.waitForTimeout(400);
}

// decode cost of every distinct atlas geometry of the pack in this browser (createImageBitmap, 3 runs each)
report.decode = await page.evaluate(async (chunks) => {
  const out = [];
  for (const c of chunks) {
    const blob = await (await fetch(`/coach-motion-v2/prod/384/${c.file}`)).blob();
    const ms = [];
    for (let i = 0; i < 3; i += 1) {
      const t = performance.now();
      const b = await createImageBitmap(blob);
      ms.push(Math.round((performance.now() - t) * 10) / 10);
      b.close();
    }
    out.push({ file: c.file, w: c.w, h: c.h, decodedMB: Math.round(((c.w * c.h * 4) / 1048576) * 100) / 100, bytes: c.bytes, decodeMs: ms });
  }
  return out;
}, [...new Map(Object.values(m.clips).flatMap((c) => c.chunks).map((c) => [`${c.w}x${c.h}`, c])).values()]);

// ---- held loops: each loop held two laps with nothing cued (idle churn, HTTP cache, seam, freeze)
const holdReport = [];
for (const loop of Object.keys(m.graph.loops)) {
  await page.click(`[data-testid="btn-${loop}"]`); // jump (or the edge from the current loop when the graph has one): wait until we are IN the loop
  await page.waitForFunction((clip) => (window.__cmTrace.at(-1) ?? [])[1] === clip, m.graph.loops[loop].clip, { timeout: 15000 });
  await page.waitForTimeout(300);
  const mark = new Set(reqs.keys());
  const n0 = await page.evaluate(() => window.__cmTrace.length);
  const lapMs = (m.clips[m.graph.loops[loop].clip].frames / m.fps) * 1000;
  await page.waitForTimeout(lapMs * 2 + 300);
  const t = await page.evaluate((n) => window.__cmTrace.slice(n), n0);
  const newReqs = [...reqs.entries()].filter(([id]) => !mark.has(id)).map(([, r]) => ({ ...r, kind: kindOf(r.file) }));
  const ints = t.slice(1).map((x, i) => x[3] - t[i][3]);
  const wraps = t.filter((x, i) => i && x[2] === 0 && t[i - 1][2] !== 0).length;
  holdReport.push({ loop, laps: 2, paints: t.length, headOrTailRequests: newReqs.filter((r) => r.kind === "head" || r.kind === "tail").length, loopRequests: newReqs.filter((r) => r.kind === "loop").length, loopRequestsOverNetwork: newReqs.filter((r) => r.kind === "loop" && !r.cached).length, maxIntervalMs: r1(Math.max(...ints)), wraps, otherClips: [...new Set(t.map((x) => x[1]).filter((c) => c !== m.graph.loops[loop].clip))] });
}
report.holds = holdReport;
report.errors = errors;

// ---- checks
const all = report.runs;
check("every run cued every hop of the cycle and reached every target loop (no frozen state, no refused cue)", all.every((r) => r.cues.length >= 1 && r.cues.every((c) => c.taken && c.reachedTarget) && r.events.some((e) => e.kind === "done") && !r.events.some((e) => e.kind === "error")), JSON.stringify(all.map((r) => r.cues.map((c) => `${c.edge}:${c.reachedTarget}`))));
const maxArm = Math.max(...m.graph.edges.map((e) => e.entry.armHeads));
const maxLook = Math.max(...m.graph.edges.map((e) => e.lookaheadFrames));
const bound = { loop: 2, armed: 2 + maxArm + 1, transition: Math.ceil(maxLook / m.chunkFrames) + 3 };
check(`CURRENT / NEXT ownership bounded: resident chunks <= ${JSON.stringify(bound)} per mode`, all.every((r) => Object.entries(r.ownership).every(([k, v]) => v.maxChunks <= bound[k])), JSON.stringify(all.map((r) => r.ownership)));
check("cue-armed loading only: no entry head / tail chunk requested while no cue was pending, and every one of them inside a cue -> arrival window", all.every((r) => r.idleHeadTailRequests.length === 0 && r.headTailRequests.total > 0 && r.headTailRequests.insideCueWindows === r.headTailRequests.total), JSON.stringify(all.map((r) => [r.idleHeadTailRequests.slice(0, 3), r.headTailRequests])));
check("every painted step is a graph successor: no duplicated or skipped authored frame, no skipped transition opening", all.every((r) => r.successorViolationCount === 0), JSON.stringify(all.map((r) => r.successorViolations.slice(0, 3))));
check("no frozen interval >= 500 ms during playback", all.every((r) => r.frozenOver500 === 0), JSON.stringify(all.map((r) => r.playback.max)));
check("no paint interval > 100 ms during playback (initial loading excluded)", all.every((r) => r.playback.over100 === 0), JSON.stringify(all.map((r) => r.playback)));
check("each hop played exactly the cued edge's head (entry within maxStepFrames, checked above) and the cue armed within 1 s", all.every((r) => r.cues.every((c) => c.head && c.cueToHeadMs < 1000)), JSON.stringify(all.map((r) => r.cues.map((c) => c.cueToHeadMs))));
check("held loops: two laps with nothing cued request NO entry head / tail chunk (cue-armed only, no idle head churn)", holdReport.every((h) => h.headOrTailRequests === 0), JSON.stringify(holdReport.map((h) => [h.loop, h.headOrTailRequests])));
check("held loops: the second lap is served by the HTTP cache (immutable chunks)", holdReport.every((h) => h.loopRequestsOverNetwork <= Math.ceil(m.clips[m.graph.loops[h.loop].clip].chunks.length)), JSON.stringify(holdReport.map((h) => [h.loop, h.loopRequests, h.loopRequestsOverNetwork])));
check("held loops: no other clip painted, the loop wraps, no interval >= 500 ms", holdReport.every((h) => h.otherClips.length === 0 && h.wraps >= 2 && h.maxIntervalMs < 500), JSON.stringify(holdReport.map((h) => [h.loop, h.wraps, h.maxIntervalMs, h.otherClips])));
check("no page errors", errors.length === 0, errors.join(" | "));
report.failures = failures;
if (OUT) writeFileSync(OUT, `${JSON.stringify(report, null, 1)}\n`);
await browser.close();
console.log(JSON.stringify({ runs: report.runs.map((r) => ({ run: r.run, paints: r.paints, firstPaintAfterCycleStartMs: r.firstPaintAfterCycleStartMs, playback: r.playback, seams: r.seams, cues: r.cues.map((c) => [c.edge, c.cueToHeadMs, c.loopFramesWhileArming, c.cueToTargetLoopMs]), ownership: r.ownership, network: r.network })), holds: report.holds, decode: report.decode }, null, 1));
console.log(failures.length ? `FAILED: ${failures.length}` : "ALL PASS");
process.exit(failures.length ? 1 : 0);
