// Targeted evidence for TSK-241 final product pass. Serves apps/web/storybook-static and drives the REAL landing story.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";

const out = dirname(fileURLToPath(import.meta.url));
const root = resolve(out, "..", "..", "..", "apps", "web", "storybook-static");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff" };
const server = createServer(async (req, res) => {
  try {
    const path = join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
    res.setHeader("content-type", types[extname(path)] ?? "application/octet-stream");
    res.end(await readFile(path));
  } catch { res.statusCode = 404; res.end(); }
});
await new Promise((ok) => server.listen(6215, "127.0.0.1", ok));
const url = "http://127.0.0.1:6215/iframe.html?id=ds-v1-landing-01b--full-page&viewMode=story";
const log = {};
const browser = await chromium.launch();

async function open(w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
  await page.goto(url);
  await page.waitForSelector('[data-testid="hero-story"]');
  await page.evaluate(() => document.fonts.ready);
  return page;
}
const heroState = (page) => page.evaluate(() => ({
  step: document.querySelector('[data-testid="hero-story"]')?.getAttribute("data-step"),
  lock: document.querySelector(".hs-lock")?.textContent,
}));
const geometry = (page) => page.evaluate(() => {
  const track = document.querySelector(".ld-memory-track"), stage = document.querySelector(".ld-memory-stage"), section = document.querySelector('[data-section="memory"]');
  return { trackTop: track.getBoundingClientRect().top + scrollY, stageH: stage.offsetHeight, sectionTop: section.getBoundingClientRect().top + scrollY, vh: innerHeight };
});
async function scrollTo(page, y) { // natural scrolling: wheel in steps
  for (;;) {
    const now = await page.evaluate(() => scrollY);
    const d = y - now;
    if (Math.abs(d) < 2) break;
    await page.mouse.wheel(0, Math.sign(d) * Math.min(Math.abs(d), 120));
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(350);
}
const waitHero = (page, text) => page.waitForFunction((t) => document.querySelector('[data-testid="hero-story"]')?.getAttribute("data-step") === "hold" && (document.querySelector(".hs-lock")?.textContent ?? "").startsWith(t), text, { timeout: 60000, polling: 100 });

async function caseA(w, h, tag, withHeroShots) {
  const page = await open(w, h);
  await page.mouse.move(w / 2, h / 2);
  await waitHero(page, "Puck");
  const g = await geometry(page);
  const pin = g.trackTop - 56;
  log[`${tag}-A-hero`] = await heroState(page);
  if (withHeroShots) { await scrollTo(page, Math.max(0, g.sectionTop - g.vh * 0.95)); await page.screenshot({ path: join(out, `1-hero-locked-puck-${tag}.png`) }); }
  await scrollTo(page, g.trackTop - g.vh * 0.5); // bridge + Match 01 beginning to form
  log[`${tag}-A-forming`] = await page.evaluate(() => ({ handoff: getComputedStyle(document.querySelector(".ld-memory-stage")).getPropertyValue("--ld-handoff"), beat: document.querySelector(".ld-memory-stage").dataset.beat, scrollY }));
  await page.screenshot({ path: join(out, `2-bridge-forming-${tag}.png`) });
  await scrollTo(page, pin + g.stageH * 0.3); // complete Match 01, pinned
  log[`${tag}-A-rest`] = await page.evaluate(() => ({ beat: document.querySelector(".ld-memory-stage").dataset.beat, handoff: getComputedStyle(document.querySelector(".ld-memory-stage")).getPropertyValue("--ld-handoff") }));
  await page.screenshot({ path: join(out, `3-match-01-pinned-${tag}.png`) });
  log[`${tag}-A-hero-after`] = await heroState(page);
  await page.close();
}
async function caseB(w, h, tag) {
  const page = await open(w, h);
  await page.mouse.move(w / 2, h / 2);
  await waitHero(page, "Ember Spirit");
  log[`${tag}-B-ember`] = await heroState(page);
  await page.screenshot({ path: join(out, `4-hero-ember-visible-${tag}.png`) });
  const g = await geometry(page);
  await scrollTo(page, Math.max(0, g.sectionTop - g.vh * 0.95)); // just before the bridge is claimed
  log[`${tag}-B-before-bridge`] = await heroState(page);
  await scrollTo(page, Math.max(0, g.sectionTop - g.vh * 0.7)); // bridge entering
  await page.waitForTimeout(1500);
  log[`${tag}-B-after-bridge`] = await heroState(page);
  const hero = page.locator('[data-section="hero"]');
  await page.screenshot({ path: join(out, `5-leaving-hero-${tag}.png`) });
  await scrollTo(page, g.trackTop - g.vh * 0.5);
  await page.screenshot({ path: join(out, `7-bridge-puck-memory-${tag}.png`) });
  log[`${tag}-B-hero-end`] = await heroState(page);
  // the canonical Puck lock, framed on the hero itself
  await page.evaluate(() => document.querySelector('[data-testid="hero-story"]').scrollIntoView({ block: "center" }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(out, `6-canonical-puck-lock-${tag}.png`) });
  await page.close();
}
await caseA(1440, 900, "1440x900", true);
await caseB(1440, 900, "1440x900");
await caseA(1366, 768, "1366x768", false);
await caseA(390, 844, "390x844", false);
await writeFile(join(out, "evidence.json"), JSON.stringify(log, null, 2));
await browser.close();
server.close();
console.log(JSON.stringify(log, null, 2));
