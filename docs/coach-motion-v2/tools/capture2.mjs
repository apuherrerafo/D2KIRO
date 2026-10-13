// Production-format study capture (headless, real live Gold Master stage, same fixed-step harness as capture.mjs).
// usage: node capture2.mjs <outDir> <job,job,...>        (frames are written OUTSIDE the repo; pack2.py / analyze_p2.py read them)
// jobs:  src30     idle 60 + trans 39 @384/30   (determinism check against src-frames-384)
//        src24     idle 48 + trans 31 @384/24
//        ref60     idle 120 + trans 78 @384/60  (temporal reference for the fps verdict)
//        refd1     idle 60 + trans 39 @276/30   (Live rendered natively at the Hero coach canvas size, DPR 1: 276 css px)
//        refd2     idle 60 + trans 39 @552/30   (same, DPR 2: 552 device px)
//        var:J,..  transition entered from idle phase J (frame index 0..59 of the 30 fps idle), 39 frames @384/30
//        bridge:K  pose-space bridge from idle phase K into the canonical transition start (6 frames @384/30)
import { launch, BASE } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = process.argv[2];
const JOBS = (process.argv[3] || "src30").split(",");
const RATE = 120, C0 = 47.7, IDLE_S = 2.0, TRANS_S = 1.3;
const INIT = { at: 0, state: "watching", aim: "center", amplitude: 0.6, verb: null };           // CUE_BY_PHASE.draft
const REVEAL = { state: "analyzing", aim: "right", amplitude: 0.8, verb: "GATHER" };            // CUE_BY_PHASE.reveal (verb of the reveal beat)
const cue = (at) => ({ at, ...REVEAL });
const spec = (px, fps, start, frames, events, extra = {}) => ({ px, fps, rate: RATE, start, frames, init: INIT, events, render: true, ...extra });

function plan(job) {
  if (["src30", "src24", "ref60", "refd1", "refd2", "refd1b", "refd2b"].includes(job)) {
    const px = job.startsWith("refd1") ? 276 : job.startsWith("refd2") ? 552 : 384;
    const fps = job === "src24" || job.endsWith("b") ? 24 : job === "ref60" ? 60 : 30;
    const nIdle = Math.round(IDLE_S * fps), nTr = Math.round(TRANS_S * fps);
    return { idle: spec(px, fps, C0, nIdle, []), trans: spec(px, fps, C0 + IDLE_S, nTr, [cue(C0 + IDLE_S + 0.5 / RATE)]) };
  }
  if (job.startsWith("var:")) {
    const out = {};
    for (const j of job.slice(4).split(":").map(Number)) {
      const t = C0 + j / 30;                                           // idle pose of phase j, free-running clock
      out[`var${String(j).padStart(2, "0")}`] = spec(384, 30, t, 39, [cue(t + 0.5 / RATE)]);
    }
    return out;
  }
  if (job.startsWith("hvar:")) {
    // entry head: idle pose of phase j up to the cue, then the analyzing clock is rebased onto the canonical cue time,
    // so every direct (un-smoothed) term of the post-cue pose equals the canonical transition's and only the smoothed terms still lag
    const out = {};
    for (const j of job.slice(5).split(":").map(Number)) {
      const t = C0 + j / 30;
      out[`hvar${String(j).padStart(2, "0")}`] = spec(384, 30, t, 39, [{ ...cue(t + 0.5 / RATE), rebase: IDLE_S - j / 30 }]);
    }
    return out;
  }
  if (job.startsWith("bridge:")) {
    const out = {};
    for (const k of job.slice(7).split(":").map(Number)) {
      // from idle(k) to the canonical transition's frame 0 (= idle phase 60), pose-space smoothstep, rendered by the stage
      out[`bridge${String(k).padStart(2, "0")}`] = spec(384, 30, C0 + k / 30, 7, [], { bridgeTo: C0 + IDLE_S, bridgeFrames: 6 });
    }
    return out;
  }
  throw new Error("unknown job " + job);
}

const { browser, ctx } = await launch();
const p = await ctx.newPage();
await p.goto(BASE + "/lab/coach-motion-v2/capture");
await p.waitForSelector("html[data-capture-ready='1']", { timeout: 180000 });
console.log("renderer:", await p.evaluate(() => window.__coachCapture.renderer));
for (const spec0 of JOBS) {
  const parts = spec0.startsWith("var:") ? [spec0] : spec0.startsWith("bridge:") ? [spec0] : [spec0];
  for (const job of parts) {
    for (const [name, s] of Object.entries(plan(job))) {
      const frames = await p.evaluate((x) => window.__coachCapture.run(x), s);
      const tag = ["var", "hvar", "bridge"].some((q) => job.startsWith(q)) ? name : `${job}/${name}`;
      const dir = `${OUT}/${tag}`;
      mkdirSync(dir, { recursive: true });
      frames.forEach((f, i) => writeFileSync(`${dir}/f${String(i).padStart(4, "0")}.png`, Buffer.from(f.png.split(",")[1], "base64")));
      writeFileSync(`${dir}/meta.json`, JSON.stringify({ spec: s, poses: frames.map((f) => ({ t: +f.t.toFixed(4), ...f.pose })) }));
      console.log(tag, frames.length, "frames");
    }
  }
}
await browser.close();
