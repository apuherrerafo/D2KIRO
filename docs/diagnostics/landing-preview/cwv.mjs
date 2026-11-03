// TSK-245: CWV-correct CLS. Reports raw sum, hadRecentInput-excluded sum, and the max session window
// (gap<1s, cap 5s) = what Chrome/CrUX call CLS. Phases: load-only vs scroll. Usage (from apps/web):
// BASE=... node ../../docs/diagnostics/landing-preview/cwv.mjs [w h] [block]
import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3100";
const [w, h] = [Number(process.argv[2] ?? 390), Number(process.argv[3] ?? 844)];
const block = process.argv[4] === "block";
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
if (block) await page.route(/steamstatic|valve|dota2\.com/i, (r) => r.abort());
await page.addInitScript(() => {
  window.__e = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) window.__e.push({ t: e.startTime, v: e.value, input: e.hadRecentInput,
      src: e.sources.map((s) => ({ n: `${s.node?.nodeName}${s.node?.id ? "#" + s.node.id : ""}.${(s.node?.className || "").toString().slice(0, 40)}`, prev: [s.previousRect.y, s.previousRect.height].map(Math.round), cur: [s.currentRect.y, s.currentRect.height].map(Math.round) })) });
  }).observe({ type: "layout-shift", buffered: true });
});
const snap = () => page.evaluate(() => window.__e.length);
await page.goto(`${base}/`, { waitUntil: "load" });
await page.waitForTimeout(2500);
const nLoad = await snap();
const docH = await page.evaluate(() => document.documentElement.scrollHeight);
for (let y = 0; y < docH; y += 220) { await page.mouse.wheel(0, 220); await page.waitForTimeout(16); }
await page.waitForTimeout(1500);
const all = await page.evaluate(() => window.__e);
function sessionMax(es) { let best = 0, cur = 0, first = 0, last = 0; for (const e of es) { if (e.input) continue; if (cur && e.t - last < 1000 && e.t - first < 5000) { cur += e.v; } else { cur = e.v; first = e.t; } last = e.t; best = Math.max(best, cur); } return best; }
const r = (n) => Number(n.toFixed(4));
const load = all.slice(0, nLoad), scroll = all.slice(nLoad);
const bySrc = {};
for (const e of all) for (const s of e.src) { const k = s.n; bySrc[k] = (bySrc[k] ?? 0) + e.v / Math.max(1, e.src.length); }
console.log(JSON.stringify({ viewport: `${w}x${h}`, blockedValve: block, docH, entries: all.length, inputExcluded: all.filter((e) => e.input).length,
  rawSum: r(all.reduce((a, e) => a + e.v, 0)), loadPhaseSum: r(load.reduce((a, e) => a + e.v, 0)), scrollPhaseSum: r(scroll.reduce((a, e) => a + e.v, 0)),
  cwvSessionMax: r(sessionMax(all)), cwvLoadOnly: r(sessionMax(load)),
  topSources: Object.entries(bySrc).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => [k, r(v)]),
  sample: scroll.slice(0, 3).map((e) => ({ t: Math.round(e.t), v: r(e.v), src: e.src.slice(0, 2) })) }, null, 1));
await browser.close();
