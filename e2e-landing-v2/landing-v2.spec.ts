import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/* LANDING V2 · integration evidence: full-page checkpoints per theme/motion/viewport, page-wide assertions, loading and
   performance measurements, and one scroll video per viewport. Run:  npx playwright test -c playwright.landing-v2.config.ts */
const OUT = resolve("docs/landing-v2-integration");
mkdirSync(OUT, { recursive: true });

const url = (q: Record<string, string> = {}) => `/lab/landing-v2?${new URLSearchParams(q).toString()}`;

async function open(page: Page, q: Record<string, string> = {}) {
  await page.goto(url(q));
  await page.waitForSelector("[data-testid=lv2]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
}

const top = (page: Page, sel: string, off = 0) =>
  page.evaluate(([s, o]) => { const el = document.querySelector(s as string); return el ? el.getBoundingClientRect().top + window.scrollY + (o as number) : 0; }, [sel, off] as const);

async function goTo(page: Page, y: number, wait = 1200) {
  await page.evaluate((t) => window.scrollTo(0, t), y);
  await page.waitForTimeout(wait);
}

/** The scroll offset at which Memory scene `i` is current (matches scroll-scene.ts weights). */
async function memoryY(page: Page, p: number) {
  return page.evaluate((progress) => {
    const t = document.querySelector("#memory") as HTMLElement;
    const pin = document.querySelector(".lv2-memory-pin") as HTMLElement;
    const stuck = parseFloat(getComputedStyle(pin).top) || 0;
    return t.getBoundingClientRect().top + window.scrollY - stuck + (t.offsetHeight - pin.offsetHeight) * progress;
  }, p);
}

async function checkpoints(page: Page, prefix: string) {
  const shot = (name: string) => page.screenshot({ path: `${OUT}/${prefix}-${name}.png` });
  await shot("1-top");
  await goTo(page, await top(page, "[data-testid=seam-hero-memory]", -260));
  await shot("2-seam-hero-memory");
  await goTo(page, await memoryY(page, 0.04), 2500);
  await shot("3a-memory-match01");
  await goTo(page, await memoryY(page, 0.42), 9000);
  await shot("3b-memory-match24");
  await goTo(page, await memoryY(page, 0.92), 12000);
  await shot("3c-memory-final");
  await goTo(page, await top(page, "[data-testid=seam-memory-cf]", -260));
  await shot("4-seam-memory-cf");
  await goTo(page, await top(page, "#counterfactual", -40), 10000);
  await shot("5-counterfactual-personal");
  await goTo(page, await top(page, "#proposition", -40), 2500);
  await shot("6-proposition");
  await goTo(page, await top(page, "#waitlist", -40), 1500);
  await shot("7-cta");
}

test("capture: dark + light checkpoints, reduced motion pass", async ({ page }, info) => {
  test.setTimeout(600_000);
  const p = info.project.name;
  await open(page, { theme: "dark" });
  await checkpoints(page, `${p}-dark`);
  await open(page, { theme: "light" });
  await checkpoints(page, `${p}-light`);
  await open(page, { theme: "dark", motion: "reduced" });
  await checkpoints(page, `${p}-reduced`);
});

test("page-wide contract", async ({ page }, info) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await open(page);

  // no horizontal overflow (the app shell's own NavBar is contained on this route)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // one H1, one theme toggle, one Pause
  expect(await page.locator("h1").count()).toBe(1);
  expect(await page.locator("[data-testid=theme-toggle]").count()).toBe(1);
  expect(await page.locator("[data-testid=hero-pause]").count()).toBe(1);
  expect(await page.locator("[data-testid=hero-pause]").evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);

  // Hero pause really stops the loop
  await page.locator("[data-testid=hero-pause]").click();
  const beat = () => page.locator("[data-testid=hero-loop]").getAttribute("data-beat");
  const a = await beat();
  await page.waitForTimeout(3500);
  expect(await beat()).toBe(a);
  await page.locator("[data-testid=hero-pause]").click();

  // asset strategy: the page is pre-rendered Coach only, on every viewport (no live Gold Master, no Three.js runtime)
  const live = requests.filter((u) => /coach-gold-master|coach-modular|live-stage|three/i.test(u));
  expect(live).toEqual([]);

  // theme toggle: one control, whole page, persisted for the session
  await page.locator("[data-testid=theme-toggle]").click();
  expect(await page.locator("[data-testid=lv2]").getAttribute("data-theme")).toBe("light");
  await page.reload();
  await page.waitForSelector("[data-testid=lv2]");
  await expect(page.locator("[data-testid=lv2]")).toHaveAttribute("data-theme", "light");
  await page.locator("[data-testid=theme-toggle]").click();

  // vocabulary: no invented numbers, no forbidden claims anywhere on the page
  const text = await page.locator("main").innerText();
  for (const re of [/ai[- ]powered/i, /\bbest pick/i, /\boptimal/i, /guarantee/i, /win\s?rate\s?of/i, /\d+\s?%/, /\bmmr\b/i, /thousands of players/i]) expect(text).not.toMatch(re);
});

