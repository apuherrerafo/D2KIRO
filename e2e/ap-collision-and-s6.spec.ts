import { expect, test, type Page, type Response } from "@playwright/test";
import { FIXTURE_HERO_ID_BY_NAME, FIXTURE_HERO_NAME_BY_ID } from "./fixtures/hero-catalog";

// R1 S7 machine-certification closure. These are hard browser gates, not best-effort telemetry:
// every relevant request still originates in the rendered product UI and reaches the real API.
// The AP test alters only the POST body of the browser's existing bot-selection request, using the
// server's environment-gated test control. The API still invokes the normal bot route and the
// same SUBMIT_SEALED_SELECTION kernel command it uses outside the test.

interface ProtocolSnapshotResponse {
  accepted?: boolean;
  view?: {
    status?: string;
    bannedHeroes?: number[];
    enemyPicks?: Array<{ visibility?: string; heroId?: number }>;
  };
}

interface RecommendationResponse {
  decision?: { actionKind?: string };
  recommendations?: Array<{ actions?: Array<{ hero?: number }>; legacy?: unknown }>;
  deferred?: { steal?: { status?: string; heroId?: number | null; opponentBaselineValue?: number | null } | string };
}

function isBotSelection(response: Response): boolean {
  return response.request().method() === "POST" && /\/api\/session\/protocol\/[^/]+\/bot-selection$/.test(new URL(response.url()).pathname);
}

function isCommand(response: Response): boolean {
  return response.request().method() === "POST" && /\/api\/session\/protocol\/[^/]+\/command$/.test(new URL(response.url()).pathname);
}

function isRecommendations(response: Response): boolean {
  return response.request().method() === "GET" && /\/api\/session\/protocol\/[^/]+\/recommendations$/.test(new URL(response.url()).pathname);
}

