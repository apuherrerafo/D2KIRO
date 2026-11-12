import type { Page } from "@playwright/test";
import { expect, test } from "./support/failure-evidence";
import { assertRecommendationContract, boardOf, decisionCardIds, latestDecision, pickAnyAvailableHero, recommendedHeroIds, waitForBoard, waitForDecisionTrigger } from "./support/decision";
import { record } from "./support/wave1";

async function heroNamesIn(page: Page, testId: string): Promise<string[]> {
  const rows = page.locator(`[data-testid="${testId}"]`);
  const names: string[] = [];
  for (let i = 0; i < await rows.count(); i++) names.push(...(await rows.nth(i).locator("span").allInnerTexts()));
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

// AP Ranked Roles V1 / Wave 1: the Player picks a side and a personal position, then controls all
// five own-team selections through the real browser flow (bans -> R1 -> R2 -> R3 -> complete).
// Contrato de elegibilidad (2026-11-03/04): "no hay recomendaciones" es un estado válido y NO es "el simulador está roto". Este modo lo fuerza de forma
// determinista (el motor responde, pero sin ninguna tarjeta ni héroe recomendado en la decisión V4 ni en el tablero) para probar que la pantalla no se
// rompe, no inventa héroes ni mensajes, y que el draft se completa igual por el camino manual con las mismas verificaciones de picks, bans y legalidad.
async function answerWithoutAnyRecommendation(page: Page): Promise<() => { decision: number; board: number }> {
  let decisionRewrites = 0;
  let boardRewrites = 0;
  await page.route(/\/recommendations\?format=v4/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.output?.decision?.candidates) {
      body.output.decision.candidates.cards = [];
      body.output.decision.candidates.poolCards = [];
      decisionRewrites += 1;
    }
    await route.fulfill({ response, json: body });
  });
  await page.route(/\/team-recommendations/, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    if (body?.currentDecision) Object.assign(body.currentDecision, { recommendedPosition: null, recommendedHeroId: null, reason: "" });
    for (const column of body?.positions ?? []) Object.assign(column, { top: [], poolTop: [], primaryHeroId: null });
    body.goldenCard = null;
    boardRewrites += 1;
    await route.fulfill({ response, json: body });
  });
  return () => ({ decision: decisionRewrites, board: boardRewrites });
}

