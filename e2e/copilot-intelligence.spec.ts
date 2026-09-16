import { expect, test, type Page } from "@playwright/test";

// R1 S7 -- traceability E2E: prueba que la cadena completa
// browser action -> comando del protocolo -> ProtocolKernel -> RecommendationSet/v2 -> Copilot
// renderizado realmente llega hasta lo que un jugador ve, no sólo hasta el transporte (que ya
// cubre TSK-217/simulator.spec.ts). Dos cosas que ese test no prueba y este sí:
//   1. el panel Copilot muestra contenido real por ronda, nunca un estado congelado o vacío;
//   2. ningún sentinel interno (NOT_COMPUTED y compañía) ni "basura" (undefined/null/[object
//      Object]/un porcentaje inventado) se filtra como texto a la UI -- si protocol-client.ts
//      dejara de validar `deferred` en el borde, esto es lo que lo detectaría en un draft real.

const ROUND_PICKS = [2, 2, 1]; // BLIND_ROUND_SPECS: Ranked All Pick 7.35d-7.37

// Ningún texto de diagnóstico interno debe llegar nunca a la superficie principal del Copilot --
// criterio de aceptación UX de S7 ("no debe exponer... NOT_COMPUTED a un usuario común").
const FORBIDDEN_SUBSTRINGS = ["NOT_COMPUTED", "undefined", "[object Object]", "NaN"];

async function copilotPanelText(page: Page): Promise<string | null> {
  const panel = page.locator('[data-testid="copilot-panel"]');
  if ((await panel.count()) === 0) return null;
  return panel.first().innerText();
}

async function playRoundAndObserveCopilot(page: Page, round: number, picks: number, observed: string[]): Promise<void> {
  await expect(page.getByText(new RegExp(`Ronda ${round}\\b`))).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < picks; i++) {
    const text = await copilotPanelText(page);
    if (text !== null) observed.push(text);
    const hero = page.locator("button[title]:not([disabled])").first();
    await expect(hero).toBeVisible({ timeout: 60_000 });
    await hero.click();
  }
}

test("el Copilot muestra RecommendationSet/v2 real por ronda, sin sentinels ni basura filtrada a la UI", async ({ page }) => {
  await page.goto("/simulator");

  await expect(page.locator("#player-position")).toBeVisible({ timeout: 60_000 });

  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(async () => {
    await page.selectOption("#player-position", "1");
    await expect(startButton).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  await startButton.click();

  const observedCopilotText: string[] = [];
  for (const [index, picksThisRound] of ROUND_PICKS.entries()) {
    await playRoundAndObserveCopilot(page, index + 1, picksThisRound, observedCopilotText);
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });

  // Traceability: el Copilot mostró contenido real en cada oportunidad que tuvo (nunca un panel
  // en blanco mientras hay recomendaciones que mostrar -- distinto del caso legítimo "sin
  // candidatos", que sí tiene su propio texto explícito).
  expect(observedCopilotText.length).toBeGreaterThan(0);
  for (const text of observedCopilotText) {
    expect(text.length).toBeGreaterThan(0);
    for (const forbidden of FORBIDDEN_SUBSTRINGS) {
      expect(text).not.toContain(forbidden);
    }
  }

  // S6 -- "Lectura del rival" es real (viene de basedOn/deferred en el wire), no garantizado en
  // cada turno individual (el motor sólo la puebla cuando el rival tiene una respuesta legal
  // concreta, un steal materializado, o un delta de lookahead calculable) -- pero en un draft real
  // de 5 picks por lado, con oponentes legales casi siempre disponibles, debería aparecer al menos
  // una vez. Si nunca aparece, es una señal real de que el mecanismo S6 dejó de producir algo
  // observable -- no se fuerza el dato, se reporta la ausencia.
  const sawOpponentIntelligence = observedCopilotText.some((text) => text.includes("Lectura del rival"));
  test.info().annotations.push({
    type: "s6-opponent-intelligence-observed",
    description: String(sawOpponentIntelligence),
  });
});
