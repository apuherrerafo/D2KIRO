import { expect, test } from "@playwright/test";

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
