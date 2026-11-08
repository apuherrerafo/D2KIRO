import { expect, type Page } from "@playwright/test";
import { heroSearch } from "./wave1";

// Contrato de elegibilidad (dueño del producto, 2026-11-03/04) en el navegador. Una recomendación solo existe con un fundamento verificable, así que:
//   - el panel de decisión puede NO tener ninguna tarjeta (y entonces no pinta ni la sección de candidatos);
//   - el objetivo (`current-decision-target`) ya no se anuncia como "vista por defecto": solo como "Objetivo recomendado" cuando hay `primaryRecommendation`
//     (un héroe STRONG; P0-03B, independiente de `targetBasis`) o como "Única posición pendiente" (información, no consejo);
//   - el aviso "Estás viendo X / Coach sugiere Y" existe SOLO cuando hay recomendación y la posición vista es otra.
// "No hay recomendaciones" es un estado válido del simulador; "el simulador está roto" sigue siendo: el draft no avanza, o una tarjeta ilegal/sin
// fundamento aparece. Estos helpers dejan que las pruebas acepten lo primero sin perder ninguna verificación de picks, bans, legalidad o cierre.

/** El texto del objetivo anunciado, o "" cuando el Coach no anuncia ninguno (sin base estratégica). */
export async function announcedTargetLabel(page: Page): Promise<string> {
  const target = page.getByTestId("current-decision-target");
  if ((await target.count()) === 0) return "";
  return (await target.innerText()).trim();
}

export interface TargetContract {
  /** Posición del objetivo anunciado, o null si el Coach no anuncia ninguno. */
  position: number | null;
  basis: string | null;
  /** true SOLO cuando el motor manda `primaryRecommendation` (un héroe STRONG detrás): "Objetivo recomendado". "Única posición pendiente" NO es consejo. */
  recommended: boolean;
}

/**
 * Verifica la coherencia del encabezado de objetivo y del aviso "Estás viendo X / Coach sugiere Y" con la posición en vista (`viewedPosition`).
 * Contrato P0-03B: la RECOMENDACIÓN es `primaryRecommendation` (un héroe con evidencia STRONG), distinta de la PRIORIDAD entre posiciones (`targetBasis`,
 * que puede ser DETERMINISTIC_DEFAULT y aun así haber un héroe STRONG que recomendar). Por eso:
 *   - "Objetivo recomendado" existe SOLO con recomendación, y entonces el tablero nombra a un héroe STRONG en esa misma posición (candidato `data-primary`
 *     sin la marca "Evidencia limitada");
 *   - "Única posición pendiente" es información, nunca consejo: sin aviso ni "Coach sugiere";
 *   - el aviso aparece SI Y SOLO SI hay recomendación y la vista es otra posición. `targetBasis` no decide nada de esto.
 */
export async function assertTargetContract(page: Page, viewedPosition: number): Promise<TargetContract> {
  const target = page.getByTestId("current-decision-target");
  const notice = page.getByTestId("current-decision-viewed");
  const suggests = page.getByTestId("current-decision-coach-suggests");
  if ((await target.count()) === 0) {
    await expect(notice).toHaveCount(0);
    await expect(suggests).toHaveCount(0);
    return { position: null, basis: null, recommended: false };
  }
  const position = Number(await target.getAttribute("data-target-position"));
  const basis = await target.getAttribute("data-target-basis");
  expect([1, 2, 3, 4, 5]).toContain(position);
  const text = (await target.innerText()).trim();
  const recommended = text.includes("Objetivo recomendado");
  if (!recommended) {
    // Sin recomendación solo cabe el aviso informativo de una única posición pendiente; nunca un consejo ("Coach sugiere") ni un aviso de navegación.
    expect(text).toContain("Única posición pendiente");
    const pending = page.getByTestId("pending-human-positions");
    if ((await pending.count()) > 0) expect(((await pending.innerText()).match(/Pos\d/g) ?? []).length).toBe(1);
    await expect(notice).toHaveCount(0);
    await expect(suggests).toHaveCount(0);
    return { position, basis, recommended: false };
  }
  // Una recomendación visible está respaldada por STRONG: el tablero (misma política de objetivo) destaca como plan a un héroe de esa posición, y un
  // candidato de evidencia limitada nunca es plan.
  const planned = page.getByTestId(`team-coach-column-${position}`).locator('[data-testid="team-coach-candidate"][data-primary="true"]');
  await expect(planned).toHaveCount(1);
  await expect(planned.locator('[data-testid="evidence-limited-mark"]')).toHaveCount(0);
  if (position !== viewedPosition) {
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute("data-viewed-position", String(viewedPosition));
    await expect(suggests).toContainText(`Coach sugiere Pos${position}`);
  } else {
    await expect(notice).toHaveCount(0);
  }
  return { position, basis, recommended: true };
}

/** Las tarjetas de la decisión actual y su sección: la sección existe SI Y SOLO SI hay tarjetas (nunca un marco vacío). */
export async function decisionCardIds(page: Page): Promise<number[]> {
  const ids = await page.locator('[data-testid="current-decision-card"], [data-testid="current-decision-alternative"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id"))));
  await expect(page.getByTestId("current-decision-candidates")).toHaveCount(ids.length > 0 ? 1 : 0);
  return ids;
}

/**
 * Un pick legal cualquiera: la tarjeta recomendada si la hay; si el Coach no tiene NINGUNA recomendación (ningún héroe con fundamento), el camino
 * manual "Buscar otro héroe" -- sigue siendo un pick legal y el draft debe poder terminar así.
 */
export async function pickAnyAvailableHero(page: Page): Promise<void> {
  const recommended = page.locator("button[title]:not([disabled])").first();
  if (await recommended.isVisible().catch(() => false)) {
    await recommended.click().catch(() => undefined);
    return;
  }
  const search = heroSearch(page);
  if (!(await search.isVisible().catch(() => false))) return;
  if (!(await search.evaluate((node) => (node as HTMLDetailsElement).open).catch(() => true))) await search.locator("summary").click().catch(() => undefined);
  await search.locator("button:not([disabled])").first().click().catch(() => undefined);
}
