// TSK-242 evidence: the REAL landing (Landing 01B story), scrolled through the Counterfactual section. Per viewport:
// Memory exit → section entry → every stage (the reorder at 0/25/50/75/100 %) → release, plus layout checks
// (nothing escapes the pinned stage, no horizontal scroll) and a reduced-motion pass.
// Usage (from apps/web): SB_URL=http://127.0.0.1:6111 FRAMES_DIR=<scratch> node ../../docs/diagnostics/counterfactual/capture.mjs
import { chromium } from "@playwright/test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.SB_URL ?? "http://127.0.0.1:6111";
const frames = process.env.FRAMES_DIR ?? join(out, "frames");
mkdirSync(frames, { recursive: true });
const story = (name) => `${base}/iframe.html?id=ds-v1-landing-01b--${name}&viewMode=story`;
const VIEWPORTS = [[1440, 900, "desktop-1440"], [1366, 768, "desktop-1366"], [390, 844, "mobile-390"], [390, 664, "mobile-390-short"]];
const only = process.env.ONLY?.split(",");
const SCREENS = { generic: 0.3, context: 0.45, reinterpret: 0.45, reorder: 0.6, personal: 0.4 };
const TOTAL = Object.values(SCREENS).reduce((a, b) => a + b, 0);
const startOf = (stage) => { let at = 0; for (const [name, s] of Object.entries(SCREENS)) { if (name === stage) return at / TOTAL; at += s; } return 0; };
const at = (stage, f) => startOf(stage) + (SCREENS[stage] / TOTAL) * f;
const report = [];

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const geometry = (page) => page.evaluate(() => {
  const track = document.querySelector(".ld-cf-track"), stage = document.querySelector(".ld-cf-stage");
  const pin = parseFloat(getComputedStyle(stage).top);
  return { start: track.getBoundingClientRect().top + scrollY - pin, span: track.offsetHeight - stage.offsetHeight, vh: innerHeight, section: document.querySelector("#counterfactual").getBoundingClientRect().top + scrollY };
});
const state = (page) => page.evaluate(() => {
  const stage = document.querySelector(".ld-cf-stage").getBoundingClientRect();
  const cf = document.querySelector(".cf");
  const parts = [...document.querySelectorAll(".ld-cf-stage .cf-object, .ld-cf-stage .cf-copy, .ld-cf-stage .cf-illustrative")].map((el) => el.getBoundingClientRect());
  const rows = [...document.querySelectorAll(".cf-row")].map((r) => ({ hero: r.dataset.hero, top: Math.round(r.getBoundingClientRect().top - stage.top), h: Math.round(r.getBoundingClientRect().height), tagsBottom: Math.round(r.querySelector(".cf-tags").getBoundingClientRect().bottom - r.getBoundingClientRect().top) }));
  return {
    stage: cf.dataset.stage, p: cf.style.getPropertyValue("--cf-p"), ctx: cf.style.getPropertyValue("--cf-ctx"), rein: cf.style.getPropertyValue("--cf-rein"),
    overflowY: Math.max(0, ...parts.map((r) => Math.round(r.bottom - stage.bottom)), ...parts.map((r) => Math.round(stage.top - r.top))),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth), stageTop: Math.round(stage.top), rows,
  };
});

async function open(browser, w, h, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark", ...opts });
  const page = await ctx.newPage();
  await page.goto(story(name));
  await page.waitForSelector(".ld-cf-stage .cf");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1400);
  return { ctx, page };
}

async function shot(page, tag, label, y, extra = {}) {
  await page.evaluate((v) => scrollTo(0, v), y);
  await settle(page);
  await page.waitForTimeout(450);
  const s = await state(page);
  await page.screenshot({ path: join(frames, `${tag}-${label}.png`) });
  report.push({ viewport: tag, label, scrollY: Math.round(y), ...s, ...extra });
  return s;
}

const browser = await chromium.launch();
for (const [w, h, tag] of VIEWPORTS) {
  if (only && !only.includes(tag)) continue;
  const { ctx, page } = await open(browser, w, h, "full-page");
  const g = await geometry(page);
  // The Memory Strip's exit and the section's entry: the section top at 85 %, 55 % and 20 % of the viewport.
  await shot(page, tag, "00-entry-85", g.section - h * 0.85);
  await shot(page, tag, "01-entry-55", g.section - h * 0.55);
  await shot(page, tag, "02-entry-20", g.section - h * 0.2);
  await shot(page, tag, "03-pin-start", g.start - 1);
  for (const [label, p] of [
    ["10-generic", at("generic", 0.7)], ["11-context-25", at("context", 0.25)], ["12-context-60", at("context", 0.6)], ["13-context-end", at("context", 1)],
    ["20-reinterpret-50", at("reinterpret", 0.5)], ["21-reinterpret-end", at("reinterpret", 1)],
    ["30-reorder-00", at("reorder", 0.001)], ["31-reorder-25", at("reorder", 0.25)], ["32-reorder-50", at("reorder", 0.5)], ["33-reorder-75", at("reorder", 0.75)], ["34-reorder-100", at("reorder", 1)],
    ["40-personal", at("personal", 0.6)],
  ]) await shot(page, tag, label, g.start + g.span * p);
  await shot(page, tag, "50-release", g.start + g.span + h * 0.5);
  await shot(page, tag, "51-next-section", g.start + g.span + h * 0.95);
  await ctx.close();
}

// Reduced motion: every stage is a discrete state; the order simply changes.
for (const [w, h, tag] of [[1440, 900, "desktop-1440"], [390, 844, "mobile-390"]]) {
  if (only && !only.includes(tag)) continue;
  const { ctx, page } = await open(browser, w, h, "reduced-motion", { reducedMotion: "reduce" });
  const g = await geometry(page);
  for (const stage of Object.keys(SCREENS)) await shot(page, `${tag}-reduced`, stage, g.start + g.span * at(stage, 0.5));
  await ctx.close();
}

writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 1));
const bad = report.filter((r) => r.overflowY > 0 || r.overflowX > 0);
console.log(`${report.length} frames, ${bad.length} with overflow`, bad.map((r) => `${r.viewport}/${r.label} y${r.overflowY} x${r.overflowX}`));

// VIDEO=1: one real-time WebM per viewport of a steady scroll from the Memory exit to the section release (~16 s).
if (process.env.VIDEO) {
  for (const [w, h, tag, name] of [[1440, 900, "desktop-1440", "desktop"], [390, 844, "mobile-390", "mobile"]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark", recordVideo: { dir: join(frames, "video"), size: { width: w, height: h } } });
    const page = await ctx.newPage();
    await page.goto(story("full-page"));
    await page.waitForSelector(".ld-cf-stage .cf");
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    const g = await geometry(page);
    const from = g.section - h * 0.9, to = g.start + g.span + h * 0.6;
    await page.evaluate((v) => scrollTo(0, v), from);
    await page.waitForTimeout(800);
    await page.evaluate(([a, b, ms]) => new Promise((done) => {
      const t0 = performance.now();
      const step = (now) => { const k = Math.min(1, (now - t0) / ms); scrollTo(0, a + (b - a) * k); k < 1 ? requestAnimationFrame(step) : done(); };
      requestAnimationFrame(step);
    }), [from, to, 16000]);
    await page.waitForTimeout(800);
    const file = await page.video().path();
    await ctx.close();
    copyFileSync(file, join(out, `scroll-${name}.webm`));
    console.log("video", tag);
  }
}
await browser.close();
