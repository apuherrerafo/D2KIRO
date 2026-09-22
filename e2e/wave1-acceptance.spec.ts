import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_HERO_ID_BY_NAME, FIXTURE_HERO_NAME_BY_ID } from "./fixtures/hero-catalog";
import {
  ENGINE_DIRECT,
  ROUND_HEADING,
  assertNoSimulatorTruthLeak,
  configureAndStart,
  expectNotSelectable,
  firstEnabled,
  heroButton,
  heroNamesIn,
  lockPicks,
  record,
  resolvedBanNames,
  type Recorder,
} from "./support/wave1";

// WAVE 1 -- PRODUCT ACCEPTANCE SMOKE (real browser, production build, real engine, fixture DB).
// Entry point: `bun run test:wave1:smoke`. These scenarios replace the manual full-draft playthroughs
// the Product Owner would otherwise do. Every assertion is on Player-visible behaviour (the DOM and
// the API responses the UI itself consumes).

const MID = ["Puck", "Storm Spirit", "Queen of Pain", "Tinker", "Necrophos"];
const CARRY = ["Anti-Mage", "Juggernaut", "Phantom Lancer", "Luna", "Sven"];
const OFFLANE = ["Tidehunter", "Slardar", "Sand King", "Axe"];
const SOFT_SUPPORT = ["Lion", "Windranger", "Vengeful Spirit", "Earthshaker"];
const HARD_SUPPORT = ["Crystal Maiden", "Dazzle", "Witch Doctor", "Lich"];

type Alternatives = readonly (readonly string[])[];
interface DraftPlan {
  r1: Alternatives;
  r2: Alternatives;
  r3: Alternatives;
}

function annotate(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

/** Snapshot-level contract: enemy reveals only when the round closes; timers 25/25/20; hidden slots carry no hero. */
function assertSnapshotContract(rec: Recorder): void {
  const snapshots = rec.snapshots();
  assertNoSimulatorTruthLeak(snapshots, rec.responses.map((entry) => entry.body));
  const revealedByPhase: Record<string, number> = { PICK_ROUND_1: 0, PICK_ROUND_2: 2, PICK_ROUND_3: 4, COMPLETE: 5 };
  for (const snapshot of snapshots) {
    const phase = snapshot.view.rankedAp?.phase ?? "";
    if (!(phase in revealedByPhase)) continue;
    const revealed = snapshot.view.enemyPicks.filter((slot) => slot.visibility === "REVEALED").length;
    expect(revealed, `revealed enemy heroes while ${phase}`).toBe(revealedByPhase[phase]);
  }
  const roundDurations = snapshots.filter((snapshot) => snapshot.stopReason === "human_input").map((snapshot) => snapshot.simulator?.durationMs);
  expect(roundDurations).toEqual([25000, 25000, 20000]);
}

async function playFullDraft(
  page: Page,
  options: { side: "Radiant" | "Dire"; position: string; seed: string; banNames: string[]; plan: DraftPlan },
): Promise<{ rec: Recorder; picked: string[] }> {
  annotate("seed", options.seed);
  const rec = record(page);
  await configureAndStart(page, options);
  const picked: string[] = [];

  const rounds: [1 | 2 | 3, Alternatives][] = [[1, options.plan.r1], [2, options.plan.r2], [3, options.plan.r3]];
  for (const [round, alternatives] of rounds) {
    const capacity = alternatives.length;
    // Round capacities are exactly 2 / 2 / 1 and the Player owns every seat.
    await expect(page.getByText(ROUND_HEADING(round, capacity))).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("round-seat")).toHaveCount(capacity);
    if (round === 1) {
      await expect(page.getByTestId("resolved-bans")).toBeVisible();
      // No pick-order-by-position rule: every planned role (incl. Mid/Carry now, support later) has a legal hero right now.
      for (const options_ of alternatives) await firstEnabled(page, options_);
    }
    picked.push(...(await lockPicks(page, alternatives)));
    if (round < 3) {
      await expect(page.getByText(`Ronda ${round} -- revelada`)).toBeVisible({ timeout: 30_000 });
      await expect(page.getByText("Equipo rival").first()).toBeVisible();
    }
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });
  const own = await heroNamesIn(page, "summary-user-picks");
  const enemy = await heroNamesIn(page, "summary-bot-picks");
  expect(own).toHaveLength(5);
  expect(enemy).toHaveLength(5);
  expect(new Set([...own, ...enemy]).size).toBe(10);
  expect([...own].sort()).toEqual([...picked].sort()); // no collision in these fixed seeds: the Player ends with exactly the 5 chosen heroes
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);

  // The Player controlled all five own seats and never any enemy seat.
  const commands = rec.requests.filter((request) => request.path.endsWith("/command")).map((request) => (request.body as { command: { type: string; side: string } }).command);
  expect(commands).toHaveLength(5);
  const side = options.side.toLowerCase();
  expect(commands.every((command) => command.type === "SUBMIT_SEALED_SELECTION" && command.side === side)).toBe(true);
  expect(rec.responses.filter((entry) => entry.status >= 400)).toEqual([]);
  assertSnapshotContract(rec);
  return { rec, picked };
}

