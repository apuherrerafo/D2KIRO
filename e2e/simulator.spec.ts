import { expect, test, type Page } from "@playwright/test";

async function heroNamesIn(page: Page, testId: string): Promise<string[]> {
  const rows = page.locator(`[data-testid="${testId}"]`);
  const names: string[] = [];
  for (let i = 0; i < await rows.count(); i++) names.push(...(await rows.nth(i).locator("span").allInnerTexts()));
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

test("AP Solo Mid: un click humano y nueve picks externos completan 5+5 sin repetidos", async ({ page }) => {
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeEnabled({ timeout: 60_000 });
  await startButton.click();

  await expect(page.getByText(/Tu pick Mid/)).toBeVisible({ timeout: 60_000 });
  const hero = page.locator("button[title]:not([disabled])").first();
  await expect(hero).toBeVisible({ timeout: 60_000 });
  await hero.click();

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });
  const radiant = await heroNamesIn(page, "summary-user-picks");
  const dire = await heroNamesIn(page, "summary-bot-picks");
  expect(radiant).toHaveLength(5);
  expect(dire).toHaveLength(5);
  expect(new Set([...radiant, ...dire]).size).toBe(10);
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
});
