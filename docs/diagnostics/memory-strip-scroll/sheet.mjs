// Composes the per-beat frames of capture.mjs into one contact sheet per viewport, captioned with the beat.
// Usage (from apps/web): FRAMES_DIR=<scratch> node ../../docs/diagnostics/memory-strip-scroll/sheet.mjs
import { chromium } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const out = process.env.OUT_DIR ?? dirname(fileURLToPath(import.meta.url));
const frames = process.env.FRAMES_DIR ?? join(out, "frames");
const report = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "report.json"), "utf8"));
const files = readdirSync(frames).filter((f) => /-\d\d\.png$/.test(f));
const groups = Map.groupBy(files, (f) => f.replace(/-\d\d\.png$/, ""));
const browser = await chromium.launch();
for (const [group, list] of groups) {
  const mobile = group.startsWith("mobile");
  const cols = mobile ? 6 : 4;
  const width = mobile ? 234 : 480;
  const labels = report.filter((row) => row.tag === group && row.label);
  const page = await browser.newPage({ viewport: { width: cols * (width + 8) + 8, height: 800 } });
  const cells = list.sort().map((f, i) => {
    const row = labels[i] ?? {};
    const caption = `${String(i).padStart(2, "0")} · ${row.label ?? ""} · ${row.scene ?? ""}`;
    return `<figure style="margin:0"><img src="data:image/png;base64,${readFileSync(join(frames, f)).toString("base64")}" style="width:${width}px;display:block"><figcaption style="color:#9aa;font:11px monospace;padding:2px">${caption}</figcaption></figure>`;
  }).join("");
  await page.setContent(`<body style="margin:0;background:#050506;display:grid;grid-template-columns:repeat(${cols},${width}px);gap:8px;padding:8px">${cells}</body>`);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(out, `sheet-${group}.png`), fullPage: true });
  await page.close();
}
await browser.close();
