import { expect, test, type Response } from "@playwright/test";

const FORBIDDEN_SUBSTRINGS = ["NOT_COMPUTED", "undefined", "[object Object]", "NaN"];

function isRecommendations(response: Response): boolean {
  return response.request().method() === "GET" && /\/api\/session\/protocol\/[^/]+\/recommendations$/.test(new URL(response.url()).pathname);
}

test("el Copilot muestra la CurrentHumanDecision V4 real de la ronda 1 (2 espacios, 5 posiciones), sin sentinels", async ({ page }) => {
  await page.goto("/simulator");
  const recommendationResponse = page.waitForResponse((response) => isRecommendations(response) && response.status() === 200);
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Dire", exact: true }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: /Offlane/ }).click();
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeEnabled({ timeout: 60_000 });
  await startButton.click();

  await expect(page.getByText(/Ronda 1 · 2 espacios de pick disponibles/)).toBeVisible({ timeout: 60_000 });
  const rawBody = (await recommendationResponse.then((response) => response.json())) as Record<string, any>;
  // Product Semantics Recovery: the Simulator reads ONLY the V4 CurrentHumanDecision -- no V2 set on the wire next to it.
  expect(Object.keys(rawBody)).toEqual(["output"]);
  const output = rawBody.output as { schema: string; decision: { kind: string; actionablePositions: number[]; roundCapacity: number; targetPosition: number; viewedPosition: number; candidates: { state: string; targetPosition: number } } };
  expect(output.schema).toBe("recommendation-output/v4");
  expect(output.decision.kind).toBe("ACTIONABLE");
  expect(output.decision.actionablePositions).toEqual([1, 2, 3, 4, 5]);
  expect(output.decision.roundCapacity).toBe(2);
  // OLD_ASSERTION: candidates.targetPosition === decision.targetPosition (la lista de candidatos era la de la posicion recomendada).
  // WHY_OBSOLETE: PSR-002 (0c4b10f) separo la recomendacion del Coach (`targetPosition`) de la posicion que el Player mira
  //   (`viewedPosition`); TSK-251 (d3f3266) hizo que la vista inicial sea la posicion PERSONAL, no la sugerida.
  // NEW_PRODUCT_CONTRACT: los candidatos pertenecen siempre a la posicion VISTA; la recomendacion es una posicion abierta del Player.
  expect(output.decision.candidates.targetPosition).toBe(output.decision.viewedPosition);
  expect(output.decision.actionablePositions).toContain(output.decision.targetPosition);
  expect(output.decision.actionablePositions).toContain(output.decision.viewedPosition);
  // Sin navegacion, el Player abre en su propia posicion (Offlane = Pos3) mientras sea elegible.
  expect(output.decision.viewedPosition).toBe(3);
  expect(["RANKED", "UNRANKED_POSITIONAL", "UNAVAILABLE"]).toContain(output.decision.candidates.state);

  const panel = page.locator('[data-testid="copilot-panel"]');
  await expect(panel).toBeVisible();
  const text = await panel.innerText();
  expect(text.length).toBeGreaterThan(0);
  for (const forbidden of FORBIDDEN_SUBSTRINGS) expect(text).not.toContain(forbidden);
});
