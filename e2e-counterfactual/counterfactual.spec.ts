import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readdirSync, renameSync } from "node:fs";
import { resolve } from "node:path";

/* COUNTERFACTUAL LAB · review evidence. Captures every required state as a link-driven still, asserts the story's claims,
   and records one short video of the whole sequence. Run:  npx playwright test -c playwright.counterfactual.config.ts */
const OUT = resolve("docs/counterfactual-v1");
mkdirSync(OUT, { recursive: true });

type Q = { beat?: string; phase?: string; theme?: "dark" | "light"; motion?: "reduced" | "full"; coach?: "0" | "1" };
const url = (q: Q) => `/lab/counterfactual?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][]).toString()}`;

async function open(page: Page, q: Q) {
  await page.goto(url(q));
  await page.waitForSelector("[data-testid=counterfactual]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(q.motion === "reduced" ? 400 : 2600); // let GATHER / SETTLE / count-up finish
}

const state = (page: Page) =>
  page.locator("[data-testid=counterfactual]").evaluate((el) => ({
    phase: el.getAttribute("data-phase"),
    rows: [...el.querySelectorAll<HTMLElement>(".cfl-row")].map((r) => ({
      hero: r.dataset.hero,
      rank: r.dataset.rank,
      fit: r.querySelector(".cfl-score b")?.textContent,
      label: r.querySelector(".cfl-score i")?.textContent,
      delta: r.querySelector(".cfl-delta")?.textContent ?? null,
      chip: r.querySelector(".cfl-chip")?.textContent,
    })),
    draft: [...el.querySelectorAll(".cfl-draft img")].map((i) => (i as HTMLImageElement).alt + (i as HTMLImageElement).src),
    text: (el as HTMLElement).innerText,
  }));

const shots: Array<[string, Q, "desktop" | "mobile"]> = [
  ["desktop-dark-1-for-anyone", { phase: "generic" }, "desktop"],
  ["desktop-dark-2-add-your-games", { phase: "evidence" }, "desktop"],
  ["desktop-dark-3-for-you", { phase: "personal" }, "desktop"],
  ["desktop-dark-3b-for-you-pointing", { beat: "call" }, "desktop"],
  ["desktop-light-1-for-anyone", { phase: "generic", theme: "light" }, "desktop"],
  ["desktop-light-3-for-you", { phase: "personal", theme: "light" }, "desktop"],
  ["reduced-generic", { phase: "generic", motion: "reduced" }, "desktop"],
  ["reduced-personal", { phase: "personal", motion: "reduced" }, "desktop"],
  ["mobile-dark-1-for-anyone", { phase: "generic" }, "mobile"],
  ["mobile-dark-2-add-your-games", { phase: "evidence" }, "mobile"],
  ["mobile-dark-3-for-you", { phase: "personal" }, "mobile"],
  ["mobile-light-3-for-you", { phase: "personal", theme: "light" }, "mobile"],
];

for (const [name, q, project] of shots) {
  test(`capture ${name}`, async ({ page }, info) => {
    test.skip(info.project.name !== project);
    await open(page, q);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
    const s = await state(page);
    if (q.phase === "generic") {
      expect(s.rows.map((r) => r.hero)).toEqual(["Queen of Pain", "Puck", "Void Spirit"]);
      expect(s.rows.map((r) => r.fit)).toEqual(["84", "82", "77"]);
      expect(s.text).toContain("For anyone");
    }
    if (q.phase === "personal") {
      expect(s.rows.map((r) => r.hero)).toEqual(["Puck", "Queen of Pain", "Void Spirit"]);
      expect(s.rows.map((r) => r.fit)).toEqual(["88", "83", "77"]);
      expect(s.rows[0].delta).toContain("+6 · Your games");
      expect(s.rows[1].delta).toContain("\u22121 · Your games");
      expect(s.rows[2].delta).toBeNull();
      expect(s.text).toContain("For you");
    }
    expect(s.rows.every((r) => r.label === "FIT")).toBe(true);
    expect(s.text).not.toMatch(/win|%|MMR|\d+ games/i);
    // no horizontal overflow; on a phone the whole story (object + caption) sits inside the first screen
    // (the site nav above the lab is app chrome and is not part of this claim)
    expect(await page.evaluate(() => { const r = document.querySelector(".cfl-lab")!.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; })).toBe(true);
    if (project === "mobile") {
      const foot = await page.locator(".cfl-foot").boundingBox();
      expect(foot!.y + foot!.height).toBeLessThanOrEqual(844);
      const coach = await page.locator(".cfl-coach").boundingBox();
      expect(coach!.width).toBeLessThanOrEqual(72);
    }
  });
}

test("the draft is the same object in every phase", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await page.goto(url({}));
  const draft = page.locator(".cfl-draft");
  await draft.waitFor();
  const handle = await draft.elementHandle();
  const before = (await state(page)).draft;
  await page.waitForTimeout(11_000); // the whole story
  expect((await state(page)).phase).toBe("personal");
  expect(await draft.elementHandle().then((h) => h!.evaluate((el, prev) => el === prev, handle))).toBe(true);
  expect((await state(page)).draft).toEqual(before);
});

test("coach is secondary and can be hidden", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop");
  await open(page, { phase: "personal", coach: "0" });
  await expect(page.locator("[data-testid=cfl-coach]")).toHaveCount(0);
});

test("record the sequence", async ({ browser }, info) => {
  test.skip(info.project.name !== "desktop");
  test.setTimeout(60_000);
  const dir = resolve("e2e-counterfactual/.tmp/video");
  const ctx = await browser.newContext({ storageState: "e2e-counterfactual/.tmp/session.json", viewport: { width: 1280, height: 800 }, recordVideo: { dir, size: { width: 1280, height: 800 } } });
  const page = await ctx.newPage();
  await page.goto(`http://localhost:3131${url({})}`);
  await page.waitForSelector("[data-testid=counterfactual]");
  await page.waitForTimeout(13_500); // generic 3.2 → add games 2.8 → for you 1.7 + 1.9 → settle
  await ctx.close();
  const [file] = readdirSync(dir).filter((f) => f.endsWith(".webm")).sort().slice(-1);
  renameSync(`${dir}/${file}`, `${OUT}/counterfactual-sequence.webm`);
});
