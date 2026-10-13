// Runtime guards for the Coach Motion V2 production slice, against a running lab server (headless Chromium, never headed).
// usage: SESSION_SECRET=... [CM_BASE=http://localhost:3162] node scripts/coach-motion-v2/verify.mjs [report.json]
// Checks: network (no Three.js / coach-modular.bin on the candidate panels), cue-armed prefetch (an idle WATCHING requests no entry head / tail), immutable chunk
// caching (the second loop pass is answered by the HTTP cache), reduced motion (no Motion V2 request), hidden / off-screen (the clock stops, no work), failure ->
// static stays visible (manifest 404 / chunk abort / undecodable bytes / timeout, and MID-SESSION: a required chunk that fails or hangs), a failed entry head is
// not fatal, held-state continuity, loop seam, transition frame continuity (no skipped opening frames).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { launch, BASE, PUBLIC_PACKS, ROOT } from "./lib.mjs";

const OUT = process.argv[2] ?? `${ROOT}/docs/coach-motion-v2/production/verify-report.json`;
const LAB = `${BASE}/lab/coach-motion-v2/production`;
const report = { base: BASE, checks: {} };
const fail = [];
const check = (name, ok, detail) => {
  report.checks[name] = { ok, detail };
  console.log(ok ? "PASS" : "FAIL", name, detail ?? "");
  if (!ok) fail.push(name);
};
const first = await launch();
const browser = first.browser;
const mk = async (extra = {}) => (await launch(extra)).ctx;
const ready = (page, pack) => page.waitForSelector(`[data-testid="panel-${pack}"][data-motion-status="motion"]`, { timeout: 30000 });

