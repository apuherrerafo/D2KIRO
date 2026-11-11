import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/failure-evidence";
import type { Locator, Page } from "@playwright/test";

// Fase 4A · Simulador Canonical Light REAL (motor + web reales, base E2E determinista). Verifica Solo / Party 2 / 3 / 5, que el clic analiza sin elegir,
// recomendado + abierto en análisis, teclado y reflow (200 % = 640 px, 400 % = 320 px de ancho CSS). Las capturas van a docs/research/phase-4a/captures.

const CAPTURES = resolve(process.cwd(), "docs/research/phase-4a/captures");
mkdirSync(CAPTURES, { recursive: true });

interface PartyCase {
  name: string;
  size: 1 | 2 | 3 | 5;
  positions: string[];
  personal: string;
  columns: number;
}

const CASES: PartyCase[] = [
  { name: "solo", size: 1, positions: [], personal: "Posición 2 — Midlane", columns: 1 },
  { name: "party2", size: 2, positions: ["Posición 2 — Midlane", "Posición 5 — Hard support"], personal: "Posición 5 — Hard support", columns: 2 },
  { name: "party3", size: 3, positions: ["Posición 1 — Carry", "Posición 3 — Offlane", "Posición 5 — Hard support"], personal: "Posición 3 — Offlane", columns: 3 },
  { name: "party5", size: 5, positions: [], personal: "Posición 2 — Midlane", columns: 5 },
];

async function startDraft(page: Page, item: PartyCase) {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  const sizeLabel = item.size === 1 ? "Solo (1)" : `Party ${item.size}`;
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: sizeLabel }).click();
  for (const pos of item.positions) {
    await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: pos }).click();
  }
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: item.personal }).click();
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  await expect(page.getByTestId("resolved-bans")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("team-coach-board")).toBeVisible();
  await expect(page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']").first()).toBeVisible({ timeout: 60_000 });
}

function cards(page: Page): Locator {
  return page.getByTestId("team-coach-board").locator("[data-card-key] button");
}

async function noHorizontalScroll(page: Page) {
  const report = await page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    // El NavBar global (preexistente, fuera de esta fase) desborda en anchos chicos; esta prueba mide SOLO el tablero Canonical Light.
    // Fase 4A.3: un adorno `aria-hidden` recortado por un ancestro con overflow-x oculto (p. ej. `span.cm-light`) no es contenido ni genera scroll: se excluye.
    // El criterio real (WCAG 1.4.10) es el scroll horizontal del documento, que se exige aparte.
    const clippedDecoration = (el: Element) => {
      if (el.getAttribute("aria-hidden") !== "true") return false;
      for (let node = el.parentElement; node; node = node.parentElement) if (/(hidden|clip)/.test(getComputedStyle(node).overflowX)) return true;
      return false;
    };
    const wide = [...document.querySelectorAll('[data-testid="team-coach-board"], [data-testid="team-coach-board"] *')]
      .filter((el) => el.getBoundingClientRect().right > limit + 1 && !clippedDecoration(el))
      .slice(0, 6)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)}[${el.getAttribute("data-testid") ?? ""}]`);
    if (document.documentElement.scrollWidth > limit) wide.push(`documento: scrollWidth ${document.documentElement.scrollWidth} > ${limit}`);
    return { overflow: wide.length, wide };
  });
  expect(report.overflow, `desbordan: ${report.wide.join(" | ")}`).toBe(0);
}

for (const item of CASES) {
  test.describe(`Simulador Canonical Light · ${item.name}`, () => {
    test(`${item.columns} columna(s), clic que solo analiza, recomendado + abierto`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await startDraft(page, item);
      const board = page.getByTestId("team-coach-board");
      await expect(board.locator("[data-testid^='team-coach-column-']")).toHaveCount(item.columns);
      await expect(board.locator(".sl-stage")).toHaveAttribute("data-columns", String(item.columns));
      await expect(board.getByText("Selecciona un héroe para ver su análisis")).toBeVisible();
      await board.screenshot({ path: resolve(CAPTURES, `${item.name}-1-sin-seleccion.png`) });

      // Sin tarjetas es un estado válido (contrato de elegibilidad): no hay nada que abrir.
      if ((await cards(page).count()) === 0) return;

      const picksBefore = await page.evaluate(() => document.querySelectorAll('[data-testid="own-roster-pos-1"]').length);
      const recommended = board.locator('[data-recommended="true"] button').first();
      const target = (await recommended.count()) > 0 ? recommended : cards(page).first();
      await target.click();
      await expect(target).toHaveAttribute("aria-pressed", "true");
      await expect(board.locator("[data-detail-key]")).toHaveCount(1);
      // Abrir el análisis no elige: el draft sigue en la misma ronda y ningún sello nuevo se envió.
      await expect(page.getByText("Draft completo")).toHaveCount(0);
      expect(await page.evaluate(() => document.querySelectorAll('[data-testid="own-roster-pos-1"]').length)).toBe(picksBefore);
      if ((await recommended.count()) > 0) await expect(target).toHaveAttribute("data-state", "recommended");
      await board.screenshot({ path: resolve(CAPTURES, `${item.name}-2-${(await recommended.count()) > 0 ? "recomendado-en-analisis" : "en-analisis"}.png`) });

      // Teclado: Tab llega a otra tarjeta y Enter abre su análisis.
      await target.focus();
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => document.activeElement?.closest("[data-card-key]")?.getAttribute("data-card-key") ?? null);
      if (focused !== null) {
        await page.keyboard.press("Enter");
        await expect(board.locator("[data-detail-key]")).toHaveAttribute("data-detail-key", focused);
      }
      // Escape no es parte del contrato: el análisis se cierra con un segundo clic en la misma tarjeta.
    });

    test(`reflow a 200 % (640 px) y 400 % (320 px) sin scroll horizontal`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await startDraft(page, item);
      for (const [label, width] of [["200", 640], ["400", 320]] as const) {
        await page.setViewportSize({ width, height: 900 });
        await page.waitForTimeout(250);
        await noHorizontalScroll(page);
        await page.getByTestId("team-coach-board").screenshot({ path: resolve(CAPTURES, `${item.name}-3-reflow-${label}.png`) });
      }
    });

    test(`movimiento reducido: el tablero se pinta igual`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.setViewportSize({ width: 1600, height: 1000 });
      await startDraft(page, item);
      if ((await cards(page).count()) > 0) await cards(page).first().click();
      await expect(page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']")).toHaveCount(item.columns);
      await page.getByTestId("team-coach-board").screenshot({ path: resolve(CAPTURES, `${item.name}-4-movimiento-reducido.png`) });
    });
  });
}
