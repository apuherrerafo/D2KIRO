import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_HERO_ID_BY_NAME, FIXTURE_HERO_IDS } from "./fixtures/hero-catalog";
import {
  ROUND_HEADING,
  assertNoSimulatorTruthLeak,
  configureAndStart,
  firstEnabled,
  heroButton,
  record,
  type Recorder,
} from "./support/wave1";

// WAVE 2 -- COACH ORCHESTRATION, PRODUCT ACCEPTANCE SMOKE (real browser, production web build, real
// engine, fixture DB). Entry point: `bun run test:wave2:smoke`. Reuses the Wave 1 harness
// (playwright.config.ts, e2e/support/wave1.ts); nothing here is a second framework.
//
// What is certified is ORCHESTRATION, not hero quality: an actionable primary action exists before the
// first pick; the Coach recomputes right after each own pick (no enemy reveal needed) and after each
// enemy reveal; the Player can ignore the advice; and hidden enemy identities never move the Coach.

const MID = ["Puck", "Storm Spirit", "Queen of Pain", "Tinker", "Necrophos"];
const CARRY = ["Anti-Mage", "Juggernaut", "Phantom Lancer", "Luna", "Sven"];
const OFFLANE = ["Axe", "Tidehunter", "Slardar", "Sand King"];
const SOFT_SUPPORT = ["Earthshaker", "Lion", "Windranger", "Vengeful Spirit"];
const HARD_SUPPORT = ["Crystal Maiden", "Dazzle", "Witch Doctor", "Lich"];

const STRATEGY_KINDS = ["REVEAL_POSITION", "REVEAL_HERO", "DEFER_POSITION", "REVEAL_FLEX", "OPPORTUNITY"];

interface CoachJson {
  primaryAction: { strategy: { kind: string; position?: number; heroId?: number }; label: string };
  shortlist: { heroId: number }[];
  meta: { round: number | null; trigger: string; revision: number; ownPicksRemaining: number; basedOn: { stateIdentity: string } };
}

