import { expect, test } from "@playwright/test";

// La beta privada expone un único modo: Ranked All Pick. No hay selector de modos y Captains Mode no se puede alcanzar desde la pantalla.
test("la beta privada muestra Ranked All Pick y no permite entrar a Captains Mode", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByTestId("mode-tab-ranked-all-pick")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("Simulador de draft").first()).toBeVisible();

  await expect(page.getByRole("button", { name: "Captains Mode", exact: true })).toHaveCount(0);
  await expect(page.getByText("Configurar Captain's Mode")).toHaveCount(0);
});
