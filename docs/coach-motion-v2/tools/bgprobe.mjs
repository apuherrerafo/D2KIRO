import { launch, BASE } from "./lib.mjs";
const { browser, ctx } = await launch();
const p = await ctx.newPage();
for (const th of ["dark", "light"]) {
  await p.goto(BASE + `/lab/coach-motion-v2?panels=v2&theme=${th}`);
  await p.waitForSelector('[data-testid="coach-v2"]');
  console.log(th, await p.evaluate(() => { const c = document.querySelector('[data-testid="coach-v2"]'); const out = []; for (let e = c; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b !== "rgba(0, 0, 0, 0)") { out.push(e.className + " " + b); break; } } return out; }));
}
await browser.close();
