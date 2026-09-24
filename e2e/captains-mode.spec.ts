import { expect, test } from "@playwright/test";

test("Captain's Mode está disponible en /simulator vía selector de modo", async ({ page }) => {
  await page.goto("/simulator");
  await expect(page.getByText("Ranked All Pick — Ranked Roles")).toBeVisible({ timeout: 60_000 });

  // Selector de modo muestra Ranked All Pick y Captains Mode
  const cmTab = page.getByRole("button", { name: "Captains Mode", exact: true });
  await expect(cmTab).toBeVisible();

  // Cambiar a Captains Mode
  await cmTab.click();
  await expect(page.getByText("Configurar Captain's Mode")).toBeVisible();
  await expect(page.getByRole("button", { name: "Iniciar Captain's Mode" })).toBeVisible();

  // Cambiar de regreso a Ranked All Pick
  const apTab = page.getByRole("button", { name: "Ranked All Pick", exact: true });
  await apTab.click();
  await expect(page.getByText("Ranked All Pick — Ranked Roles")).toBeVisible();
});

test("Captain's Mode inicia y permite realizar acciones de ban en el simulador", async ({ page }) => {
  await page.goto("/simulator");
  const cmTab = page.getByRole("button", { name: "Captains Mode", exact: true });
  await cmTab.click();

  const startBtn = page.getByRole("button", { name: "Iniciar Captain's Mode" });
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  // Paso 1: Tu turno: Ban (Radiant first pick, radiant localSide)
  await expect(page.getByText(/Paso 1 — tu turno: Ban/i)).toBeVisible({ timeout: 30_000 });

  // Ban Anti-Mage
  const amBtn = page.getByRole("button", { name: "Anti-Mage Anti-Mage" });
  await expect(amBtn).toBeVisible();
  await amBtn.click();

  // El bot responde y luego avanza el turno (Paso 1 ya no está visible)
  await expect(page.getByText(/Paso 1 — tu turno/i)).not.toBeVisible({ timeout: 30_000 });
});
