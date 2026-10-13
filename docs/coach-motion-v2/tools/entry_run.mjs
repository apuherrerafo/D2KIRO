// Drives the entry-phase lab (headless) through the real player: three strategies side by side for idle phases 0 / 50 / 80 %, then single-strategy
// pages for the loader model (CURRENT + NEXT, previous clip released).  usage: node entry_run.mjs <outDir> [pack=A]
import { launch, BASE } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = process.argv[2];
const PACK = process.argv[3] || "A";
const TARGETS = { 0: 0, 50: 30, 80: 48 };
const { browser, ctx } = await launch(undefined, { viewport: { width: 1500, height: 700 } });
const meta = { pack: PACK, runs: {}, memory: {} };

const p = await ctx.newPage();
const errs = [];
p.on("pageerror", (e) => errs.push(String(e)));
await p.goto(BASE + `/lab/coach-motion-v2/entry?pack=${PACK}&stride=6`);
await p.waitForFunction(() => window.__entry, null, { timeout: 120000 });
for (const [pct, frame] of Object.entries(TARGETS)) {
  const res = await p.evaluate((f) => window.__entry.run(f), frame);
  for (const r of res) {
    const dir = `${OUT}/entry/${PACK}/${r.strategy}-${pct}`;
    mkdirSync(dir, { recursive: true });
    r.frames.forEach((f, i) => writeFileSync(`${dir}/f${String(i).padStart(2, "0")}.png`, Buffer.from(f.png.split(",")[1], "base64")));
    meta.runs[`${r.strategy}-${pct}`] = { shown: r.shown, dir: r.dir, plan: r.plan, boundary: r.boundary, frames: r.frames.map((f) => ({ clip: f.clip, frame: f.frame, t: +f.t.toFixed(1) })), peakDecodedBytes: r.peakDecodedBytes };
  }
  console.log("run", pct, res.map((r) => `${r.strategy}: shown ${r.shown} plan ${JSON.stringify(r.plan)} boundary@${r.boundary}`).join(" | "));
}
console.log("page errors:", errs);
await p.close();

// loader model: one strategy owns the loader (release enabled); peak decoded bytes while the cue at idle frame 30 is served
for (const only of ["canonical", "nearest", "wait"]) {
  const q = await ctx.newPage();
  await q.goto(BASE + `/lab/coach-motion-v2/entry?pack=${PACK}&stride=6&only=${only}`);
  await q.waitForFunction(() => window.__entry, null, { timeout: 120000 });
  await q.waitForTimeout(1500);
  const res = await q.evaluate(() => window.__entry.run(30));
  const mem = await q.evaluate(() => window.__entry.memory());
  meta.memory[only] = { peakDecodedBytes: res[0].peakDecodedBytes, heldAtEnd: res[0].held, bytesAtEnd: mem.bytes, boundary: res[0].boundary, frames: res[0].frames.map((f) => `${f.clip}:${f.frame}`) };
  console.log("memory", only, res[0].peakDecodedBytes, mem.bytes, res[0].held.join(","));
  await q.close();
}
writeFileSync(`${OUT}/entry/${PACK}/meta.json`, JSON.stringify(meta, null, 1));
await browser.close();
