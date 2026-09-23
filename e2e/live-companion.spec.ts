import { expect, test, type Page } from "@playwright/test";

// MVP P0.1 -- Live Companion. Smoke: a manual live-companion draft (bans confirmed with zero
// nominations -- a valid real-match scenario, see use-random-draft-session.live-companion.test.ts)
// reaches at least Ronda 2, entering BOTH "TU EQUIPO" and "ENEMIGO" picks by hand, with the Enemy
// Bot never in the loop (there is no auto-drive/bot-selection call this mode could even reach --
// see protocol-session.live-companion.test.ts, engine side).

// HeroPicker's own wrapping <div> holds only the search input and its results rows (a sibling of
// everything else in the panel) -- scoping to it means "the first enabled button in there" can
// only ever be a hero row, never "Confirmar"/"Corregir"/"TU EQUIPO"/"ENEMIGO"/"Quitar".
async function pickFirstAvailableHero(page: Page): Promise<void> {
  const searchBox = page.getByPlaceholder("Buscar héroe...");
  await searchBox.fill("a");
  await searchBox.locator("..").locator("button:not([disabled])").first().click();
  await page.getByRole("button", { name: "Confirmar" }).click();
}

test("Live Companion: un draft manual llega al menos a la Ronda 2 sin el Enemy Bot", async ({ page }) => {
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeDisabled({ timeout: 60_000 });

  await page.getByRole("group", { name: "Modo" }).getByRole("button", { name: "Live Companion" }).click();
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();
  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page.getByText("Bans observados")).toBeVisible({ timeout: 60_000 });
  // Cero bans nominados es un escenario real válido -- confirma directo, sin escribir ninguno.
  await page.getByRole("button", { name: "Confirmar bans y empezar Ronda 1" }).click();

  await expect(page.getByText(/Ronda 1 -- reportar pick observado/)).toBeVisible({ timeout: 30_000 });

  // Bounded guard, never an infinite loop: Ronda 1 needs at most 2 own + 2 enemy entries, so 6
  // attempts is generous headroom before the assertion below would fail anyway.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (await page.getByText(/Ronda 2 -- reportar pick observado/).isVisible()) break;
    const ownButton = page.getByRole("button", { name: "TU EQUIPO" });
    if (await ownButton.isEnabled().catch(() => false)) {
      await ownButton.click();
      await pickFirstAvailableHero(page);
    }
    const enemyButton = page.getByRole("button", { name: "ENEMIGO" });
    if (await enemyButton.isEnabled().catch(() => false)) {
      await enemyButton.click();
      await pickFirstAvailableHero(page);
    }
  }

  await expect(page.getByText(/Ronda 2 -- reportar pick observado/)).toBeVisible({ timeout: 30_000 });
  // Nunca se llamó al Enemy Bot: en Live Companion no existe ninguna ruta que lo invoque (403
  // estructural en el motor, ver protocol-session.live-companion.test.ts) -- este smoke prueba el
  // camino feliz del navegador real llegando hasta acá sin depender de ese bot en ningún momento.
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
});
