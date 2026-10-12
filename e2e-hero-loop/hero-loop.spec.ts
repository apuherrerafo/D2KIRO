import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const OUT = resolve("docs/hero-loop-v1");
mkdirSync(OUT, { recursive: true });

const BEATS: Record<string, string[]> = {
  A: ["draft", "reveal", "evidence-1", "evidence-2", "evidence-3", "evidence-4", "recommendation", "lock", "settle", "carry", "relax"],
  B: ["draft", "reveal", "evidence-1", "evidence-3", "evidence-4", "recommendation", "lock", "settle", "carry", "relax"],
  C: ["draft", "reveal", "evidence-1", "evidence-3", "evidence-4", "evidence-6", "recommendation", "lock", "settle", "carry", "relax"],
};

async function open(page: Page, query: string) {
  await page.goto(`/lab/hero-loop?${query}`);
  await expect(page.getByTestId("hero-loop")).toBeVisible();
  await page.waitForTimeout(1400); // acquisition + count-up settle
}

const stage = (page: Page) => page.getByTestId("hero-loop-page");

test.describe("review captures", () => {
  for (const [scenario, beats] of Object.entries(BEATS)) {
    test(`scenario ${scenario}: every beat`, async ({ page }, info) => {
      for (const beat of beats) {
        await open(page, `scenario=${scenario}&beat=${beat}`);
        await expect(page.getByTestId("hero-loop")).toHaveAttribute("data-beat", beat);
        await expect(page.getByTestId("hero-loop")).toHaveAttribute("data-scenario", scenario);
        if (info.project.name === "desktop") await expect(page.getByTestId("hero-coach")).toHaveAttribute("data-renderer", "live", { timeout: 60_000 });
        await stage(page).screenshot({ path: `${OUT}/${info.project.name}-${scenario}-${beat}.png` });
      }
    });
  }
});

test("coach strategy: desktop live, mobile pre-rendered, reduced static", async ({ page }, info) => {
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await open(page, "scenario=A&beat=recommendation");
  const coach = page.getByTestId("hero-coach");
  if (info.project.name === "desktop") {
    await expect(coach).toHaveAttribute("data-renderer", "live", { timeout: 60_000 });
    await expect(page.getByTestId("coach-live")).toBeVisible();
    // the live canvas actually drew the Coach: a transparent 300 px canvas encodes to a tiny PNG, the Coach does not
    const shot = await page.getByTestId("coach-live").screenshot({ omitBackground: true });
    expect(shot.length).toBeGreaterThan(8_000);
    expect(requests.some((u) => u.includes("coach-modular.bin"))).toBe(true);
  } else {
    await expect(coach).toHaveAttribute("data-renderer", "sprite");
    await expect(page.getByTestId("coach-sprite")).toBeVisible();
    await expect(page.getByTestId("coach-live")).toHaveCount(0);
    // mobile never pays for Three.js or the 7.7 MB Gold Master package
    expect(requests.some((u) => u.includes("coach-modular"))).toBe(false);
    expect(requests.some((u) => /coach-web-pack\/hero\/.*\.webp/.test(u))).toBe(true);
  }
  // reduced motion: static state stills on every device
  await open(page, "scenario=A&beat=recommendation&motion=reduced");
  await expect(page.getByTestId("hero-coach")).toHaveAttribute("data-renderer", "static");
  await expect(page.getByTestId("coach-live")).toHaveCount(0);
  await expect(page.getByTestId("coach-sprite")).toHaveAttribute("data-motion", "reduced");
});

test("coach states follow the loop", async ({ page }) => {
  const expectState = async (beat: string, state: string) => {
    await open(page, `scenario=A&beat=${beat}&coach=sprite`);
    await expect(page.getByTestId("hero-coach")).toHaveAttribute("data-state", state);
  };
  await expectState("draft", "watching");
  await expectState("reveal", "analyzing");
  await expectState("evidence-2", "analyzing");
  await expectState("recommendation", "pointing");
  await expectState("lock", "confirming");
  await expectState("relax", "watching");
});

test("scenario content: A flips on personal evidence, B is draft-read-only, C repels", async ({ page }) => {
  await open(page, "scenario=A&beat=evidence-3&coach=sprite");
  await expect(page.locator(".hl-card[data-rank='1']")).toHaveAttribute("data-hero", "Queen of Pain");
  await open(page, "scenario=A&beat=evidence-4&coach=sprite");
  await expect(page.locator(".hl-card[data-rank='1']")).toHaveAttribute("data-hero", "Puck");
  await open(page, "scenario=A&beat=recommendation&coach=sprite");
  await expect(page.getByTestId("personal-flip")).toBeVisible();
  await open(page, "scenario=B&beat=recommendation&coach=sprite");
  await expect(page.getByTestId("draft-only")).toBeVisible();
  await expect(page.getByTestId("personal-flip")).toHaveCount(0);
  await open(page, "scenario=C&beat=evidence-3&coach=sprite");
  await expect(page.getByTestId("hero-loop")).toHaveAttribute("data-verb", "REPEL");
  await expect(page.locator(".hl-card[data-repelled='true']")).toHaveAttribute("data-hero", "Centaur Warrunner");
  await open(page, "scenario=C&beat=evidence-4&coach=sprite");
  await expect(page.locator(".hl-card[data-repelled='true']")).toHaveCount(0);
});

