import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/failure-evidence";
import { PARTY_CASES, startDraft } from "./support/simulator-start";

// Fase 4A.3 · ¿el decorativo `span.cm-light` que la prueba de 4A marca como desborde produce scroll horizontal REAL o está recortado?
const OUT = resolve(process.cwd(), "docs/research/phase-4a3");
mkdirSync(OUT, { recursive: true });
const rows: unknown[] = [];
for (const item of PARTY_CASES) {
  test(`4A.3 · reflow decorativo · ${item.name}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1600, height: 900 });
    await startDraft(page, item);
    for (const width of [1600, 640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const els = [...document.querySelectorAll('[data-testid="team-coach-board"] .cm-light')] as HTMLElement[];
        const clipped = (el: HTMLElement) => { for (let n = el.parentElement; n; n = n.parentElement) { const o = getComputedStyle(n); if (/(hidden|clip|auto|scroll)/.test(o.overflowX)) return `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 30)} overflow-x:${o.overflowX}`; } return null; };
        const html = document.documentElement;
        return {
          clientWidth: limit, htmlScrollWidth: html.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
          docScrolls: html.scrollWidth > limit,
          decorative: els.map((el) => ({ cls: String(el.className), right: Math.round(el.getBoundingClientRect().right), position: getComputedStyle(el).position, ariaHidden: el.getAttribute("aria-hidden"), pointerEvents: getComputedStyle(el).pointerEvents, clippedBy: clipped(el) })),
        };
      });
      rows.push({ case: item.name, width, ...r });
      expect(r.docScrolls, `scroll horizontal REAL en ${item.name} a ${width}px`).toBe(false);
    }
    writeFileSync(resolve(OUT, `reflow-decorativo-${item.name}.json`), JSON.stringify(rows.filter((row) => (row as { case: string }).case === item.name), null, 2));
  });
}
