// TSK-244 evidence: which element shifts, and when. Usage (from apps/web): BASE=... node ../../docs/diagnostics/landing-routing/cls.mjs [w h]
import { chromium } from "@playwright/test";
const base = process.env.BASE ?? "http://localhost:3100";
const [w, h] = [Number(process.argv[2] ?? 390), Number(process.argv[3] ?? 844)];
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
await page.addInitScript(() => {
  window.__shifts = [];
  new PerformanceObserver((l) => {
    for (const e of l.getEntries()) {
      if (e.hadRecentInput) continue;
      window.__shifts.push({ t: Math.round(e.startTime), v: Number(e.value.toFixed(4)), src: e.sources.map((s) => `${s.node?.nodeName}.${(s.node?.className || "").toString().slice(0, 50)}`) });
    }
  }).observe({ type: "layout-shift", buffered: true });
});
await page.goto(`${base}/`, { waitUntil: "load" });
await page.waitForTimeout(1500);
for (let y = 0; y < 12000; y += 220) { await page.mouse.wheel(0, 220); await page.waitForTimeout(16); }
await page.waitForTimeout(800);
console.log(JSON.stringify(await page.evaluate(() => window.__shifts), null, 1));
await browser.close();
