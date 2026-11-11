import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "./support/failure-evidence";
import { PARTY_CASES, personalPositionOf, startDraft, type PartyCase } from "./support/simulator-start";
import type { Page } from "@playwright/test";

// Fase 4A.1 · certificación del Simulador Canonical Light. NO cambia producto: mide y captura. Evidencia -> docs/research/phase-4a1/.
// axe está declarado en apps/web (devDependency existente); se resuelve desde ahí para no tocar dependencias.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { default?: unknown; AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const OUT = resolve(process.cwd(), "docs/research/phase-4a1");
const CAPTURES = resolve(OUT, "captures");
mkdirSync(CAPTURES, { recursive: true });
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function save(name: string, data: unknown) {
  writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2));
}

async function waitImages(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 20_000 }).catch(() => undefined);
}

// ---------- 1 · ELIGE AHORA con un fixture explícito sobre la respuesta REAL del motor ----------
// El motor E2E (meta fijo) devuelve evidencia WEAK en todas las tarjetas, y el contrato de elegibilidad prohíbe ELIGE AHORA con WEAK. Para ver la
// pantalla recomendada sin tocar V6: se deja pasar la respuesta real y SOLO se promueve una tarjeta REAL a STRONG + currentDecision STRATEGIC.
// Es una prueba de la presentación del contrato, no una recomendación del motor. Cada campo tocado queda registrado.
interface PatchRecord { caseName: string; position: number; heroId: number; before: unknown; after: unknown }

async function installRecommendedFixture(page: Page, item: PartyCase, records: PatchRecord[]) {
  const human = personalPositionOf(item);
  await page.route("**/team-recommendations", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const columns: Array<{ position: number; top: Array<Record<string, unknown>>; primaryHeroId: number | null }> = body.positions ?? [];
    const withCards = columns.filter((column) => column.top.length > 0);
    const target = withCards.find((column) => column.position === human) ?? withCards[0];
    if (target !== undefined) {
      const card = target.top[0];
      const before = { evidenceStrength: card.evidenceStrength, isPrimary: card.isPrimary, decision: body.currentDecision };
      card.evidenceStrength = "STRONG";
      card.isPrimary = true;
      target.primaryHeroId = card.heroId as number;
      body.currentDecision = {
        ...body.currentDecision,
        recommendedPosition: target.position,
        recommendedHeroId: card.heroId,
        targetBasis: "STRATEGIC",
        reason: "FIXTURE 4A.1 (no es una recomendación del motor): razón estratégica de prueba para ver el contrato completo.",
      };
      records.push({ caseName: item.name, position: target.position, heroId: card.heroId as number, before, after: { evidenceStrength: "STRONG", isPrimary: true, targetBasis: "STRATEGIC" } });
    }
    await route.fulfill({ response, json: body });
  });
}

