import { expect, test } from "@playwright/test";

const createSessionBody = {
  rulesetId: "dota2/ranked-all-pick",
  patch: "7.41e",
  localSide: "radiant",
  adapterKind: "simulator",
  partyContext: { partySize: 1, side: "radiant", controlledSlots: [] },
  controlledPositions: [2],
  humanPosition: 2,
  simulatorSeed: "AUTHSMOKE",
};

test("authenticated browser POST session/protocol crosses the Next proxy with engine identity", async ({ page }) => {
  await page.goto("/simulator");

  const result = await page.evaluate(async (body) => {
    const session = await fetch("/api/auth/session");
    const created = await fetch("/engine/api/session/protocol", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return {
      sessionStatus: session.status,
      sessionAuthenticated: Number.isInteger((await session.json() as { accountId?: unknown }).accountId),
      createStatus: created.status,
    };
  }, createSessionBody);

  expect(result.sessionStatus).toBe(200);
  expect(result.sessionAuthenticated).toBe(true);
  expect(result.createStatus).toBe(201);
});
