// TSK-243 evidence: the REAL landing (Landing 01B story), lower half. Per viewport: Counterfactual release → proposition →
// close → end of page, plus whole-page layout checks (horizontal overflow, touch targets, CTA visibility, footer spacing),
// a reduced-motion pass and a wheel-driven pacing pass (ordinary mouse-wheel steps, not scripted frame stepping).
// Usage (from apps/web): SB_URL=http://127.0.0.1:6111 FRAMES_DIR=<scratch> node ../../docs/diagnostics/landing-close/capture.mjs
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.SB_URL ?? "http://127.0.0.1:6111";
const frames = process.env.FRAMES_DIR ?? join(out, "frames");
mkdirSync(frames, { recursive: true });
const story = (name) => `${base}/iframe.html?id=ds-v1-landing-01b--${name}&viewMode=story`;
const VIEWPORTS = [[1440, 900, "desktop-1440"], [1366, 768, "desktop-1366"], [390, 844, "mobile-390"], [390, 664, "mobile-390-short"]];
const report = [];
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const layout = (page) => page.evaluate(() => {
  const top = (sel) => { const el = document.querySelector(sel); return el ? Math.round(el.getBoundingClientRect().top + scrollY) : null; };
  const rect = (sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top + scrollY), bottom: Math.round(r.bottom + scrollY), h: Math.round(r.height) }; };
  const small = [...document.querySelectorAll("button, a, input")].filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44) && getComputedStyle(el).visibility !== "hidden"; })
    .map((el) => ({ tag: el.tagName, text: (el.textContent || el.getAttribute("aria-label") || el.name || "").trim().slice(0, 24), w: Math.round(el.getBoundingClientRect().width), h: Math.round(el.getBoundingClientRect().height) }));
  return {
    docH: document.documentElement.scrollHeight, vh: innerHeight, overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    counterfactual: rect("#counterfactual"), proposition: rect("#proposition"), waitlist: rect("#waitlist"), footer: rect(".ld-footer"), cta: rect(".ld-waitlist-action"),
    small, tops: { proposition: top("#proposition"), waitlist: top("#waitlist") },
  };
});

async function open(browser, w, h, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark", ...opts });
  const page = await ctx.newPage();
  await page.goto(story(name));
  await page.waitForSelector("#waitlist");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  return { ctx, page };
}
async function shot(page, tag, label, y) {
  await page.evaluate((v) => scrollTo(0, v), y);
  await settle(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(frames, `${tag}-${label}.png`) });
}

const browser = await chromium.launch();
for (const [w, h, tag] of VIEWPORTS) {
  const { ctx, page } = await open(browser, w, h, "full-page");
  const g = await layout(page);
  report.push({ viewport: tag, ...g });
  const cf = g.counterfactual, pr = g.proposition, wl = g.waitlist;
  await shot(page, tag, "00-cf-release", cf.bottom - h * 0.6);
  await shot(page, tag, "01-cf-to-proposition", pr.top - h * 0.45);
  await shot(page, tag, "02-proposition-head", pr.top - 56 + 8);
  await shot(page, tag, "03-proposition-stage", pr.top + h * 0.35);
  await shot(page, tag, "04-proposition-points", pr.bottom - h * 0.85);
  await shot(page, tag, "05-close", wl.top - 56 + 8);
  await shot(page, tag, "06-end", g.docH - h);
  await ctx.close();
}
// Reduced motion
for (const [w, h, tag] of [[1440, 900, "desktop-1440"], [390, 844, "mobile-390"]]) {
  const { ctx, page } = await open(browser, w, h, "reduced-motion", { reducedMotion: "reduce" });
  const g = await layout(page);
  await shot(page, `${tag}-reduced`, "proposition", g.tops.proposition - 56 + 8);
  await shot(page, `${tag}-reduced`, "close", g.tops.waitlist - 56 + 8);
  report.push({ viewport: `${tag}-reduced`, overflowX: g.overflowX });
  await ctx.close();
}
// Wheel pacing: ordinary mouse-wheel steps down the whole page, noting long tasks / dropped frames.
for (const [w, h, tag] of [[1440, 900, "desktop-1440"], [390, 844, "mobile-390"]]) {
  const { ctx, page } = await open(browser, w, h, "full-page");
  await page.evaluate(() => {
    window.__frames = []; window.__long = [];
    let last = performance.now();
    const tick = (now) => { window.__frames.push(now - last); last = now; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(Math.round(e.duration)))).observe({ entryTypes: ["longtask"] });
  });
  await page.mouse.move(w / 2, h / 2);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const steps = Math.ceil((docH - h) / 100);
  for (let i = 0; i < steps; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(24); }
  await page.waitForTimeout(600);
  const perf = await page.evaluate(() => {
    const f = window.__frames.slice(5).sort((a, b) => a - b);
    return { frames: f.length, p50: +f[Math.floor(f.length * 0.5)].toFixed(1), p95: +f[Math.floor(f.length * 0.95)].toFixed(1), worst: +f[f.length - 1].toFixed(1), over50: f.filter((x) => x > 50).length, longTasks: window.__long };
  });
  report.push({ viewport: `${tag}-wheel`, wheelSteps: steps, ...perf });
  await page.screenshot({ path: join(frames, `${tag}-wheel-end.png`) });
  await ctx.close();
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report.map((r) => ({ v: r.viewport, ox: r.overflowX, docH: r.docH, prop: r.proposition?.h, wl: r.waitlist?.h, small: r.small?.length, perf: r.p95 ? [r.p50, r.p95, r.worst, r.over50] : undefined })), null, 0));
await browser.close();
