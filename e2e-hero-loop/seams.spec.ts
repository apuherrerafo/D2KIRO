import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/* HERO LOOP V1.1 · the seams, captured from ONE natural A → B → C → A playback (also recorded as video). It also samples,
   on every poll, the three things that must never happen: a portrait still loading, a flight outside the panel, an empty
   Recent calls. */
const OUT = resolve("docs/hero-loop-v1");
mkdirSync(OUT, { recursive: true });

type Sample = { scenario: string; beat: string; draft: number; loading: number; calls: number; flier: null | { l: number; t: number; r: number; b: number }; panel: { l: number; t: number; r: number; b: number }; target: null | { l: number; t: number; r: number; b: number }; vw: number; vh: number };

const read = (page: Page): Promise<Sample> =>
  page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    };
    const root = document.querySelector("[data-testid=hero-loop]") as HTMLElement;
    const imgs = [...root.querySelectorAll<HTMLImageElement>("img.chm-icon-img")];
    return {
      scenario: root.dataset.scenario ?? "",
      beat: root.dataset.beat ?? "",
      draft: Number(root.dataset.draft),
      loading: imgs.filter((i) => !i.complete).length,
      calls: document.querySelectorAll(".hl-trace-item").length,
      flier: box(document.querySelector("[data-testid=flight]")),
      panel: box(root.querySelector(".hl-panel")) as { l: number; t: number; r: number; b: number },
      target: box(document.querySelector(".hl-trace-item[data-newest=true] .hl-trace-art")),
      vw: document.documentElement.clientWidth,
      vh: window.innerHeight,
    };
  });

const ORDER = ["draft", "reveal", "evidence-1", "evidence-2", "evidence-3", "evidence-4", "evidence-5", "evidence-6", "recommendation", "lock", "settle", "carry", "relax"];
/** A position in the endless session; a shot fires on the first sample AT OR AFTER its target (a slow screenshot must not skip it). */
const key = (draft: number, beat: string) => draft * 100 + ORDER.indexOf(beat);

type Shot = { name: string; match: (s: Sample) => boolean; delay: number; check?: (s: Sample) => void };

const SHOTS: Shot[] = [
  { name: "01-A-lock", match: (s) => key(s.draft, s.beat) >= key(1, "lock"), delay: 100 },
  { name: "02-A-carry", match: (s) => key(s.draft, s.beat) >= key(1, "carry"), delay: 250 },
  { name: "03-A-to-B-draft-complete", match: (s) => key(s.draft, s.beat) >= key(1, "relax"), delay: 450 },
  { name: "04-B-start-next-draft", match: (s) => key(s.draft, s.beat) >= key(2, "draft"), delay: 0 },
  { name: "05-B-to-C-draft-complete", match: (s) => key(s.draft, s.beat) >= key(2, "relax"), delay: 450 },
  { name: "06-C-start-next-draft", match: (s) => key(s.draft, s.beat) >= key(3, "draft"), delay: 0 },
  { name: "07-C-contradiction", match: (s) => key(s.draft, s.beat) >= key(3, "evidence-3"), delay: 150 },
  { name: "08-C-carry", match: (s) => key(s.draft, s.beat) >= key(3, "carry"), delay: 250 },
  { name: "09-C-to-A-draft-complete", match: (s) => key(s.draft, s.beat) >= key(3, "relax"), delay: 450 },
  { name: "10-A2-start-next-draft", match: (s) => key(s.draft, s.beat) >= key(4, "draft"), delay: 0 },
];

test.use({ video: "on" });

for (const theme of ["dark", "light"] as const) {
  test.describe(`seams ${theme}`, () => {
    test(`A → B → C → A natural playback (${theme})`, async ({ page }, info) => {
      test.setTimeout(300_000);
      const tag = `${info.project.name}-${theme}`;
      await page.goto(`/lab/hero-loop?theme=${theme}&coach=sprite`);
      await expect(page.getByTestId("hero-loop")).toBeVisible();
      const started = Date.now();
      let moving = false;
      let loadingSeen = 0;
      let emptyTrace = 0;
      let outside = 0;
      let landing: string[] = [];
      const log: string[] = [];
      let next = 0;
      while (next < SHOTS.length && Date.now() - started < 200_000) {
        const sample = await read(page);
        if (sample.beat !== "draft" || sample.draft > 1) moving = true;
        if (moving && sample.loading > 0) loadingSeen += 1;
        if (sample.beat !== "carry" && sample.draft === 1 && ["draft", "reveal", "settle", "lock"].includes(sample.beat) && sample.calls > 0) emptyTrace += 1;
        if (sample.flier) {
          const f = sample.flier;
          if (f.l < sample.panel.l - 1 || f.t < sample.panel.t - 1 || f.r > sample.panel.r + 1 || f.b > sample.panel.b + 1 || f.r > sample.vw + 1 || f.b > sample.vh + 1000) outside += 1;
        }
        if (SHOTS[next].match(sample)) {
          const shot = SHOTS[next];
          await page.waitForTimeout(shot.delay);
          const after = await read(page);
          log.push(`${shot.name} @ ${after.scenario}:${after.beat} draft ${after.draft} calls ${after.calls} loading ${after.loading}`);
          if (shot.name.endsWith("carry") && after.flier && after.target) landing.push(`${shot.name}: flier ${JSON.stringify(after.flier)} target ${JSON.stringify(after.target)}`);
          await page.getByTestId("hero-loop-page").screenshot({ path: `${OUT}/v11-${tag}-${shot.name}.png` });
          next += 1;
        }
        await page.waitForTimeout(60);
      }
      writeFileSync(`${OUT}/v11-${tag}-seams.txt`, [...log, `placeholder-samples: ${loadingSeen}`, `flier-outside-panel-samples: ${outside}`, `calls-before-first-carry-samples: ${emptyTrace}`, ...landing].join("\n"));
      await page.waitForTimeout(1500);
      const video = page.video();
      await page.close();
      await video?.saveAs(`${OUT}/v11-${tag}-loop.webm`);
      expect(next).toBe(SHOTS.length);
      expect(loadingSeen).toBe(0);
      expect(outside).toBe(0);
      expect(emptyTrace).toBe(0);
    });
  });
}
