import { expect, test } from "@playwright/test";
import { FIXTURE_HERO_ID_BY_NAME } from "./fixtures/hero-catalog";

test("AP collision conserva kernel, información sellada y Conflict_Ban", async ({ page, baseURL }) => {
  const endpoint = `${baseURL}/engine/api/session/protocol`;
  const created = await page.request.post(endpoint, {
    data: {
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
      partyContext: {
        partySize: 5,
        side: "radiant",
        controlledSlots: [], // AP policy (PD-026/PD-027): slots are inert; ownership is `controlledPositions`
      },
      controlledPositions: [1, 2, 3, 4, 5],
    },
  });
  expect(created.status()).toBe(201);
  const { sessionId } = await created.json() as { sessionId: string };
  const commandUrl = `${endpoint}/${sessionId}/command`;
  const botUrl = `${endpoint}/${sessionId}/bot-selection`;
  const command = (value: unknown) => page.request.post(commandUrl, { data: { command: value } });

  await command({ type: "RECORD_RESOLVED_BANS", heroes: [] });
  await command({ type: "BAN_RESOLUTION_COMPLETE" });
  const heroA = FIXTURE_HERO_ID_BY_NAME.get("Clockwerk")!;
  const heroB = FIXTURE_HERO_ID_BY_NAME.get("Puck")!;
  await command({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: heroA });
  const sealed = await command({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: heroB });
  const sealedBody = await sealed.json() as { view: { enemyPicks: Array<{ visibility: string }> } };
  expect(sealedBody.view.enemyPicks.every((pick) => pick.visibility === "HIDDEN")).toBe(true);

  await page.request.post(botUrl, { data: { forcedHeroId: heroA } });
  const resolved = await page.request.post(botUrl, { data: { forcedHeroId: heroB } });
  expect(resolved.status()).toBe(200);
  const body = await resolved.json() as { accepted: boolean; view: { bannedHeroes: number[]; enemyPicks: unknown[] } };
  expect(body.accepted).toBe(true);
  expect(body.view.bannedHeroes).toEqual(expect.arrayContaining([heroA, heroB]));
  expect(body.view.enemyPicks).toHaveLength(0);
});
