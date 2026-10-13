import { launch, BASE, OUT } from "./lib.mjs";
const { browser, ctx } = await launch(undefined, { viewport: { width: 1200, height: 560 } });
const p = await ctx.newPage();
await p.goto(BASE + "/lab/coach-motion-v2?theme=light");
await p.waitForFunction(() => document.querySelector('[data-testid="panel-live"] [data-testid="hero-coach"]')?.dataset.renderer === "live", null, { timeout: 120000 });
await p.waitForTimeout(3000);
await p.click('[data-testid="replay-transition"]'); await p.waitForTimeout(1800 + 450);
await p.screenshot({ path: OUT + "/light-theme-check.png" });
await browser.close();