test.describe("Wave 1 acceptance -- real browser", () => {
  test("A. Radiant + Pos2, 4 ban preferences: Mid+Carry in R1, support in R3, COMPLETE", async ({ page }) => {
    const prefs = ["Zeus", "Lina", "Sniper", "Kunkka"];
    const plan: DraftPlan = { r1: [MID, CARRY], r2: [OFFLANE, SOFT_SUPPORT], r3: [HARD_SUPPORT] };
    const { rec } = await playFullDraft(page, { side: "Radiant", position: "Posición 2 — Midlane", seed: "WAVE1RAD", banNames: prefs, plan });
    // 4 full preferences => at least one of them is in the resolved set; at most 4 nominations can be entered.
    const banned = rec.snapshots().find((snapshot) => snapshot.view.bannedHeroes.length > 0)!.view.bannedHeroes.map((id) => FIXTURE_HERO_NAME_BY_ID.get(id));
    expect(prefs.some((name) => banned.includes(name))).toBe(true);
    for (const snapshot of rec.snapshots()) expect(snapshot.view.viewerSide).toBe("radiant");
  });

  test("B. Dire + Pos5, 0 ban preferences, roles in a different pick order: COMPLETE (side symmetry)", async ({ page }) => {
    // Hard support and offlane FIRST, carry + soft support in R2, Mid LAST -- the opposite of any "natural" order.
    const plan: DraftPlan = { r1: [HARD_SUPPORT, OFFLANE], r2: [CARRY, SOFT_SUPPORT], r3: [MID] };
    const { rec } = await playFullDraft(page, { side: "Dire", position: "Posición 5 — Hard support", seed: "WAVE1DIR", banNames: [], plan });
    for (const snapshot of rec.snapshots()) expect(snapshot.view.viewerSide).toBe("dire");
    // 0 nominations still resolves bans (the other 9 participants are simulated).
    expect(rec.snapshots().some((snapshot) => snapshot.view.bannedHeroes.length > 0)).toBe(true);
  });
});

