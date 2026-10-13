// motion-v2-comparison.webm: CURRENT | LIVE | MOTION V2, dark then light, idle then WATCHING->ANALYZING. Headless.
import { launch, BASE, OUT } from "./lib.mjs";
const { browser, ctx } = await launch(undefined, { viewport: { width: 1200, height: 560 } });
const p = await ctx.newPage();
await p.goto(BASE + "/lab/coach-motion-v2?theme=dark");
await p.waitForFunction(() => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live", null, { timeout: 120000 });
await p.waitForTimeout(5000);
await p.screencast.start({ path: OUT + "/motion-v2-comparison.webm", size: { width: 1200, height: 560 } });
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
