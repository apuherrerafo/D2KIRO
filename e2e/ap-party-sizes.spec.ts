import { expect, test, type Page } from "@playwright/test";

async function heroNamesIn(page: Page, testId: string): Promise<string[]> {
  const rows = page.locator(`[data-testid="${testId}"]`);
  const names: string[] = [];
  for (let i = 0; i < await rows.count(); i++) names.push(...(await rows.nth(i).locator("span").allInnerTexts()));
  return names.map((name) => name.trim()).filter((name) => name.length > 0);
}

async function playPartyDraft(
  page: Page,
  side: "Radiant" | "Dire",
  partySize: 1 | 2 | 3 | 5,
  partyPositions: string[],
  personalPosition: string,
): Promise<{ own: string[]; enemy: string[] }> {
  await page.goto("/simulator");
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });

  await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: side, exact: true }).click();

  if (partySize === 1) {
    await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Solo (1)" }).click();
  } else if (partySize === 2) {
    await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Party 2" }).click();
    for (const pos of partyPositions) {
      await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: pos }).click();
    }
  } else if (partySize === 3) {
    await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Party 3" }).click();
    for (const pos of partyPositions) {
      await page.getByRole("group", { name: "Posiciones de tu party" }).getByRole("button", { name: pos }).click();
    }
  } else {
    await page.getByRole("group", { name: "Tamaño de party" }).getByRole("button", { name: "Party 5" }).click();
  }

  await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: personalPosition }).click();

  await expect(startButton).toBeEnabled();
  await startButton.click();

  await expect(page.getByTestId("resolved-bans")).toBeVisible({ timeout: 60_000 });

  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await page.getByText("Draft completo").isVisible()) break;
    const hero = page.locator("button[title]:not([disabled])").first();
    if (await hero.isVisible().catch(() => false)) {
      await hero.click().catch(() => undefined);
    }
    await page.waitForTimeout(500);
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 90_000 });
  const own = await heroNamesIn(page, "summary-user-picks");
  const enemy = await heroNamesIn(page, "summary-bot-picks");
  expect(own).toHaveLength(5);
  expect(enemy).toHaveLength(5);
  expect(new Set([...own, ...enemy]).size).toBe(10);
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);

  return { own, enemy };
}

test.describe("AP Ranked Roles -- superficie de configuración", () => {
  test("el Player debe elegir lado y posición personal; no hay default de Radiant ni de Mid", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.getByText("Ranked All Pick — Ranked Roles", { exact: true })).toBeVisible({ timeout: 60_000 });
    const sides = page.getByRole("group", { name: "Tu lado" });
    await expect(sides.getByRole("button", { name: "Radiant", exact: true })).toBeVisible();
    await expect(sides.getByRole("button", { name: "Dire", exact: true })).toBeVisible();
    const positions = page.getByRole("group", { name: "Tu posición personal" });
    for (const label of ["Carry", "Midlane", "Offlane", "Support", "Hard support"]) {
      await expect(positions.getByRole("button", { name: new RegExp(label) }).first()).toBeVisible();
    }
    await expect(page.getByRole("button", { name: "Iniciar Draft" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Captain's Mode" })).toHaveCount(0);
    for (const intent of ["Push", "Teamfight", "Pickoff", "Scaling"]) {
      await expect(page.getByRole("button", { name: intent })).toHaveCount(0);
    }
  });

  test("Party 4 continúa rechazada por el contrato real del motor", async ({ page, baseURL }) => {
    const response = await page.request.post(`${baseURL}/engine/api/session/protocol`, {
      data: {
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41e",
        localSide: "radiant",
        adapterKind: "simulator",
        partyContext: {
          partySize: 4,
          side: "radiant",
          controlledSlots: [0, 1, 2, 3].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })),
        },
      },
    });
    expect(response.status()).toBe(400);
    expect((await response.json()).error).toBe("invalid_body");
  });
});

test.describe("AP Ranked Roles -- Acceptance Journeys", () => {
  test("All Pick Solo Pos 1 (Carry) completa con aliados simulados", async ({ page }) => {
    await playPartyDraft(page, "Radiant", 1, [], "Posición 1 — Carry");
  });

  test("All Pick Solo Pos 2 (Midlane) completa con aliados simulados", async ({ page }) => {
    await playPartyDraft(page, "Radiant", 1, [], "Posición 2 — Midlane");
  });

  test("All Pick Solo Pos 3 (Offlane) completa con aliados simulados", async ({ page }) => {
    await playPartyDraft(page, "Dire", 1, [], "Posición 3 — Offlane");
  });

  test("All Pick Solo Pos 4 (Support) completa con aliados simulados", async ({ page }) => {
    await playPartyDraft(page, "Radiant", 1, [], "Posición 4 — Support");
  });

  test("All Pick Solo Pos 5 (Hard support) completa con aliados simulados", async ({ page }) => {
    await playPartyDraft(page, "Dire", 1, [], "Posición 5 — Hard support");
  });

  test("Party 2 (Pos 2 + Pos 5) completa con 3 aliados y 5 enemigos simulados", async ({ page }) => {
    await playPartyDraft(
      page,
      "Radiant",
      2,
      ["Posición 2 — Midlane", "Posición 5 — Hard support"],
      "Posición 5 — Hard support",
    );
  });

  test("Party 3 (Pos 1 + Pos 3 + Pos 5) completa con 2 aliados y 5 enemigos simulados", async ({ page }) => {
    await playPartyDraft(
      page,
      "Dire",
      3,
      ["Posición 1 — Carry", "Posición 3 — Offlane", "Posición 5 — Hard support"],
      "Posición 3 — Offlane",
    );
  });

  test("Party 5 (control total) completa con 5 enemigos simulados", async ({ page }) => {
    await playPartyDraft(page, "Radiant", 5, [], "Posición 2 — Midlane");
  });
});