test.describe("Wave 1 acceptance -- ban flow (browser)", () => {
  test("resolved bans appear, banned heroes cannot be selected, a 5th nomination is impossible", async ({ page }) => {
    annotate("seed", "WAVE1BAN");
    const rec = record(page);
    await configureAndStart(page, { side: "Radiant", position: "Posición 3 — Offlane", seed: "WAVE1BAN", banNames: ["Zeus", "Lina", "Sniper", "Kunkka"] });
    await expect(page.getByText(ROUND_HEADING(1, 2))).toBeVisible({ timeout: 60_000 });
    const banned = await resolvedBanNames(page);
    expect(banned.length).toBeGreaterThan(0);
    // 4 full nominations => at least one is banned, and a catalog hero that is banned can no longer be selected.
    const bannedNominations = ["Zeus", "Lina", "Sniper", "Kunkka"].filter((name) => banned.includes(name));
    expect(bannedNominations.length).toBeGreaterThan(0);
    for (const name of banned) await expectNotSelectable(page, name);
    const resolve = rec.responses.find((entry) => entry.path.endsWith("/resolve-bans"))!;
    expect(resolve.status).toBe(200);
    expect(rec.requests.find((request) => request.path.endsWith("/resolve-bans"))!.body).toEqual({
      playerBanPreferences: ["Zeus", "Lina", "Sniper", "Kunkka"].map((name) => FIXTURE_HERO_ID_BY_NAME.get(name)),
    });
  });

  test("the configuration screen caps nominations at 4", async ({ page }) => {
    await page.goto("/simulator");
    await expect(page.getByRole("button", { name: "Iniciar Draft" })).toBeDisabled({ timeout: 60_000 });
    for (const name of ["Zeus", "Lina", "Sniper", "Kunkka"]) {
      await page.getByRole("button", { name: "Agregar héroe" }).click();
      await page.getByRole("dialog").locator(`button[title="${name}"]`).click();
    }
    await expect(page.getByRole("button", { name: "Agregar héroe" })).toHaveCount(0);
  });

  test("FAIL CLOSED: a failing ban resolution never starts Round 1, and the retry uses the same request", async ({ page }) => {
    annotate("seed", "WAVE1FCL");
    const rec = record(page);
    let failing = true;
    await page.route("**/engine/api/session/protocol/*/resolve-bans", async (route) => {
      if (failing) {
        await route.fulfill({ status: 422, contentType: "application/json", body: JSON.stringify({ error: "ban_resolution_failed", reason: "policy_failed", retryable: true }) });
        return;
      }
      await route.continue();
    });
    await configureAndStart(page, { side: "Dire", position: "Posición 1 — Carry", seed: "WAVE1FCL", banNames: ["Zeus"] });
    await expect(page.getByTestId("ban-failed")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Ronda 1 -- elegí/)).toHaveCount(0);
    expect(rec.requests.some((request) => request.path.endsWith("/auto-drive"))).toBe(false);
    expect(rec.requests.some((request) => request.path.endsWith("/command"))).toBe(false);

    failing = false;
    await page.getByRole("button", { name: "Reintentar bans" }).click();
    await expect(page.getByText(ROUND_HEADING(1, 2))).toBeVisible({ timeout: 60_000 });
    const attempts = rec.requests.filter((request) => request.path.endsWith("/resolve-bans"));
    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.body).toEqual(attempts[0]!.body);
  });
});

