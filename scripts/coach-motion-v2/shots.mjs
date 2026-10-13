// Actual-size screenshots of LIVE / 384 / 512 at DPR 1 and 2 (headless), WATCHING and ANALYZING, dark and light, for the 384-vs-512 review.
// usage: SESSION_SECRET=... node scripts/coach-motion-v2/shots.mjs [outDir]
import { mkdirSync } from "node:fs";
import { launch, BASE, ROOT } from "./lib.mjs";

const OUT = process.argv[2] ?? `${ROOT}/docs/coach-motion-v2/production/shots`;
mkdirSync(OUT, { recursive: true });
for (const dpr of [1, 2]) {
  for (const theme of ["dark", "light"]) {
    const { browser, ctx } = await launch({ deviceScaleFactor: dpr, viewport: { width: 1100, height: 760 } });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/lab/coach-motion-v2/production?theme=${theme}`);
    await page.waitForSelector('[data-testid="panel-512"][data-motion-status="motion"]', { timeout: 60000 });
    await page.waitForSelector('[data-testid="panel-384"][data-motion-status="motion"]', { timeout: 60000 });
    await page.waitForTimeout(2500);
    for (const scene of ["watching", "analyzing"]) {
      await page.click(`[data-testid="btn-${scene}"]`);
      await page.waitForTimeout(2200);
      await page.click('[data-testid="btn-pause"]'); // freezes the Motion V2 panels on a real frame; LIVE keeps running (reference only)
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/dpr${dpr}-${theme}-${scene}.png`, clip: { x: 0, y: 0, width: 1100, height: 620 } });
      await page.click('[data-testid="btn-pause"]');
    }
    await browser.close();
  }
}
