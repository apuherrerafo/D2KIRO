// Mobile scroll video. WebKit crashes when recording video on this Windows runner, so the video uses Chromium with the
// iPhone 14 profile at 390x844 (screenshots and the contract tests stay on WebKit).  node e2e-landing-v2/record-mobile.mjs
import { chromium, devices } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync } from "node:fs";

const OUT = "docs/landing-v2-integration";
const dir = `${OUT}/.video-mobile`;
mkdirSync(dir, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices["iPhone 14"],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  storageState: "e2e-landing-v2/.tmp/session.json",
  recordVideo: { dir, size: { width: 390, height: 844 } },
});
const page = await ctx.newPage();
await page.goto(`${process.env.LAB_BASE_URL ?? "http://localhost:3141"}/lab/landing-v2?theme=dark`);
await page.waitForSelector("[data-testid=lv2]");
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(3000);
await page.evaluate(async () => {
  const h = document.documentElement.scrollHeight - innerHeight;
  const mem = document.querySelector("#memory");
  const start = mem.getBoundingClientRect().top + scrollY;
  const end = start + mem.offsetHeight;
  let y = 0;
  let last = performance.now();
  while (y < h) {
    const now = performance.now();
    const inMemory = y > start - 200 && y < end - innerHeight;
    y += (inMemory ? 70 : 190) * ((now - last) / 1000);
    last = now;
    window.scrollTo(0, y);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
});
await page.waitForTimeout(2500);
await ctx.close();
await browser.close();
const file = readdirSync(dir).find((f) => f.endsWith(".webm"));
if (file) renameSync(`${dir}/${file}`, `${OUT}/video-B-mobile-dark-scroll.webm`);
