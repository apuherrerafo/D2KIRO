import { expect, test } from "./support/failure-evidence";

test.describe("Party 5 QA Readiness Browser Journey", () => {
  test("creates a 5-person team group preset, loads it in simulator, resolves 16 bans, and drafts with party control", async ({ page }) => {
    // 1. Visit /simulator to establish session
    await page.goto("/simulator");
    await expect(page.getByText("Ranked All Pick — Ranked Roles", { exact: true })).toBeVisible({ timeout: 60_000 });

    // 2. Create a Party 5 preset via engine API through Next proxy
    const createdGroup = await page.evaluate(async () => {
      const resp = await fetch("/engine/api/team-groups", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "QA 5-Stack Preset",
          partySize: 5,
          members: [
            { slot: 1, name: "Pos 1 Carry", heroPool: [1, 8, 10, 18, 44] }, // AM, Jugg, Morph, Sven, PA
            { slot: 2, name: "Pos 2 Mid", heroPool: [11, 13, 22, 46, 74] },   // SF, Puck, Zeus, TA, Invoker
            { slot: 3, name: "Pos 3 Offlane", heroPool: [2, 7, 28, 96, 99] }, // Axe, Earthshaker, Slardar, Centaur, Bristle
            { slot: 4, name: "Pos 4 Support", heroPool: [3, 20, 26, 27, 86] }, // Bane, VS, Lion, Shadow Shaman, Rubick
            { slot: 5, name: "Pos 5 Hard Sup", heroPool: [5, 30, 83, 87, 111] }, // CM, WD, Treant, Disruptor, Oracle
          ],
        }),
      });
      return { status: resp.status, data: (await resp.json()) as { id: number; name: string } };
    });

    expect(createdGroup.status).toBe(201);
    expect(createdGroup.data.name).toBe("QA 5-Stack Preset");

    // 3. Reload /simulator to refresh team presets query
    await page.goto("/simulator");
    await expect(page.getByText("Ranked All Pick — Ranked Roles", { exact: true })).toBeVisible({ timeout: 60_000 });

    // 4. Configure Party 5
    await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
    await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Party 5" }).click();

    // 5. Verify the Team Preset selector is visible and contains our preset
    const presetSelect = page.locator("#team-preset-select");
    await expect(presetSelect).toBeVisible();
    await presetSelect.selectOption({ value: String(createdGroup.data.id) });

    // Verify active indicator
    await expect(page.getByText("Pools de posiciones activos")).toBeVisible();

    // Select personal position Pos 1
    await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 1 — Carry" }).click();

    // 6. Iniciar Draft
    const startButton = page.getByRole("button", { name: "Iniciar Draft" });
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // 7. Verify exactly 16 bans resolved
    const resolvedBans = page.getByTestId("resolved-bans");
    await expect(resolvedBans).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText("Bans resueltos (16)")).toBeVisible();

    // 8. Verify all 5 positions in roster are human controlled (Party / YOU), no Ally Bot
    const roster = page.getByTestId("team-roster");
    await expect(roster).toBeVisible();
    await expect(roster.getByText("YOU", { exact: true })).toHaveCount(1);
    await expect(roster.getByText("PARTY", { exact: true })).toHaveCount(4);
    await expect(roster.getByText("ALLY BOT", { exact: true })).toHaveCount(0);

    // 9. Play through the draft to completion
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if (await page.getByText("Draft completo").isVisible()) break;
      const hero = page.locator("button[title]:not([disabled])").first();
      if (await hero.isVisible().catch(() => false)) {
        await hero.click().catch(() => undefined);
      }
      await page.waitForTimeout(500);
    }

    // 10. Verify completion
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 90_000 });
    for (const position of [1, 2, 3, 4, 5]) {
      await expect(roster.getByTestId(`own-roster-pos-${position}`)).toBeVisible();
      await expect(roster.getByTestId(`enemy-roster-pos-${position}`)).toBeVisible();
    }
  });
});