test.describe("Wave 1 acceptance -- timers and gold penalty (deterministic clock)", () => {
  async function advance(request: APIRequestContext, page: Page, sessionId: string, ms: number): Promise<void> {
    // Server-side Simulator timer clock (test-only seam, gated to index.e2e.ts) + the browser fake clock, in lockstep.
    const response = await request.post(`${ENGINE_DIRECT}/api/session/protocol/${sessionId}/test-advance-clock`, { data: { ms } });
    expect(response.status()).toBe(200);
    await page.clock.runFor(ms);
  }

  async function goldOf(page: Page, seatIndex: number): Promise<number> {
    const label = page.getByTestId("round-seat").nth(seatIndex).getByTestId("gold-penalty");
    if ((await label.count()) === 0) return 0;
    const match = /-(\d+) oro/.exec(await label.innerText());
    return match ? Number(match[1]) : 0;
  }

  test("expiry starts 2 gold/s per pending seat; locked seats stop; nothing is auto-picked; the Player can still pick", async ({ page, request }) => {
    annotate("seed", "WAVE1TMR");
    await page.clock.install();
    const rec = record(page);
    await configureAndStart(page, { side: "Dire", position: "Posición 3 — Offlane", seed: "WAVE1TMR", banNames: [] });
    await expect(page.getByText(ROUND_HEADING(1, 2))).toBeVisible({ timeout: 60_000 });
    const sessionId = rec.sessionId()!;
    expect(rec.snapshots().find((snapshot) => snapshot.stopReason === "human_input")!.simulator!.durationMs).toBe(25000);
    await expect(page.getByText(/^(2[0-5])s$/).first()).toBeVisible(); // visible countdown on the 25 s base
    await expect(page.getByTestId("gold-penalty")).toHaveCount(0);
    await expect(page.getByTestId("timer-expired")).toHaveCount(0);

    // Cross the 25 s deadline by 3+ s WITHOUT picking anything.
    await advance(request, page, sessionId, 28_000);
    await expect(page.getByTestId("timer-expired")).toBeVisible();
    await expect(page.getByTestId("timer-expired")).toContainText("2 de oro por segundo");
    expect(await goldOf(page, 0)).toBeGreaterThanOrEqual(6);
    expect(await goldOf(page, 1)).toBeGreaterThanOrEqual(6);
    // No hero was selected for the Player: still two pending seats, zero commands sent.
    await expect(page.getByTestId("round-seat").getByText("Pendiente")).toHaveCount(2);
    expect(rec.requests.filter((request_) => request_.path.endsWith("/command"))).toHaveLength(0);

    // The Player can still choose after expiry: lock seat 1 -- its penalty freezes, seat 2 keeps accruing.
    const first = await firstEnabled(page, [...MID, ...CARRY]);
    await heroButton(page, first).click();
    await expect(page.getByText("(1 de 2 sellados)")).toBeVisible();
    const lockedGold = await goldOf(page, 0);
    const pendingGold = await goldOf(page, 1);
    expect(lockedGold).toBeGreaterThanOrEqual(6);
    expect(pendingGold).toBeGreaterThanOrEqual(6);

    await advance(request, page, sessionId, 5_000);
    expect(await goldOf(page, 0)).toBe(lockedGold); // locked seat: frozen
    const grown = (await goldOf(page, 1)) - pendingGold;
    expect(grown).toBeGreaterThanOrEqual(10); // pending seat: 2 gold/s x 5 s
    expect(grown).toBeLessThanOrEqual(13);

    // Late pick still accepted; the round proceeds to a fresh 25 s Round 2.
    const second = await firstEnabled(page, [...OFFLANE, ...SOFT_SUPPORT]);
    await heroButton(page, second).click();
    await expect(page.getByText(ROUND_HEADING(2, 2))).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("timer-expired")).toHaveCount(0);
    const round2 = rec.snapshots().filter((snapshot) => snapshot.stopReason === "human_input").at(-1)!;
    expect(round2.simulator!.durationMs).toBe(25000);
    expect(round2.simulator!.goldPenaltyBySlot.slice(2)).toEqual([0, 0, 0]);
    expect(rec.responses.filter((entry) => entry.status >= 400)).toEqual([]);
  });
});

