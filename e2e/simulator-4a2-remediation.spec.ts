import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "./support/failure-evidence";
import { PARTY_CASES, personalPositionOf, startDraft, type PartyCase } from "./support/simulator-start";
import type { Locator, Page } from "@playwright/test";

// Fase 4A.2 · remediación y certificación del Simulador Canonical Light. Evidencia -> docs/research/phase-4a2/.
// DOS NIVELES DE EVIDENCIA, nunca mezclados:
//   A · UI con FIXTURE (nombre de archivo y razón rotulados «FIXTURE»): prueba que la interfaz representa bien una recomendación/decisión con el contrato V6.
//       La respuesta real del motor pasa por `page.route` y SOLO se promueve una tarjeta real. No certifica al motor.
//   B · MOTOR REAL (sin `page.route`): un draft completo jugado por la UI; se registra cada respuesta de /team-recommendations tal cual salió del motor.
// V6, sus pesos y los datasets no se tocan en ningún caso.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const OUT = resolve(process.cwd(), "docs/research/phase-4a2");
const CAPTURES = resolve(OUT, "captures");
mkdirSync(CAPTURES, { recursive: true });
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const FIXTURE_REASON = "FIXTURE 4A.2 (no es una recomendación del motor): razón estratégica de prueba para ver el contrato completo.";

function save(name: string, data: unknown) {
  writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2));
}

async function waitImages(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 20_000 }).catch(() => undefined);
}

interface PatchRecord { caseName: string; position: number; heroId: number; before: unknown; after: unknown }

// ---------- A · fixture explícito sobre la respuesta REAL ----------
async function installRecommendedFixture(page: Page, item: PartyCase, records: PatchRecord[]) {
  const human = personalPositionOf(item);
  await page.route("**/team-recommendations", async (route) => {
    // Una respuesta en vuelo cuando termina el test (la UI sigue recalculando tras el pick) no es un fallo del producto.
    const response = await route.fetch().catch(() => null);
    const body = response === null ? null : await response.json().catch(() => null);
    if (response === null || body === null) {
      await route.abort().catch(() => undefined);
      return;
    }
    const columns: Array<{ position: number; top: Array<Record<string, unknown>>; primaryHeroId: number | null }> = body.positions ?? [];
    const withCards = columns.filter((column) => column.top.length > 0);
    const target = withCards.find((column) => column.position === human) ?? withCards[0];
    if (target !== undefined) {
      const card = target.top[0];
      const before = { evidenceStrength: card.evidenceStrength, isPrimary: card.isPrimary, decision: body.currentDecision };
      card.evidenceStrength = "STRONG";
      card.isPrimary = true;
      target.primaryHeroId = card.heroId as number;
      body.currentDecision = { ...body.currentDecision, recommendedPosition: target.position, recommendedHeroId: card.heroId, targetBasis: "STRATEGIC", reason: FIXTURE_REASON };
      records.push({ caseName: item.name, position: target.position, heroId: card.heroId as number, before, after: { evidenceStrength: "STRONG", isPrimary: true, targetBasis: "STRATEGIC" } });
    }
    await route.fulfill({ response, json: body });
  });
}

async function axeReport(page: Page, label: string) {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const violations = result.violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    nodes: violation.nodes.length,
    targets: violation.nodes.slice(0, 8).map((node) => node.target.join(" ")),
  }));
  return { label, violations, passes: result.passes.length, incomplete: result.incomplete.map((entry) => ({ id: entry.id, nodes: entry.nodes.length })) };
}