async function playFullDraft(page: Page, side: "Radiant" | "Dire", position: string, options: { withoutAnyRecommendation?: boolean } = {}): Promise<void> {
  const rewrittenResponses = options.withoutAnyRecommendation ? await answerWithoutAnyRecommendation(page) : () => ({ decision: 0, board: 0 });
  record(page);
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  // Neither side nor position is preselected: starting is impossible until both are chosen.
  await expect(startButton).toBeDisabled({ timeout: 60_000 });
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: side, exact: true }).click();
  await expect(startButton).toBeDisabled();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: position }).click();
  await expect(startButton).toBeEnabled();
  await startButton.click();

  // Product Semantics Recovery -- Party5 Round 1 visual acceptance contract: 2 pick slots available,
  // 5 human positions pending, ONE current decision (one target line, one candidate section), no
  // "elegí 5 héroes" quota, no "TU <POS> AHORA" personal panel, no legacy V2 body under the Coach.
  await expect(page.getByTestId("round-capacity")).toHaveText(/Ronda 1 de 3 · Elige 2 héroes/, { timeout: 60_000 });
  await expect(page.getByTestId("pending-human-positions")).toHaveText("Posiciones humanas pendientes: Pos1 Pos2 Pos3 Pos4 Pos5");
  await expect(page.getByText(/elige 5 héroes/)).toHaveCount(0);
  await expect(page.getByTestId("resolved-bans")).toBeVisible();
  // MIGRADO (Canonical Light): el Copilot con `current-decision-panel` ya no existe; el tablero real es el único dueño visual y el motor respondió su V4.
  await waitForBoard(page);
  await expect.poll(() => latestDecision(page)?.kind ?? null, { timeout: 60_000 }).toBe("ACTIONABLE");
  // Contrato de elegibilidad: puede no haber NINGUNA tarjeta (ningun heroe con fundamento).
  const openingCards = await decisionCardIds(page);
  if (options.withoutAnyRecommendation) {
    expect(openingCards).toEqual([]);
    expect(await recommendedHeroIds(page)).toEqual([]); // no recommended hero is invented
    await expect(page.getByRole("button", { name: /^Elige a / })).toHaveCount(0);
    await expect(page.getByText(/ELIGE AHORA/)).toHaveCount(0);
    // Cada columna lo dice en llano (nunca un marco vacío ni una tarjeta inventada).
    expect(await boardOf(page).getByTestId("sl-column-empty").count()).toBeGreaterThan(0);
  }
  await expect(page.getByTestId("coach-personal-hero-view")).toHaveCount(0);
  await expect(page.getByText(/^TU .+ AHORA$/)).toHaveCount(0);
  await expect(page.getByTestId("round-recommendation-columns")).toHaveCount(0);
  await expect(page.getByTestId("coach-panel")).toHaveCount(0);
  await expect(page.getByTestId("copilot-panel")).toHaveCount(0); // el Copilot duplicado no reaparece
  await expect(page.getByTestId("current-decision-panel")).toHaveCount(0);
  // COHERENCE-013 / PSR-002 / TSK-251 in the real browser.
  // OLD_ASSERTION: with no navigation `current-decision-viewed` never renders (viewed === recommended) and the
  //   highlighted position is the recommended one.
  // WHY_OBSOLETE: TSK-251 (d3f3266) made the FIRST view the Player's own position, while the Coach may recommend
  //   another open one (Party5 opening habit); "Estas viendo PosN · Coach sugiere PosM" is the explicit notice.
  // NEW_PRODUCT_CONTRACT: without navigation the viewed position is the Player's personal one; the notice renders
  //   IFF viewed != recommended; the selector highlights the VIEWED position (BlindRoundPanel `selectedTarget`);
  //   the recommendation is an open position and never moves with the view.
  const personal = position.match(/\d/)?.[0] ?? "";
  // The recommendation header exists only with a `primaryRecommendation` (a STRONG hero, P0-03B -- not tied to `targetBasis`): the notice is checked against it, never assumed.
  await assertRecommendationContract(page);
  // La vista inicial es la posición PERSONAL (TSK-251): lo dice la respuesta V4 real y la columna de esa posición está en pantalla.
  expect(latestDecision(page)?.viewedPosition).toBe(Number(personal));
  await expect(boardOf(page).getByTestId(`team-coach-column-${personal}`)).toBeVisible();
  const viewedButton = page.getByRole("group", { name: "Posición para el próximo pick" }).getByRole("button", { name: new RegExp(`Pos${personal} `) });
  await expect(viewedButton).toHaveAttribute("aria-pressed", "true");

  // Any hero at any time: the first selectable hero (or, when the Coach has no recommendation at all, the manual search), repeatedly, until the
  // draft completes. A pick that collides with the (hidden) enemy pick is handled by the engine: ban + repick.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await page.getByText("Draft completo").isVisible()) break;
    await pickAnyAvailableHero(page);
    await page.waitForTimeout(500);
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 90_000 });
  const own = await heroNamesIn(page, "summary-user-picks");
  const enemy = await heroNamesIn(page, "summary-bot-picks");
  expect(own).toHaveLength(5);
  expect(enemy).toHaveLength(5);
  expect(new Set([...own, ...enemy]).size).toBe(10);
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
  if (options.withoutAnyRecommendation) {
    // Both interceptions really served answers (neither can be silently broken while the other makes the count pass).
    expect(rewrittenResponses().decision, "decision (V4) answers served with zero cards").toBeGreaterThan(2);
    expect(rewrittenResponses().board, "board answers served with every column empty").toBeGreaterThan(2);
  }
}

test("AP Ranked Roles: Radiant + Midlane completa 5+5 con los 5 picks del Player", async ({ page }) => {
  await playFullDraft(page, "Radiant", "Posición 2 — Midlane");
});

test("AP Ranked Roles: Dire + Carry completa 5+5 con los 5 picks del Player", async ({ page }) => {
  await playFullDraft(page, "Dire", "Posición 1 — Carry");
});

test("AP Ranked Roles: Dire + Hard support (posición al final) completa 5+5", async ({ page }) => {
  await playFullDraft(page, "Dire", "Posición 5 — Hard support");
});

test("AP Ranked Roles: sin NINGUNA recomendación el simulador no se rompe y el draft se completa 5+5 por la búsqueda manual", async ({ page }) => {
  await playFullDraft(page, "Radiant", "Posición 2 — Midlane", { withoutAnyRecommendation: true });
});

