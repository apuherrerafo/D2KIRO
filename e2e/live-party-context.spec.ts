import { ENGINE_DIRECT, engineDirectHeaders } from "./support/wave1";
import { expect, test } from "./support/failure-evidence";

// Live Dota + Party 5 preset, in a real Chromium against the real engine + web. Dota itself is replaced by
// direct POSTs to the GSI ingest route with the link's own credential (the exact request Dota would make).
//
//   1. Dota connected, reporting only side + own hero (the real bot-match shape) -> honest partial capture
//   2. the account's Party 5 preset is selected in /live-draft -> five positions show "Pos N ✓"
//   3. the structural diagnostic reports what Dota sent -- sections present / absent, no identities
//   4. Dota leaves hero selection -> "DRAFT TERMINADO", no PICK NOW anywhere

interface IssuedLink {
  liveId: string;
  token: string;
  sessionId: string;
}

function gsiBody(token: string, gameState: string, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    provider: { name: "Dota 2", appid: 570 },
    map: { name: "start", matchid: "1234567890", game_state: gameState, clock_time: -30 },
    player: { steamid: "SENTINEL-STEAMID", accountid: "SENTINEL-ACCOUNTID", name: "SENTINEL-NAME", team_name: "radiant" },
    hero: { id: 104 },
    draft: {},
    auth: { token },
    ...extra,
  });
}

test.describe("Live Dota + Party 5", () => {
  test("preset pools active, structural diagnostic, and no PICK NOW once the draft ended", async ({ page, request }) => {
    // The cfg download (https-only origin) is not reachable on http://127.0.0.1, so the link is issued the way
    // apps/web does it server-side: the account-authenticated engine route.
    const issued = await request.post(`${ENGINE_DIRECT}/api/live/gsi-link/issue`, { headers: engineDirectHeaders() });
    expect(issued.status()).toBe(201);
    const link = (await issued.json()) as IssuedLink;

    // The account's own Party 5 preset (through the same /engine proxy the page uses).
    await page.goto("/live-draft");
    const group = await page.evaluate(async () => {
      const response = await fetch("/engine/api/team-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "E2E Team Julio",
          partySize: 5,
          members: [
            { slot: 1, name: "Pos 1", heroPool: [1, 8, 10] },
            { slot: 2, name: "Pos 2", heroPool: [11, 13, 22] },
            { slot: 3, name: "Pos 3", heroPool: [2, 7, 28] },
            { slot: 4, name: "Pos 4", heroPool: [3, 20, 26] },
            { slot: 5, name: "Pos 5", heroPool: [5, 30, 83] },
          ],
        }),
      });
      return { status: response.status };
    });
    expect(group.status).toBe(201);

    // 1. Dota speaks: hero selection, our side and our hero, an EMPTY draft block (nobody else's heroes).
    const first = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_HERO_SELECTION"), headers: { "content-type": "application/json" } });
    expect(first.status()).toBe(200);

    await page.goto("/live-draft");
    await expect(page.getByTestId("live-party-preset")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("live-capture-partial")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("live-preset-inactive")).toBeVisible();

    // F7: Dota reports only part of the draft -> the facts it did report are shown, but there is NO recommendation:
    // no Team Coach board, no PICK NOW, no manual fallback.
    await expect(page.getByTestId("live-pick-detected")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("team-coach-board")).toHaveCount(0);

    // 2. Select the preset: five positions become active, shown by NAME (no ids).
    await page.getByTestId("live-preset-select").selectOption({ label: "E2E Team Julio" });
    await expect(page.getByTestId("live-preset-active")).toBeVisible({ timeout: 30_000 });
    for (const position of [1, 2, 3, 4, 5]) {
      await expect(page.getByTestId(`live-preset-pos-${position}`)).toHaveAttribute("data-active", "true");
      await expect(page.getByTestId(`live-preset-pos-${position}`)).toContainText("✓");
    }
    // Selecting a preset does not bring a recommendation back while the draft is incomplete.
    await expect(page.getByTestId("team-coach-board")).toHaveCount(0);
    await expect(page.getByTestId("live-team-coach")).not.toContainText(/PICK NOW/i);
    await expect(page.getByTestId("live-manual-entry")).toHaveCount(0);

    // The remembered choice survives a reload (re-applied by the page if the engine forgot it).
    await page.reload();
    await expect(page.getByTestId("live-preset-active")).toBeVisible({ timeout: 30_000 });

    // 3. Structural diagnostic: the draft section is present (empty), allplayers is absent; nothing identifying.
    await page.getByTestId("live-diagnostics").locator("summary").click();
    await expect(page.getByTestId("diag-structure-draft")).toHaveAttribute("data-presence", "YES");
    await expect(page.getByTestId("diag-structure-allplayers")).toHaveAttribute("data-presence", "NO");
    await expect(page.getByTestId("diag-structure-draft.team2")).toHaveAttribute("data-presence", "NO");
    const diagnostics = (await page.getByTestId("live-diagnostics").textContent()) ?? "";
    expect(diagnostics).not.toMatch(/SENTINEL|1234567890|[0-9a-f]{64}/);

    // 4. Dota moves on to the match: the draft is over.
    const ended = await request.post(`${ENGINE_DIRECT}/api/live/gsi/${link.liveId}`, { data: gsiBody(link.token, "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"), headers: { "content-type": "application/json" } });
    expect(ended.status()).toBe(200);
    await expect(page.getByTestId("team-coach-draft-ended")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("live-team-coach")).not.toContainText(/PICK NOW/i);
    await expect(page.getByTestId("team-coach-pick-now")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Elegir / })).toHaveCount(0);
    // The live session stays up for the in-match coach: still connected, preset still active.
    await expect(page.getByTestId("live-preset-active")).toBeVisible();
    await expect(page.getByTestId("live-capture-status")).toContainText("Draft terminado");
  });
});