for (const item of PARTY_CASES) {
  test(`4A.2 · ${item.name} · UI con FIXTURE: razón estratégica, elegir ≠ analizar, axe`, async ({ page }) => {
    const records: PatchRecord[] = [];
    await page.setViewportSize({ width: 1600, height: 1000 });
    await installRecommendedFixture(page, item, records);
    await startDraft(page, item);
    const board = page.getByTestId("team-coach-board");
    await board.getByText("Selecciona un héroe para ver su análisis").waitFor();
    await expect.poll(() => board.locator("[data-card-key] button").count(), { timeout: 15_000 }).toBeGreaterThan(0).catch(() => undefined);
    await waitImages(page);
    await page.screenshot({ path: resolve(CAPTURES, `${item.name}-1-pagina-sin-seleccion.png`), fullPage: true });

    if ((await board.locator("[data-card-key] button").count()) === 0) {
      // Estado válido del contrato: el motor no tiene ningún héroe con fundamento. No se fabrica una tarjeta.
      save(`fixture-${item.name}.json`, { applicable: false, note: "El motor real devolvió 0 tarjetas; no hay candidato real que promover (ver engine-real-solo.json)." });
      return;
    }

    const recommended = board.locator('[data-recommended="true"] button').first();
    await expect(recommended).toHaveCount(1, { timeout: 30_000 });
    const pendingBefore = await page.getByTestId("pending-human-positions").textContent();

    // 1 · razón estratégica: aparece SOLO al abrir; separada de las razones del héroe.
    await expect(page.getByTestId("sl-decision")).toHaveCount(0);
    await recommended.click();
    const decision = board.getByTestId("sl-decision");
    await expect(decision).toBeVisible();
    await expect(decision).toHaveAttribute("data-decision", "same");
    await expect(board.getByTestId("sl-decision-reason")).toHaveText(FIXTURE_REASON);
    await waitImages(page);
    await board.screenshot({ path: resolve(CAPTURES, `${item.name}-2-razon-estrategica-visible.png`) });

    // 2 · abrir NO elige: ninguna posición se selló, ningún «Draft completo»; elegir exige el botón de la ronda.
    expect(await page.getByTestId("pending-human-positions").textContent()).toBe(pendingBefore);
    const pickAction = page.getByTestId("analyzed-pick-button");
    await expect(pickAction).toBeVisible();
    await expect(pickAction).toBeEnabled();
    await page.screenshot({ path: resolve(CAPTURES, `${item.name}-3-recomendado-mas-analisis-mas-elegir.png`), fullPage: true });

    // 3 · otro candidato: la decisión se atribuye al recomendado, no al abierto.
    const others = board.locator('[data-card-key]:not([data-recommended="true"]) button');
    let otherChecked = "sin otra tarjeta para abrir";
    if ((await others.count()) > 0) {
      await others.first().click();
      await expect(decision).toHaveAttribute("data-decision", "other");
      await expect(decision).toContainText("Esta decisión es sobre");
      await expect(recommended).toHaveAttribute("data-state", "recommended");
      await expect(recommended).not.toHaveAttribute("aria-pressed", "true");
      await board.screenshot({ path: resolve(CAPTURES, `${item.name}-4-otro-candidato-decision-atribuida.png`) });
      otherChecked = "ok";
    }

    // 4 · axe sobre la PÁGINA COMPLETA, con el análisis abierto y la acción de elegir visible. Cero violaciones A/AA detectables.
    if ((await recommended.getAttribute("aria-pressed")) !== "true") await recommended.click();
    await expect(pickAction).toBeVisible();
    const axe = await axeReport(page, `${item.name} · fixture · análisis + elegir`);
    save(`axe-fixture-${item.name}.json`, axe);
    expect(axe.violations, JSON.stringify(axe.violations)).toEqual([]);

    // 5 · elegir con el botón de la ronda: el estado de la ronda se sincroniza (la posición sale de las pendientes).
    await pickAction.click();
    await expect(page.getByTestId("pending-human-positions")).not.toHaveText(pendingBefore ?? "", { timeout: 30_000 });
    save(`fixture-${item.name}.json`, { fixture: true, note: "Respuesta real del motor con UNA tarjeta real promovida; V6 intacto.", patches: records, otherCandidate: otherChecked, pendingBefore, pendingAfter: await page.getByTestId("pending-human-positions").textContent() });
  });
}

