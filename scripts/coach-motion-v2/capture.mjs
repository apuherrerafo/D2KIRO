// Renders the Coach Motion V2 production source frames with the REAL Gold Master stage (HeroCoachStage, "lite", WebGL, headless Chromium).
// usage: node scripts/coach-motion-v2/capture.mjs --px 384,512 --out <frames dir> [--only watching,analyzing,tail,head-006]
//        env: SESSION_SECRET (the lab server's), CM_BASE (default http://localhost:3162)
// Output: <out>/<px>/<job>/f0000.png ... , <out>/<px>/hashes.json (sha256 of every PNG), <out>/capture-report.json
// The poses of every frame come from apps/web/features/coach-motion/loop-pose.ts (pure, tested) on a 120 Hz fixed-step simulation sampled at 30 fps.
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { launch, BASE } from "./lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const OUT = arg("out");
if (!OUT) throw new Error("--out <frames dir> is required (outside the repo, or in a gitignored folder)");
const PX = arg("px", "384,512").split(",").map(Number);
const ONLY = arg("only", "")?.split(",").filter(Boolean);
const SLICE = 30; // poses per round trip: keeps every CDP message a few MB

const { browser, ctx } = await launch();
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(`${BASE}/lab/coach-motion-v2/capture`);
await page.waitForSelector("html[data-capture-ready='1']", { timeout: 240000 });
const renderer = await page.evaluate(() => window.__coachCapture.renderer);
const selfCheck = await page.evaluate(() => window.__coachCapture.production.selfCheck());
console.log("renderer:", renderer, "| loop-pose vs HeroCoachStage.update max abs pose diff:", selfCheck);
if (!(selfCheck < 1e-9)) throw new Error(`loop-pose smoothing no longer matches the Live stage (${selfCheck})`);

const phases = Array.from({ length: 42 }, (_, i) => i * 6);
const jobs = [{ name: "watching", job: { kind: "watching" } }, { name: "analyzing", job: { kind: "analyzing" } }, { name: "tail", job: { kind: "tail" } }, ...phases.map((p) => ({ name: `head-${String(p).padStart(3, "0")}`, job: { kind: "head", phase: p } }))].filter((j) => !ONLY.length || ONLY.includes(j.name));

const report = { renderer, selfCheckMaxAbsPoseDiff: selfCheck, base: BASE, px: {}, errors };
for (const px of PX) {
  const hashes = {};
  const t0 = Date.now();
  await page.evaluate((n) => (window.__stage = window.__coachCapture.production.open(n)), px);
  for (const { name, job } of jobs) {
    const poses = await page.evaluate((j) => window.__coachCapture.production.poses(j), job);
    const dir = `${OUT}/${px}/${name}`;
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/poses.json`, JSON.stringify(poses));
    for (let i = 0; i < poses.length; i += SLICE) {
      const pngs = await page.evaluate((ps) => window.__stage.frames(ps), poses.slice(i, i + SLICE));
      pngs.forEach((url, k) => {
        const buf = Buffer.from(url.split(",")[1], "base64");
        const file = `f${String(i + k).padStart(4, "0")}.png`;
        writeFileSync(`${dir}/${file}`, buf);
        hashes[`${name}/${file}`] = createHash("sha256").update(buf).digest("hex");
      });
    }
    console.log(px, name, poses.length, "frames");
  }
  await page.evaluate(() => window.__stage.close());
  writeFileSync(`${OUT}/${px}/hashes.json`, JSON.stringify(hashes, null, 0));
  report.px[px] = { frames: Object.keys(hashes).length, seconds: (Date.now() - t0) / 1000 };
}
writeFileSync(`${OUT}/capture-report.json`, JSON.stringify(report, null, 1));
await browser.close();
if (errors.length) throw new Error(`page errors: ${errors.join(" | ")}`);
