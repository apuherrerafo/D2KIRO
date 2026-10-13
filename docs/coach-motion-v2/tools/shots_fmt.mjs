// Lab screenshots of the format comparison mode (LIVE, A, B, C) for review. Headless.
// usage: node shots_fmt.mjs <outDir>   -> <outDir>/shot-{theme}-{idle|mid|late|inspect}.png ; compose_fmt.py stacks them into format-comparison-*.png
import { launch, BASE } from "./lib.mjs";
import { writeFileSync } from "node:fs";
const OUT = process.argv[2];
for (const theme of ["dark", "light"]) {
  for (const [dpr, inspect] of [[2, 0], [1, 1]]) {
    const { browser, ctx } = await launch(undefined, { viewport: { width: inspect ? 2500 : 1500, height: inspect ? 1000 : 760 }, deviceScaleFactor: dpr });
    const p = await ctx.newPage();
    await p.goto(BASE + `/lab/coach-motion-v2?mode=format&theme=${theme}&inspect=${inspect}`);
    await p.waitForFunction(() => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live", null, { timeout: 180000 });
    await p.waitForTimeout(4000);
    const tag = inspect ? "inspect" : "actual";
    await p.click('[data-testid="replay-idle"]');
    await p.waitForTimeout(900);
    await p.screenshot({ path: `${OUT}/shot-${theme}-${tag}-idle.png` });
    writeFileSync(`${OUT}/rects-${theme}-${tag}.json`, JSON.stringify(await p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.cm-panel')].map((e) => [e.dataset.testid, e.querySelector('.cm-stage').getBoundingClientRect().toJSON()])))));
    await p.click('[data-testid="replay-transition"]');
    await p.waitForTimeout(1800 + 330);
    await p.screenshot({ path: `${OUT}/shot-${theme}-${tag}-mid.png` });
    await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/shot-${theme}-${tag}-late.png` });
    await browser.close();
    console.log("shots", theme, tag);
  }
}