// ---------- B1 · encabezado Light, axe y reflow: motor real, sin parche ----------
async function reflowReport(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).split(" ")[0] : ""} "${(el.textContent ?? "").trim().slice(0, 20)}" right=${Math.round(el.getBoundingClientRect().right)}`;
    const wide = [...document.body.querySelectorAll("*")].filter((el) => el.getBoundingClientRect().right > limit + 1 && getComputedStyle(el).position !== "fixed");
    const transfer = document.querySelector<HTMLElement>(".sl-transfer");
    const before = document.documentElement.scrollWidth;
    if (transfer) transfer.style.display = "none";
    const withoutTransfer = document.documentElement.scrollWidth;
    if (transfer) transfer.style.display = "";
    return {
      clientWidth: limit,
      pageScrollWidth: before,
      pageScrollsHorizontally: before > limit + 1,
      scrollWidthWithoutDecorativeOverlay: withoutTransfer,
      overflowCount: wide.length,
      overflowSamples: wide.slice(0, 8).map(describe),
    };
  });
}

for (const item of PARTY_CASES) {
  test(`4A.2 · ${item.name} · encabezado Light, axe y reflow (motor real)`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startDraft(page, item);
    const board = page.getByTestId("team-coach-board");
    await waitImages(page);

    // Encabezado: la franja del draft y el banner de ronda leen los MISMOS tokens Light que el tablero (no el tema oscuro del sitio).
    const paint = (selector: string) => page.evaluate((query) => {
      const el = document.querySelector(query);
      if (el === null) return null;
      const css = getComputedStyle(el);
      return { background: css.backgroundColor, color: css.color, fontFamily: css.fontFamily.split(",")[0] };
    }, selector);
    const header = {
      page: await paint("body"),
      strip: await paint('[data-testid="draft-sticky-strip"] .sl-light'),
      compactBoard: await paint('[data-testid="draft-sticky-strip"] .sl-light > div'),
      timer: await paint('[data-testid="draft-sticky-strip"] .tabular-nums'),
      roundBanner: await paint('[data-testid="round-instruction"]'),
      lightBlock: await paint('[data-testid="team-coach-board"] ~ *, .sl-light'),
    };
    save(`encabezado-${item.name}.json`, header);
    const stripBox = await page.getByTestId("draft-sticky-strip").boundingBox();
    expect(stripBox?.height ?? 9999, "la franja fija no debe medir una pantalla (min-height heredado de .r3-page)").toBeLessThan(260);
    const lightBg = header.strip?.background;
    expect(lightBg, "la franja del draft debe pintarse con el fondo Light, no con el oscuro del sitio").toBe("rgb(242, 237, 229)");
    expect(header.compactBoard?.background, "CompactBoard sobre el panel Light").toBe("rgb(251, 248, 242)");
    expect(header.roundBanner?.background, "banner de ronda sobre el panel Light").toBe("rgb(251, 248, 242)");
    await page.screenshot({ path: resolve(CAPTURES, `${item.name}-5-encabezado-light.png`), clip: { x: 0, y: 0, width: 1600, height: 640 } });

    // axe, página completa, candidato abierto (si hay tarjetas).
    const cards = board.locator("[data-card-key] button");
    if ((await cards.count()) > 0) await cards.first().click();
    await waitImages(page);
    const axe = await axeReport(page, `${item.name} · motor real`);
    save(`axe-${item.name}.json`, axe);
    expect(axe.violations, JSON.stringify(axe.violations)).toEqual([]);

    // Reflow, PÁGINA COMPLETA: 200 % (640 CSS px) y 400 % (320 CSS px) de un viewport de 1280.
    const reflow: Record<string, unknown> = {};
    for (const width of [1600, 1280, 640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      const report = await reflowReport(page);
      reflow[String(width)] = report;
      await page.screenshot({ path: resolve(CAPTURES, `${item.name}-6-pagina-completa-${width}.png`), fullPage: true });
      if (width <= 640) expect(report.pageScrollsHorizontally, `scroll horizontal a ${width}px: ${report.overflowSamples.join(" | ")}`).toBe(false);
    }
    save(`reflow-${item.name}.json`, reflow);
  });
}

test("4A.2 · reflow de la configuración previa al draft (NavBar global) a 640 y 320", async ({ page }) => {
  const reflow: Record<string, unknown> = {};
  for (const width of [1280, 640, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/simulator");
    await page.getByRole("button", { name: "Iniciar Draft" }).waitFor({ timeout: 60_000 });
    const report = await reflowReport(page);
    reflow[String(width)] = report;
    await page.screenshot({ path: resolve(CAPTURES, `config-pagina-completa-${width}.png`), fullPage: true });
    if (width <= 640) expect(report.pageScrollsHorizontally, `scroll horizontal a ${width}px: ${report.overflowSamples.join(" | ")}`).toBe(false);
  }
  save("reflow-config.json", reflow);
  const axe = await axeReport(page, "configuración previa al draft");
  save("axe-config.json", axe);
  expect(axe.violations, JSON.stringify(axe.violations)).toEqual([]);
});

// ---------- B2 · MOTOR REAL: un draft completo jugado por la UI, sin ningún page.route ----------
interface BoardSample {
  atMs: number;
  columns: Array<{ position: number; state: string; cards: number; strong: number; weak: number; primaryHeroId: number | null }>;
  decision: { recommendedPosition: number | null; recommendedHeroId: number | null; targetBasis: string | null; reason: string };
}

async function pickOnce(page: Page, board: Locator): Promise<string> {
  const cards = board.locator("[data-card-key] button");
  if ((await cards.count()) > 0) {
    const target = (await board.locator('[data-recommended="true"] button').count()) > 0 ? board.locator('[data-recommended="true"] button').first() : cards.first();
    await target.click({ timeout: 5_000 }).catch(() => undefined);
    const action = page.getByTestId("analyzed-pick-button");
    if (await action.isVisible().catch(() => false)) {
      await action.click({ timeout: 5_000 }).catch(() => undefined);
      return "analizar+elegir";
    }
    await target.click({ timeout: 5_000 }).catch(() => undefined);
  }
  const search = page.getByTestId("other-hero-search");
  if (!(await search.isVisible().catch(() => false))) return "sin-accion";
  if (!(await search.evaluate((node) => (node as HTMLDetailsElement).open).catch(() => true))) await search.locator("summary").click({ timeout: 5_000 }).catch(() => undefined);
  await search.locator("button:not([disabled])").first().click({ timeout: 5_000 }).catch(() => undefined);
  return "buscador";
}

for (const item of PARTY_CASES) {
  test(`4A.2 · ${item.name} · MOTOR REAL: draft completo, ¿hay STRONG / ELIGE AHORA / candidatos?`, async ({ page }) => {
    test.setTimeout(420_000);
    const samples: BoardSample[] = [];
    const started = Date.now();
    page.on("response", async (response) => {
      if (!/team-recommendations/.test(response.url()) || response.request().method() === "OPTIONS") return;
      const body = await response.json().catch(() => null);
      if (body === null || !Array.isArray(body.positions)) return;
      samples.push({
        atMs: Date.now() - started,
        columns: body.positions.map((column: { position: number; state: string; top: Array<{ evidenceStrength: string }>; primaryHeroId: number | null }) => ({
          position: column.position,
          state: column.state,
          cards: column.top.length,
          strong: column.top.filter((card) => card.evidenceStrength === "STRONG").length,
          weak: column.top.filter((card) => card.evidenceStrength === "WEAK").length,
          primaryHeroId: column.primaryHeroId,
        })),
        decision: { recommendedPosition: body.currentDecision?.recommendedPosition ?? null, recommendedHeroId: body.currentDecision?.recommendedHeroId ?? null, targetBasis: body.currentDecision?.targetBasis ?? null, reason: body.currentDecision?.reason ?? "" },
      });
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await startDraft(page, item);
    const board = page.getByTestId("team-coach-board");
    const rounds: Array<{ round: string; cards: number; recommendedCards: number; picker: string }> = [];
    let captured = false;
    for (let attempt = 0; attempt < 90; attempt += 1) {
      if (await page.getByText("Draft completo").isVisible()) break;
      const round = (await page.getByTestId("round-capacity").textContent({ timeout: 1_500 }).catch(() => null)) ?? "?";
      const cardsNow = await board.locator("[data-card-key] button").count();
      const recommendedNow = await board.locator('[data-recommended="true"] button').count();
      if (recommendedNow > 0 && !captured) {
        const rec = board.locator('[data-recommended="true"] button').first();
        await rec.click({ timeout: 5_000 }).catch(() => undefined);
        await waitImages(page);
        await page.screenshot({ path: resolve(CAPTURES, `${item.name}-7-MOTOR-REAL-elige-ahora.png`), fullPage: true });
        await rec.click({ timeout: 5_000 }).catch(() => undefined);
        captured = true;
      }
      const picker = await pickOnce(page, board);
      if (rounds.length === 0 || rounds[rounds.length - 1].round !== round) rounds.push({ round, cards: cardsNow, recommendedCards: recommendedNow, picker });
      await page.waitForTimeout(500);
    }
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 120_000 });
    const withStrong = samples.filter((sample) => sample.columns.some((column) => column.strong > 0));
    const withRecommendation = samples.filter((sample) => sample.decision.recommendedHeroId !== null);
    const withAnyCard = samples.filter((sample) => sample.columns.some((column) => column.cards > 0));
    save(`engine-real-${item.name}.json`, {
      evidenceLevel: "MOTOR REAL (sin page.route, sin fixture, V6 intacto)",
      responses: samples.length,
      responsesWithAnyCard: withAnyCard.length,
      responsesWithStrongCard: withStrong.length,
      responsesWithRecommendation: withRecommendation.length,
      eligeAhoraCapturedFromRealEngine: captured,
      rounds,
      firstSamples: samples.slice(0, 3),
      strongSamples: withStrong.slice(0, 5),
      recommendationSamples: withRecommendation.slice(0, 5),
      allColumnStates: [...new Set(samples.flatMap((sample) => sample.columns.map((column) => column.state)))],
      maxCardsInAnyColumn: Math.max(0, ...samples.flatMap((sample) => sample.columns.map((column) => column.cards))),
    });
  });
}
