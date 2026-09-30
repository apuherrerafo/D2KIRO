import { expect, test, type Page } from "@playwright/test";

async function heroNamesIn(page: Page, testId: string): Promise<string[]> {
  const rows = page.locator(`[data-testid="${testId}"]`);
  const names: string[] = [];
  for (let i = 0; i < await rows.count(); i++) names.push(...(await rows.nth(i).locator("span").allInnerTexts()));
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

// AP Ranked Roles V1 / Wave 1: the Player picks a side and a personal position, then controls all
// five own-team selections through the real browser flow (bans -> R1 -> R2 -> R3 -> complete).
async function playFullDraft(page: Page, side: "Radiant" | "Dire", position: string): Promise<void> {
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
  await expect(page.getByTestId("round-capacity")).toHaveText(/Ronda 1 · 2 espacios de pick disponibles/, { timeout: 60_000 });
  await expect(page.getByTestId("pending-human-positions")).toHaveText("Posiciones humanas pendientes: Pos1 Pos2 Pos3 Pos4 Pos5");
  await expect(page.getByText(/elegí 5 héroes/)).toHaveCount(0);
  await expect(page.getByTestId("resolved-bans")).toBeVisible();
  await expect(page.getByTestId("current-decision-panel")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("current-decision-target")).toHaveCount(1);
  await expect(page.getByTestId("current-decision-candidates")).toHaveCount(1);
  await expect(page.getByTestId("coach-personal-hero-view")).toHaveCount(0);
  await expect(page.getByText(/AHORA$/)).toHaveCount(0);
  await expect(page.getByTestId("round-recommendation-columns")).toHaveCount(0);
  await expect(page.getByTestId("coach-panel")).toHaveCount(0);
  // COHERENCE-013 / PSR-002 in the real browser: with no navigation the highlighted position is the viewed one AND the recommendation.
  await expect(page.getByTestId("current-decision-viewed")).toHaveCount(0);
  const target = await page.getByTestId("current-decision-target").getAttribute("data-target-position");
  const targetButton = page.getByRole("group", { name: "Posición para el próximo pick" }).getByRole("button", { name: new RegExp(`Pos${target} `) });
  await expect(targetButton).toHaveClass(/border-accent-primary/);

  // Any hero at any time: the first selectable hero, repeatedly, until the draft completes. A pick
  // that collides with the (hidden) enemy pick is handled by the engine: ban + repick.
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await page.getByText("Draft completo").isVisible()) break;
    const hero = page.locator("button[title]:not([disabled])").first();
    if (await hero.isVisible().catch(() => false)) await hero.click().catch(() => undefined);
    await page.waitForTimeout(500);
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 90_000 });
  const own = await heroNamesIn(page, "summary-user-picks");
  const enemy = await heroNamesIn(page, "summary-bot-picks");
  expect(own).toHaveLength(5);
  expect(enemy).toHaveLength(5);
  expect(new Set([...own, ...enemy]).size).toBe(10);
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
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

async function decisionHeroIds(page: Page): Promise<string[]> {
  return page.locator('[data-testid="current-decision-card"], [data-testid="current-decision-alternative"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-hero-id") ?? ""));
}

// Product Semantics Recovery -- Party5 visual acceptance contract, after the first pick (not Pos1):
// the binding appears, round capacity decreases, the target recomputes among the remaining four
// positions, the previous cards disappear, and no allied bot acts.
test("Party5: primer pick manual (no Pos1) -> binding, capacidad 1, objetivo recalculado entre las 4 restantes, sin cartas viejas", async ({ page }) => {
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeDisabled({ timeout: 60_000 });
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();
  await startButton.click();

  await expect(page.getByTestId("round-capacity")).toHaveAttribute("data-round-capacity", "2", { timeout: 60_000 });
  const target = page.getByTestId("current-decision-target");
  await expect(target).toBeVisible({ timeout: 60_000 });
  const firstTarget = Number(await target.getAttribute("data-target-position"));
  const chosen = firstTarget === 5 ? 4 : 5; // deliberately not Pos1, and a navigation away from the Coach's recommendation

  // Selector navigation (PSR-002). OLD_ASSERTION: the banner's data-target-position became `chosen`.
  // WHY_OBSOLETE: that conflated "the Coach recommends" with "the Player is inspecting".
  // NEW_PRODUCT_CONTRACT: navigation moves only the VIEWED position; the recommendation is untouched.
  const selector = page.getByRole("group", { name: "Posición para el próximo pick" });
  await selector.getByRole("button", { name: new RegExp(`Pos${chosen} `) }).click();
  const viewed = page.getByTestId("current-decision-viewed");
  await expect(viewed).toHaveAttribute("data-viewed-position", String(chosen), { timeout: 30_000 });
  await expect(viewed).toContainText(`Estás viendo Pos${chosen}`);
  await expect(page.getByTestId("current-decision-coach-suggests")).toContainText(`Coach sugiere Pos${firstTarget}`);
  await expect(target).toHaveAttribute("data-target-position", String(firstTarget)); // recommendation did not move
  await expect(page.getByTestId("current-decision-candidates")).toContainText(`Pos${chosen} `);
  const cardsBefore = await decisionHeroIds(page);

  await page.locator("button[title]:not([disabled])").first().click();

  await expect(page.getByTestId("round-capacity")).toHaveAttribute("data-round-capacity", "1", { timeout: 30_000 });
  await expect(page.getByTestId("pending-human-positions")).not.toContainText(`Pos${chosen}`);
  await expect(target).toBeVisible({ timeout: 30_000 });
  const nextTarget = Number(await target.getAttribute("data-target-position"));
  expect(nextTarget).not.toBe(chosen);
  expect([1, 2, 3, 4, 5].filter((position) => position !== chosen)).toContain(nextTarget);
  const cardsAfter = await decisionHeroIds(page);
  // The previous (Pos`chosen`) card set is gone: a new target owns the list now. A flex hero may
  // legitimately be credible at both positions, so the check is on the set, not on each hero.
  expect(cardsAfter).not.toEqual(cardsBefore);
  await expect(page.getByTestId("current-decision-viewed")).toHaveCount(0); // a real pick resets navigation to the recomputed recommendation
  await expect(page.getByText("ALLY BOT", { exact: true })).toHaveCount(0); // Party5: no allied bot exists to act
});
