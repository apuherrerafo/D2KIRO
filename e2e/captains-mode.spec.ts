import { expect, test } from "@playwright/test";

test("Captain's Mode no se ofrece en la recovery build AP Solo Mid", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByText("Ranked All Pick", { exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Captain's Mode" })).toHaveCount(0);
  await expect(page.getByText("Configurar Captain's Mode")).toHaveCount(0);
});