test("memory is scroll-driven and deterministic; Match 24 is reached in order", async ({ page }) => {
  test.setTimeout(180_000);
  await open(page);
  const scene = () => page.locator("#memory").getAttribute("data-scene");
  await goTo(page, await memoryY(page, 0.01), 800);
  expect(await scene()).toBe("0");
  // jump straight to the end: scenes still play in order and none is skipped
  const seen = new Set<string>();
  await goTo(page, await memoryY(page, 0.95), 0);
  for (let i = 0; i < 90; i += 1) {
    seen.add((await scene()) ?? "");
    await page.waitForTimeout(500);
  }
  expect([...seen].sort()).toEqual(["0", "1", "2", "3", "4"]);
  // back up: straight to the earlier scene
  await goTo(page, await memoryY(page, 0.04), 1500);
  expect(await scene()).toBe("0");
});

test("offscreen sections halt: the Hero clock stops when the Hero is out of view", async ({ page }) => {
  await open(page);
  await goTo(page, await top(page, "#proposition", -40), 800);
  const beat = () => page.locator("[data-testid=hero-loop]").getAttribute("data-beat");
  const a = await beat();
  await page.waitForTimeout(3500);
  expect(await beat()).toBe(a);
});

test("performance + loading measurements", async ({ page }, info) => {
  test.setTimeout(240_000);
  const bytes: Record<string, number> = { js: 0, css: 0, image: 0, font: 0, other: 0, total: 0 };
  const gold: string[] = [];
  const coachBytes = { hero: 0, memory: 0 };
  const memoryAt: Record<string, number> = {};
  page.on("response", async (r) => {
    const u = r.url();
    // transferred (encoded) size, as the network saw it
    const len = await r.request().sizes().then((z) => z.responseBodySize + z.responseHeadersSize).catch(() => 0);
    const type = /\.js(\?|$)/.test(u) ? "js" : /\.css(\?|$)/.test(u) ? "css" : /\.(webp|png|jpe?g|svg)(\?|$)/.test(u) ? "image" : /\.woff2?/.test(u) ? "font" : "other";
    bytes[type] += len;
    bytes.total += len;
    if (/coach-gold-master|coach-modular|live-stage|three/i.test(u)) gold.push(u);
    if (/\/coach-web-pack\/(?!memory|reconstruct)/.test(u)) coachBytes.hero += len;
    if (/\/coach-web-pack\/(memory|reconstruct)/.test(u)) coachBytes.memory += len;
    if (u.includes("/coach-web-pack/memory/") && !(u in memoryAt)) memoryAt[u] = Date.now();
  });
  await page.addInitScript(() => {
    (window as unknown as { __cls: number; __lt: number[] }).__cls = 0;
    (window as unknown as { __lt: number[] }).__lt = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ hadRecentInput: boolean; value: number }>) if (!e.hadRecentInput) (window as unknown as { __cls: number }).__cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as unknown as { __lt: number[] }).__lt.push(e.duration); }).observe({ type: "longtask", buffered: true }); } catch { /* not supported (WebKit) */ }
  });
  const t0 = Date.now();
  await open(page);
  const initial = { ...bytes };
  const initialGold = gold.length;
  const memoryBeforeScroll = Object.keys(memoryAt).length;

  // frame pacing while scrolling the whole page
  const pacing = await page.evaluate(async () => {
    const frames: number[] = [];
    let last = performance.now();
    let on = true;
    const tick = (n: number) => { frames.push(n - last); last = n; if (on) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    const h = document.documentElement.scrollHeight - innerHeight;
    for (let y = 0; y < h; y += 60) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 16)); }
    on = false;
    frames.sort((a, b) => a - b);
    const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
    return { frames: frames.length, avg, p95: frames[Math.floor(frames.length * 0.95)], max: frames[frames.length - 1], over50: frames.filter((f) => f > 50).length };
  });
  await page.waitForTimeout(1500);
  const cls = await page.evaluate(() => (window as unknown as { __cls: number }).__cls);
  const longTasks = await page.evaluate(() => (window as unknown as { __lt: number[] }).__lt);
  const report = {
    project: info.project.name,
    bytesAtLoadPlus3s: initial,
    bytesAfterFullScroll: { ...bytes },
    liveCoachOrThreeRequestsAtLoad: initialGold,
    liveCoachOrThreeRequestsTotal: gold.length,
    coachAssetBytes: coachBytes,
    memoryStillsRequestedBeforeAnyScroll: memoryBeforeScroll,
    memoryAssetsTotal: Object.keys(memoryAt).length,
    cls: Number(cls.toFixed(4)),
    longTasks: { count: longTasks.length, totalMs: Math.round(longTasks.reduce((a, b) => a + b, 0)), maxMs: Math.round(Math.max(0, ...longTasks)) },
    framePacing: pacing,
    ms: Date.now() - t0,
  };
  writeFileSync(`${OUT}/perf-${info.project.name}.json`, JSON.stringify(report, null, 2));
});

