import { launch, BASE } from "./lib.mjs";
const dpr = Number(process.argv[2] || 1);
const { browser, ctx } = await launch(undefined, { viewport: { width: 1500, height: 760 }, deviceScaleFactor: dpr });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
await p.goto(BASE + "/lab/coach-motion-v2?mode=format&theme=dark");
await p.waitForFunction(() => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live", null, { timeout: 180000 });
await p.waitForTimeout(5000);
console.log(JSON.stringify(await p.evaluate(() => ({
  dpr: devicePixelRatio,
  atlas: [...document.querySelectorAll('[data-testid="coach-atlas"]')].map((c) => ({ px: [c.width, c.height], css: [c.clientWidth, c.clientHeight], clip: c.dataset.clip, err: c.dataset.error })),
  live: [...document.querySelectorAll('canvas')].filter((c) => c.dataset.testid !== "coach-atlas").map((c) => ({ px: [c.width, c.height], css: [c.clientWidth, c.clientHeight], tid: c.dataset.testid })),
  readouts: [...document.querySelectorAll(".cm-readout")].map((e) => e.textContent),
}))));
console.log("errors:", errs.slice(0, 5));
await p.screenshot({ path: process.env.TEMP + `/probe-${dpr}.png` });
await browser.close();
