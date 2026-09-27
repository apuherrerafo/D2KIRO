import { expect, test } from "./support/failure-evidence";

type RecommendationResponse = {
  recommendationSet: {
    decision: { controlledSlots: Array<{ position?: number | null }> };
    recommendations: Array<{ actions: Array<{ hero: number; slot: { position?: number | null } }> }>;
  };
  output: {
    primaryAction: { strategy: { kind: string; position?: number; heroId?: number } };
    shortlist: Array<{ heroId: number; position: number }>;
  } | null;
};

const POSITION_LABELS: Record<number, string> = { 1: "Carry", 2: "Midlane", 3: "Offlane", 4: "Support", 5: "Hard support" };

test("mobile semantic: Solo Pos2 preserves V2 personal and Coach team sources independently", async ({ page }) => {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Solo (1)" }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();

  const responsePromise = page.waitForResponse((response) => response.url().includes("/recommendations?format=v3") && response.status() === 200);
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  const body = await responsePromise.then((response) => response.json() as Promise<RecommendationResponse>);

  // V2 is the personal/controlled source: this must stay Pos2 even when Coach advises another team role.
  expect(body.recommendationSet.decision.controlledSlots.map((slot) => slot.position)).toEqual([2]);
  expect(body.recommendationSet.recommendations.flatMap((entry) => entry.actions).every((action) => action.slot.position === 2)).toBe(true);
  expect(body.output).not.toBeNull();
  const coach = body.output!;

  await expect(page.getByTestId("copilot-panel")).toBeVisible();
  await expect(page.getByTestId("coach-primary-action")).toHaveAttribute("data-strategy-kind", coach.primaryAction.strategy.kind);
  const cards = page.getByTestId("coach-hero-card");
  await expect(cards).toHaveCount(coach.shortlist.length);
  expect(await cards.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id"))))).toEqual(coach.shortlist.map((card) => card.heroId));

  // Coach cards are rendered from the team-level shortlist, never forced to equal V2's personal Pos2 list.
  for (const [index, card] of coach.shortlist.entries()) {
    await expect(cards.nth(index)).toHaveAttribute("data-hero-id", String(card.heroId));
    await expect(cards.nth(index)).toContainText(POSITION_LABELS[card.position]!);
  }
});