test("video: full scroll", async ({ browser }, info) => {
  test.setTimeout(600_000);
  const dir = resolve(OUT, `.video-${info.project.name}`);
  const ctx = await browser.newContext({
    ...(info.project.use as object),
    storageState: "e2e-landing-v2/.tmp/session.json",
    recordVideo: { dir, size: info.project.name === "mobile" ? { width: 390, height: 844 } : { width: 1440, height: 900 } },
  });
  const page = await ctx.newPage();
  await open(page, { theme: "dark" });
  // a calm read: smooth scroll over the page in ~75 s, slower through the pinned Memory chapter
  await page.evaluate(async () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    const mem = document.querySelector("#memory") as HTMLElement;
    const memStart = mem.getBoundingClientRect().top + scrollY;
    const memEnd = memStart + mem.offsetHeight;
    let y = 0;
    let last = performance.now();
    // time-based, so a slow compositor (headless WebKit) still produces a calm read: px per second
    while (y < h) {
      const now = performance.now();
      const inMemory = y > memStart - 200 && y < memEnd - innerHeight;
      y += (inMemory ? 70 : 190) * ((now - last) / 1000);
      last = now;
      window.scrollTo(0, y);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    }
  });
  await page.waitForTimeout(2500);
  await ctx.close();
  const file = readdirSync(dir).find((f) => f.endsWith(".webm"));
  if (file) renameSync(`${dir}/${file}`, `${OUT}/video-${info.project.name === "mobile" ? "B-mobile" : "A-desktop"}-dark-scroll.webm`);
});
