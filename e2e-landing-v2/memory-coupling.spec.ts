import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/* LANDING V2 · Memory scroll/playback coupling. Real scrolling at the review profiles (time-based, plain window.scrollTo —
   no wheel interception, no locking), sampling the controller's semantic state every frame:
   data-target (what scroll asks for), data-scene (rendered), data-settled, data-snapped.
   Scrolling is NOT stopped at the pin release: a flick keeps carrying the page past it, and Memory/seam visibility is
   measured, so the test sees what the viewer sees after the release.
   Run: npx playwright test -c playwright.landing-v2.config.ts memory-coupling */
const OUT = resolve("docs/landing-v2-integration");
mkdirSync(OUT, { recursive: true });

interface Gesture { px: number; ms: number; pauseMs: number; ease?: boolean }
interface Sample { t: number; target: number; scene: number; settled: boolean; snapped: boolean; progress: number; memVis: number; seamVis: number }
interface Result { samples: Sample[]; lateAt: Sample | null; release: Sample; releaseMs: number; exitPlus: Sample; sceneFirstSeen: Record<string, number> }

async function open(page: Page, q: Record<string, string> = {}) {
  await page.goto(`/lab/landing-v2?${new URLSearchParams(q).toString()}`);
  await page.waitForSelector("[data-testid=lv2]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(3000);
}

/** Park where the pin engages, then scroll with the profile until 900 ms after the release. */
async function play(page: Page, gestures: Gesture[], repeat: boolean, lead = 0): Promise<Result> {
  await page.evaluate(() => {
    const t = document.querySelector("#memory") as HTMLElement;
    const pin = document.querySelector(".lv2-memory-pin") as HTMLElement;
    const stuck = parseFloat(getComputedStyle(pin).top) || 0;
    window.scrollTo(0, t.getBoundingClientRect().top + scrollY - stuck);
  });
  await page.waitForTimeout(600);
  return page.evaluate(async ({ gestures, repeat, lead }) => {
    const t = document.querySelector("#memory") as HTMLElement;
    const pin = document.querySelector(".lv2-memory-pin") as HTMLElement;
    const seam = document.querySelector("[data-testid=seam-memory-cf]") as HTMLElement;
    const stuck = parseFloat(getComputedStyle(pin).top) || 0;
    const base = t.getBoundingClientRect().top + scrollY - stuck;
    const travel = t.offsetHeight - pin.offsetHeight;
    const vis = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      const h = Math.max(1, Math.min(r.height, innerHeight));
      return Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0)) / h;
    };
    const read = (t0: number): Sample => ({
      t: performance.now() - t0,
      target: Number(t.dataset.target),
      scene: Number(t.dataset.scene),
      settled: t.dataset.settled === "true",
      snapped: t.dataset.snapped === "true",
      progress: (scrollY - base) / travel,
      memVis: vis(t),
      seamVis: vis(seam),
    });
    const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
    const samples: Sample[] = [];
    const t0 = performance.now();
    const maxY = document.documentElement.scrollHeight - innerHeight;
    let y = base;
    let lateAt: Sample | null = null;
    let release: Sample | null = null;
    let exitPlus: Sample | null = null;
    let releaseAt = 0;
    const step = async (dy: number, ms: number, ease: boolean) => {
      const from = y;
      const start = performance.now();
      for (;;) {
        await frame();
        const now = performance.now();
        const k = Math.min(1, (now - start) / ms);
        y = Math.min(maxY, from + dy * (ease ? 1 - (1 - k) * (1 - k) : k));
        window.scrollTo(0, y);
        const s = read(t0);
        samples.push(s);
        if (!lateAt && s.progress >= 0.86) lateAt = s;
        if (!release && y >= base + travel - 1) { release = s; releaseAt = now; }
        if (release && now - releaseAt >= 900) { exitPlus = s; return; }
        if (k >= 1) return;
      }
    };
    if (lead > 0) await step(lead, 450, true);
    outer: for (let round = 0; round < 40; round += 1) {
      for (const g of gestures) {
        await step(g.px, g.ms, !!g.ease);
        if (exitPlus) break outer;
        if (g.pauseMs) await step(0, g.pauseMs, false);
        if (exitPlus) break outer;
      }
      if (!repeat) break;
    }
    while (!exitPlus) await step(travel, 1000, false);
    const sceneFirstSeen: Record<string, number> = {};
    for (const s of samples) if (!(s.scene in sceneFirstSeen)) sceneFirstSeen[s.scene] = Math.round(s.t);
    return { samples, lateAt, release: release as unknown as Sample, releaseMs: Math.round(releaseAt - t0), exitPlus: exitPlus as unknown as Sample, sceneFirstSeen };
  }, { gestures, repeat, lead });
}

