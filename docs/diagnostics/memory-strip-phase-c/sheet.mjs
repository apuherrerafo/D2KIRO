// Composes frozen frames into one contact sheet per transition and viewport.
// Usage: FRAMES_DIR=<scratch> node sheet.mjs
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = dirname(fileURLToPath(import.meta.url));
const frames = process.env.FRAMES_DIR ?? join(out, "frames");
const files = readdirSync(frames).filter((f) => f.endsWith(".png") && /-\d\d\.png$/.test(f));
const groups = Map.groupBy(files, (f) => f.replace(/-\d\d\.png$/, ""));
const browser = await chromium.launch();
for (const [group, list] of groups) {
  const mobile = group.startsWith("mobile");
  const cols = mobile ? 4 : 3;
  const width = mobile ? 300 : 640;
  const page = await browser.newPage({ viewport: { width: cols * (width + 8) + 8, height: 800 } });
  const cells = list.sort().map((f, i) => `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(join(frames, f)).toString("base64")}" style="width:${width}px;display:block"><figcaption style="color:#9aa;font:11px monospace;padding:2px">${group} · ${i}/${list.length - 1}</figcaption></figure>`).join("");
  await page.setContent(`<body style="margin:0;background:#050506;display:grid;grid-template-columns:repeat(${cols},${width}px);gap:8px;padding:8px">${cells}</body>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `sheet-${group}.png`), fullPage: true });
  await page.close();
}
await browser.close();