// ---------------------------------------------------------------- network + continuity (candidate panels only)
{
  const ctx = await mk();
  const page = await ctx.newPage();
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  // per-request network accounting through CDP (Playwright does not say whether the HTTP cache answered)
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  const net = new Map();
  const kindOf = (url) => {
    const f = new URL(url).pathname.split("/").pop();
    return /^head-/.test(f) ? "head" : /^tail-/.test(f) ? "tail" : /^(watching|analyzing)-/.test(f) ? "loop" : null;
  };
  cdp.on("Network.requestWillBeSent", (e) => {
    const kind = kindOf(e.request.url);
    if (kind) net.set(e.requestId, { kind, url: e.request.url, at: Date.now(), cached: false });
  });
  cdp.on("Network.requestServedFromCache", (e) => void (net.get(e.requestId) && (net.get(e.requestId).cached = true)));
  cdp.on("Network.responseReceived", (e) => {
    const r = net.get(e.requestId);
    if (r && (e.response.fromDiskCache || e.response.fromPrefetchCache)) r.cached = true;
  });
  await page.addInitScript(() => (window.__cmTrace = []));
  await page.goto(`${LAB}?panels=384,512`);
  await Promise.all([ready(page, "384"), ready(page, "512")]);
  const readyAt = Date.now();
  for (const r of net.values()) r.before = true; // everything requested up to here is startup
  await page.waitForTimeout(17600); // two full 8.4 s WATCHING loop passes
  const bad = urls.filter((u) => /three|coach-modular|coach-gold-master/.test(u));
  check("network: no Three.js / coach-modular.bin on the candidate panels", bad.length === 0, bad.join(", ") || `${urls.length} requests`);
  const motionReq = urls.filter((u) => u.includes("/coach-motion-v2/prod/"));
  check("network: Motion V2 packs requested", motionReq.some((u) => u.includes("/384/")) && motionReq.some((u) => u.includes("/512/")), `${motionReq.length} requests`);
  const idle = [...net.values()].filter((r) => !r.before);
  const idleHeadsTails = idle.filter((r) => r.kind !== "loop");
  check("cue-armed prefetch: an idle WATCHING (two loop passes) requests no entry head and no tail chunk", idleHeadsTails.length === 0, `${idleHeadsTails.length} head/tail requests: ${idleHeadsTails.slice(0, 3).map((r) => r.url.split("/").pop()).join(", ")}`);
  const pass2 = idle.filter((r) => r.kind === "loop" && r.at - readyAt > 9000);
  const pass2Network = pass2.filter((r) => !r.cached);
  check("immutable chunk URLs: the second loop pass is answered by the HTTP cache, no encoded byte crosses the network again", pass2.length > 0 && pass2Network.length === 0, `${pass2.length} loop requests in pass 2, ${pass2Network.length} over the network`);
  const hdr = await page.evaluate(async () => {
    const m = await fetch("/coach-motion-v2/prod/384/manifest.json", { cache: "no-store" });
    const manifest = await m.json();
    const file = manifest.clips.WATCHING_LOOP.chunks[0].file;
    const c = await fetch(`/coach-motion-v2/prod/384/${file}`);
    return { manifest: m.headers.get("cache-control"), chunk: c.headers.get("cache-control"), file };
  });
  check("cache headers: fingerprinted chunk = immutable for a year, manifest = revalidated on every load", /max-age=31536000/.test(hdr.chunk ?? "") && /immutable/.test(hdr.chunk ?? "") && /no-cache/.test(hdr.manifest ?? ""), JSON.stringify(hdr));

  const trace = await page.evaluate(() => window.__cmTrace);
  for (const pack of ["384", "512"]) {
    const t = trace.filter((x) => x[0] === pack && x[1] === "WATCHING_LOOP");
    let maxGap = 0, skipped = 0, dupes = 0, wraps = 0;
    for (let i = 1; i < t.length; i++) {
      maxGap = Math.max(maxGap, t[i][3] - t[i - 1][3]);
      const d = (t[i][2] - t[i - 1][2] + 252) % 252;
      if (d === 0) dupes++;
      else if (d > 1) skipped += d - 1;
      if (t[i][2] < t[i - 1][2]) wraps++;
    }
    check(`held WATCHING ${pack}: no >= 500 ms freeze, no skipped/duplicated frame`, maxGap < 500 && skipped === 0 && dupes === 0, `paints ${t.length}, max gap ${maxGap.toFixed(0)} ms, skipped ${skipped}, dupes ${dupes}`);
    check(`loop seam ${pack}: WATCHING wraps 251 -> 0 without a stall`, wraps >= 1, `wraps ${wraps}`);
  }

  // transition at arbitrary phases: three cues, fresh WATCHING each time
  for (let round = 0; round < 3; round++) {
    await page.click('[data-testid="btn-watching"]');
    await page.waitForTimeout(1200 + round * 1370);
    await page.evaluate(() => (window.__cmTrace.length = 0));
    await page.click('[data-testid="btn-transition"]');
    await page.waitForTimeout(3000);
    const tr = await page.evaluate(() => window.__cmTrace);
    for (const pack of ["384", "512"]) {
      const t = tr.filter((x) => x[0] === pack);
      const h0 = t.findIndex((x) => x[1].startsWith("ENTRY_HEAD_WA_"));
      const seq = t.slice(h0);
      let ok = h0 >= 0;
      let why = "";
      const want = [];
      for (let i = 0; i < 10; i++) want.push([seq[0]?.[1], i]);
      for (let i = 0; i < 35; i++) want.push(["TAIL_WA", i]);
      for (let i = 0; i < 20; i++) want.push(["ANALYZING_LOOP", i]);
      for (let i = 0; i < want.length && ok; i++) {
        if (!seq[i] || seq[i][1] !== want[i][0] || seq[i][2] !== want[i][1]) {
          ok = false;
          why = `at ${i}: got ${seq[i]?.slice(1, 3)} want ${want[i]}`;
        }
      }
      const gaps = seq.slice(1, 60).map((x, i) => x[3] - seq[i][3]);
      check(`transition ${pack} #${round}: head 0..9 -> tail 0..34 -> ANALYZING 0.., nothing skipped`, ok, why || `max paint gap ${Math.max(...gaps).toFixed(0)} ms`);
    }
  }
  // held ANALYZING
  await page.click('[data-testid="btn-analyzing"]');
  await page.evaluate(() => (window.__cmTrace.length = 0));
  await page.waitForTimeout(8000);
  const an = await page.evaluate(() => window.__cmTrace);
  for (const pack of ["384", "512"]) {
    const t = an.filter((x) => x[0] === pack && x[1] === "ANALYZING_LOOP");
    let maxGap = 0, skipped = 0, wraps = 0;
    for (let i = 1; i < t.length; i++) {
      maxGap = Math.max(maxGap, t[i][3] - t[i - 1][3]);
      const d = (t[i][2] - t[i - 1][2] + 210) % 210;
      if (d > 1) skipped += d - 1;
      if (t[i][2] < t[i - 1][2]) wraps++;
    }
    check(`held ANALYZING ${pack}: no freeze, no skipped frame, seam crossed`, maxGap < 500 && skipped === 0 && wraps >= 1, `paints ${t.length}, max gap ${maxGap.toFixed(0)} ms, wraps ${wraps}`);
  }
  await ctx.close();
}

