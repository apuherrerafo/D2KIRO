// TSK-243 evidence: composes contact sheets from the frames capture.mjs wrote, and one whole-page sequence per form factor
// (the page scrolled top to bottom in 10 even steps with ordinary wheel input, to judge rhythm as one experience).
// Usage (from apps/web): SB_URL=http://127.0.0.1:6111 FRAMES_DIR=<scratch> node ../../docs/diagnostics/landing-close/sheets.mjs
import { chromium } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.SB_URL ?? "http://127.0.0.1:6111";
const frames = process.env.FRAMES_DIR ?? join(out, "frames");
const story = (name) => `${base}/iframe.html?id=ds-v1-landing-01b--${name}&viewMode=story`;
const browser = await chromium.launch();

async function sheet(file, files, cols, cell, label) {
  const imgs = files.map((f) => `<figure><img src="data:image/png;base64,${readFileSync(join(frames, f)).toString("base64")}"><figcaption>${f.replace(".png", "")}</figcaption></figure>`).join("");
  const page = await browser.newPage({ viewport: { width: cols * (cell + 12) + 12, height: 400 } });
  await page.setContent(`<style>body{margin:0;background:#050505;font:11px monospace;color:#9a9a9a;padding:12px}h1{font:12px monospace;margin:0 0 8px;color:#ddd}main{display:grid;grid-template-columns:repeat(${cols},${cell}px);gap:12px}figure{margin:0}img{width:${cell}px;display:block;border:1px solid #222}figcaption{padding-top:4px}</style><h1>${label}</h1><main>${imgs}</main>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, file), fullPage: true });
  await page.close();
}

async function sequence(w, h, tag) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: "dark" });
  const page = await ctx.newPage();
  await page.goto(story("full-page"));
  await page.waitForSelector("#waitlist");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1200);
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const names = [];
  const N = 10;
  for (let i = 0; i < N; i++) {
    const y = Math.round(((docH - h) * i) / (N - 1));
    const now = await page.evaluate(() => scrollY);
    const delta = y - now;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / 120));
    await page.mouse.move(w / 2, h / 2);
    for (let s = 0; s < steps; s++) {
      await page.mouse.wheel(0, delta / steps);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(700);
    const name = `seq-${tag}-${String(i).padStart(2, "0")}.png`;
    await page.screenshot({ path: join(frames, name) });
    names.push(name);
  }
  await ctx.close();
  return names;
}

const all = readdirSync(frames);
const pick = (prefix) => all.filter((f) => f.startsWith(prefix) && /-0[0-6]-/.test(f));
await sheet("sheet-desktop-1440.png", pick("desktop-1440-"), 4, 420, "TSK-243 · desktop 1440x900 · Counterfactual → proposition → close → end");
await sheet("sheet-desktop-1366.png", pick("desktop-1366-"), 4, 420, "TSK-243 · desktop 1366x768");
await sheet("sheet-mobile-390.png", pick("mobile-390-0"), 7, 190, "TSK-243 · mobile 390x844");
await sheet("sheet-mobile-390-short.png", pick("mobile-390-short-"), 7, 190, "TSK-243 · mobile 390x664");
await sheet("sheet-reduced.png", all.filter((f) => f.includes("-reduced-")), 4, 340, "TSK-243 · reduced motion");
await sheet("sequence-desktop-1440.png", await sequence(1440, 900, "d"), 5, 300, "TSK-243 · whole page, 10 wheel-driven stops · 1440x900");
await sheet("sequence-mobile-390.png", await sequence(390, 844, "m"), 10, 150, "TSK-243 · whole page, 10 wheel-driven stops · 390x844");
await browser.close();
console.log("sheets done");