for (const item of PARTY_CASES) {
  test(`4A.1 · ${item.name} · ELIGE AHORA (fixture explícito sobre respuesta real)`, async ({ page }) => {
    const records: PatchRecord[] = [];
    await page.setViewportSize({ width: 1600, height: 1000 });
    await installRecommendedFixture(page, item, records);
    await startDraft(page, item);
    const board = page.getByTestId("team-coach-board");
    // Las tarjetas llegan después de las columnas: se espera hasta 15 s antes de declarar «sin tarjetas».
    await expect.poll(() => board.locator("[data-card-key] button").count(), { timeout: 15_000 }).toBeGreaterThan(0).catch(() => undefined);
    const realCards = await board.locator("[data-card-key] button").count();
    if (realCards === 0) {
      // Estado válido del contrato: el motor no tiene ningún héroe con fundamento. No se fabrica una tarjeta (eso sería inventar en el frontend).
      save(`elige-ahora-${item.name}.json`, { fixture: true, applicable: false, note: "El motor real devolvió 0 tarjetas; no hay candidato real que promover." });
      return;
    }
    const recommended = board.locator('[data-recommended="true"] button').first();
    await expect(recommended, "el fixture debe producir una tarjeta recomendada").toHaveCount(1, { timeout: 30_000 });
    await expect(recommended).toHaveAttribute("data-state", "recommended");
    // «ELIGE AHORA» es para la posición propia; si el motor recomienda la de otro miembro de la party, el sello es «Para tu party · Pos N».
    const seal = /ELIGE AHORA|Para tu party/;
    await expect(recommended).toContainText(seal);
    const sealText = ((await recommended.textContent()) ?? "").match(seal)?.[0] ?? "";
    await waitImages(page);
    await board.screenshot({ path: resolve(CAPTURES, `${item.name}-A-recomendado.png`) });

    await recommended.click();
    await expect(recommended).toHaveAttribute("aria-pressed", "true");
    await expect(recommended).toHaveAttribute("data-state", "recommended");
    await expect(board.locator("[data-detail-key]")).toHaveCount(1);
    await expect(recommended).toContainText(seal);
    await waitImages(page);
    await board.screenshot({ path: resolve(CAPTURES, `${item.name}-B-recomendado-pressed-analisis.png`) });

    // Conservación: abrir OTRA tarjeta no quita la recomendación; la recomendada sigue `recommended` y sin `pressed`.
    const others = board.locator('[data-card-key]:not([data-recommended="true"]) button');
    let conserved = "sin otra tarjeta para abrir";
    if ((await others.count()) > 0) {
      await others.first().click();
      await expect(recommended).toHaveAttribute("data-state", "recommended");
      await expect(recommended).not.toHaveAttribute("aria-pressed", "true");
      await expect(recommended).toContainText(seal);
      await waitImages(page);
      await board.screenshot({ path: resolve(CAPTURES, `${item.name}-C-conservacion-otra-abierta.png`) });
      conserved = "ok: otra tarjeta abierta; la recomendada conserva data-state=recommended y ELIGE AHORA";
    }
    // Reabrir y cerrar la recomendada tampoco la pierde. Abrir no elige: ningún sello nuevo.
    await recommended.click();
    await recommended.click();
    await expect(recommended).toHaveAttribute("data-state", "recommended");
    await expect(page.getByText("Draft completo")).toHaveCount(0);
    save(`elige-ahora-${item.name}.json`, { fixture: true, note: "Respuesta real del motor con UNA tarjeta real promovida; V6 intacto.", seal: sealText, patches: records, conservation: conserved });
  });
}

