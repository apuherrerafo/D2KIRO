import { expect, type Locator, type Page } from "@playwright/test";
import { heroSearch, recorderOf } from "./wave1";

// MIGRACIÓN Canonical Light (P0 recuperación de certificación).
// OLD_ASSERTION: la decisión actual se leía de un panel propio (`current-decision-panel/-target/-viewed/-card/-candidates`) y de sus atributos
//   `data-decision-kind|trigger|revision|state-identity`, dentro del Copilot.
// WHY_OBSOLETE: el commit 6b0bb3d2 eliminó el Copilot duplicado: el tablero (`team-coach-board`) es el ÚNICO lugar de la recomendación humana.
//   Esos testids ya no existen en el DOM; probarlos solo puede fallar, y un `not.toContainText` sobre ellos pasaría en vacío.
// NEW_PRODUCT_CONTRACT: (1) lo que el jugador VE son las tarjetas del tablero: `[data-card-key]` por columna de posición, la recomendada marcada
//   `data-recommended="true"`, y `sl-column-empty` cuando una columna no tiene ningún héroe con fundamento; (2) lo que el MOTOR respondió
//   (`kind`, `trigger`, `revision`, `stateIdentity`) se lee de la respuesta V4 REAL que el navegador recibió (el Recorder), no de un atributo
//   decorativo -- es la misma frontera que ya usan las demás pruebas de wave1/wave2. Ninguna garantía se elimina: cada una se re-expresa aquí.
// Contrato de elegibilidad (dueño del producto, 2026-11-03/04): "no hay recomendaciones" es un estado válido; "el simulador está roto" sigue siendo:
//   el draft no avanza, o una tarjeta ilegal/sin fundamento aparece.

export interface DecisionSnapshot {
  kind: string;
  trigger: string;
  revision: number;
  identity: string;
  viewedPosition: number | null;
  targetPosition: number | null;
  /** Hero ids the engine offered in this answer (ranked cards or, when unranked, positional alternatives). */
  offered: number[];
}

interface V4Wire {
  schema?: string;
  decision?: {
    kind?: string;
    viewedPosition?: number;
    targetPosition?: number;
    candidates?: { cards?: { heroId: number }[]; alternatives?: { heroId: number }[] };
  };
  meta?: { revision?: number; trigger?: string; basedOn?: { stateIdentity?: string } };
}

export function boardOf(page: Page): Locator {
  return page.getByTestId("team-coach-board");
}

/** El tablero real, con al menos una columna de posición pintada. */
export async function waitForBoard(page: Page): Promise<void> {
  await expect(boardOf(page)).toBeVisible({ timeout: 60_000 });
  await expect(boardOf(page).locator("[data-testid^='team-coach-column-']").first()).toBeVisible({ timeout: 60_000 });
}

/** La última respuesta V4 (200) que el navegador recibió de `GET .../recommendations`, o null si todavía no llegó ninguna. */
export function latestDecision(page: Page): DecisionSnapshot | null {
  const answers = recorderOf(page).responses.filter((entry) => entry.status === 200 && entry.method === "GET" && entry.path.endsWith("/recommendations"));
  for (let index = answers.length - 1; index >= 0; index -= 1) {
    const output = (answers[index]!.body as { output?: V4Wire | null } | null)?.output;
    if (output?.schema !== "recommendation-output/v4" || !output.decision || !output.meta) continue;
    const { candidates } = output.decision;
    return {
      kind: output.decision.kind ?? "",
      trigger: output.meta.trigger ?? "",
      revision: output.meta.revision ?? -1,
      identity: output.meta.basedOn?.stateIdentity ?? "",
      viewedPosition: output.decision.viewedPosition ?? null,
      targetPosition: output.decision.targetPosition ?? null,
      offered: (candidates?.cards ?? candidates?.alternatives ?? []).map((candidate) => candidate.heroId),
    };
  }
  return null;
}

