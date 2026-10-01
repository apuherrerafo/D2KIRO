import { expect, test } from "./support/failure-evidence";

// OLD_ASSERTION: the response of `recommendations?format=v3` was waited for and its V2 `controlledSlots` + V3 `primaryAction` /
//   `shortlist` were compared to `coach-primary-action` / `coach-hero-card` in the DOM.
// WHY_OBSOLETE: the Simulator no longer requests or renders V2/V3 for a session with HumanActionability (WP3): the ONE
//   visual owner is the V4 CurrentHumanDecision (`current-decision-*`). The V3 request never happens, so the wait timed out.
// NEW_PRODUCT_CONTRACT: Solo Pos2 => ONE actionable position (Pos2), capacity 1, recommendation and view both Pos2, and every
//   card the DOM shows is the V4 candidate for Pos2, in the engine's order; no legacy V2/V3 surface renders next to it.
// NEW_ASSERTION: below.

type V4Response = {
  output: {
    decision: {
      kind: string;
      actionablePositions: number[];
      roundCapacity: number;
      targetPosition: number;
      viewedPosition: number;
      candidates: { state: string; targetPosition: number; cards?: Array<{ heroId: number; position: number }>; alternatives?: Array<{ heroId: number; position: number }> };
    };
  };
};

test("mobile semantic: Solo Pos2 renders the single V4 decision for Pos2, sourced from the engine's candidates", async ({ page }) => {
  await page.goto("/simulator");
  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Solo (1)" }).click();
  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();

  const responsePromise = page.waitForResponse((response) => response.url().includes("/recommendations?format=v4") && response.status() === 200);
  await page.getByRole("button", { name: "Iniciar Draft" }).click();
  const { output } = await responsePromise.then((response) => response.json() as Promise<V4Response>);
  const decision = output.decision;

  expect(decision.kind).toBe("ACTIONABLE");
  expect(decision.actionablePositions).toEqual([2]);
  expect(decision.roundCapacity).toBe(1);
  expect(decision.targetPosition).toBe(2);
  expect(decision.viewedPosition).toBe(2);
  const expected = decision.candidates.state === "RANKED" ? decision.candidates.cards! : decision.candidates.alternatives ?? [];
  expect(expected.length).toBeGreaterThan(0);
  expect(expected.every((candidate) => candidate.position === 2)).toBe(true);

  await expect(page.getByTestId("copilot-panel")).toBeVisible();
  await expect(page.getByTestId("current-decision-panel")).toBeVisible();
  await expect(page.getByTestId("current-decision-target")).toHaveAttribute("data-target-position", "2");
  await expect(page.getByTestId("current-decision-viewed")).toHaveCount(0); // viewing the recommended position: no second notice
  await expect(page.getByTestId("coach-primary-action")).toHaveCount(0); // no V3 decision next to V4
  await expect(page.getByTestId("coach-panel")).toHaveCount(0);

  const shown = page.locator('[data-testid="current-decision-card"], [data-testid="current-decision-alternative"]');
  await expect(shown).toHaveCount(expected.length);
  expect(await shown.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id"))))).toEqual(expected.map((candidate) => candidate.heroId));
});
