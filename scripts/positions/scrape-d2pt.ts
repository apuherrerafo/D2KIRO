#!/usr/bin/env bun
// MANUAL, developer-run, never automatic, never imported from apps/. Reads the five Dota2ProTracker position tables with a REAL
// browser and writes the raw page dumps `import-observations.ts` consumes (one `pos-N.json` per position).
//
//   bun scripts/positions/scrape-d2pt.ts --out=<dir>
//
// STATUS: **NOT verified against the live site** -- Cloudflare returned 403 to a headless Edge on 2026-09-20 and this repo does
// not evade bot protection. The browser opens VISIBLE so a person can clear a challenge if one is shown; the script only waits for
// that. It pauses between pages (a rapid burst is what got the original run blocked) and dumps the raw cells -- it does not decide
// what any column means: `import-observations.ts` locates "Matches" from the header, or takes --matches-column after a visual check.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const PAUSE_MS = 20_000;
const CHALLENGE_WAIT_MS = 180_000;
const outArg = process.argv.find((a) => a.startsWith("--out="));
if (!outArg) throw new Error("usage: --out=<dir>");
const outDir = resolve(outArg.slice("--out=".length));
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: "msedge", headless: false });
try {
  const page = await browser.newPage();
  for (const position of [1, 2, 3, 4, 5] as const) {
    if (position > 1) await new Promise((done) => setTimeout(done, PAUSE_MS));
    const url = `https://dota2protracker.com/meta?position=pos+${position}`;
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => undefined);
    await page.waitForSelector(".d2-table-sticky-cell", { timeout: CHALLENGE_WAIT_MS });
    const dump = await page.evaluate(() => {
      const rowOf = (cell: Element): Element => cell.closest("[class*='min-h-']") ?? cell.parentElement!;
      const rows = [...document.querySelectorAll(".d2-table-sticky-cell")].map((cell) => ({
        name: (cell as HTMLElement).innerText.trim(),
        cells: [...rowOf(cell).children].map((child) => (child as HTMLElement).innerText.trim()),
      }));
      const header = document.querySelector("[class*='d2-table-header']");
      return { rows, tableHeader: header ? [...header.children].map((child) => (child as HTMLElement).innerText.trim()) : null };
    });
    const payload = { schema: "d2pt-position-page/v1", position, url, retrievedAt: new Date().toISOString(), tableHeader: dump.tableHeader, rows: dump.rows };
    writeFileSync(join(outDir, `pos-${position}.json`), `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`pos ${position}: ${dump.rows.length} rows`);
  }
} finally {
  await browser.close();
}
