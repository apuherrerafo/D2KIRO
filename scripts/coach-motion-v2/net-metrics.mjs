// Network + decode footprint of the Coach Motion V2 production slice while WATCHING idles, against a running lab server (headless Chromium, never headed).
// usage: SESSION_SECRET=... [CM_BASE=http://localhost:3162] node scripts/coach-motion-v2/net-metrics.mjs [--pack 384] [--passes 2] [--out report.json]
// Counts, per clip kind (loop chunk / entry head / tail), the requests the browser issued after the first frame was painted, whether the HTTP cache answered
// them, and the encoded bytes that really crossed the network. An idle WATCHING must not touch entry heads at all, and from the second loop pass on every
// loop chunk must be served by the cache (immutable, fingerprinted URLs).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { launch, BASE } from "./lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const pack = arg("pack", "384");
const passes = Number(arg("passes", "2"));
const out = arg("out");
const kindOf = (url) => {
  const f = new URL(url).pathname.split("/").pop();
  if (/^head-/.test(f)) return "head";
  if (/^tail-/.test(f)) return "tail";
  if (/^(watching|analyzing)-/.test(f)) return "loop";
  return null;
};

const { browser, ctx } = await launch();
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("Network.enable");
const seen = new Map();
let recording = false;
cdp.on("Network.requestWillBeSent", (e) => {
  const kind = kindOf(e.request.url);
  if (kind) seen.set(e.requestId, { kind, url: e.request.url, recording, status: null, fromCache: false, bytes: 0 });
});
cdp.on("Network.requestServedFromCache", (e) => {
  const r = seen.get(e.requestId);
  if (r) r.fromCache = true;
});
cdp.on("Network.responseReceived", (e) => {
  const r = seen.get(e.requestId);
  if (r) {
    r.status = e.response.status;
    if (e.response.fromDiskCache || e.response.fromPrefetchCache) r.fromCache = true;
  }
});
cdp.on("Network.loadingFinished", (e) => {
  const r = seen.get(e.requestId);
  if (r) r.bytes = e.encodedDataLength;
});

await page.goto(`${BASE}/lab/coach-motion-v2/production?panels=${pack}`);
await page.waitForSelector(`[data-testid="panel-${pack}"][data-motion-status="motion"]`, { timeout: 30000 });
recording = true;
for (const r of seen.values()) r.recording = false;
const t0 = Date.now();
await page.waitForTimeout(Math.round(passes * 8400 + 600));
const seconds = (Date.now() - t0) / 1000;
await page.waitForTimeout(500);

const rows = [...seen.values()].filter((r) => r.recording);
const summary = {};
for (const kind of ["loop", "head", "tail"]) {
  const k = rows.filter((r) => r.kind === kind);
  summary[kind] = {
    requests: k.length,
    distinctUrls: new Set(k.map((r) => r.url)).size,
    servedFromCache: k.filter((r) => r.fromCache).length,
    networkTransfers: k.filter((r) => !r.fromCache).length,
    status304: k.filter((r) => r.status === 304).length,
    encodedBytesOverNetwork: k.filter((r) => !r.fromCache).reduce((n, r) => n + r.bytes, 0),
  };
}
const report = { base: BASE, pack, idleSeconds: +seconds.toFixed(1), loopPasses: passes, startup: { requests: seen.size - rows.length }, idle: summary };
console.log(JSON.stringify(report, null, 1));
if (out) {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 1));
}
await browser.close();