// ---------- 2 · retratos, 3 · axe, 4 · reflow, 5 · CompactBoard: motor real, sin parche ----------
for (const item of PARTY_CASES) {
  test(`4A.1 · ${item.name} · retratos, axe, reflow y encabezado (motor real)`, async ({ page }) => {
    const imageResponses: Array<{ url: string; status: number }> = [];
    const imageFailures: string[] = [];
    page.on("response", (response) => {
      if (response.request().resourceType() === "image") imageResponses.push({ url: response.url(), status: response.status() });
    });
    page.on("requestfailed", (request) => {
      if (request.resourceType() === "image") imageFailures.push(`${request.url()} :: ${request.failure()?.errorText ?? "?"}`);
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startDraft(page, item);
    const board = page.getByTestId("team-coach-board");

    // 2 · RETRATOS: una captura INMEDIATA (como la de 4A) y otra tras esperar a que todas las <img> terminen.
    const probe = () => page.evaluate(() => [...document.querySelectorAll("img")].map((img) => ({
      host: new URL(img.currentSrc || img.src, location.href).host,
      complete: img.complete,
      naturalWidth: img.naturalWidth,
      loading: img.getAttribute("loading"),
    })));
    const immediate = await probe();
    await board.screenshot({ path: resolve(CAPTURES, `${item.name}-D-retratos-inmediata.png`) });
    await waitImages(page);
    const settled = await probe();
    await board.screenshot({ path: resolve(CAPTURES, `${item.name}-D-retratos-tras-carga.png`) });
    const summarize = (rows: typeof immediate) => ({
      total: rows.length,
      loaded: rows.filter((row) => row.complete && row.naturalWidth > 0).length,
      pending: rows.filter((row) => !row.complete).length,
      brokenAfterComplete: rows.filter((row) => row.complete && row.naturalWidth === 0).length,
      lazy: rows.filter((row) => row.loading === "lazy").length,
      hosts: [...new Set(rows.map((row) => row.host))],
    });
    save(`retratos-${item.name}.json`, {
      immediate: summarize(immediate),
      settled: summarize(settled),
      networkStatuses: [...new Set(imageResponses.map((entry) => entry.status))],
      nonOkResponses: imageResponses.filter((entry) => entry.status >= 400),
      requestFailures: imageFailures,
    });

    // 3 · AXE WCAG A/AA, página completa, con un candidato abierto.
    const cards = board.locator("[data-card-key] button");
    const hasCards = (await cards.count()) > 0;
    if (hasCards) await cards.first().click();
    await waitImages(page);
    const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const boardAxe = await new AxeBuilder({ page }).include('[data-testid="team-coach-board"]').withTags(WCAG_TAGS).analyze();
    save(`axe-${item.name}.json`, {
      candidateOpen: hasCards,
      violations: axe.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.length,
        targets: violation.nodes.slice(0, 6).map((node) => node.target.join(" ")),
      })),
      boardOnlyViolations: boardAxe.violations.map((violation) => ({ id: violation.id, impact: violation.impact, nodes: violation.nodes.length })),
      passes: axe.passes.length,
      incomplete: axe.incomplete.map((entry) => ({ id: entry.id, nodes: entry.nodes.length })),
    });

    // 4 · REFLOW separado: tablero vs página completa (con NavBar). 1600 = base; 640 = 200 %; 320 = 400 %.
    const reflow: Record<string, unknown> = {};
    for (const width of [1600, 640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      reflow[String(width)] = await page.evaluate(() => {
        const limit = document.documentElement.clientWidth;
        const over = (root: Element | null) => (root === null ? [] : [root, ...root.querySelectorAll("*")]).filter((el) => el.getBoundingClientRect().right > limit + 1);
        const describe = (el: Element) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 24)}" right=${Math.round(el.getBoundingClientRect().right)}`;
        const nav = document.querySelector("nav");
        const boardRoot = document.querySelector('[data-testid="team-coach-board"]');
        return {
          clientWidth: limit,
          pageScrollWidth: document.documentElement.scrollWidth,
          pageScrollsHorizontally: document.documentElement.scrollWidth > limit + 1,
          navScrollWidth: nav?.scrollWidth ?? null,
          navOverflowCount: over(nav).length,
          navOverflowSamples: over(nav).slice(0, 5).map(describe),
          boardOverflowCount: over(boardRoot).length,
          boardOverflowSamples: over(boardRoot).slice(0, 5).map(describe),
          otherOverflowCount: over(document.body).filter((el) => el.closest("nav") === null && el.closest('[data-testid="team-coach-board"]') === null).length,
        };
      });
      await page.screenshot({ path: resolve(CAPTURES, `${item.name}-E-pagina-completa-${width}.png`), fullPage: true });
      await board.screenshot({ path: resolve(CAPTURES, `${item.name}-E-tablero-${width}.png`) });
    }
    save(`reflow-${item.name}.json`, reflow);

    // 5 · ENCABEZADO (CompactBoard, estilo oscuro de producción) frente al cuerpo Canonical Light.
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.waitForTimeout(300);
    const style = await page.evaluate(() => {
      const paint = (el: Element | null) => {
        if (el === null) return null;
        const css = getComputedStyle(el);
        return { background: css.backgroundColor, color: css.color, borderBottom: css.borderBottomColor, fontFamily: css.fontFamily.split(",")[0] };
      };
      return {
        pageBody: paint(document.body),
        stickyStrip: paint(document.querySelector('[data-testid="draft-sticky-strip"]')),
        compactBoard: paint(document.querySelector('[data-testid="draft-sticky-strip"] > div')),
        lightBlock: paint(document.querySelector(".sl-light")),
        lightTitle: paint(document.querySelector(".sl-title")),
      };
    });
    save(`encabezado-${item.name}.json`, style);
    await page.screenshot({ path: resolve(CAPTURES, `${item.name}-F-encabezado-junto-al-tablero.png`), clip: { x: 0, y: 0, width: 1600, height: 560 } });
    await page.getByTestId("draft-sticky-strip").screenshot({ path: resolve(CAPTURES, `${item.name}-F-compactboard.png`) });
  });
}
