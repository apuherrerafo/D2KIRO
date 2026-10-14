import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/* LANDING V2 + COACH MOTION V2 · integration release checks (real route `/`, logged out, production build, LANDING_VARIANT=v2).
   Run against a production server:  LAB_PROD=1 LAB_REUSE=1 LAB_PORT=<port> npx playwright test -c playwright.landing-v2.config.ts motion-integration */
const OUT = resolve("docs/landing-v2-coach-motion");
mkdirSync(OUT, { recursive: true });

test.use({ storageState: { cookies: [], origins: [] } });

declare global {
  interface Window {
    __cmTrace?: Array<[string, string, number, number]>;
    __beatTrace?: Array<[number, string]>;
  }
}

/** Every paint of the Coach (clip, time) and every Hero phase change (time), on one clock. */
async function installTraces(page: Page) {
  await page.addInitScript(() => {
    window.__cmTrace = [];
    window.__beatTrace = [];
    let last = "";
    setInterval(() => {
      const phase = document.querySelector("[data-testid=hero-loop]")?.getAttribute("data-phase") ?? "";
      if (phase && phase !== last) {
        last = phase;
        window.__beatTrace!.push([performance.now(), phase]);
      }
    }, 25);
  });
}

function watchPage(page: Page) {
  const problems: string[] = [];
  const requests: string[] = [];
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("response", (r) => {
    requests.push(r.url());
    if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
    if (/\/login(\?|$)/.test(r.url())) problems.push(`auth redirect: ${r.url()}`);
  });
  return { problems, requests };
}

async function openLanding(page: Page, q = "") {
  await page.goto(`/${q}`);
  await page.waitForSelector("[data-testid=lv2]");
  await page.evaluate(() => document.fonts.ready);
}

const stateOfClip = (clip: string): string => {
  if (clip.endsWith("_LOOP")) return clip.replace("_LOOP", "").toLowerCase();
  const edge = /^(?:ENTRY_HEAD_|TAIL_)([A-Z]{2})/.exec(clip)?.[1];
  return edge ? ({ WA: "watching>analyzing", AP: "analyzing>pointing", PC: "pointing>confirming", CP: "confirming>pointing", PW: "pointing>watching" } as Record<string, string>)[edge] : clip;
};

test("real route: Landing V2 at `/` for a logged-out visitor, no auth error, no console error", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const { problems } = watchPage(page);
  await openLanding(page);
  await expect(page.getByTestId("landing-v2")).toBeVisible();
  for (const id of ["hero", "memory", "counterfactual", "proposition", "waitlist"]) await expect(page.locator(`#${id}`)).toHaveCount(1);
  await page.waitForTimeout(4000);
  expect(problems).toEqual([]);
});

test("public asset access: exactly the Landing's Coach assets, nothing else", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop");
  const manifest = await request.get("/coach-motion-v2/prod/384/manifest.json", { maxRedirects: 0 });
  expect(manifest.status()).toBe(200);
  const m = await manifest.json();
  const chunk = Object.values(m.clips as Record<string, { chunks: Array<{ file: string }> }>)[0].chunks[0].file;
  const open = ["/coach-motion-v2/prod/384/" + chunk, "/coach-web-pack/hero/watching-c.webp", "/coach-web-pack/memory/analyzing-ru.webp", "/coach-web-pack/reconstruct-memory.webp"];
  for (const path of open) expect((await request.get(path, { maxRedirects: 0 })).status(), path).toBe(200);
  const immutable = (await request.get(open[0], { maxRedirects: 0 })).headers()["cache-control"];
  expect(immutable).toContain("immutable");
  expect((await request.get("/coach-motion-v2/prod/384/manifest.json")).headers()["cache-control"]).toContain("no-cache");
  const closed = ["/coach-motion-v2/prod/512/manifest.json", "/coach-motion-v2/manifest.json", "/coach-motion-v2/calibration/manifest.json", "/coach-motion-v2/watching-idle.webp", "/coach-gold-master/coach-modular.bin", "/lab/landing-v2", "/lab/coach-motion-v2/full-pack", "/draft"];
  for (const path of closed) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status(), path).toBe(307);
    expect(response.headers().location, path).toMatch(/\/login$/);
  }
});

