import { expect, type Page } from "@playwright/test";
import { heroSearch } from "./wave1";

// Contrato de elegibilidad (dueño del producto, 2026-11-03/04) en el navegador. Una recomendación solo existe con un fundamento verificable, así que:
//   - el panel de decisión puede NO tener ninguna tarjeta (y entonces no pinta ni la sección de candidatos);
//   - el objetivo (`current-decision-target`) ya no se anuncia como "vista por defecto": solo con base STRATEGIC (o con una única posición pendiente);
//   - el aviso "Estás viendo X / Coach sugiere Y" existe SOLO cuando hay un objetivo STRATEGIC distinto de la posición vista.
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
}

/**
 * Verifica la coherencia del encabezado de objetivo y del aviso "Estás viendo X" con la posición en vista (`viewedPosition`):
 * sin objetivo anunciado no hay aviso ni "Coach sugiere"; con objetivo, el aviso aparece SI Y SOLO SI la base es STRATEGIC y la vista es otra posición.
 */
export async function assertTargetContract(page: Page, viewedPosition: number): Promise<TargetContract> {
  const target = page.getByTestId("current-decision-target");
  const notice = page.getByTestId("current-decision-viewed");
  const suggests = page.getByTestId("current-decision-coach-suggests");
  if ((await target.count()) === 0) {
    await expect(notice).toHaveCount(0);
    await expect(suggests).toHaveCount(0);
    return { position: null, basis: null };
  }
  const position = Number(await target.getAttribute("data-target-position"));
  const basis = await target.getAttribute("data-target-basis");
  expect([1, 2, 3, 4, 5]).toContain(position);
  if (basis === "STRATEGIC" && position !== viewedPosition) {
    await expect(notice).toHaveCount(1);
    await expect(notice).toHaveAttribute("data-viewed-position", String(viewedPosition));
    await expect(suggests).toContainText(`Coach sugiere Pos${position}`);
  } else {
    await expect(notice).toHaveCount(0);
  }
  // A default (non-STRATEGIC) view is only announced when there is nothing to choose between ("Única posición pendiente"): never as an opening hint among several.
  if (basis !== "STRATEGIC") {
    const pending = page.getByTestId("pending-human-positions");
    if ((await pending.count()) > 0) expect(((await pending.innerText()).match(/Pos\d/g) ?? []).length).toBe(1);
  }
  return { position, basis };
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
