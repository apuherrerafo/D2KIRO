// pose scan: the live idle pose trajectory (no rendering) -> choose the 2.0 s idle window
import { launch, BASE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const { browser, ctx } = await launch();
const p = await ctx.newPage();
p.on("console", (m) => console.log("[page]", m.text()));
await p.goto(BASE + "/lab/coach-motion-v2/capture");
await p.waitForSelector("html[data-capture-ready='1']", { timeout: 120000 });
console.log("renderer:", await p.evaluate(() => window.__coachCapture.renderer));
const spec = { px: 64, fps: 30, rate: 120, start: 0, frames: 30 * 70, render: false,
  init: { at: 0, state: "watching", aim: "center", amplitude: 0.6, verb: null }, events: [] };
const frames = await p.evaluate((s) => window.__coachCapture.run(s), spec);
writeFileSync(OUT + "/idle-pose-scan.json", JSON.stringify(frames.map((f) => ({ t: f.t, ...f.pose }))));
console.log("scanned", frames.length);
await browser.close();