function annotate(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

/** Every Coach output the browser received, in arrival order (the exact boundary the UI trusts). */
function coachOutputs(rec: Recorder): CoachJson[] {
  return rec.responses
    .filter((entry) => entry.method === "GET" && entry.path.endsWith("/recommendations") && entry.status === 200)
    .flatMap((entry) => {
      const body = entry.body as { output?: CoachJson | null } | null;
      return body?.output ? [body.output] : [];
    });
}

function primary(page: Page) {
  return page.getByTestId("coach-primary-action");
}

async function snapshotOfCoach(page: Page) {
  const action = primary(page);
  await expect(action).toBeVisible({ timeout: 60_000 });
  return {
    kind: (await action.getAttribute("data-strategy-kind"))!,
    trigger: (await action.getAttribute("data-trigger"))!,
    revision: Number(await action.getAttribute("data-revision")),
    identity: (await action.getAttribute("data-state-identity"))!,
    label: (await page.getByTestId("coach-primary-label").innerText()).trim(),
    shortlist: await page.getByTestId("coach-hero-card").evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id")))),
  };
}

/** Number of `GET .../recommendations` requests the browser has issued so far. */
function recommendationRequests(rec: Recorder): number {
  return rec.requests.filter((request) => request.method === "GET" && request.path.endsWith("/recommendations")).length;
}

function commandsSoFar(rec: Recorder): number {
  return rec.requests.filter((request) => request.path.endsWith("/command")).length;
}

interface CoachRun {
  side: "Radiant" | "Dire";
  position: string;
  seed: string;
  banNames: string[];
  plan: readonly (readonly (readonly string[])[])[];
}

/** Plays a full draft while asserting the Coach contract at every legal observable-state change. */
async function playWithCoach(page: Page, run: CoachRun): Promise<Recorder> {
  annotate("seed", run.seed);
  const rec = record(page);
  await configureAndStart(page, run);
  const kindsSeen: string[] = [];

  for (const [index, alternatives] of run.plan.entries()) {
    const round = (index + 1) as 1 | 2 | 3;
    await expect(page.getByText(ROUND_HEADING(round, alternatives.length))).toBeVisible({ timeout: 60_000 });

    // (a) An actionable Coach answer exists at the START of every round, before the Player picks.
    const atStart = await snapshotOfCoach(page);
    expect(STRATEGY_KINDS).toContain(atStart.kind);
    expect(atStart.label.length).toBeGreaterThan(0);
    expect(atStart.shortlist.length).toBeGreaterThan(0);
    await expect(page.getByTestId("coach-shortlist")).toBeVisible();
    kindsSeen.push(`${atStart.kind}[${atStart.label.replace(/^Sugerencia: /, "")}]`);
    if (round === 1) expect(atStart.trigger).toBe("DRAFT_PICKS_STARTED");
    else expect(atStart.trigger).toBe("ROUND_REVEALED"); // Round 2/3 open only after the enemy reveal

    if (alternatives.length === 2) {
      // (b) OWN PICK #1 -> the Coach recomputes IMMEDIATELY, before the second seat and before any enemy reveal.
      const firstName = await firstEnabled(page, alternatives[0]!);
      const requestsBefore = recommendationRequests(rec);
      await heroButton(page, firstName).click();
      await expect(page.getByText("(1 de 2 sellados)")).toBeVisible();
      await expect(primary(page)).toHaveAttribute("data-trigger", "OWN_PICK_CONFIRMED", { timeout: 30_000 });
      const afterFirst = await snapshotOfCoach(page);
      expect(afterFirst.revision).toBeGreaterThan(atStart.revision);
      expect(afterFirst.identity).not.toBe(atStart.identity);
      expect(afterFirst.shortlist).not.toContain(FIXTURE_HERO_ID_BY_NAME.get(firstName)); // our own pick is no longer an option
      expect(recommendationRequests(rec)).toBeGreaterThan(requestsBefore);
      // ...all of it while nothing is revealed: the latest snapshot still has only HIDDEN enemy slots in this round.
      const snapshot = rec.snapshots().at(-1)!;
      expect(snapshot.view.enemyPicks.filter((slot) => slot.visibility === "REVEALED")).toHaveLength(round === 1 ? 0 : 2);
      const remaining = alternatives[1]!.filter((name) => name !== firstName);
      await heroButton(page, await firstEnabled(page, remaining)).click();
    } else {
      await heroButton(page, await firstEnabled(page, alternatives[0]!)).click();
    }
  }

  await expect(page.getByText("Draft completo")).toBeVisible({ timeout: 60_000 });
  annotate("coach-strategy-kinds", kindsSeen.join(","));

  // Server-side facts about the whole run, from what the browser actually received.
  const outputs = coachOutputs(rec);
  expect(outputs.length).toBeGreaterThanOrEqual(5); // 3 round starts + 2 own-pick recomputations
  const revisions = outputs.map((output) => output.meta.revision);
  expect(revisions).toEqual([...revisions].sort((a, b) => a - b)); // monotonic per session
  expect(outputs.map((output) => output.meta.trigger)).toEqual(
    expect.arrayContaining(["DRAFT_PICKS_STARTED", "OWN_PICK_CONFIRMED", "ROUND_REVEALED"]),
  );
  expect(new Set(outputs.map((output) => output.meta.basedOn.stateIdentity)).size).toBeGreaterThanOrEqual(5);
  expect(rec.responses.filter((entry) => entry.status >= 400)).toEqual([]);
  assertNoSimulatorTruthLeak(rec.snapshots(), rec.responses.map((entry) => entry.body));
  return rec;
}

test.describe("Wave 2 acceptance -- Coach orchestration in a real browser", () => {
  test("A. Radiant: Coach action before the first pick, recomputed after own pick #1 (before the reveal) and after each enemy reveal", async ({ page }) => {
    // Same seed/plan as the Wave 1 Radiant scenario: a full draft with no collision.
    await playWithCoach(page, {
      side: "Radiant",
      position: "Posición 2 — Midlane",
      seed: "WAVE1RAD",
      banNames: ["Zeus", "Lina", "Sniper", "Kunkka"],
      plan: [[MID, CARRY], [OFFLANE, SOFT_SUPPORT], [HARD_SUPPORT]],
    });
  });

  test("B. Dire: same Coach behaviour from the other side", async ({ page }) => {
    await playWithCoach(page, {
      side: "Dire",
      position: "Posición 5 — Hard support",
      seed: "WAVE1DIR",
      banNames: [],
      plan: [[HARD_SUPPORT, OFFLANE], [CARRY, SOFT_SUPPORT], [MID]],
    });
  });

  test("C. The Player ignores the advice: a different legal hero is accepted, no 'wrong choice', and the Coach recomputes", async ({ page }) => {
    annotate("seed", "WAVE1RAD");
    const rec = record(page);
    await configureAndStart(page, { side: "Radiant", position: "Posición 2 — Midlane", seed: "WAVE1RAD", banNames: ["Zeus", "Lina", "Sniper", "Kunkka"] });
    await expect(page.getByText(ROUND_HEADING(1, 2))).toBeVisible({ timeout: 60_000 });
    const advice = await snapshotOfCoach(page);
    expect(advice.shortlist.length).toBeGreaterThan(0);

    // Deliberately choose a legal hero that is NOT in the Coach shortlist.
    const pool = [...MID, ...CARRY, ...OFFLANE, ...SOFT_SUPPORT, ...HARD_SUPPORT];
    let ignored: string | null = null;
    for (const name of pool) {
      const id = FIXTURE_HERO_ID_BY_NAME.get(name);
      const button = heroButton(page, name);
      if (id !== undefined && !advice.shortlist.includes(id) && (await button.count()) > 0 && (await button.isEnabled())) {
        ignored = name;
        break;
      }
    }
    expect(ignored, "no legal hero outside the Coach shortlist").not.toBeNull();
    await heroButton(page, ignored!).click();

    // Accepted: the seat is sealed, no rejection notice, no HTTP error -- and the Coach has recomputed.
    await expect(page.getByText("(1 de 2 sellados)")).toBeVisible();
    await expect(page.getByText(/no está disponible/)).toHaveCount(0);
    await expect(primary(page)).toHaveAttribute("data-trigger", "OWN_PICK_CONFIRMED", { timeout: 30_000 });
    const after = await snapshotOfCoach(page);
    expect(after.revision).toBeGreaterThan(advice.revision);
    expect(after.label.length).toBeGreaterThan(0);
    await expect(page.getByTestId("copilot-panel")).not.toContainText(/incorrect|equivocad|no deberías/i);
    const commands = rec.requests.filter((request) => request.path.endsWith("/command")).map((request) => (request.body as { command: { heroId: number } }).command.heroId);
    expect(commands).toEqual([FIXTURE_HERO_ID_BY_NAME.get(ignored!)]);

    // The draft keeps going: the second seat is still open and can be sealed.
    const second = await firstEnabled(page, [...CARRY, ...MID].filter((name) => name !== ignored));
    await heroButton(page, second).click();
    await expect(page.getByText(/Ronda 1 -- revelada|Ronda 2 -- elegí/).first()).toBeVisible({ timeout: 30_000 });
    expect(commandsSoFar(rec)).toBe(2);
    expect(rec.responses.filter((entry) => entry.status >= 400)).toEqual([]);
  });
});

test.describe("Wave 2 acceptance -- hidden information (deterministic setup through the test-only seam)", () => {
  interface World {
    sessionId: string;
    api: string;
    bans: number[];
  }

  async function createWorld(request: APIRequestContext, baseURL: string, seed: string): Promise<World> {
    const api = `${baseURL}/engine/api/session/protocol`;
    const partyContext = { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: "player" })) };
    const created = await request.post(api, {
      data: { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", partyContext, humanPosition: 2, simulatorSeed: seed },
    });
    expect(created.status()).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };
    const resolved = await request.post(`${api}/${sessionId}/resolve-bans`, { data: { playerBanPreferences: [] } });
    expect(resolved.status()).toBe(200);
    const { resolvedBans } = (await resolved.json()) as { resolvedBans: number[] };
    return { sessionId, api, bans: resolvedBans };
  }

  /** The Enemy Bot's seats are forced to `heroes` (test-only seam in index.e2e.ts): Simulator Truth differs, nothing else does. */
  async function forceEnemy(request: APIRequestContext, world: World, heroes: [number, number]): Promise<void> {
    for (const forcedHeroId of heroes) {
      const response = await request.post(`${world.api}/${world.sessionId}/bot-selection`, { data: { forcedHeroId } });
      expect(response.status()).toBe(200);
      expect(((await response.json()) as { accepted: boolean }).accepted).toBe(true);
    }
  }

  async function sealOwn(request: APIRequestContext, world: World, slotIndex: number, heroId: number) {
    const response = await request.post(`${world.api}/${world.sessionId}/command`, {
      data: { command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId } },
    });
    const body = (await response.json()) as { accepted: boolean; view: { enemyPicks: { visibility: string; heroId?: number }[] } };
    expect(body.accepted).toBe(true);
    return body;
  }

  async function coachOf(request: APIRequestContext, world: World): Promise<{ output: CoachJson & { sessionId?: string }; recommendationSet: { sessionId?: string } }> {
    const response = await request.get(`${world.api}/${world.sessionId}/recommendations?format=v3`);
    expect(response.status()).toBe(200);
    return (await response.json()) as never;
  }

  /** The Coach's whole answer with the (necessarily different) session id removed. */
  function normalized(body: unknown): string {
    return JSON.stringify(body, (key, value) => (key === "sessionId" ? undefined : value));
  }

  test("D. two worlds differing ONLY in the hidden enemy identity: identical Coach output before the reveal; the reveal may then legally change it", async ({ request, baseURL }) => {
    const seed = "WAVE2HID";
    annotate("seed", seed);
    const a = await createWorld(request, baseURL!, seed);
    const b = await createWorld(request, baseURL!, seed);
    expect(a.bans).toEqual(b.bans); // same seed -> same bans: the ONLY difference below is the enemy's hidden picks

    const free = [...FIXTURE_HERO_IDS].filter((id) => !a.bans.includes(id));
    expect(free.length).toBeGreaterThanOrEqual(8);
    const [ownA, ownB, hiddenX1, hiddenX2, hiddenY1, hiddenY2] = free;
    await forceEnemy(request, a, [hiddenX1!, hiddenX2!]);
    await forceEnemy(request, b, [hiddenY1!, hiddenY2!]);

    // Own pick #1 in both worlds (the Player is mid-round: the enemy's two hidden picks are sealed).
    const sealedA = await sealOwn(request, a, 0, ownA!);
    const sealedB = await sealOwn(request, b, 0, ownA!);
    for (const body of [sealedA, sealedB]) {
      expect(body.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }, { visibility: "HIDDEN" }]); // no id reaches the Player
    }

    const beforeA = await coachOf(request, a);
    const beforeB = await coachOf(request, b);
    expect(beforeA.output.meta.trigger).toBe("DRAFT_PICKS_STARTED");
    expect(normalized(beforeA)).toBe(normalized(beforeB)); // Coach output AND the V2 set it is built on: byte-identical
    assertNoSimulatorTruthLeak([], [beforeA, beforeB]);

    // Asking again changes nothing either (still hidden).
    expect(normalized(await coachOf(request, a))).toBe(normalized(await coachOf(request, b)));

    // Own pick #2 closes the round: the enemy reveal is now LEGAL information and the worlds may diverge.
    const revealedA = await sealOwn(request, a, 1, ownB!);
    const revealedB = await sealOwn(request, b, 1, ownB!);
    expect(revealedA.view.enemyPicks.map((slot) => slot.heroId).sort()).toEqual([hiddenX1, hiddenX2].sort());
    expect(revealedB.view.enemyPicks.map((slot) => slot.heroId).sort()).toEqual([hiddenY1, hiddenY2].sort());
    const afterA = await coachOf(request, a);
    const afterB = await coachOf(request, b);
    expect(afterA.output.meta.trigger).toBe("ROUND_REVEALED");
    expect(afterA.output.meta.basedOn.stateIdentity).not.toBe(afterB.output.meta.basedOn.stateIdentity);
    expect(normalized(afterA)).not.toBe(normalized(afterB));
  });
});