/** Espera la respuesta V4 cuyo `trigger` es el pedido (p. ej. OWN_PICK_CONFIRMED tras un pick propio) y la devuelve. */
export async function waitForDecisionTrigger(page: Page, trigger: string, timeout = 30_000): Promise<DecisionSnapshot> {
  await expect.poll(() => latestDecision(page)?.trigger ?? null, { timeout, message: `V4 decision with trigger ${trigger}` }).toBe(trigger);
  return latestDecision(page)!;
}

/** Ids de héroe de las tarjetas visibles del tablero (ranking general + "Más de tu pool"), sin repetir y en orden de pantalla. */
export async function decisionCardIds(page: Page): Promise<number[]> {
  const ids = await boardOf(page).locator("[data-card-key]").evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id"))));
  return [...new Set(ids)];
}

/** Héroes que el tablero marca como recomendados (`data-recommended="true"`): vacío cuando el Coach no tiene ninguna recomendación con fundamento. */
export async function recommendedHeroIds(page: Page): Promise<number[]> {
  return boardOf(page).locator('[data-card-key][data-recommended="true"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id"))));
}

/** Texto anunciado de la recomendación ("" si no hay): los ids recomendados, estable entre corridas con la misma semilla. */
export async function announcedTargetLabel(page: Page): Promise<string> {
  return (await recommendedHeroIds(page)).join(",");
}

/**
 * Contrato de la recomendación visible, el sustituto del antiguo `assertTargetContract`:
 *   - como mucho UNA tarjeta recomendada en todo el tablero (una acción principal, nunca dos);
 *   - la recomendada siempre es legal: ni baneada ni ya elegida (propia o rival revelada) según el último estado que el servidor mandó;
 *   - lo mismo para todo lo que el motor ofreció en la decisión V4 y para toda tarjeta pintada;
 *   - "Estás viendo / Coach sugiere" ya no existe como aviso: la posición vista es la columna abierta y la recomendación vive en su tarjeta.
 * Devuelve los ids recomendados (vacío = sin recomendación, estado válido).
 */
export async function assertRecommendationContract(page: Page): Promise<number[]> {
  const recommended = await recommendedHeroIds(page);
  expect(recommended.length, "una sola tarjeta recomendada en el tablero").toBeLessThanOrEqual(1);
  const snapshot = recorderOf(page).snapshots().at(-1);
  if (snapshot) {
    const taken = new Set<number>(snapshot.view.bannedHeroes);
    for (const slot of [...snapshot.view.ownPicks, ...snapshot.view.enemyPicks]) if (slot.heroId !== undefined) taken.add(slot.heroId);
    const shown = await decisionCardIds(page);
    for (const heroId of [...recommended, ...shown]) expect(taken.has(heroId), `la tarjeta ${heroId} es ilegal (baneada o ya elegida)`).toBe(false);
    for (const heroId of latestDecision(page)?.offered ?? []) expect(taken.has(heroId), `el motor ofreció ${heroId} (baneado o ya elegido)`).toBe(false);
  }
  return recommended;
}

/**
 * Un pick legal cualquiera: la tarjeta del tablero si la hay; si el Coach no tiene NINGUNA recomendación (ningún héroe con fundamento), el camino
 * manual "Buscar otro héroe" -- sigue siendo un pick legal y el draft debe poder terminar así.
 * Abrir una tarjeta (o un resultado del buscador) solo abre el análisis: elegir es el botón «Elegir a X» de ese análisis.
 */
export async function pickAnyAvailableHero(page: Page): Promise<void> {
  const card = boardOf(page).locator("[data-card-key] button:not([disabled])").first();
  if (await card.isVisible().catch(() => false)) {
    await card.click().catch(() => undefined);
  } else {
    const search = heroSearch(page);
    if (!(await search.isVisible().catch(() => false))) return;
    await search.locator(".sl-picker-row:not([disabled])").first().click({ timeout: 5_000 }).catch(() => undefined);
  }
  await page.getByTestId("analyzed-pick-button").click({ timeout: 5_000 }).catch(() => undefined);
}
