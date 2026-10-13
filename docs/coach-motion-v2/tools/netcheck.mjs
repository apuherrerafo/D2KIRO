// Network check: which requests does each lab configuration make? usage: node netcheck.mjs
import { launch, BASE, OUT } from "./lib.mjs";
import { writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
async function run(query, waitFor) {
  const { browser, ctx } = await launch();
  const p = await ctx.newPage();
  const reqs = [];
  p.on("response", async (r) => {
    const url = r.url(); if (!url.startsWith(BASE)) return;
    let body = null; try { body = await r.body(); } catch {}
    const ct = r.headers()["content-type"] || "";
    const js = /javascript/.test(ct);
    const text = js && body ? body.toString("utf8") : "";
    reqs.push({ url: url.replace(BASE, ""), status: r.status(), type: ct.split(";")[0], bytes: body ? body.length : null, gzip: body ? gzipSync(body).length : null, threeSignature: js ? /WebGLRenderer/.test(text) && /PerspectiveCamera/.test(text) : false });
  });
  await p.goto(BASE + "/lab/coach-motion-v2" + query);
  await p.waitForFunction(waitFor, null, { timeout: 120000 });
  await p.waitForTimeout(4000); // let any lazy chunk or model fetch start
  const state = await p.evaluate(() => ({ atlas: [...document.querySelectorAll('[data-testid="coach-atlas"]')].map((c) => [c.dataset.clip, c.dataset.error ?? null]), renderers: [...document.querySelectorAll('[data-testid="hero-coach"]')].map((c) => c.dataset.renderer) }));
  await browser.close();
  const sum = (f) => reqs.filter(f).reduce((s, r) => s + (r.bytes || 0), 0);
  return { query, state, requests: reqs.length,
    three_chunk_loaded: reqs.some((r) => r.threeSignature), coach_modular_loaded: reqs.some((r) => /coach-modular/.test(r.url)), any_coach_gold_master: reqs.filter((r) => /coach-gold-master/.test(r.url)).map((r) => r.url),
    js_bytes: sum((r) => /javascript/.test(r.type)), js_gzip_bytes: reqs.filter((r) => /javascript/.test(r.type)).reduce((s, r) => s + (r.gzip || 0), 0), atlas_bytes: sum((r) => /coach-motion-v2/.test(r.url)),
    assets: reqs.filter((r) => /coach-motion-v2|coach-modular|coach-web-pack/.test(r.url)).map((r) => ({ url: r.url, bytes: r.bytes })), three_chunks: reqs.filter((r) => r.threeSignature).map((r) => ({ url: r.url, bytes: r.bytes, gzip: r.gzip })) };
}
const out = {
  v2_only: await run("?panels=v2", () => document.querySelector('[data-testid="coach-atlas"]')?.dataset.clip),
  all_panels: await run("", () => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live"),
};
writeFileSync(OUT + "/network-check.json", JSON.stringify(out, null, 1));
for (const [k, v] of Object.entries(out)) console.log(k, JSON.stringify({ requests: v.requests, three: v.three_chunk_loaded, modular: v.coach_modular_loaded, gm: v.any_coach_gold_master, js_gzip: v.js_gzip_bytes, atlas_bytes: v.atlas_bytes, assets: v.assets, state: v.state }));