function summarize(name: string, project: string, r: Result) {
  const lagMs = (n: number) => {
    let ms = 0;
    for (let i = 1; i < r.samples.length; i += 1) if (r.samples[i].target - r.samples[i].scene >= n) ms += r.samples[i].t - r.samples[i - 1].t;
    return Math.round(ms);
  };
  const peakMs = Math.round(r.samples.reduce((a, s, i) => (i > 0 && s.scene === 2 ? a + s.t - r.samples[i - 1].t : a), 0));
  const fin = r.samples.find((s) => s.scene === 4);
  let finalWhileMemoryMs = 0;
  for (let i = 1; i < r.samples.length; i += 1) if (r.samples[i].scene === 4 && r.samples[i].memVis >= 0.25) finalWhileMemoryMs += r.samples[i].t - r.samples[i - 1].t;
  // "Now use it." is readable once ~60% of the seam is in view
  const seamRead = r.samples.find((s) => s.seamVis >= 0.6);
  const out = {
    profile: name, project, releaseMs: r.releaseMs,
    sceneAtLate: r.lateAt?.scene ?? null, sceneAtRelease: r.release.scene, snappedAtRelease: r.release.snapped,
    finalFirstMs: fin ? Math.round(fin.t) : null, memoryVisAtFinal: fin ? Number(fin.memVis.toFixed(2)) : null,
    finalWhileMemory25Ms: Math.round(finalWhileMemoryMs), seamReadableMs: seamRead ? Math.round(seamRead.t) : null,
    sceneAtSeamReadable: seamRead?.scene ?? null, memoryVisAtSeamReadable: seamRead ? Number(seamRead.memVis.toFixed(2)) : null,
    exitTrace: r.samples.filter((x) => x.progress >= 0.6 && x.t <= r.releaseMs + 400).map((x) => [Math.round(x.t), Number(x.progress.toFixed(3)), x.scene, x.snapped ? 1 : 0, Number(x.memVis.toFixed(2))]),
    exitPlus: r.exitPlus, sceneFirstSeen: r.sceneFirstSeen, behind1Ms: lagMs(1), behind2Ms: lagMs(2), behind3Ms: lagMs(3), match24OnScreenMs: peakMs, snapped: r.exitPlus.snapped,
  };
  writeFileSync(`${OUT}/coupling-${project}-${name}.json`, JSON.stringify(out, null, 2));
  return out;
}

function monotone(r: Result) {
  let prev = 0;
  for (const s of r.samples) { expect(s.scene).toBeGreaterThanOrEqual(prev); prev = s.scene; }
}

const PROFILES: Record<string, { gestures: (vh: number) => Gesture[]; repeat: boolean; lead?: (vh: number) => number }> = {
  // calm desktop wheel/trackpad, ~170 px/s
  A_desktop_calm: { gestures: () => [{ px: 170, ms: 1000, pauseMs: 0 }], repeat: true },
  // calm mobile drag, ~210 px/s with a short natural pause every third second
  B_mobile_calm: { gestures: () => [{ px: 210, ms: 1000, pauseMs: 0 }, { px: 210, ms: 1000, pauseMs: 0 }, { px: 220, ms: 1000, pauseMs: 400 }], repeat: true },
  // fast desktop skim
  D_desktop_skim: { gestures: () => [{ px: 1400, ms: 1000, pauseMs: 0 }], repeat: true },
};
// successive ~1.3 viewport momentum flicks (ease-out, carried past the pin release), phase-shifted by a lead flick
for (const offset of [0, 0.25, 0.5, 0.75, 1.0]) {
  PROFILES[`C_mobile_flicks_o${String(offset).replace(".", "")}`] = {
    gestures: (vh) => [{ px: vh * 1.3, ms: 450, pauseMs: 900, ease: true }],
    repeat: true,
    lead: (vh) => vh * 1.3 * offset,
  };
}

for (const [name, p] of Object.entries(PROFILES)) {
  test(`memory coupling · ${name}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await open(page, { theme: "dark" });
    const vh = await page.evaluate(() => innerHeight);
    const r = await play(page, p.gestures(vh), p.repeat, p.lead ? p.lead(vh) : 0);
    const s = summarize(name, info.project.name, r);
    monotone(r);
    // the page stays natively scrollable: the profile reached the release point on its own
    expect(r.release.progress).toBeGreaterThanOrEqual(0.998);
    expect(r.exitPlus.scene).toBe(4);
    expect(r.exitPlus.target).toBe(4);
    // EXIT GUARANTEE: Final is the rendered scene at the release, and appeared while Memory was still meaningfully in view
    expect(r.release.scene).toBe(4);
    expect(s.finalFirstMs).not.toBeNull();
    expect(s.memoryVisAtFinal ?? 0).toBeGreaterThanOrEqual(0.25);
    // "Now use it." never becomes readable over an unfinished Match 24/56
    if (s.seamReadableMs !== null) expect(s.sceneAtSeamReadable).toBe(4);
    if (name.startsWith("C_")) expect(s.finalWhileMemory25Ms).toBeGreaterThanOrEqual(150);
    if (name === "A_desktop_calm" || name === "B_mobile_calm") {
      // calm scrolling never needs the deadline snap
      expect(s.snapped).toBe(false);
      expect(s.match24OnScreenMs).toBeGreaterThanOrEqual(2500);
      expect(s.behind2Ms).toBeLessThan(2500);
    }
    if (name === "A_desktop_calm") expect(s.behind2Ms).toBeLessThan(600);
    // no backlog: being 3+ scenes behind lasts only moments
    expect(s.behind3Ms).toBeLessThan(2500);
  });
}

// reduced motion: no force simulation, the same exit guarantee, forward only
for (const [name, p] of [["calm", PROFILES.B_mobile_calm], ["flicks", PROFILES.C_mobile_flicks_o05]] as const) {
  test(`memory coupling · reduced motion · ${name}`, async ({ page }, info) => {
    test.setTimeout(180_000);
    await open(page, { theme: "dark", motion: "reduced" });
    expect(await page.locator("#memory").getAttribute("data-reduced")).toBe("true");
    const vh = await page.evaluate(() => innerHeight);
    const r = await play(page, p.gestures(vh), p.repeat, p.lead ? p.lead(vh) : 0);
    const s = summarize(`reduced_${name}`, info.project.name, r);
    monotone(r);
    expect(r.release.scene).toBe(4);
    expect(r.exitPlus.scene).toBe(4);
    expect(s.memoryVisAtFinal ?? 0).toBeGreaterThanOrEqual(0.25);
    if (s.seamReadableMs !== null) expect(s.sceneAtSeamReadable).toBe(4);
  });
}
