import { expect, test } from "@playwright/test";

test("la beta privada muestra Ranked All Pick y no permite entrar a Captains Mode", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByText("Ranked All Pick — Ranked Roles")).toBeVisible({ timeout: 60_000 });

  await expect(page.getByRole("button", { name: "Ranked All Pick", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Captains Mode", exact: true })).toHaveCount(0);
  await expect(page.getByText("Configurar Captain's Mode")).toHaveCount(0);
});
