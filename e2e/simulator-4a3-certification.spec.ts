import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { expect, test } from "./support/failure-evidence";
import type { Page } from "@playwright/test";

// Fase 4A.3 · Solo y Party 2 — escenarios deterministas de bans curados, procesados por el MOTOR REAL (V6, pesos y datasets intactos).
// Cada escenario es una ENTRADA DEL PRODUCTO (semilla del draft + «Tu Personal_Ban_List»), jugada por la UI. No hay page.route sobre la respuesta
// salvo donde el nombre del caso dice «FIXTURE de interfaz». Los escenarios se identifican como PRUEBA en la evidencia.
const webRequire = createRequire(resolve(process.cwd(), "apps/web/package.json"));
const AxeBuilder = (webRequire("@axe-core/playwright") as { AxeBuilder?: unknown }).AxeBuilder as typeof import("@axe-core/playwright").AxeBuilder;
const OUT = resolve(process.cwd(), "docs/research/phase-4a3");
const CAPTURES = resolve(OUT, "captures");
mkdirSync(CAPTURES, { recursive: true });
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

function save(name: string, data: unknown) {
  writeFileSync(resolve(OUT, name), JSON.stringify(data, null, 2));
}

async function waitImages(page: Page) {
  await page.waitForFunction(() => [...document.querySelectorAll("img")].every((img) => img.complete), undefined, { timeout: 20_000 }).catch(() => undefined);
}

interface Scenario {
  id: string;
  kind: "STRONG" | "WEAK" | "CERO";
  size: 1 | 2;
  positions: string[];
  personal: string;
  humanPosition: number;
  seed: string;
  banNames: string[];
  /** Héroe que el motor real debe recomendar (solo en los STRONG). */
  expectedHero?: string;
}

const SCENARIOS: Scenario[] = [
  { id: "solo-strong", kind: "STRONG", size: 1, positions: [], personal: "Posición 2 — Midlane", humanPosition: 2, seed: "CURATED1", banNames: ["Anti-Mage", "Nyx Assassin", "Riki", "Disruptor"], expectedHero: "Leshrac" },
  { id: "party2-strong", kind: "STRONG", size: 2, positions: ["Posición 2 — Midlane", "Posición 5 — Hard support"], personal: "Posición 5 — Hard support", humanPosition: 5, seed: "CURATED3", banNames: ["Doom", "Ancient Apparition", "Shadow Demon", "Troll Warlord"], expectedHero: "Oracle" },
  { id: "solo-weak", kind: "WEAK", size: 1, positions: [], personal: "Posición 2 — Midlane", humanPosition: 2, seed: "SCAN0005", banNames: [] },
  { id: "party2-weak", kind: "WEAK", size: 2, positions: ["Posición 2 — Midlane", "Posición 5 — Hard support"], personal: "Posición 5 — Hard support", humanPosition: 5, seed: "SCAN0000", banNames: [] },
  { id: "solo-cero", kind: "CERO", size: 1, positions: [], personal: "Posición 2 — Midlane", humanPosition: 2, seed: "SCAN0000", banNames: [] },
];

interface BoardSnapshot {
  positions: Array<{ position: number; state: string; primaryHeroId: number | null; top: Array<Record<string, unknown>> }>;
  currentDecision: Record<string, unknown>;
}

async function configureAndStart(page: Page, item: Scenario) {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: item.size === 1 ? "Solo (1)" : `Party ${item.size}` }).click();
  for (const pos of item.positions) await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: pos }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: item.personal }).click();
  await page.locator('input[maxlength="8"]').fill(item.seed);
  for (const name of item.banNames) {
    await page.getByRole("button", { name: "Agregar héroe" }).click();
    await page.getByRole("dialog").locator(`button[title="${name}"]`).click();
  }
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  await expect(page.getByTestId("resolved-bans")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("team-coach-board").locator("[data-testid^='team-coach-column-']").first()).toBeVisible({ timeout: 60_000 });
}

function latestBoard(boards: BoardSnapshot[]): BoardSnapshot {
  const last = boards[boards.length - 1];
  if (last === undefined) throw new Error("el motor no respondió ningún tablero");
  return last;
}

