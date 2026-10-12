import { expect, test, type Page } from "@playwright/test";
import { spawn } from "node:child_process";
import { globSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";

/* HERO LOOP V1.1 · final motion evidence. Chromium CDP screencast: every compositor frame the page produces is stored with
   its own timestamp, NOTHING touches the page while recording (no element screenshots, no scroll), then the frames are
   encoded at a constant 60 fps with the real inter-frame timing preserved. The quality of the capture is measured and
   written next to each video. Run explicitly:  npx playwright test -c playwright.hero-loop.config.ts motion-video  */
const OUT = resolve("docs/hero-loop-v1");
mkdirSync(OUT, { recursive: true });

function ffmpegPath(): string {
  const [found] = globSync(join(homedir(), "AppData/Local/ms-playwright/ffmpeg-*/ffmpeg-win64.exe"));
  if (!found) throw new Error("playwright ffmpeg not found");
  return found;
}

type Shot = { t: number; file: string };

async function record(page: Page, name: string, until: () => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "hl-cap-"));
  const cdp = await page.context().newCDPSession(page);
  const shots: Shot[] = [];
  const pending: Promise<unknown>[] = [];
  cdp.on("Page.screencastFrame", (frame: { data: string; metadata: { timestamp?: number }; sessionId: number }) => {
    const t = (frame.metadata.timestamp ?? 0) * 1000;
    const file = join(dir, `${String(shots.length).padStart(6, "0")}.jpg`);
    shots.push({ t, file });
    writeFileSync(file, Buffer.from(frame.data, "base64"));
    pending.push(cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => undefined));
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1, maxWidth: 1280, maxHeight: 800 });
  await until();
  await cdp.send("Page.stopScreencast");
  await Promise.all(pending);
  expect(shots.length).toBeGreaterThan(60);

  // constant-60fps encode: each 1/60 s tick shows the newest captured frame (true timing; a held frame is a real hold)
  const video = `${OUT}/${name}.webm`;
  const start = shots[0].t;
  const end = shots[shots.length - 1].t;
  const ticks = Math.ceil(((end - start) / 1000) * 60) + 1;
  const encoder = spawn(ffmpegPath(), ["-y", "-f", "image2pipe", "-framerate", "60", "-c:v", "mjpeg", "-i", "pipe:0", "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", "-c:v", "libvpx", "-b:v", "6M", "-crf", "10", "-an", video], { stdio: ["pipe", "ignore", "pipe"] });
  let logged = "";
  encoder.stderr.on("data", (d) => void (logged = (logged + d).slice(-1500)));
  const done = new Promise<void>((ok, fail) => {
    encoder.on("exit", (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exit ${code}: ${logged}`))));
    encoder.on("error", fail);
  });
  encoder.stdin.on("error", () => undefined); // the real reason is ffmpeg's own log, reported by `done`
  let cursor = 0;
  let current = readFileSync(shots[0].file);
  for (let tick = 0; tick < ticks; tick += 1) {
    const at = start + (tick * 1000) / 60;
    let moved = false;
    while (cursor + 1 < shots.length && shots[cursor + 1].t <= at) {
      cursor += 1;
      moved = true;
    }
    if (moved) current = readFileSync(shots[cursor].file);
    if (encoder.stdin.destroyed) break;
    if (!encoder.stdin.write(current)) await new Promise((r) => encoder.stdin.once("drain", r));
  }
  encoder.stdin.end();
  await done;

  const gaps = shots.slice(1).map((s, i) => s.t - shots[i].t);
  const sorted = [...gaps].sort((a, b) => a - b);
  const span = shots[shots.length - 1].t - shots[0].t;
  const report = {
    video: `${name}.webm`,
    seconds: Number((span / 1000).toFixed(1)),
    distinctFrames: shots.length,
    averageFps: Number((shots.length / (span / 1000)).toFixed(1)),
    medianGapMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(1)),
    p95GapMs: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(1)),
    framesWithGapOver100ms: gaps.filter((g) => g > 100).length,
    worstGapMs: Number(Math.max(...gaps).toFixed(1)),
  };
  writeFileSync(`${OUT}/${name}.capture.json`, JSON.stringify(report, null, 2));
  rmSync(dir, { force: true, recursive: true });
  return report;
}

const draftIs = (page: Page, n: number) => expect(page.getByTestId("hero-loop")).toHaveAttribute("data-draft", String(n), { timeout: 120_000 });

test("final motion evidence", async ({ page }, info) => {
  test.skip(info.project.name === "mobile" || info.project.name === "desktop", "CDP screencast is Chromium-only; desktop is captured with the desktop-capture project");
  test.setTimeout(400_000);
  const mobile = info.project.name === "mobile-chromium";
  const runs = mobile ? [{ name: "v11f-mobile-dark-A-B-C-A", theme: "dark", drafts: 4 }] : [{ name: "v11f-desktop-dark-A-B-C-A", theme: "dark", drafts: 4 }, { name: "v11f-desktop-light-A-B", theme: "light", drafts: 2 }];
  for (const run of runs) {
    await page.goto(`/lab/hero-loop?theme=${run.theme}&coach=sprite`);
    await expect(page.getByTestId("hero-loop")).toBeVisible();
    await draftIs(page, 1);
    await page.waitForTimeout(500);
    // the loop is already playing (draft 1); recording starts on a quiet frame and only waits
    const report = await record(page, run.name, async () => {
      await draftIs(page, run.drafts);
      await page.waitForTimeout(run.drafts === 2 ? 2500 : 1800);
    });
    console.log(JSON.stringify(report));
  }
});
