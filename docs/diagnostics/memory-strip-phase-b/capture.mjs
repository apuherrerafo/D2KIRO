import { chromium } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const out = dirname(fileURLToPath(import.meta.url));
const base = process.env.SB_URL ?? "http://127.0.0.1:6110";
const shots = [
  [1440, 900, "match-08", "match-08"], [1440, 900, "match-56", "match-56"],
  [1366, 768, "match-56", "match-56"],
  [390, 844, "match-08", "match-08-mobile"], [390, 844, "match-56", "match-56-mobile"],
  [390, 844, "match-01", "match-01-mobile"], [390, 844, "match-24", "match-24-mobile"], [390, 844, "player-model", "player-model-mobile"],
  // five-state desktop contact sheet source frames
  [1440, 900, "match-01", "match-01"], [1440, 900, "match-24", "match-24"], [1440, 900, "player-model", "player-model"],
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

// contact sheet: all five states in one page (static composite of the five screenshots)
const sheet = await browser.newPage({ viewport: { width: 2400, height: 1100 } });
const names = ["match-01", "match-08", "match-24", "match-56", "player-model"];
const html = `<body style="margin:0;background:#0b0b0d;display:grid;grid-template-columns:repeat(3,800px);gap:8px;padding:8px">${names
  .map((n) => `<img src="file:///${join(out, `${n}-1440x900.png`).replace(/\\/g, "/")}" style="width:800px">`)
  .join("")}</body>`;
await sheet.setContent(html);
await sheet.waitForTimeout(500);
await sheet.screenshot({ path: join(out, "contact-sheet-desktop.png"), fullPage: true });
await browser.close();