test.describe("Wave 1 acceptance -- hidden information and collision (deterministic, Player-visible only)", () => {
  /** Plays only round 1 through the API the UI uses and reports what the Player later SEES the enemy reveal. */
  async function revealedRound1(request: APIRequestContext, baseURL: string, seed: string): Promise<{ heroes: number[]; bansBefore: number } | null> {
    const api = `${baseURL}/engine/api/session/protocol`;
    const partyContext = { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: "player" })) };
    const created = await request.post(api, {
      data: { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", partyContext, humanPosition: 2, simulatorSeed: seed },
    });
    const { sessionId } = (await created.json()) as { sessionId: string };
    await request.post(`${api}/${sessionId}/resolve-bans`, { data: { playerBanPreferences: [] } });
    const drive = await (await request.post(`${api}/${sessionId}/auto-drive`, { data: {} })).json() as { view: { bannedHeroes: number[] } };
    let last: { view: { bannedHeroes: number[]; enemyPicks: { visibility: string; heroId?: number }[] } } | null = null;
    for (const [slotIndex, name] of ["Clockwerk", "Dazzle"].entries()) {
      const response = await request.post(`${api}/${sessionId}/command`, {
        data: { command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: FIXTURE_HERO_ID_BY_NAME.get(name) } },
      });
      last = (await response.json()) as typeof last;
    }
    if (!last || last.view.bannedHeroes.length !== drive.view.bannedHeroes.length) return null; // a collision happened in the probe
    const heroes = last.view.enemyPicks.flatMap((slot) => (slot.visibility === "REVEALED" && slot.heroId !== undefined ? [slot.heroId] : []));
    return heroes.length === 2 && heroes.every((id) => FIXTURE_HERO_NAME_BY_ID.has(id)) ? { heroes, bansBefore: drive.view.bannedHeroes.length } : null;
  }

  test("a hidden enemy pick stays selectable for the Player; picking it collides, bans it, and the pool updates", async ({ page, request, baseURL }) => {
    // Fixture seed choice (NOT a search for a collision): the first candidate seed whose Round-1 enemy heroes exist in the
    // fixture catalog, so the UI can be asked about them. The enemy Bot is deterministic per seed, so the same seed replays it.
    let seed: string | null = null;
    let enemy: number[] = [];
    for (let index = 1; index <= 24 && seed === null; index += 1) {
      const candidate = `HIDE${String(index).padStart(4, "0")}`;
      const probe = await revealedRound1(request, baseURL!, candidate);
      if (probe) {
        seed = candidate;
        enemy = probe.heroes;
      }
    }
    expect(seed, "no fixture seed produced a Round-1 enemy pair inside the fixture catalog").not.toBeNull();
    annotate("seed", seed!);
    const [enemyA, enemyB] = enemy.map((id) => FIXTURE_HERO_NAME_BY_ID.get(id)!) as [string, string];

    const rec = record(page);
    await configureAndStart(page, { side: "Radiant", position: "Posición 2 — Midlane", seed: seed!, banNames: [] });
    await expect(page.getByText(ROUND_HEADING(1, 2))).toBeVisible({ timeout: 60_000 });

    // Sealed enemy picks: HIDDEN in the API, and both heroes are still selectable in the Player's pool.
    const atRoundStart = rec.snapshots().filter((snapshot) => snapshot.stopReason === "human_input")[0]!;
    expect(atRoundStart.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }, { visibility: "HIDDEN" }]);
    await expect(heroButton(page, enemyA)).toBeEnabled();
    await expect(heroButton(page, enemyB)).toBeEnabled();

    // Pick the enemy hero A (hidden to us) plus a harmless hero -> collision at the round close.
    const other = await firstEnabled(page, ["Tinker", "Necrophos", "Luna", "Sven"].filter((name) => name !== enemyA && name !== enemyB));
    await heroButton(page, enemyA).click();
    await expect(page.getByText("(1 de 2 sellados)")).toBeVisible();
    await heroButton(page, other).click();

    await expect(page.getByText(/Baneados por colisión en esta ronda/)).toContainText(enemyA, { timeout: 30_000 });
    await expect(page.getByText(/elegí 1 héroe/)).toBeVisible(); // only the colliding seat reopened
    await expectNotSelectable(page, enemyA); // availability updated: the collision-banned hero is gone
    const afterCollision = rec.snapshots().at(-1)!;
    expect(afterCollision.view.bannedHeroes).toContain(FIXTURE_HERO_ID_BY_NAME.get(enemyA));

    // The draft still completes from here, and the banned hero is on neither team.
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (await page.getByText("Draft completo").isVisible()) break;
      const name = await firstEnabled(page, Array.from(FIXTURE_HERO_NAME_BY_ID.values())).catch(() => null);
      if (name) await heroButton(page, name).click({ timeout: 2_000 }).catch(() => undefined);
      await page.waitForTimeout(500);
    }
    await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });
    const teams = [...(await heroNamesIn(page, "summary-user-picks")), ...(await heroNamesIn(page, "summary-bot-picks"))];
    expect(teams).not.toContain(enemyA);
    expect(new Set(teams).size).toBe(10);
    assertNoSimulatorTruthLeak(rec.snapshots(), rec.responses.map((entry) => entry.body));
    expect(rec.responses.filter((entry) => entry.status >= 400)).toEqual([]);
  });
});