// Product Semantics Recovery -- Party5 visual acceptance contract, after the first pick (not Pos1):
// the binding appears, round capacity decreases, the target recomputes among the remaining four
// positions, the previous cards disappear, and no allied bot acts.
test("Party5: primer pick manual (no Pos1) -> binding, capacidad 1, objetivo recalculado entre las 4 restantes, sin cartas viejas", async ({ page }) => {
  record(page);
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeDisabled({ timeout: 60_000 });
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();
  await startButton.click();

  await expect(page.getByTestId("round-capacity")).toHaveAttribute("data-round-capacity", "2", { timeout: 60_000 });
  await waitForBoard(page);
  await expect.poll(() => latestDecision(page)?.kind ?? null, { timeout: 60_000 }).toBe("ACTIONABLE");
  // The opening view is the Player's own position (Pos2); the recommendation (when any) is a marked card of the board.
  const recommendedOpening = await assertRecommendationContract(page);
  expect(latestDecision(page)?.viewedPosition).toBe(2);
  const firstTarget = latestDecision(page)!.targetPosition;
  const chosen = firstTarget === 5 ? 4 : 5; // deliberately not Pos1, and a navigation away from the Coach's recommendation

  // Selector navigation (PSR-002). OLD_ASSERTION: the banner's data-target-position became `chosen`.
  // WHY_OBSOLETE: that conflated "the Coach recommends" with "the Player is inspecting".
  // NEW_PRODUCT_CONTRACT: navigation moves only the VIEWED position (the selector highlights it); a recommendation, when the Coach announces one,
  //   is untouched and restated by the "Estás viendo X / Coach sugiere Y" notice; with no announced recommendation there is no such notice.
  const selector = page.getByRole("group", { name: "Posición para el próximo pick" });
  // The viewed position is refetched with `&target=chosen`: wait for THAT answer before reading anything, so the checks below cannot read the previous decision.
  const navigated = page.waitForResponse((response) => new RegExp(`recommendations\\?format=v4&target=${chosen}\\b`).test(response.url()), { timeout: 30_000 });
  await selector.getByRole("button", { name: new RegExp(`Pos${chosen} `) }).click();
  await navigated;
  await expect(selector.getByRole("button", { name: new RegExp(`Pos${chosen} `) })).toHaveAttribute("aria-pressed", "true", { timeout: 30_000 });
  expect(await assertRecommendationContract(page)).toEqual(recommendedOpening); // the recommendation (or its absence) did not move with the view
  const afterNavigation = latestDecision(page)!;
  expect(afterNavigation.targetPosition).toBe(firstTarget);
  expect(afterNavigation.viewedPosition).toBe(chosen); // the engine answered for the position the Player is inspecting
  const cardsBefore = afterNavigation.offered;

  // TSK-237: a hero from the "Buscar otro héroe" search, never the Team Coach candidate cards (the
  // first of those is the Pos1 recommendation, which would consume Pos1 instead of the viewed Pos).
  // The full 127-hero grid no longer exists: the search is the manual path.
  const manualSearch = page.getByTestId("other-hero-search");
  await manualSearch.locator(".sl-picker-row:not([disabled])").first().click();
  await page.getByTestId("analyzed-pick-button").click();

  await expect(page.getByTestId("round-capacity")).toHaveAttribute("data-round-capacity", "1", { timeout: 30_000 });
  await expect(page.getByTestId("pending-human-positions")).not.toContainText(`Pos${chosen}`);
  // The pick recomputes the decision (`OWN_PICK_CONFIRMED`): read the cards only after that answer replaced the previous one.
  const afterPickDecision = await waitForDecisionTrigger(page, "OWN_PICK_CONFIRMED");
  const cardsAfter = afterPickDecision.offered;
  // The previous (Pos`chosen`) card set is gone: a new view owns the list now. A flex hero may legitimately be credible at both positions, so the
  // check is on the set, not on each hero. (With no recommendation before there is nothing stale to show; the section must simply not be an empty frame.)
  if (cardsBefore.length > 0) expect(cardsAfter).not.toEqual(cardsBefore);
  // OLD_ASSERTION: after a real pick `current-decision-viewed` is absent (navigation resets to the recomputed recommendation).
  // WHY_OBSOLETE: TSK-251 (d3f3266) -- the reset view is the Player's OWN position (Pos2) while it is open, not the recommendation.
  // NEW_PRODUCT_CONTRACT: a real pick drops the manual navigation (the viewed position is no longer `chosen`); the view returns to the
  //   Player's personal position, and the "viewing X / Coach suggests Y" notice renders IFF that differs from the recomputed recommendation.
  const personalAfter = 2; // chosen is 4 or 5, so the personal Midlane stays open
  await assertRecommendationContract(page);
  expect(afterPickDecision.viewedPosition).toBe(personalAfter);
  expect(afterPickDecision.targetPosition).not.toBe(chosen); // the position consumed by the pick is never the recommendation again
  expect([1, 2, 3, 4, 5].filter((position) => position !== chosen)).toContain(afterPickDecision.targetPosition);
  await expect(page.getByText("ALLY BOT", { exact: true })).toHaveCount(0); // Party5: no allied bot exists to act
});