// ---------------------------------------------------------------- reduced motion
{
  const ctx = await mk({ reducedMotion: "reduce" });
  const page = await ctx.newPage();
  const urls = [];
  page.on("request", (r) => urls.push(r.url()));
  await page.goto(`${LAB}?panels=384,512`);
  await page.waitForTimeout(3500);
  const motion = urls.filter((u) => /\/coach-motion-v2\/(prod|A|B|C|manifest\.json|watching)/.test(new URL(u).pathname) && !new URL(u).pathname.startsWith("/lab/"));
  const statuses = await page.$$eval("[data-motion-status]", (els) => els.map((e) => e.getAttribute("data-motion-status")));
  const sprite = await page.$$eval('[data-testid="coach-sprite"]', (els) => els.map((e) => getComputedStyle(e).visibility));
  check("reduced motion: NO Motion V2 request (manifest or atlas)", motion.length === 0, `${urls.length} requests, ${motion.length} motion: ${motion.join(" ")}`);
  check("reduced motion: static Coach visible", statuses.every((s) => s === "static") && sprite.length >= 2 && sprite.every((v) => v === "visible"), JSON.stringify({ statuses, sprite }));
  await ctx.close();
}

// ---------------------------------------------------------------- failures keep the static Coach visible
const failCase = async (name, setup, query = "") => {
  const ctx = await mk();
  const page = await ctx.newPage();
  await setup(page);
  await page.goto(`${LAB}?panels=384${query}`);
  await page.waitForSelector('[data-testid="panel-384"][data-motion-status="failed"]', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="motion-player-384"]');
    const sprite = root.querySelector('[data-testid="coach-sprite"]');
    const canvas = root.querySelector("canvas");
    const imgs = [...sprite.querySelectorAll("img")].filter((i) => getComputedStyle(i).opacity === "1");
    return { status: root.getAttribute("data-motion-status"), spriteVisible: getComputedStyle(sprite).visibility === "visible", canvasVisible: getComputedStyle(canvas).visibility === "visible", litLayers: imgs.length, loaded: imgs.every((i) => i.complete && i.naturalWidth > 0), readout: document.querySelector('[data-testid="readout-384"]').textContent };
  });
  check(`failure (${name}): static Coach stays visible, canvas hidden`, r.status === "failed" && r.spriteVisible && !r.canvasVisible && r.litLayers === 1 && r.loaded, JSON.stringify(r));
  await ctx.close();
};
await failCase("manifest 404", (p) => p.route("**/coach-motion-v2/prod/384/manifest.json", (r) => r.fulfill({ status: 404, body: "no" })));
await failCase("atlas fetch aborted", (p) => p.route("**/coach-motion-v2/prod/384/*.avif", (r) => r.abort()));
await failCase("AVIF size mismatch", (p) => p.route("**/coach-motion-v2/prod/384/*.avif", (r) => r.fulfill({ status: 200, contentType: "image/avif", body: Buffer.from("not an avif") })));
const firstChunkBytes = JSON.parse(readFileSync(`${PUBLIC_PACKS}/384/manifest.json`, "utf8")).clips.WATCHING_LOOP.chunks[0].bytes;
await failCase("AVIF decode error (right size, junk bytes)", (p) => p.route("**/coach-motion-v2/prod/384/watching-00.*.avif", (r) => r.fulfill({ status: 200, contentType: "image/avif", body: Buffer.alloc(firstChunkBytes) })));
await failCase("timeout", (p) => p.route("**/coach-motion-v2/prod/384/*.avif", async (r) => { await new Promise((x) => setTimeout(x, 6000)); await r.abort().catch(() => {}); }), "&timeout=1500");
// MID-SESSION: the first frames play, then a chunk the loop needs fails (after its one retry) or hangs (stall watchdog) -> static, never a frozen frame
await failCase("mid-session: a required loop chunk fails after its retry", (p) => p.route("**/coach-motion-v2/prod/384/watching-03.*.avif", (r) => r.abort()));
await failCase("mid-session: a required loop chunk hangs (stall watchdog)", (p) => p.route("**/coach-motion-v2/prod/384/watching-02.*.avif", async (r) => { await new Promise((x) => setTimeout(x, 15000)); await r.abort().catch(() => {}); }), "&stall=1500");

