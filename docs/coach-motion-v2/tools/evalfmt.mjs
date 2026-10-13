// Paints every frame of every candidate pack through the lab's own paintFrame at the Hero coach canvas size (276 px at DPR 1, 552 px at DPR 2)
// and times a cold decode of each atlas.  usage: node evalfmt.mjs <outDir>      (PNG read-backs go OUTSIDE the repo; analyze_p2.py reads them)
import { launch, BASE } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
const OUT = process.argv[2];
const PACKS = ["webp", "A", "B", "C", "X", "Y", "L30", "L24"];
const SIDES = [276, 552];
const { browser, ctx } = await launch();
const p = await ctx.newPage();
await p.goto(BASE + "/lab/coach-motion-v2/eval");
await p.waitForSelector("html[data-eval-ready='1']", { timeout: 120000 });
const manifests = {};
for (const pack of PACKS) manifests[pack] = await (await p.request.get(BASE + `/coach-motion-v2/${pack === "webp" ? "" : pack + "/"}manifest.json`)).json();
const decode = {};
for (const pack of PACKS) {
  for (const clip of ["WATCHING_IDLE", "WATCHING_TO_ANALYZING"]) {
    const runs = [];
    for (let i = 0; i < 3; i += 1) runs.push(await p.evaluate(([a, b]) => window.__cmEval.decode(a, b), [pack, clip]));
    decode[`${pack}/${clip}`] = { ms: runs.map((r) => +r.ms.toFixed(1)), w: runs[0].w, h: runs[0].h, bytes: runs[0].bytes, decodedBytes: runs[0].decodedBytes };
  }
}
for (const pack of PACKS) {
  for (const side of SIDES) {
    for (const [clip, tag] of [["WATCHING_IDLE", "idle"], ["WATCHING_TO_ANALYZING", "trans"]]) {
      const n = manifests[pack].clips[clip].frames;
      const urls = await p.evaluate(([a, b, c, d]) => window.__cmEval.paint(a, b, c, d), [pack, clip, [...Array(n).keys()], side]);
      const dir = `${OUT}/ev/${pack}/${side}/${tag}`;
      mkdirSync(dir, { recursive: true });
      urls.forEach((u, i) => writeFileSync(`${dir}/f${String(i).padStart(4, "0")}.png`, Buffer.from(u.split(",")[1], "base64")));
    }
  }
  console.log("painted", pack);
}
writeFileSync(`${OUT}/ev/decode.json`, JSON.stringify(decode, null, 1));
console.log(JSON.stringify(decode));
await browser.close();
