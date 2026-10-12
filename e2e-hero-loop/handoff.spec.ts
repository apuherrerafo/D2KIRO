import { expect, test, type Page } from "@playwright/test";

/* HERO LOOP V1.1 · regression for the two seams that must never show:
   1. the carry handoff: at EVERY animation frame of a natural A → B → C → A pass, the carried hero is visible either as the
      flier or as the Recent calls icon (never neither), and the hero never doubles up by more than the planned overlap;
   2. the Lock pill: while it is still visible, it never carries the NEXT draft's hero.
   A per-frame in-page sampler (requestAnimationFrame), no screenshots while sampling. */

type Frame = { t: number; scenario: string; beat: string; draft: number; flier: number; icon: number; iconBox: number[] | null; flierBox: number[] | null; lock: string; lockOpacity: number; calls: number };

async function install(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __frames: unknown[]; __stop: boolean };
    w.__frames = [];
    w.__stop = false;
    const box = (el: Element | null) => (el ? ((r) => [r.left, r.top, r.width, r.height])(el.getBoundingClientRect()) : null);
    const loop = (t: number) => {
      const root = document.querySelector("[data-testid=hero-loop]") as HTMLElement | null;
      if (root) {
        const flier = document.querySelector("[data-testid=flight]") as HTMLElement | null;
        const art = document.querySelector(".hl-trace-item[data-newest=true] .hl-trace-art") as HTMLElement | null;
        const lock = root.querySelector(".hl-lock") as HTMLElement | null;
        // fully visible = opacity of the element AND of every ancestor up to the stage
        const seen = (el: HTMLElement | null) => {
          let o = 1;
          for (let n: HTMLElement | null = el; n && n !== root; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
          return o;
        };
        w.__frames.push({
          t,
          scenario: root.dataset.scenario,
          beat: root.dataset.beat,
          draft: Number(root.dataset.draft),
          flier: flier ? seen(flier) : 0,
          icon: art ? seen(art) : 0,
          iconBox: box(art),
          flierBox: box(flier),
          lock: lock?.textContent ?? "",
          lockOpacity: lock ? seen(lock) : 0,
          calls: document.querySelectorAll(".hl-trace-item").length,
        });
      }
      if (!w.__stop) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}

for (const theme of ["dark", "light"] as const) {
  test(`handoff + lock pill, frame by frame, A → B → C → A (${theme})`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.goto(`/lab/hero-loop?theme=${theme}&coach=sprite`);
    await expect(page.getByTestId("hero-loop")).toBeVisible();
    await install(page);
    await expect(page.getByTestId("hero-loop")).toHaveAttribute("data-draft", "4", { timeout: 120_000 });
    await page.waitForTimeout(600);
    const frames = (await page.evaluate(() => {
      const w = window as unknown as { __frames: unknown[]; __stop: boolean };
      w.__stop = true;
      return w.__frames;
    })) as Frame[];

    // sanity: the sampler really ran per frame around every carry (a freeze there would hide a blink)
    let worstGap = 0;
    for (let i = 1; i < frames.length; i += 1) if (frames[i].beat === "carry" || frames[i].beat === "relax") worstGap = Math.max(worstGap, frames[i].t - frames[i - 1].t);
    const gaps = frames.slice(1).map((f, i) => f.t - frames[i].t).sort((a, b) => a - b);
    console.log(`frames ${frames.length} median-gap ${gaps[Math.floor(gaps.length / 2)]} p95 ${gaps[Math.floor(gaps.length * 0.95)]} worst-in-carry ${worstGap}`);
    expect(frames.length).toBeGreaterThan(600);
    expect(worstGap).toBeLessThan(250);

    // 1 · for each of the three carries: at least one representation of the hero is fully visible on every frame
    const OPAQUE = 0.98;
    for (const draft of [1, 2, 3]) {
      const carry = frames.filter((f) => f.draft === draft && (f.beat === "carry" || f.beat === "relax"));
      expect(carry.length, `draft ${draft}: carry+relax frames`).toBeGreaterThan(60);
      const firstLanding = carry.findIndex((f) => f.beat === "carry");
      const window = carry.slice(firstLanding);
      // from the moment the flier has left its origin (it has been placed) until the end of relax
      const started = window.findIndex((f) => f.flier > 0);
      expect(started, `draft ${draft}: the flier exists`).toBeGreaterThanOrEqual(0);
      const live = window.slice(started);
      const missing = live.filter((f) => f.flier < OPAQUE && f.icon < OPAQUE);
      expect(missing.map((f) => `${f.beat}@${Math.round(f.t)} flier ${f.flier} icon ${f.icon}`), `draft ${draft}: frames with no visible hero`).toEqual([]);
      // the hero ends as the Recent calls icon, flier gone
      const last = live[live.length - 1];
      expect(last.flier).toBe(0);
      expect(last.icon).toBeGreaterThanOrEqual(OPAQUE);
      // the overlap is brief and the destination does not move: no position snap
      const both = live.filter((f) => f.flier >= OPAQUE && f.icon >= OPAQUE);
      expect(both.length * 16.7, `draft ${draft}: overlap ms`).toBeLessThan(300);
      const still = live.filter((f) => f.iconBox).map((f) => f.iconBox!);
      for (let i = 1; i < still.length; i += 1) expect(Math.abs(still[i][0] - still[i - 1][0]) + Math.abs(still[i][1] - still[i - 1][1])).toBeLessThan(30);
    }

    // 2 · the Lock pill never shows the next draft's hero while it is visible
    const winner: Record<string, string> = {};
    for (const f of frames) if (f.beat === "recommendation" && f.lock.startsWith("Lock ") && !winner[f.scenario]) winner[f.scenario] = f.lock.slice(5);
    expect(Object.keys(winner).sort()).toEqual(["A", "B", "C"]);
    const leaks = frames.filter((f) => f.lockOpacity > 0.02 && ["draft", "reveal", "evidence-1", "evidence-2", "evidence-3", "evidence-4", "evidence-5", "evidence-6"].includes(f.beat) && f.lock.includes(winner[f.scenario]));
    expect(leaks.map((f) => `${f.scenario}:${f.beat}@${Math.round(f.t)} "${f.lock}" opacity ${f.lockOpacity}`)).toEqual([]);

    // 3 · Recent calls does not exist before the first carry, and holds at most 3
    expect(frames.filter((f) => f.draft === 1 && ["draft", "reveal", "settle", "lock"].includes(f.beat) && f.calls > 0)).toEqual([]);
    expect(Math.max(...frames.map((f) => f.calls))).toBeLessThanOrEqual(3);
  });
}

test("reduced motion: no flier, the destination is simply there from the first frame of the carry", async ({ page }) => {
  await page.goto("/lab/hero-loop?scenario=A&beat=carry&motion=reduced&coach=sprite");
  await expect(page.getByTestId("hero-loop")).toHaveAttribute("data-motion", "reduced");
  await expect(page.getByTestId("flight")).toHaveCount(0);
  const item = page.locator(".hl-trace-item[data-newest=true]");
  await expect(item).toHaveAttribute("data-landing", "full");
  await expect(item.locator(".hl-trace-art")).toHaveCSS("opacity", "1");
  await expect(item.locator(".hl-trace-text")).toHaveCSS("opacity", "1");
});