async function startDraft(page: Page, seed: string): Promise<void> {
  await page.goto("/simulator");
  await expect(page.locator("#player-position")).toBeVisible({ timeout: 30_000 });
  await page.locator('input[type="text"]').first().fill(seed);
  const startButton = page.getByRole("button", { name: "Iniciar Draft" });
  // Next can replace this select during hydration. This is readiness synchronization (the same
  // pattern used by the existing browser smoke), not a scenario retry: no draft action has run.
  await expect(async () => {
    await page.selectOption("#player-position", "1");
    await expect(startButton).toBeEnabled({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  await startButton.click();
}

async function startCaptainsMode(page: Page): Promise<void> {
  await page.goto("/simulator");
  await page.getByRole("button", { name: "Captain's Mode" }).click();
  await expect(page.getByText("Configurar Captain's Mode")).toBeVisible({ timeout: 30_000 });
  await page.locator("text=Tu lado").locator("..").getByRole("button", { name: "Radiant", exact: true }).click();
  await page.locator("text=Quién elige primero (FIRST)").locator("..").getByRole("button", { name: "Radiant", exact: true }).click();
  await page.getByRole("button", { name: "Iniciar Captain's Mode" }).click();
  await expect(page.getByText(/Paso 1/)).toBeVisible({ timeout: 30_000 });
}

test("AP collision hard: selecciones selladas iguales recorren el kernel y sólo revelan Conflict_Ban", async ({ page }) => {
  const forcedHeroIds: number[] = [];
  const botSnapshots: ProtocolSnapshotResponse[] = [];
  const forcedRequests: unknown[] = [];

  page.on("response", (response) => {
    if (!isBotSelection(response)) return;
    void response.json().then((body: ProtocolSnapshotResponse) => botSnapshots.push(body));
  });
  // First/second Ranked AP collisions are resolved directly by the kernel. This would be third-
  // collision semantics in the wrong scenario, so make an accidental authority request fail.
  await page.route("**/simulator-authority", async (route) => {
    throw new Error(`unexpected simulator authority request: ${route.request().url()}`);
  });
  await page.route("**/bot-selection", async (route) => {
    const heroId = forcedHeroIds.shift();
    if (heroId === undefined) {
      await route.continue();
      return;
    }
    const body = { forcedHeroId: heroId };
    forcedRequests.push(body);
    await route.continue({ postData: JSON.stringify(body) });
  });

  // The historic fixture family is 817254; UI input requires its canonical eight-character
  // representation, so the deterministic browser seed is 81725400.
  await startDraft(page, "81725400");
  await expect(page.getByText(/Ronda 1\b/)).toBeVisible({ timeout: 30_000 });

  // Hidden opponent truth is absent before either local selection is submitted to the kernel.
  const direRow = page.getByText("Dire", { exact: true }).first().locator("..");
  await expect(direRow.locator("img")).toHaveCount(0);

  const localButtons = page.locator("button[title]:not([disabled])");
  const localNames = await localButtons.evaluateAll((buttons) => buttons.slice(0, 2).map((button) => button.getAttribute("title")));
  expect(localNames).toHaveLength(2);
  expect(localNames[0]).not.toBeNull();
  expect(localNames[1]).not.toBeNull();
  const localHeroIds = localNames.map((name) => FIXTURE_HERO_ID_BY_NAME.get(name!));
  expect(localHeroIds.every((heroId): heroId is number => heroId !== undefined)).toBe(true);
  expect(new Set(localHeroIds).size).toBe(2);

  // These values are derived from legal, enabled browser controls, so each pair is a legal equal
  // sealed selection. No random retries and no fake recommendation/state path are involved.
  forcedHeroIds.push(localHeroIds[0]!, localHeroIds[1]!);
  await page.locator(`button[title="${localNames[0]}"]:not([disabled])`).click();
  await page.locator(`button[title="${localNames[1]}"]:not([disabled])`).click();

  await expect(page.getByText(/Conflict_Ban:/)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => forcedRequests.length).toBe(2);
  await expect.poll(() => botSnapshots.length).toBe(2);
  expect(botSnapshots.every((snapshot) => snapshot.accepted === true)).toBe(true);

  // The post-bot protocol snapshots are canonical evidence that the real kernel found both
  // conflicts and banned their heroes. The retry is also real: those heroes are absent from the
  // freshly rendered selectable grid.
  const bannedByKernel = new Set(botSnapshots.flatMap((snapshot) => snapshot.view?.bannedHeroes ?? []));
  for (const heroId of localHeroIds) expect(bannedByKernel).toContain(heroId);

  // Public state has the collision resolution, but no sealed enemy hero leaked before it.
  const conflictText = await page.getByText(/Conflict_Ban:/).innerText();
  expect(conflictText).toContain("quedó baneado");
  await expect(direRow.locator("img")).toHaveCount(0);
  await expect(page.getByText(/Ronda 1\b/)).toBeVisible();
  for (const heroName of localNames) await expect(page.locator(`button[title="${heroName}"]`)).toHaveCount(0);
});

test("S6 steal hard: ban CM real materializa el steal del RecommendationSet/v2 y el Copilot lo muestra", async ({ page }) => {
  await startCaptainsMode(page);

  // Step 1 only advances the canonical CM sequence. Step 2 is the first point where the real
  // S6 lookahead has a legal Dire response after our BAN, exactly the certified engine scenario.
  // HeroGrid's accessible name includes image alt text and its visible label. The title belongs
  // to the same real user control and is the exact stable selector.
  const firstBan = page.locator('button[title="Clockwerk"]');
  await expect(firstBan).toBeEnabled();
  const recommendationAtStep2 = page.waitForResponse((response) => isRecommendations(response) && response.status() === 200);
  await firstBan.click();
  const recommendationResponse = await recommendationAtStep2;
  const recommendation = await recommendationResponse.json() as RecommendationResponse;

  await expect(page.getByText(/Paso 2/)).toBeVisible({ timeout: 30_000 });
  expect(recommendation.decision?.actionKind).toBe("BAN");
  const top = recommendation.recommendations?.[0];
  const heroH = top?.actions?.[0]?.hero;
  expect(top?.legacy).not.toBeNull(); // a real V6 projection, not a fabricated RecommendationSet.
  expect(typeof heroH).toBe("number");
  expect(recommendation.deferred?.steal).not.toBe("NOT_COMPUTED");
  const steal = recommendation.deferred?.steal;
  if (typeof steal === "string" || !steal || heroH === undefined) throw new Error("missing real S6 steal evidence");
  expect(steal.status).toBe("MATERIALIZED");
  expect(steal.heroId).toBe(heroH);
  expect(typeof steal.opponentBaselineValue).toBe("number");

  const heroName = FIXTURE_HERO_NAME_BY_ID.get(heroH);
  expect(heroName).toBeDefined();
  await expect(page.getByTestId("opponent-intelligence")).toContainText("le quita");
  await expect(page.getByTestId("opponent-intelligence")).toContainText(heroName!);

  const commandResponse = page.waitForResponse((response) => isCommand(response) && response.status() === 202);
  await page.locator(`button[title="${heroName}"]`).click();
  const command = await commandResponse;
  const afterBan = await command.json() as ProtocolSnapshotResponse;
  expect(afterBan.accepted).toBe(true);
  expect(afterBan.view?.bannedHeroes).toContain(heroH);
});