test("the loop never resets: one stage, every phase in order, A → B → C → A", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/lab/hero-loop?coach=sprite");
  await expect(page.getByTestId("hero-loop")).toBeVisible();
  // mark the DOM node: if the stage ever unmounts (a visible reset) the mark disappears
  await page.getByTestId("hero-loop").evaluate((el) => void ((el as HTMLElement & { __mark?: number }).__mark = 1));
  const trace: string[] = [];
  const started = Date.now();
  let unmounted = false;
  while (Date.now() - started < 85_000) {
    const sample = await page.getByTestId("hero-loop").evaluate((el) => `${el.getAttribute("data-scenario")}:${el.getAttribute("data-phase")}:${(el as HTMLElement & { __mark?: number }).__mark === 1}`);
    if (!sample.endsWith("true")) unmounted = true;
    if (trace[trace.length - 1] !== sample) trace.push(sample);
    await page.waitForTimeout(150);
  }
  writeFileSync(`${OUT}/loop-trace.txt`, trace.join("\n"));
  expect(unmounted).toBe(false);
  const phases = trace.map((t) => t.split(":")[1]);
  for (const phase of ["draft", "reveal", "evidence", "recommendation", "lock", "settle", "carry", "relax"]) expect(phases).toContain(phase);
  const scenarios = trace.map((t) => t.split(":")[0]).filter((s, i, a) => s !== a[i - 1]);
  expect(scenarios.slice(0, 4)).toEqual(["A", "B", "C", "A"]);
  // the persisted state: Recent calls is never reset between drafts
  // each scenario ends in relax and the next begins in draft: no extra beat between them
  for (let i = 1; i < trace.length; i += 1) {
    const [prevS, prevP] = trace[i - 1].split(":");
    const [s, p] = trace[i].split(":");
    if (s !== prevS) {
      expect(prevP).toBe("relax");
      expect(p).toBe("draft");
    }
  }
});

test("Recent calls: absent before the first carry, then the newest call on top, max 3", async ({ page }) => {
  await open(page, "scenario=A&beat=draft&coach=sprite");
  await expect(page.getByTestId("recent-calls")).toHaveCount(0);
  await open(page, "scenario=A&beat=settle&coach=sprite");
  await expect(page.getByTestId("recent-calls")).toHaveCount(0);
  await open(page, "scenario=A&beat=relax&coach=sprite");
  await expect(page.locator(".hl-trace-item")).toHaveCount(1);
  await expect(page.getByTestId("recent-calls")).toContainText("Recent calls");
  await open(page, "scenario=C&beat=relax&coach=sprite");
  await expect(page.locator(".hl-trace-item")).toHaveCount(3); // C is the third draft: its own call plus the two before it
  await open(page, "scenario=A&beat=relax&coach=sprite&calls=0");
  await expect(page.getByTestId("recent-calls")).toHaveCount(0);
});

test("copy: FIT is labelled, causes are named, no personal telemetry", async ({ page }) => {
  await open(page, "scenario=A&beat=evidence-4&coach=sprite");
  const text = await page.getByTestId("hero-loop").innerText();
  expect(text).toContain("FIT");
  expect(text).toMatch(/\+6 · Your games · Often played/);
  expect(text).not.toMatch(/\d+ games|% win|win rate|probability/i);
  await expect(page.locator(".hl-card-fit").first()).toHaveText("FIT");
});

test("next draft: the shell continues, the match changes", async ({ page }) => {
  await open(page, "scenario=B&beat=draft&coach=sprite");
  await expect(page.locator(".hl-block-title")).toHaveText("Draft 2");
  await expect(page.locator(".hl-draft")).toHaveAttribute("data-next", "true");
  await open(page, "scenario=A&beat=draft&coach=sprite");
  await expect(page.locator(".hl-draft")).toHaveAttribute("data-next", "false");
  await open(page, "scenario=A&beat=relax&coach=sprite");
  await expect(page.locator(".hl-block-meta")).toHaveText("Draft complete");
});

test("light theme is authored, not inverted", async ({ page }, info) => {
  await open(page, "scenario=A&beat=recommendation&coach=sprite&theme=light");
  const tokens = await page.getByTestId("hero-loop-theme").evaluate((el) => {
    const css = getComputedStyle(el);
    return { bg: css.getPropertyValue("--r3-bg").trim(), ink: css.getPropertyValue("--r3-ink").trim(), page: getComputedStyle(el).backgroundColor };
  });
  expect(tokens.bg).toBe("#e7eae6");
  expect(tokens.ink).toBe("#15191a");
  await page.getByTestId("hero-loop-page").screenshot({ path: `${OUT}/${info.project.name}-light-A-recommendation.png` });
  await page.getByTestId("theme").click();
  await expect(page.getByTestId("hero-loop-theme")).toHaveAttribute("data-theme", "dark");
});

test("ios lock: no horizontal scroll, controls reachable", async ({ page }) => {
  await open(page, "scenario=C&beat=evidence-6&coach=sprite");
  // the lab itself must fit the viewport (the app's global NavBar, outside the lab, is reported separately)
  const overflow = await page.evaluate(() => {
    const lab = document.querySelector("[data-testid=hero-loop-page]") as HTMLElement;
    const wide = [...lab.querySelectorAll("*")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1);
    return wide.length;
  });
  expect(overflow).toBe(0);
  const small = await page.locator(".hl-lab-btn").evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44).length);
  expect(small).toBe(0);
});
