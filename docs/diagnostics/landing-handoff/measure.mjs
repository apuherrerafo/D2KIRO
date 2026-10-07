import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, resolve } from "node:path";
const out = dirname(fileURLToPath(import.meta.url));
const root = resolve(out, "..", "..", "..", "apps", "web", "storybook-static");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const server = createServer(async (q, r) => { try { const p = join(root, decodeURIComponent(new URL(q.url, "http://x").pathname)); r.setHeader("content-type", types[extname(p)] ?? "application/octet-stream"); r.end(await readFile(p)); } catch { r.statusCode = 404; r.end(); } });
await new Promise((ok) => server.listen(6216, "127.0.0.1", ok));
const browser = await chromium.launch();
for (const [w, h] of [[1440, 900], [1366, 768], [1024, 768], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://127.0.0.1:6216/iframe.html?id=ds-v1-landing-01b--full-page&viewMode=story");
  await page.waitForSelector(".ld-memory-stage .ms-object");
  console.log(w, h, JSON.stringify(await page.evaluate(() => {
    const s = document.querySelector(".ld-memory-stage").getBoundingClientRect(), o = document.querySelector(".ld-memory-stage .ms-object").getBoundingClientRect(), hd = document.querySelector(".ld-memory-head").getBoundingClientRect();
    return { stageH: s.height, objTopInStage: o.top - s.top, objH: o.height, headH: hd.height, headBottomToStage: s.top - hd.bottom };
  })));
}
await browser.close(); server.close();
