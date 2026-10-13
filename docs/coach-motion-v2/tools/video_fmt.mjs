// format-motion-comparison.webm: LIVE | A | B | C at actual size (DPR 1), dark then light, idle then WATCHING->ANALYZING. Headless.
import { launch, BASE, OUT } from "./lib.mjs";
const { browser, ctx } = await launch(undefined, { viewport: { width: 1480, height: 560 } });
const p = await ctx.newPage();
await p.goto(BASE + "/lab/coach-motion-v2?mode=format&theme=dark");
await p.waitForFunction(() => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live", null, { timeout: 180000 });
await p.waitForTimeout(5000);
await p.evaluate(() => window.scrollTo(0, 150));
await p.screencast.start({ path: OUT + "/production-format/format-motion-comparison.webm", size: { width: 1480, height: 560 } });
const seq = async () => {
  await p.click('[data-testid="replay-idle"]'); await p.waitForTimeout(2600);
  await p.click('[data-testid="replay-transition"]'); await p.waitForTimeout(1800 + 2600);
};
await seq();
await p.click('[data-testid="theme"]'); await p.waitForTimeout(600);
await seq();
await p.screencast.stop();
await browser.close();
console.log("video done");