test("desktop Hero: the Coach follows the Hero story, evidence first", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(120_000);
  const { problems } = watchPage(page);
  await installTraces(page);
  await openLanding(page);
  await expect(page.getByTestId("motion-player-384")).toHaveAttribute("data-motion-status", "motion", { timeout: 20_000 });
  await expect(page.getByTestId("hero-loop").getByTestId("hero-coach")).toHaveAttribute("data-renderer", "motion-v2");
  // two full scenarios of the Hero: every edge of the approved cycle is played at least once
  await page.waitForTimeout(40_000);
  const { cm, beats } = await page.evaluate(() => ({ cm: window.__cmTrace!, beats: window.__beatTrace! }));
  // collapse the paint trace into [state, first paint time]
  const runs: Array<{ state: string; at: number }> = [];
  for (const [, clip, , t] of cm) {
    const state = stateOfClip(clip);
    if (runs.at(-1)?.state !== state) runs.push({ state, at: t });
  }
  const seq = runs.map((r) => r.state);
  info.annotations.push({ type: "coach-sequence", description: seq.join(" | ") });
  // 1. the approved cycle, in order, for the transitions the graph owns
  const cycle = ["watching", "watching>analyzing", "analyzing", "analyzing>pointing", "pointing", "pointing>confirming", "confirming", "confirming>pointing", "pointing", "pointing>watching", "watching"];
  const start = seq.findIndex((s, i) => cycle.every((c, k) => seq[i + k] === c));
  expect(start, `cycle not found in ${seq.join(" | ")}`).toBeGreaterThanOrEqual(0);
  // 2. every Coach move happens AFTER the Hero beat that explains it (never before the UI shows why)
  const phaseStart = (phase: string, after: number) => beats.find(([t, p]) => p === phase && t >= after)?.[0];
  const slack = 60; // one sampling interval + a frame
  const rules: Array<[string, string]> = [["watching>analyzing", "reveal"], ["analyzing>pointing", "recommendation"], ["pointing>confirming", "lock"], ["confirming>pointing", "carry"], ["pointing>watching", "relax"]];
  for (const [edge, phase] of rules) {
    for (const run of runs.filter((r) => r.state === edge)) {
      const before = beats.filter(([t, p]) => p === phase && t <= run.at + slack).at(-1)?.[0];
      expect(before, `${edge} began at ${Math.round(run.at)} ms with no ${phase} beat before it`).toBeDefined();
      expect(phaseStart(phase, 0)).toBeDefined();
    }
  }
  // 3. a transition is entered on a Hero beat of the matching phase, and never more than one beat late
  const lag: number[] = [];
  for (const [edge, phase] of rules) for (const run of runs.filter((r) => r.state === edge)) lag.push(run.at - (beats.filter(([t, p]) => p === phase && t <= run.at + slack).at(-1)?.[0] ?? run.at));
  info.annotations.push({ type: "cue-lag-ms", description: lag.map(Math.round).join(",") });
  writeFileSync(`${OUT}/coach-sequence.json`, JSON.stringify({ sequence: runs.map((r) => ({ ...r, at: Math.round(r.at) })), heroPhases: beats.map(([t, p]) => [Math.round(t), p]), cueLagMs: lag.map(Math.round) }, null, 1));
  expect(Math.max(...lag)).toBeLessThan(1500);
  expect(problems).toEqual([]);
});

test("Pause holds the Hero and the Coach together", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await installTraces(page);
  await openLanding(page);
  await expect(page.getByTestId("motion-player-384")).toHaveAttribute("data-motion-status", "motion", { timeout: 20_000 });
  await page.getByTestId("hero-pause").click();
  await page.waitForTimeout(400);
  const a = await page.evaluate(() => ({ cm: window.__cmTrace!.length, phase: document.querySelector("[data-testid=hero-loop]")!.getAttribute("data-beat") }));
  await page.waitForTimeout(1500);
  const b = await page.evaluate(() => ({ cm: window.__cmTrace!.length, phase: document.querySelector("[data-testid=hero-loop]")!.getAttribute("data-beat") }));
  expect(b).toEqual(a);
});

test("reduced motion: static Coach, no Motion V2 request", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  const { problems, requests } = watchPage(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openLanding(page);
  await page.waitForTimeout(6000);
  await expect(page.getByTestId("hero-loop").getByTestId("hero-coach")).toHaveAttribute("data-mode", "static");
  await expect(page.getByTestId("hero-loop").getByTestId("hero-coach")).toHaveAttribute("data-renderer", "static");
  expect(requests.filter((u) => /coach-motion-v2/.test(u))).toEqual([]);
  expect(problems).toEqual([]);
});

test("mobile: the lightweight stills, no Motion V2 request", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile");
  const { problems, requests } = watchPage(page);
  await openLanding(page);
  await page.waitForTimeout(7000);
  await expect(page.getByTestId("hero-loop").getByTestId("hero-coach")).toHaveAttribute("data-mode", "sprite");
  expect(requests.filter((u) => /coach-motion-v2/.test(u))).toEqual([]);
  expect(requests.filter((u) => /coach-web-pack\/hero/.test(u)).length).toBeGreaterThan(0);
  expect(problems).toEqual([]);
  await page.screenshot({ path: `${OUT}/mobile-hero.png` });
});

test("CTA scrolls to the waitlist", async ({ page }) => {
  await openLanding(page);
  await page.locator("#hero").getByRole("button").first().click();
  await expect.poll(() => page.evaluate(() => Math.round(document.querySelector("#waitlist")!.getBoundingClientRect().top))).toBeLessThan(600);
});

for (const theme of ["dark", "light"] as const) {
  test(`visual pass: Hero states + sections, ${theme}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await installTraces(page);
    await openLanding(page, `?theme=${theme}`);
    const p = info.project.name;
    const motion = p === "desktop";
    if (motion) await expect(page.getByTestId("motion-player-384")).toHaveAttribute("data-motion-status", "motion", { timeout: 20_000 });
    const stage = page.locator(".lv2-hero-stage");
    for (const phase of ["draft", "reveal", "evidence", "recommendation", "lock", "carry"]) {
      await page.waitForFunction((ph) => document.querySelector("[data-testid=hero-loop]")?.getAttribute("data-phase") === ph, phase, { timeout: 30_000 });
      await page.waitForTimeout(phase === "draft" ? 400 : 1700);
      await stage.screenshot({ path: `${OUT}/${p}-${theme}-hero-${phase}.png` });
    }
    await page.screenshot({ path: `${OUT}/${p}-${theme}-top.png` });
    for (const id of ["memory", "counterfactual", "proposition", "waitlist"]) {
      await page.locator(`#${id}`).scrollIntoViewIfNeeded();
      await page.waitForTimeout(2500);
      await page.screenshot({ path: `${OUT}/${p}-${theme}-${id}.png` });
    }
  });
}
