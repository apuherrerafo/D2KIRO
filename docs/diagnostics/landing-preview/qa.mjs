// TSK-244 evidence: the REAL routed page `/` on a production build (`next start`), not Storybook.
// Usage (from apps/web): BASE=http://localhost:3100 node ../../docs/diagnostics/landing-routing/qa.mjs
import { chromium, webkit, firefox } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.BASE ?? "http://localhost:3100";
const shots = process.env.SHOTS_DIR ?? join(out, "shots");
mkdirSync(shots, { recursive: true });
const VIEWPORTS = [[1440, 900, "d1440"], [1366, 768, "d1366"], [390, 844, "m844"], [390, 664, "m664"]];
const report = { base, runs: [] };

async function open(browserType, { w, h, reduced = false, blockValve = false }) {
  const browser = await browserType.launch();
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  const page = await ctx.newPage();
  const log = { console: [], failed: [], nonGet: [], pageErrors: [] };
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) log.console.push(`${m.type()}: ${m.text().slice(0, 160)}`); });
  page.on("pageerror", (e) => log.pageErrors.push(String(e).slice(0, 160)));
  page.on("requestfailed", (r) => log.failed.push(`${r.url().slice(0, 100)} ${r.failure()?.errorText}`));
  page.on("response", (r) => { if (r.status() >= 400) log.failed.push(`${r.status()} ${r.url().slice(0, 100)}`); });
  page.on("request", (r) => { if (r.method() !== "GET") log.nonGet.push(`${r.method()} ${r.url().slice(0, 100)}`); });
  if (blockValve) await page.route(/steamstatic|valve|dota2\.com/i, (route) => route.abort());
  await page.addInitScript(() => { window.__cls = 0; new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: "layout-shift", buffered: true }); });
  return { browser, page, log };
}
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function structure(page) {
  return page.evaluate(() => ({
    title: document.title,
    h1: [...document.querySelectorAll("h1")].map((e) => e.textContent.trim().slice(0, 60)),
    landmarks: { nav: document.querySelectorAll("nav").length, main: document.querySelectorAll("main").length, footer: document.querySelectorAll("footer").length },
    anchors: [...document.querySelectorAll('a[href^="#"]')].map((a) => ({ href: a.getAttribute("href"), exists: !!document.querySelector(a.getAttribute("href")) })),
    sections: [...document.querySelectorAll("[data-section]")].map((e) => e.id),
    overflowX: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    images: [...document.images].map((i) => ({ loading: i.loading, w: i.width, h: i.height, ok: i.complete && i.naturalWidth > 0 })),
  }));
}

async function anchorOffsets(page) {
  const res = [];
  for (const id of ["memory", "counterfactual", "proposition", "waitlist"]) {
    await page.goto(`${base}/#${id}`, { waitUntil: "load" });
    await page.waitForTimeout(700);
    await settle(page);
    res.push(await page.evaluate((i) => { const e = document.getElementById(i); return { id: i, exists: !!e, top: e ? Math.round(e.getBoundingClientRect().top) : null, scrollMargin: e ? getComputedStyle(e).scrollMarginTop : null, navH: Math.round(document.querySelector(".ld-nav")?.getBoundingClientRect().height ?? 0) }; }, id));
  }
  return res;
}

async function scrollPass(page) {
  const docH = await page.evaluate(() => document.documentElement.scrollHeight);
  const gaps = [];
  const sampler = page.evaluate(() => new Promise((resolve) => {
    const g = []; let last = performance.now(); const t0 = last;
    const tick = (t) => { g.push(t - last); last = t; if (t - t0 < 4500) requestAnimationFrame(tick); else resolve(g); };
    requestAnimationFrame(tick);
  }));
  for (let y = 0; y < docH; y += 220) { await page.mouse.wheel(0, 220); await page.waitForTimeout(16); }
  gaps.push(...(await sampler));
  return { docH, frames: gaps.length, framesOver50ms: gaps.filter((g) => g > 50).length, worstMs: Math.round(Math.max(...gaps)) };
}

async function waitlistProbe(page) {
  await page.locator("#waitlist").scrollIntoViewIfNeeded();
  await page.fill('input[name="email"]', "qa@example.com");
  await page.locator("#waitlist button").first().click();
  await page.waitForTimeout(1500);
  const text = await page.locator("#waitlist").innerText();
  return { claimsOnList: /you are on the list/i.test(text), says: text.replace(/\s+/g, " ").slice(0, 400) };
}

async function run(name, browserType, vp, opts = {}) {
  const [w, h, tag] = vp;
  const { browser, page, log } = await open(browserType, { w, h, ...opts });
  const entry = { run: name, viewport: tag, ...opts };
  try {
    const resp = await page.goto(`${base}/`, { waitUntil: "load" });
    entry.status = resp.status();
    await page.waitForTimeout(1200);
    entry.structure = await structure(page);
    entry.heroSeats = await page.evaluate(() => ({ openLabels: [...document.querySelectorAll("*")].filter((e) => e.children.length === 0 && e.textContent.trim() === "Open").length, imgsLoaded: [...document.images].filter((i) => i.complete && i.naturalWidth > 0).length, imgsTotal: document.images.length }));
    await page.screenshot({ path: join(shots, `${name}-${tag}-top.png`) });
    if (!opts.skipDeep) {
      entry.anchors = await anchorOffsets(page);
      await page.goto(`${base}/`, { waitUntil: "load" });
      await page.waitForTimeout(600);
      entry.scroll = await scrollPass(page);
      await page.screenshot({ path: join(shots, `${name}-${tag}-end.png`) });
      entry.waitlist = await waitlistProbe(page);
    }
    entry.cls = Number((await page.evaluate(() => window.__cls)).toFixed(4));
  } catch (error) { entry.error = String(error).slice(0, 300); }
  entry.log = log;
  await browser.close();
  report.runs.push(entry);
}

const only = process.env.ONLY;
if (!only || only === "chromium") {
  for (const vp of VIEWPORTS) {
    await run("chromium", chromium, vp);
    await run("chromium-reduced", chromium, vp, { reduced: true });
    await run("chromium-blocked", chromium, vp, { blockValve: true, skipDeep: true });
  }
}
if (!only || only === "webkit") {
  await run("webkit", webkit, VIEWPORTS[0]);
  await run("webkit", webkit, VIEWPORTS[2]);
}
if (!only || only === "firefox") {
  try { await run("firefox", firefox, VIEWPORTS[0]); } catch (e) { report.runs.push({ run: "firefox", error: String(e).slice(0, 160) }); }
}
writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report.runs.map((r) => ({ run: r.run, vp: r.viewport, status: r.status, err: r.error?.slice(0, 90), h1: r.structure?.h1.length, cls: r.cls, console: r.log?.console.length, failed: r.log?.failed.length })), null, 0));
