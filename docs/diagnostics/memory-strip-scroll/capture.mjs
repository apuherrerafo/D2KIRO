// TSK-241 evidence: the REAL landing (Landing 01B story), scrolled. Per viewport: one frame per beat (approach, handoff,
// every hold, each transition at 25/50/75 %, release) + layout checks; refresh and resize mid-section; reduced motion;
// a real-time WebM of a steady scroll.
// Usage (from apps/web): SB_URL=http://127.0.0.1:6111 FRAMES_DIR=<scratch> node ../../docs/diagnostics/memory-strip-scroll/capture.mjs
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
const only = process.env.ONLY?.split(",");
const skip = process.env.SKIP?.split(",") ?? [];
const report = [];

const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const state = (page) => page.evaluate(() => {
  const stage = document.querySelector(".ld-memory-stage");
  const strip = document.querySelector(".ld-memory-stage [data-testid=memory-strip]");
  const s = stage.getBoundingClientRect();
  const parts = [...stage.querySelectorAll(".ms-object, .ms-annotation")].map((el) => el.getBoundingClientRect());
  return {
    beat: stage.dataset.beat, scene: strip.dataset.scene, handoff: stage.style.getPropertyValue("--ld-handoff"),
    overflowY: Math.max(0, ...parts.map((r) => Math.round(r.bottom - s.bottom)), ...parts.map((r) => Math.round(s.top - r.top))),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    stageTop: Math.round(s.top),
  };
});

