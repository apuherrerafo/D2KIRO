import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.SB_URL ?? "http://127.0.0.1:6110";
const shots = [
  [1440, 900, "match-01", "match-01"], [1440, 900, "match-24", "match-24"], [1440, 900, "player-model", "player-model"],
  [1366, 768, "match-24", "match-24"], [1366, 768, "player-model", "player-model"],
  [390, 844, "match-01", "match-01-mobile"], [390, 844, "match-24", "match-24-mobile"], [390, 844, "player-model", "player-model-mobile"],
];
const browser = await chromium.launch();
for (const [w, h, name, story] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: "dark" });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/iframe.html?id=ds-v1-landing-01b-memory-strip--${story}&viewMode=story`);
  await page.waitForSelector("[data-testid=memory-strip]");
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.waitForTimeout(600);
  await page.screenshot({ path: join(out, `${name}-${w}x${h}.png`), fullPage: w < 500 });
  await page.close();
}
await browser.close();
