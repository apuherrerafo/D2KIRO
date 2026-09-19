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

  await expect(page.getByText(/Ronda 1 -- elegí 2 héroes/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("resolved-bans")).toBeVisible();

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