async function open(browser, w, h, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark", ...opts });
  const page = await ctx.newPage();
  await page.goto(story(name));
  await page.waitForSelector(".ld-memory-stage [data-testid=memory-strip]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  return { ctx, page };
}

const geometry = (page) => page.evaluate(() => {
  const track = document.querySelector(".ld-memory-track"), stage = document.querySelector(".ld-memory-stage");
  const pin = parseFloat(getComputedStyle(stage).top);
  return { start: track.getBoundingClientRect().top + scrollY - pin, span: track.offsetHeight - stage.offsetHeight, vh: innerHeight };
});

/** Walks the pinned range and returns the scrollY where every beat starts / ends (read from the page, not assumed). */
async function beatMap(page) {
  const g = await geometry(page);
  const beats = [];
  for (let y = g.start; y <= g.start + g.span + 1; y += 12) {
    await page.evaluate((v) => scrollTo(0, v), y);
    await settle(page);
    const { beat } = await state(page);
    if (!beats.length || beats.at(-1).beat !== beat) beats.push({ beat, from: y, to: y });
    else beats.at(-1).to = y;
  }
  return { ...g, beats };
}

async function shot(page, tag, i, label) {
  await settle(page);
  await page.waitForTimeout(420);
  report.push({ tag, label, ...(await state(page)) });
  await page.screenshot({ path: join(frames, `${tag}-${String(i).padStart(2, "0")}.png`) });
}

const scrollTo = (page, y) => page.evaluate((v) => window.scrollTo(0, v), Math.round(y));
const browser = await chromium.launch();

if (!skip.includes("beats")) for (const [w, h, tag] of VIEWPORTS) {
  if (only && !only.includes(tag)) continue;
  const { ctx, page } = await open(browser, w, h, "full-page");
  const map = await beatMap(page);
  report.push({ tag, pinned: Math.round(map.span), vh: map.vh, beats: map.beats.map((b) => `${b.beat}:${Math.round(b.to - b.from)}px`).join(" ") });
  let i = 0;
  await scrollTo(page, map.start - map.vh * 0.55);
  await shot(page, tag, i++, "approach");
  for (const b of map.beats) {
    const points = b.beat.startsWith("transition") ? [0.25, 0.5, 0.75] : [0.5];
    for (const p of points) {
      await scrollTo(page, b.from + (b.to - b.from) * p);
      await shot(page, tag, i++, `${b.beat}@${p}`);
    }
  }
  await scrollTo(page, map.start + map.span + map.vh * 0.5);
  await shot(page, tag, i++, "release");
  // refresh mid-section: land in the Match 24 rest, reload, read the state back
  const hold24 = map.beats.find((b) => b.beat === "hold:match-24");
  await scrollTo(page, (hold24.from + hold24.to) / 2);
  await settle(page);
  await page.reload();
  await page.waitForSelector(".ld-memory-stage [data-testid=memory-strip]");
  await page.waitForTimeout(1500);
  /* The Storybook iframe does not restore scroll on reload, so land there in ONE jump, as a restored scroll would. */
  await scrollTo(page, (hold24.from + hold24.to) / 2);
  await settle(page);
  await page.waitForTimeout(600);
  report.push({ tag, label: "reload, then one jump into hold:match-24", ...(await state(page)) });
  await ctx.close();
}

// resize mid-section: 1440 → 1366 → 390 while pinned in the Match 56 rest (same fraction of the pin)
if (!skip.includes("resize")) {
  const { ctx, page } = await open(browser, 1440, 900, "full-page");
  const map = await beatMap(page);
  const hold56 = map.beats.find((b) => b.beat === "hold:match-56");
  const frac = ((hold56.from + hold56.to) / 2 - map.start) / map.span;
  await scrollTo(page, (hold56.from + hold56.to) / 2);
  for (const [w, h] of [[1366, 768], [390, 844]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(500);
    const g = await geometry(page);
    await scrollTo(page, g.start + g.span * frac);
    await settle(page);
    await page.waitForTimeout(400);
    report.push({ tag: `resize-to-${w}x${h}`, ...(await state(page)) });
    await page.screenshot({ path: join(frames, `resize-${w}.png`) });
  }
  await ctx.close();
}

// reduced motion: the same page with motionMode="reduced"
if (!skip.includes("reduced")) {
  const { ctx, page } = await open(browser, 1440, 900, "reduced-motion");
  const map = await beatMap(page);
  report.push({ tag: "reduced", beats: map.beats.map((b) => b.beat).join(" ") });
  let i = 0;
  for (const b of map.beats.filter((x) => x.beat.startsWith("transition"))) {
    for (const p of [0.3, 0.7]) {
      await scrollTo(page, b.from + (b.to - b.from) * p);
      await shot(page, "reduced", i++, `${b.beat}@${p}`);
    }
  }
  await ctx.close();
}

// real time: a steady scroll through the whole section (a calm reader), recorded, with frame-gap stats
if (!skip.includes("video")) for (const [w, h, tag, pxPerFrame] of [[1440, 900, "desktop", 12], [390, 844, "mobile", 10]]) {
  const { ctx, page } = await open(browser, w, h, "full-page", { recordVideo: { dir: frames, size: { width: w, height: h } } });
  const stats = await page.evaluate(async (step) => {
    const track = document.querySelector(".ld-memory-track"), stage = document.querySelector(".ld-memory-stage");
    const start = track.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(stage).top);
    const end = start + track.offsetHeight - stage.offsetHeight + innerHeight * 0.8;
    window.scrollTo(0, start - innerHeight * 0.8);
    const gaps = [];
    let last = performance.now();
    await new Promise((done) => {
      const tick = (now) => {
        gaps.push(now - last);
        last = now;
        window.scrollBy(0, step);
        if (scrollY >= end) return done();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    gaps.sort((a, b) => a - b);
    return { frames: gaps.length, p50: Math.round(gaps[Math.floor(gaps.length / 2)]), p95: Math.round(gaps[Math.floor(gaps.length * 0.95)]), max: Math.round(gaps.at(-1)) };
  }, pxPerFrame);
  report.push({ tag: `scroll-${tag}`, ...stats });
  const video = page.video();
  await ctx.close();
  await video.saveAs(join(out, `scroll-${tag}.webm`));
}

await browser.close();
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
