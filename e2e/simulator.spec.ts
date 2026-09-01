import { expect, test, type Page } from "@playwright/test";

// TSK-217: el smoke que faltaba. Reproduce el draft exacto que el usuario corrió en Railway el
// 2026-08-30 — el que devolvió Wraith King en las 3 rondas con el tablero congelado — y falla si
// vuelve a pasar. Ningún test del proyecto abría la app hasta ahora: el harness de Fase 9 mide el
// motor offline, así que el bug vivió semanas en la capa de transporte sin que nada lo viera.

const ROUND_PICKS = [2, 2, 1]; // BLIND_ROUND_SPECS: Ranked All Pick 7.35d-7.37

// Los nombres visibles de los héroes salen del <span> que renderiza DraftHeroSlot.
async function heroNamesIn(page: Page, testId: string): Promise<string[]> {
  const rows = page.locator(`[data-testid="${testId}"]`);
  const names: string[] = [];
  for (let i = 0; i < await rows.count(); i++) {
    names.push(...(await rows.nth(i).locator("span").allInnerTexts()));
  }
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

// Espera SEMÁNTICA, no un timeout a ciegas: entre ronda y ronda el simulador revela los picks,
// emite sus eventos al motor y hace una pausa de revelación. Esperar el encabezado de la ronda
// que toca es lo que hace la prueba estable — una espera fija se rompe en cuanto el motor tarda
// un poco más (medido: falló con 20 s justo al entrar a la ronda 3, con el draft perfectamente
// sano en 4+4 picks).
async function playRound(page: Page, round: number, picks: number): Promise<void> {
  await expect(page.getByText(new RegExp(`Ronda ${round}\\b`))).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < picks; i++) {
    // El grid de héroes seleccionables: botones habilitados con `title` = nombre del héroe.
    const hero = page.locator("button[title]:not([disabled])").first();
    await expect(hero).toBeVisible({ timeout: 60_000 });
    await hero.click();
  }
}

test("un draft completo de 3 rondas: el tablero avanza y nadie repite héroe", async ({ page }) => {
  await page.goto("/simulator");

  // El gate de auth es el real: si la cookie sellada no sirviera, esto terminaría en /login.
  // El panel de configuración sólo se renderiza con sesión válida.
  await expect(page.locator("#player-position")).toBeVisible({ timeout: 60_000 });
  expect(page.url()).toContain("/simulator");

  // La página se sirve renderizada desde el servidor: el <select> existe en el DOM antes de que
  // React lo hidrate, y un `change` disparado en esa ventana no llega a ningún handler. Se
  // reintenta hasta que el botón se habilita, que es la señal real de que el estado se aplicó.
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(async () => {
    await page.selectOption("#player-position", "1");
    await expect(startButton).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  await startButton.click();

  for (const [index, picksThisRound] of ROUND_PICKS.entries()) {
    await playRound(page, index + 1, picksThisRound);
  }

  // Fin del draft: el resumen aparece solo cuando la fase llega a `complete`. Si el tablero se
  // congela, nunca llega -- este `toBeVisible` es la primera red de seguridad.
  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });

  const userPicks = await heroNamesIn(page, "summary-user-picks");
  const botPicks = await heroNamesIn(page, "summary-bot-picks");

  // El síntoma exacto del bug reportado: el bot devolvía [WK, Spectre, WK, Spectre, WK].
  expect(botPicks).toHaveLength(5);
  expect(new Set(botPicks).size).toBe(5);

  expect(userPicks).toHaveLength(5);
  expect(new Set(userPicks).size).toBe(5);

  // Y ningún héroe puede estar en los dos lados a la vez.
  expect(new Set([...userPicks, ...botPicks]).size).toBe(10);

  // TSK-215: si el transporte hubiera fallado en algún punto, el banner estaría en pantalla y
  // cualquier conclusión sobre el draft sería inválida.
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
});
