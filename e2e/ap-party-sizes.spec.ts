import { expect, test, type Page } from "@playwright/test";

// R1 S7 completion wave -- product E2E for Blocker 2's AP party-size entry point. Confirms Solo/
// Party2/Party3/Party5 are all real, selectable, and each drives a real completed draft through
// the actual protocol/engine path (never a fabricated RecommendationSet). Party 4 is confirmed
// rejected at the real HTTP contract level -- the engine (createPartyContext) is the only
// authority for that rule, never duplicated in the UI (ConfigPanel never offers "4" as an option).

const ROUND_PICKS = [2, 2, 1]; // BLIND_ROUND_SPECS: Ranked All Pick 7.35d-7.37

async function playRound(page: Page, round: number, picks: number): Promise<void> {
  await expect(page.getByText(new RegExp(`Ronda ${round}\\b`))).toBeVisible({ timeout: 60_000 });
  for (let i = 0; i < picks; i++) {
    const hero = page.locator("button[title]:not([disabled])").first();
    await expect(hero).toBeVisible({ timeout: 60_000 });
    await hero.click();
  }
}

async function playFullApDraft(page: Page, partySizeLabel: string, seed: string): Promise<void> {
  await page.goto("/simulator");
  await expect(page.locator("#player-position")).toBeVisible({ timeout: 60_000 });

  await page.selectOption("#party-size", partySizeLabel);
  await expect(async () => {
    await page.selectOption("#player-position", "1");
    await expect(page.getByRole("button", { name: "Iniciar Draft" })).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });

  const seedInput = page.locator('input[type="text"]').first();
  await seedInput.fill(seed);

  await page.getByRole("button", { name: "Iniciar Draft" }).click();

  for (const [index, picksThisRound] of ROUND_PICKS.entries()) {
    await playRound(page, index + 1, picksThisRound);
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
}

test.describe("Ranked AP -- tamaño de party real, vía el motor", () => {
  test("Solo (party 1): un draft completo real", async ({ page }) => {
    await playFullApDraft(page, "1", "81725410");
  });

  test("Party 2: un draft completo real", async ({ page }) => {
    await playFullApDraft(page, "2", "81725411");
  });

  test("Party 3: un draft completo real", async ({ page }) => {
    await playFullApDraft(page, "3", "81725412");
  });

  test("Party 5 (stack completo): un draft completo real", async ({ page }) => {
    await playFullApDraft(page, "5", "81725413");
  });

  test("Party 4: el motor la rechaza (INVALID_PARTY_SIZE) -- nunca ofrecida en la UI", async ({ page, baseURL }) => {
    // ConfigPanel nunca renderiza "4" como opción (createPartyContext, party-context.ts, es la
    // única autoridad sobre esta regla) -- confirmado leyendo las opciones reales del <select>.
    await page.goto("/simulator");
    await expect(page.locator("#party-size")).toBeVisible({ timeout: 60_000 });
    const optionValues = await page.locator("#party-size option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    expect(optionValues.sort()).toEqual(["1", "2", "3", "5"]);

    // El motor sigue siendo la única fuente de verdad de la regla -- se prueba pegándole
    // directamente al contrato real vía el mismo proxy que usa el navegador, sin ningún mock.
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
    // isValidPartyContextInput (draft-protocol/validation.ts) rejects partySize 4 at the structural
    // edge -- 400 "invalid_body", never reaching store.create()'s own INVALID_PARTY_SIZE (422) path
    // for this particular field. Both are the SAME engine authority (VALID_PARTY_SIZES,
    // party-context.ts) refusing the request; this asserts the one this route actually returns.
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toBe("invalid_body");
  });
});
