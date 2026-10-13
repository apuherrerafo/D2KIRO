// Offline capture of the two Motion V2 source clips from the live Gold Master stage.  usage: node capture.mjs [px=384]
import { launch, BASE, OUT } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const PX = Number(process.argv[2] || 384);
const FPS = 30, RATE = 120;
const C0 = 47.7;             // idle window start (no blink inside; see pickwindow.mjs)
const IDLE_S = 2.0;          // WATCHING hold = 60 frames
const TRANS_S = 1.3;         // the loop's `reveal` beat (BEAT_MS.reveal) = 39 frames
const INIT = { at: 0, state: "watching", aim: "center", amplitude: 0.6, verb: null };           // CUE_BY_PHASE.draft
const REVEAL = { state: "analyzing", aim: "right", amplitude: 0.8, verb: "GATHER" };            // CUE_BY_PHASE.reveal, verb of the reveal beat
const clips = {
  WATCHING_IDLE: { start: C0, frames: Math.round(IDLE_S * FPS), events: [] },
  // the transition starts where the idle ends; the cue lands one sim step after frame 0 so frame 0 is the pure last idle pose
  WATCHING_TO_ANALYZING: { start: C0 + IDLE_S, frames: Math.round(TRANS_S * FPS), events: [{ at: C0 + IDLE_S + 0.5 / RATE, ...REVEAL }] },
  // the idle one frame past its window: needed to measure the wrap seam (not shipped)
  _IDLE_EXTRA: { start: C0 + IDLE_S, frames: 1, events: [] },
};
const { browser, ctx } = await launch();
const p = await ctx.newPage();
await p.goto(BASE + "/lab/coach-motion-v2/capture");
await p.waitForSelector("html[data-capture-ready='1']", { timeout: 120000 });
const renderer = await p.evaluate(() => window.__coachCapture.renderer);
console.log("renderer:", renderer);
const meta = { px: PX, fps: FPS, rate: RATE, c0: C0, renderer, init: INIT, reveal: REVEAL, clips: {} };
for (const [name, c] of Object.entries(clips)) {
  const spec = { px: PX, fps: FPS, rate: RATE, start: c.start, frames: c.frames, init: INIT, events: c.events, render: true };
  const frames = await p.evaluate((s) => window.__coachCapture.run(s), spec);
  const dir = `${OUT}/src-frames-${PX}/${name}`; mkdirSync(dir, { recursive: true });
  frames.forEach((f, i) => writeFileSync(`${dir}/f${String(i).padStart(4, "0")}.png`, Buffer.from(f.png.split(",")[1], "base64")));
  meta.clips[name] = { start: c.start, frames: frames.length, poses: frames.map((f) => ({ t: +f.t.toFixed(4), ...f.pose })) };
  console.log(name, frames.length, "frames");
}
writeFileSync(`${OUT}/src-frames-${PX}/capture-meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
