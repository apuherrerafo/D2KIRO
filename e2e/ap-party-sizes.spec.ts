import { expect, test } from "@playwright/test";

test.describe("AP Solo Mid -- superficie reducida", () => {
  test("expone sólo Ranked All Pick, Solo, Radiant y Posición 2 Mid", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.getByText("Ranked All Pick", { exact: true })).toBeVisible({ timeout: 60_000 });
    await expect(page.getByLabel("Configuración fija del simulador")).toContainText("Solo");
    await expect(page.getByLabel("Configuración fija del simulador")).toContainText("Radiant");
    await expect(page.getByLabel("Configuración fija del simulador")).toContainText("Posición 2");
    await expect(page.locator("#party-size")).toHaveCount(0);
    await expect(page.locator("#player-position")).toHaveCount(0);
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