// ---------------------------------------------------------------- a failed entry head is NOT fatal
{
  const ctx = await mk();
  const page = await ctx.newPage();
  await page.route("**/coach-motion-v2/prod/384/head-wa-*.avif", (r) => r.abort());
  await page.addInitScript(() => (window.__cmTrace = []));
  await page.goto(`${LAB}?panels=384&stall=4000`);
  await ready(page, "384");
  await page.waitForTimeout(1500);
  await page.click('[data-testid="btn-transition"]'); // arms the heads: every one of them fails
  await page.waitForTimeout(2200);
  const status = await page.getAttribute('[data-testid="panel-384"]', "data-motion-status");
  const trace = await page.evaluate(() => window.__cmTrace);
  const sinceCue = trace.filter((x) => x[1].startsWith("ENTRY_HEAD_WA_") || x[1] === "TAIL_WA");
  check("entry head fetch aborted: Motion V2 stays alive (speculative failure is non-fatal), WATCHING keeps playing", status === "motion" && sinceCue.length === 0, `status ${status}, transition frames ${sinceCue.length}`);
  await page.waitForSelector('[data-testid="panel-384"][data-motion-status="failed"]', { timeout: 10000 }).catch(() => {});
  const after = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="motion-player-384"]');
    return { status: root.getAttribute("data-motion-status"), staticState: root.querySelector('[data-testid="coach-sprite"]').getAttribute("data-state"), canvas: getComputedStyle(root.querySelector("canvas")).visibility };
  });
  check("a request that can never start falls back after the watchdog, and the STATIC Coach shows the requested state", after.status === "failed" && after.staticState === "analyzing" && after.canvas === "hidden", JSON.stringify(after));
  await ctx.close();
}

// ---------------------------------------------------------------- hidden tab / off-screen: the clock stops, nothing is painted, playback resumes where it was
{
  const ctx = await mk();
  const page = await ctx.newPage();
  await page.addInitScript(() => (window.__cmTrace = []));
  await page.goto(`${LAB}?panels=384`);
  await ready(page, "384");
  await page.waitForTimeout(1500);
  const count = () => page.evaluate(() => window.__cmTrace.length);
  const lastFrame = () => page.evaluate(() => window.__cmTrace[window.__cmTrace.length - 1][2]);
  for (const [name, hide, show] of [
    ["hidden tab", () => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); }, () => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); }],
    ["off-screen", () => { const el = document.querySelector('[data-testid="motion-player-384"]'); el.style.position = "fixed"; el.style.top = "-9999px"; }, () => { const el = document.querySelector('[data-testid="motion-player-384"]'); el.style.position = ""; el.style.top = ""; }],
  ]) {
    await page.evaluate(hide);
    await page.waitForTimeout(400);
    const a = await count();
    const fa = await lastFrame();
    await page.waitForTimeout(1500);
    const b = await count();
    check(`${name}: no frame is painted and the clock does not run`, b === a, `${b - a} paints while hidden`);
    await page.evaluate(show);
    await page.waitForTimeout(800);
    const c = await count();
    const next = await page.evaluate((n) => window.__cmTrace[n][2], b);
    check(`${name} -> visible: playback resumes on the very next frame (no jump, no skipped frame)`, c > b && next === (fa + 1) % 252, `paints after ${c - b}, resumed at ${next}, held at ${fa}`);
  }
  await ctx.close();
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
await browser.close();
console.log(fail.length ? `FAILED: ${fail.length}` : "ALL PASS");
process.exit(fail.length ? 1 : 0);
