// Phase C evidence. Frozen-frame contact sheets per transition (scrub = deterministic) + real-time WebM per viewport.
// Usage: SB_URL=http://127.0.0.1:6111 FRAMES_DIR=<scratch> node capture.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.SB_URL ?? "http://127.0.0.1:6111";
const frames = process.env.FRAMES_DIR ?? join(out, "frames");
mkdirSync(frames, { recursive: true });
const story = (name) => `${base}/iframe.html?id=ds-v1-landing-01b-memory-strip-motion--${name}&viewMode=story`;
const TRANSITIONS = ["match-01>match-08", "match-08>match-24", "match-24>match-56", "match-56>player-model"];
const STEPS = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1];
const only = process.env.ONLY?.split(",");

async function open(browser, w, h, name, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark", ...opts });
  const page = await ctx.newPage();
  await page.goto(story(name));
  await page.waitForSelector("[data-testid=memory-strip]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  return { ctx, page };
}

const setScrub = (page, p) => page.evaluate((v) => {
  const el = document.querySelector("[data-testid=scrub]");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, String(Math.round(v * 1000)));
  el.dispatchEvent(new Event("input", { bubbles: true }));
}, p);

const browser = await chromium.launch();
for (const [w, h, tag, name] of [[1440, 900, "desktop", "motion-review"], [390, 844, "mobile", "motion-review-mobile"]]) {
  const { ctx, page } = await open(browser, w, h, name);
  for (const t of TRANSITIONS) {
    if (only && !only.includes(t)) continue;
    const to = t.split(">")[1];
    await page.click(`[data-testid="play-${t}"]`);
    await page.waitForTimeout(200);
    await page.click(`[data-testid=scrub-toggle]`).catch(() => {});
    for (const [i, p] of STEPS.entries()) {
      await setScrub(page, p);
      await page.waitForTimeout(120);
      await page.locator("[data-testid=memory-strip]").screenshot({ path: join(frames, `${tag}-${t.replace(">", "_")}-${String(i).padStart(2, "0")}.png`) });
    }
    // release scrub: back to the settled static state
    if ((await page.locator("[data-testid=scrub-toggle]").innerText()).includes("release")) await page.click("[data-testid=scrub-toggle]");
    void to;
  }
  await ctx.close();
}

// Real-time video: all four transitions in a row (WebM).
for (const [w, h, tag, name] of [[1440, 900, "desktop", "motion-review"], [390, 844, "mobile", "motion-review-mobile"]]) {
  const { ctx, page } = await open(browser, w, h, name, { recordVideo: { dir: frames, size: { width: w, height: h } } });
  await page.waitForTimeout(900);
  for (const t of TRANSITIONS) {
    await page.click(`[data-testid="play-${t}"]`);
    await page.waitForTimeout(3600);
  }
  await page.waitForTimeout(600);
  const video = page.video();
  await ctx.close();
  await video.saveAs(join(out, `motion-${tag}.webm`));
}
await browser.close();
