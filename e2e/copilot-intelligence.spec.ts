import { expect, test, type Response } from "@playwright/test";

const FORBIDDEN_SUBSTRINGS = ["NOT_COMPUTED", "undefined", "[object Object]", "NaN"];

function isRecommendations(response: Response): boolean {
  return response.request().method() === "GET" && /\/api\/session\/protocol\/[^/]+\/recommendations$/.test(new URL(response.url()).pathname);
}

test("el Copilot muestra el RecommendationSet/v2 de la ronda 1 (2 asientos) real, sin sentinels", async ({ page }) => {
  await page.goto("/simulator");
  const recommendationResponse = page.waitForResponse((response) => isRecommendations(response) && response.status() === 200);
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Dire", exact: true }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: /Offlane/ }).click();
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeEnabled({ timeout: 60_000 });
  await startButton.click();

  await expect(page.getByText(/Ronda 1 -- elegí 2 héroes/)).toBeVisible({ timeout: 60_000 });
  const rawBody = (await recommendationResponse.then((response) => response.json())) as Record<string, any>;
  if ("output" in rawBody && rawBody.output !== null) {
    expect(rawBody.output.schema).toBe("recommendation-output/v3");
  }
  const recommendation = (rawBody.recommendationSet ?? rawBody) as {
    schema: string;
    decision: { actionCount: number; actor: string };
    recommendations: Array<{ actions: unknown[] }>;
  };
  expect(recommendation.schema).toBe("recommendation-set/v2");
  expect(recommendation.decision.actor).toBe("dire");
  expect(recommendation.decision.actionCount).toBe(2);
  expect(recommendation.recommendations.length).toBeGreaterThan(0);
  expect(recommendation.recommendations.every((entry) => entry.actions.length === 2)).toBe(true);

  const panel = page.locator('[data-testid="copilot-panel"]');
  await expect(panel).toBeVisible();
  const text = await panel.innerText();
  expect(text.length).toBeGreaterThan(0);
  for (const forbidden of FORBIDDEN_SUBSTRINGS) expect(text).not.toContain(forbidden);
});
