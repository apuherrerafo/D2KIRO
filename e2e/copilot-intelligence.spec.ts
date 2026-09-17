import { expect, test, type Response } from "@playwright/test";

const FORBIDDEN_SUBSTRINGS = ["NOT_COMPUTED", "undefined", "[object Object]", "NaN"];

function isRecommendations(response: Response): boolean {
  return response.request().method() === "GET" && /\/api\/session\/protocol\/[^/]+\/recommendations$/.test(new URL(response.url()).pathname);
}

test("el Copilot muestra el RecommendationSet/v2 Top6 Mid real sin sentinels", async ({ page }) => {
  await page.goto("/simulator");
  const recommendationResponse = page.waitForResponse((response) => isRecommendations(response) && response.status() === 200);
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  await expect(startButton).toBeEnabled({ timeout: 60_000 });
  await startButton.click();

  await expect(page.getByText(/Tu pick Mid/)).toBeVisible({ timeout: 60_000 });
  const recommendation = await recommendationResponse.then((response) => response.json()) as {
    schema: string;
    decision: { actionCount: number };
    recommendations: Array<{ actions: unknown[] }>;
  };
  expect(recommendation.schema).toBe("recommendation-set/v2");
  expect(recommendation.decision.actionCount).toBe(1);
  expect(recommendation.recommendations).toHaveLength(6);
  expect(recommendation.recommendations.every((entry) => entry.actions.length === 1)).toBe(true);

  const panel = page.locator('[data-testid="copilot-panel"]');
  await expect(panel).toBeVisible();
  const text = await panel.innerText();
  expect(text.length).toBeGreaterThan(0);
  for (const forbidden of FORBIDDEN_SUBSTRINGS) expect(text).not.toContain(forbidden);
});
