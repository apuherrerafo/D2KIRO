// On-screen evidence capture of the three panels at once (CDP screencast PNG frames, same method as docs/coach-motion-audit).
// usage: node evidence.mjs <frames-dir>   (frames are written OUTSIDE the repo; analyze_v2.py reads them)
import { launch, BASE, OUT } from "./lib.mjs";
import { mkdirSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
const FR = process.argv[2];
const INIT = () => {
  window.__log = []; window.__raf = [];
  const tick = () => { window.__raf.push(performance.timeOrigin + performance.now()); requestAnimationFrame(tick); }; requestAnimationFrame(tick);
  const watch = () => {
    const els = { current: document.querySelector('[data-testid="panel-current"] [data-testid="hero-coach"]'), live: document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]'), v2: document.querySelector('[data-testid="coach-v2"]') };
    const ro = document.querySelector('[data-testid="cm-readout"]');
    if (!els.current || !els.live || !els.v2 || !ro) return requestAnimationFrame(watch);
    for (const [k, el] of Object.entries(els)) {
      const rec = () => window.__log.push({ t: Date.now(), panel: k, state: el.dataset.state, renderer: el.dataset.renderer, verb: el.dataset.verb });
      rec(); new MutationObserver(rec).observe(el, { attributes: true });
    }
    const rec2 = () => window.__log.push({ t: Date.now(), panel: "v2-frame", text: ro.textContent });
    rec2(); new MutationObserver(rec2).observe(ro, { childList: true, characterData: true, subtree: true });
  }; watch();
};
async function rects(p) {
  return p.evaluate(() => Object.fromEntries([["current", '[data-testid="panel-current"] .hl-coach'], ["live", '[data-testid="panel-live"] .hl-coach'], ["v2", '[data-testid="coach-v2"]']].map(([k, s]) => [k, document.querySelector(s).getBoundingClientRect().toJSON()])));
}
async function cdpFrames(p, dir, ms, during) {
  mkdirSync(dir, { recursive: true });
  const cdp = await p.context().newCDPSession(p); const frames = []; const writes = []; let i = 0;
  cdp.on("Page.screencastFrame", (f) => {
    const n = i++; frames.push({ n, ts: f.metadata.timestamp, recv: Date.now() });
    writes.push(writeFile(`${dir}/${String(n).padStart(4, "0")}.png`, Buffer.from(f.data, "base64")));
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  const t0 = Date.now(); const extra = await during(); 
  await p.waitForTimeout(ms);
  await cdp.send("Page.stopScreencast"); const t1 = Date.now();
  await Promise.all(writes); await cdp.detach();
  return { frames, t0, t1, ...extra };
}
const { browser, ctx } = await launch();
const p = await ctx.newPage();
await p.addInitScript(INIT);
await p.goto(BASE + "/lab/coach-motion-v2?theme=dark");
await p.waitForFunction(() => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live", null, { timeout: 120000 });
await p.waitForTimeout(6000); // shaders/model hot, atlas decoded
const meta = await p.evaluate(() => ({ renderer: (() => { const gl = document.createElement("canvas").getContext("webgl"); const e = gl && gl.getExtension("WEBGL_debug_renderer_info"); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : null; })(), dpr: devicePixelRatio, url: location.href,
  atlas: [...document.querySelectorAll('[data-testid="coach-atlas"]')].map((c) => [c.width, c.height]), live: [...document.querySelectorAll('canvas[data-testid="coach-live"]')].map((c) => [c.width, c.height, c.clientWidth]) }));
const R = await rects(p);
// IDLE: restart V2 idle at frame 0 (A and B are already WATCHING), capture 2.6 s
const idle = await cdpFrames(p, `${FR}/idle`, 2600, async () => { const t = Date.now(); await p.click('[data-testid="replay-idle"]'); return { t_click: t, t_click_done: Date.now() }; });
idle.log = await p.evaluate(() => window.__log.slice()); idle.raf = await p.evaluate(() => window.__raf.slice()); idle.rects = R; idle.meta = meta;
writeFileSync(`${FR}/cap-idle.json`, JSON.stringify(idle));
await p.waitForTimeout(1500);
// TRANSITION: WATCHING holds LEAD_MS then the reveal cue lands in all three panels
await p.evaluate(() => { window.__log.length = 0; });
const tr = await cdpFrames(p, `${FR}/trans`, 4300, async () => { const t = Date.now(); await p.click('[data-testid="replay-transition"]'); return { t_click: t }; });
tr.log = await p.evaluate(() => window.__log.slice()); tr.raf = await p.evaluate(() => window.__raf.slice()); tr.rects = R; tr.meta = meta;
writeFileSync(`${FR}/cap-trans.json`, JSON.stringify(tr));
console.log("idle frames", idle.frames.length, "trans frames", tr.frames.length, meta.renderer);
console.log("trans log:", tr.log.filter((l) => l.panel !== "v2-frame").map((l) => `${l.t - tr.t_click} ${l.panel} ${l.state}`).join(" | "));
await browser.close();