for (const item of SCENARIOS) {
  test(`4A.3 · ${item.id} · ${item.kind} · motor real con bans curados`, async ({ page }) => {
    test.setTimeout(240_000);
    const boards: BoardSnapshot[] = [];
    page.on("response", async (response) => {
      if (!/team-recommendations/.test(response.url()) || response.request().method() === "OPTIONS") return;
      const body = await response.json().catch(() => null);
      if (body !== null && Array.isArray(body.positions)) boards.push(body as BoardSnapshot);
    });
    await page.setViewportSize({ width: 1600, height: 1000 });
    await configureAndStart(page, item);
    const board = page.getByTestId("team-coach-board");
    await expect.poll(() => boards.length, { timeout: 30_000 }).toBeGreaterThan(0);
    await waitImages(page);
    const resolvedBans = ((await page.getByTestId("resolved-bans").innerText()) ?? "").replace(/\s+/g, " ").trim();
    const real = latestBoard(boards);
    const humanColumn = real.positions.find((column) => column.position === item.humanPosition);
    const cards = real.positions.flatMap((column) => column.top.map((card) => ({ position: column.position, heroId: card.heroId, evidenceStrength: card.evidenceStrength, isPrimary: card.isPrimary, rationale: card.rationale ?? null, reasons: card.reasons ?? null })));
    const strong = cards.filter((card) => card.evidenceStrength === "STRONG");
    const recommendedNow = await board.locator('[data-recommended="true"] button').count();

    const record: Record<string, unknown> = {
      evidenceLevel: "MOTOR REAL (V6 intacto) · ESCENARIO DE PRUEBA con entradas curadas (semilla + Personal_Ban_List); sin page.route",
      scenario: { id: item.id, kind: item.kind, size: item.size, humanPosition: item.humanPosition, seed: item.seed, nominatedBans: item.banNames },
      resolvedBansText: resolvedBans,
      engineResponses: boards.length,
      columns: real.positions.map((column) => ({ position: column.position, state: column.state, cards: column.top.length, primaryHeroId: column.primaryHeroId })),
      cards,
      currentDecision: real.currentDecision,
      uiRecommendedCards: recommendedNow,
    };

    if (item.kind === "STRONG") {
      expect(strong.length, "el motor real debe devolver al menos una tarjeta STRONG").toBeGreaterThan(0);
      expect(humanColumn?.primaryHeroId, "la recomendación cae en la columna del jugador").not.toBeNull();
      expect(recommendedNow).toBeGreaterThan(0);
      const rec = board.locator('[data-recommended="true"]').first();
      await expect(rec).toContainText(item.expectedHero ?? "");
      await expect(board).toContainText("ELIGE AHORA");
      await page.screenshot({ path: resolve(CAPTURES, `${item.id}-1-elige-ahora-pagina-completa.png`), fullPage: true });
      // Analizar ≠ elegir: abrir el análisis no cambia la ronda.
      const pendingBefore = await page.getByTestId("pending-human-positions").innerText().catch(() => "");
      await rec.locator("button").first().click();
      await expect(page.getByTestId("sl-decision")).toBeVisible();
      const pendingAfter = await page.getByTestId("pending-human-positions").innerText().catch(() => "");
      expect(pendingAfter).toBe(pendingBefore);
      await waitImages(page);
      record.analysisPanel = {
        decisionAttr: await page.getByTestId("sl-decision").getAttribute("data-decision"),
        decisionText: (await page.getByTestId("sl-decision").innerText()).replace(/\s+/g, " ").trim(),
        heroReasonsText: (await page.getByTestId("sl-hero-reasons").innerText().catch(() => "")).replace(/\s+/g, " ").trim(),
      };
      await page.screenshot({ path: resolve(CAPTURES, `${item.id}-2-analisis-razon.png`), fullPage: true });
      const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
      record.axe = { violations: axe.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })), incomplete: axe.incomplete.map((e) => ({ id: e.id, nodes: e.nodes.length })) };
      expect(axe.violations).toEqual([]);
      // Elegir el recomendado con SU posición (misma onLockPick que el resto del Simulador).
      const choose = page.getByTestId("analyzed-pick-button");
      await expect(choose).toBeVisible();
      await expect(choose).toContainText(item.expectedHero ?? "");
      await choose.click();
      // El pick quedó en SU posición: el héroe aparece en el roster propio (en Solo el draft termina solo y el tablero ya no existe).
      const seat = item.humanPosition === 2 ? "Pos2 Mid" : "Pos5 Hard Support";
      await expect.poll(async () => new RegExp(`${seat}\\s+${item.expectedHero}\\b`).test(await page.locator("body").innerText()), { timeout: 30_000, message: `${item.expectedHero} debe quedar en ${seat} del roster` }).toBe(true);
      record.pickedRecommended = item.expectedHero;
    }

    if (item.kind === "WEAK") {
      expect(strong.length, "este escenario debe ser WEAK: ninguna tarjeta STRONG").toBe(0);
      expect(cards.length).toBeGreaterThan(0);
      expect(recommendedNow, "WEAK nunca es acción principal").toBe(0);
      await expect(board).not.toContainText("ELIGE AHORA");
      expect(real.currentDecision.recommendedHeroId ?? null).toBeNull();
      await page.screenshot({ path: resolve(CAPTURES, `${item.id}-1-weak-pagina-completa.png`), fullPage: true });
      await board.locator("[data-card-key] button").first().click();
      // Contrato 4A.2: con evidencia limitada NO hay decisión del equipo que mostrar (no se inventa una), pero la marca y las razones del héroe sí se dicen.
      await expect(page.locator(".sl-detail")).toContainText("Evidencia limitada");
      await expect(page.getByTestId("sl-decision")).toHaveCount(0);
      record.analysisPanel = { decisionSectionRendered: false, limitedEvidenceMark: true, heroReasonsShown: (await page.getByTestId("sl-hero-reasons").count()) > 0, detailText: (await page.locator(".sl-detail").innerText()).replace(/\s+/g, " ").trim() };
      await page.screenshot({ path: resolve(CAPTURES, `${item.id}-2-weak-analisis.png`), fullPage: true });
    }

    if (item.kind === "CERO") {
      expect(cards.length, "este escenario debe tener cero candidatos").toBe(0);
      expect(await board.locator("[data-card-key]").count()).toBe(0);
      await expect(board).not.toContainText("ELIGE AHORA");
      // Ninguna acción se pierde: el jugador sigue pudiendo elegir cualquier héroe disponible.
      await expect(page.getByTestId("sl-column-empty")).toContainText("Sin recomendaciones disponibles con la información actual");
      await expect(page.getByTestId("other-hero-search")).toBeVisible();
      record.otherHeroSearchVisible = true;
      await page.screenshot({ path: resolve(CAPTURES, `${item.id}-1-cero-candidatos-pagina-completa.png`), fullPage: true });
    }

    save(`scenario-${item.id}.json`, record);
  });
}

