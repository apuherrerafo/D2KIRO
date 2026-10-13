// Runtime guards for the Coach Motion V2 production slice, against a running lab server (headless Chromium, never headed).
// usage: SESSION_SECRET=... [CM_BASE=http://localhost:3162] node scripts/coach-motion-v2/verify.mjs [report.json]
// Checks: network (no Three.js / coach-modular.bin on the candidate panels), reduced motion (no Motion V2 request), failure -> static stays visible
// (manifest 404 / chunk abort / undecodable bytes / timeout), held-state continuity, loop seam, transition frame continuity (no skipped opening frames).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { launch, BASE, ROOT } from "./lib.mjs";

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
  await page.addInitScript(() => (window.__cmTrace = []));
  await page.goto(`${LAB}?panels=384,512`);
  await Promise.all([ready(page, "384"), ready(page, "512")]);
  await page.waitForTimeout(10500); // > one full 8.4 s WATCHING loop
  const bad = urls.filter((u) => /three|coach-modular|coach-gold-master/.test(u));
  check("network: no Three.js / coach-modular.bin on the candidate panels", bad.length === 0, bad.join(", ") || `${urls.length} requests`);
  const motionReq = urls.filter((u) => u.includes("/coach-motion-v2/prod/"));
  check("network: Motion V2 packs requested", motionReq.some((u) => u.includes("/384/")) && motionReq.some((u) => u.includes("/512/")), `${motionReq.length} requests`);

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
      const h0 = t.findIndex((x) => x[1].startsWith("ENTRY_HEAD_"));
      const seq = t.slice(h0);
      let ok = h0 >= 0;
      let why = "";
      const want = [];
      for (let i = 0; i < 10; i++) want.push([seq[0]?.[1], i]);
      for (let i = 0; i < 35; i++) want.push(["TRANSITION_TAIL", i]);
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
await failCase("AVIF decode error", (p) => p.route("**/coach-motion-v2/prod/384/*.avif", (r) => r.fulfill({ status: 200, contentType: "image/avif", body: Buffer.from("not an avif") })));
await failCase("timeout", (p) => p.route("**/coach-motion-v2/prod/384/*.avif", async (r) => { await new Promise((x) => setTimeout(x, 6000)); await r.abort().catch(() => {}); }), "&timeout=1500");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(report, null, 1));
await browser.close();
console.log(fail.length ? `FAILED: ${fail.length}` : "ALL PASS");
process.exit(fail.length ? 1 : 0);