// ---------- WAITING: estado de interfaz con FIXTURE (el Simulador real no lo expone en el ritmo normal; se reescribe SOLO el estado de la columna) ----------
test("4A.3 · Party 2 · WAITING de interfaz (FIXTURE de interfaz, texto del motor)", async ({ page }) => {
  test.setTimeout(180_000);
  const WAITING_NOTE = "Sin acción humana en este momento: se recalcula cuando se abra la próxima ronda.";
  await page.route("**/team-recommendations", async (route) => {
    const response = await route.fetch().catch(() => null);
    const body = response === null ? null : await response.json().catch(() => null);
    if (response === null || body === null) {
      await route.abort().catch(() => undefined);
      return;
    }
    const columns: Array<Record<string, unknown>> = body.positions ?? [];
    const other = columns.find((column) => column.position === 2);
    if (other !== undefined) Object.assign(other, { state: "WAITING", top: [], poolTop: [], primaryHeroId: null, note: WAITING_NOTE });
    await route.fulfill({ response, json: body });
  });
  const item = SCENARIOS[1];
  await page.setViewportSize({ width: 1600, height: 1000 });
  await configureAndStart(page, { ...item, id: "party2-waiting", kind: "WEAK", seed: "SCAN0000", banNames: [] });
  const column = page.getByTestId("team-coach-column-2");
  await expect(column).toHaveAttribute("data-state", "WAITING");
  await expect(column).toContainText(WAITING_NOTE);
  await expect(column.locator("[data-card-key]")).toHaveCount(0);
  await expect(page.getByTestId("team-coach-board")).not.toContainText("ELIGE AHORA");
  await waitImages(page);
  await page.screenshot({ path: resolve(CAPTURES, "party2-waiting-1-fixture-interfaz.png"), fullPage: true });
  save("scenario-party2-waiting.json", { evidenceLevel: "FIXTURE de interfaz: el estado WAITING lo escribe la prueba sobre una respuesta real; el texto es el del motor", note: WAITING_NOTE });
});
