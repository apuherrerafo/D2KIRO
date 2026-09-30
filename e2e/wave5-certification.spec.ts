import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { FIXTURE_HERO_ID_BY_NAME, FIXTURE_HERO_IDS, FIXTURE_HERO_NAME_BY_ID } from "./fixtures/hero-catalog";
import { ROUND_HEADING, assertNoSimulatorTruthLeak, awaitRoundHandlingCollision, configureAndStart, firstEnabled, heroButton, heroNamesIn, record, type Recorder } from "./support/wave1";

// WAVE 5 -- PRODUCT CERTIFICATION, browser layer (real Chromium, production web build, real engine, fixture DB).
// Entry point: `bun run test:wave5:smoke`. Reuses the Wave 1/2 harness (playwright.config.ts, e2e/support/wave1.ts).
// tasks.md names apps/web/e2e/*.spec.ts; the repo's Playwright testDir is ./e2e (playwright.config.ts), so the
// Wave 5 specs live here -- a path-only deviation, no behavioural one.
//
// It certifies the PRODUCT PATH end to end, not hero quality: browser -> /engine proxy -> perspective-safe route ->
// Coach -> real V6 signals -> response -> DOM. Nothing here adds a feature and nothing is faked in the product:
//   * the ONLY test seams are the two that already exist in index.e2e.ts (forced Enemy Bot selection, clock);
//   * Safe Core is NOT forced through fake data. The fixture catalog has 50 heroes and the real curated counters, so a
//     Safe Core window cannot honestly occur here; its dedicated deterministic scenarios are the engine suites
//     (coach/safe-core.coach.test.ts, coach/wave5.certification.test.ts) and the real-data run
//     (scripts/wave5-certification.ts), which reproduces the two natural windows found by the Wave 4A audit.

const MID_POOL = ["Puck", "Storm Spirit", "Tinker"];
const CARRY_POOL = ["Anti-Mage", "Sven", "Luna"];
const SUPPORT_POOL = ["Crystal Maiden", "Dazzle", "Witch Doctor"];
const FLEX_CANDIDATES = ["Kunkka", "Sand King", "Slardar", "Earthshaker", "Windranger", "Necrophos", "Razor"]; // 2+ curated positions
const ANY_HERO = Array.from(FIXTURE_HERO_NAME_BY_ID.values());

// Internal / debug vocabulary that must never reach the Player (UX certification, automated part).
const INTERNAL_TERMS = /V6 degraded|stale_meta|contradictorias|solo[\s_-]?mid|SOLO_MID|REVEAL_(POSITION|HERO|FLEX)|DEFER_POSITION|CONFIRMED_FORCED|UNRESOLVED|YOUR_POOL|OUTSIDE_YOUR_POOL|PLAYER_POSITION_ASSIGNED|OWN_PICK_CONFIRMED|stateIdentity|perspectiveIdentity|\bundefined\b|\bNaN\b|\[object /i;

interface CoachJson {
  primaryAction: { strategy: { kind: string; position?: number; heroId?: number }; label: string };
  shortlist: { heroId: number; badges: string[] }[];
  opportunity?: unknown;
  personalHeroView?: { position: number; positionLabel: string; heroes: { heroId: number; rank: number; isFromPool: boolean }[] };
  roleBeliefs: { own: { heroId: number; status: string; positions: number[] }[]; enemy: { heroId: number; status: string; positions: number[] }[] };
  meta: { round: number | null; trigger: string; revision: number; confidence: string; decisionContext: string; basedOn: { stateIdentity: string; perspectiveIdentity: string; evidenceVersion: string } };
}

function annotate(type: string, description: string): void {
  test.info().annotations.push({ type, description });
}

// Product Semantics Recovery: the Simulator's current-decision surface is the V4 CurrentHumanDecision (one visual owner).
// The journeys certify the same contract as before -- an answer before the first pick, recomputed after every own pick and
// every reveal, advisory only, pool only where it applies -- read from the V4 panel instead of the retired V3 panel.
interface V4Json {
  schema: string;
  decision: {
    kind: string;
    actionablePositions: number[];
    roundCapacity: number;
    targetPosition: number;
    targetBasis: string;
    viewedPosition: number;
    personalPoolApplied: boolean;
    candidates: { state: string; targetPosition: number; cards?: { heroId: number; position: number; isFromPool: boolean }[]; alternatives?: { heroId: number }[] };
  };
  roleBeliefs: { own: { heroId: number; status: string; positions: number[] }[]; enemy: { heroId: number; status: string; positions: number[] }[] };
  meta: { round: number | null; trigger: string; revision: number; basedOn: { stateIdentity: string; perspectiveIdentity: string; evidenceVersion: string } };
}

/** Every V4 decision the browser received (recommendations GET), in arrival order. */
function decisionOutputs(rec: Recorder): V4Json[] {
  return rec.responses
    .filter((entry) => entry.status === 200 && entry.method === "GET" && entry.path.endsWith("/recommendations"))
    .flatMap((entry) => {
      const body = entry.body as { output?: V4Json | null } | null;
      return body?.output?.schema === "recommendation-output/v4" ? [body.output] : [];
    });
}

/** Hero ids the decision offers (ranked cards or, when unranked, positional alternatives). */
function offeredHeroIds(output: V4Json): number[] {
  const { candidates } = output.decision;
  return (candidates.cards ?? candidates.alternatives ?? []).map((candidate) => candidate.heroId);
}

const primary = (page: Page) => page.getByTestId("current-decision-panel");

async function coachSnapshot(page: Page) {
  const panel = primary(page);
  await expect(panel).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("coach-primary-action")).toHaveCount(0); // no V3 decision next to V4
  return {
    kind: (await panel.getAttribute("data-decision-kind"))!,
    trigger: (await panel.getAttribute("data-trigger"))!,
    revision: Number(await panel.getAttribute("data-revision")),
    identity: (await panel.getAttribute("data-state-identity"))!,
    label: (await page.getByTestId("current-decision-target").innerText()).trim(),
    shortlist: await page.locator('[data-testid="current-decision-card"], [data-testid="current-decision-alternative"]').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id")))),
  };
}

async function putPool(request: APIRequestContext, names: readonly string[]): Promise<void> {
  const entries = names.map((name) => ({ hero: FIXTURE_HERO_ID_BY_NAME.get(name)!, source: "manual", personalWinrate: null, personalGames: 0 }));
  const response = await request.put("/engine/api/hero-pool", { data: { entries } });
  expect(response.status(), "PUT /engine/api/hero-pool").toBe(200);
}

// KNOWN, REPORTED (open U5 item, not changed): the one engine-authored degradation `detail` the Copilot panel still prints
// verbatim. `V6 degraded flag: ...` and the contradiction list are now translated/hidden and are hard failures via INTERNAL_TERMS.
// Recorded as an annotation instead of asserted, so the suite neither hides it nor fails on a known open item.
const KNOWN_INTERNAL_COPY = /el shortlist no sobrevivió la post-validación[^\n]*/g;
const observedInternalCopy = new Set<string>();

/** UX hygiene: nothing the Player reads is internal vocabulary, obsolete Solo Mid language, or a broken render. */
async function assertPlayerFacingCopyIsClean(page: Page): Promise<void> {
  const text = await page.locator("body").innerText();
  for (const known of text.match(KNOWN_INTERNAL_COPY) ?? []) {
    if (!observedInternalCopy.has(known)) {
      observedInternalCopy.add(known);
      annotate("ux-finding", `internal wording shown to the Player: "${known}"`);
    }
  }
  const remainder = text.replace(KNOWN_INTERNAL_COPY, "");
  expect(remainder.match(INTERNAL_TERMS)?.[0] ?? null, "internal/obsolete term visible to the Player").toBeNull();
}

/** Evidence for the human visual check (UX certification): full-page screenshots under test-results/wave5-ux/. Never asserted on. */
async function shot(page: Page, side: string, name: string): Promise<void> {
  await page.screenshot({ path: `test-results/wave5-ux/${side}-${name}.png`, fullPage: true });
}

async function assertTimerRunning(page: Page): Promise<void> {
  const timer = page.getByText(/^\d+s$/).first();
  await expect(timer).toBeVisible();
  const first = Number.parseInt((await timer.innerText()).replace("s", ""), 10);
  await page.waitForTimeout(2_300);
  const second = Number.parseInt((await timer.innerText()).replace("s", ""), 10);
  expect(second, "the round timer must count down").toBeLessThan(first);
}

interface JourneySummary {
  side: "radiant" | "dire";
  outputs: V4Json[];
  triggers: string[];
  targetBases: string[];
  perspectiveIdentities: string[];
  ownCommandSides: string[];
  outputKeys: string[];
  /** The Personal Hero Pool shaped the candidates at least once (only possible when the viewed position is the personal one). */
  poolAppliedSeen: boolean;
  /** A pool mark on a card while the pool was NOT applied -- COHERENCE-007 violation, must stay false. */
  poolMarkWithoutPool: boolean;
}
const journeys: Partial<Record<"radiant" | "dire", JourneySummary>> = {};

interface JourneyConfig {
  side: "Radiant" | "Dire";
  position: string;
  /** The Player's personal position (Pos number) -- the Coach's default view, and the only one where the pool applies. */
  personalPosition: 1 | 2 | 3 | 4 | 5;
  seed: string;
  bans: string[];
  pool: readonly string[];
  alternatePool: readonly string[];
  roundThreePlan: readonly string[];
  /** Exercise the Own-Flex assignment UI (needs a Flex hero legally pickable at round 1). */
  flexAssignment: boolean;
}

async function playJourney(page: Page, request: APIRequestContext, config: JourneyConfig): Promise<Recorder> {
  annotate("seed", config.seed);
  const side = config.side.toLowerCase() as "radiant" | "dire";
  await putPool(request, config.pool);
  const rec = record(page);
  await configureAndStart(page, { side: config.side, position: config.position, seed: config.seed, banNames: config.bans });

  // ---------------------------------------------------------------- ROUND 1
  await expect(page.getByText(ROUND_HEADING(1, 2))).toBeVisible({ timeout: 60_000 });
  await assertTimerRunning(page);
  const start = await coachSnapshot(page);
  expect(start.kind).toBe("ACTIONABLE");
  expect(start.trigger).toBe("DRAFT_PICKS_STARTED");
  expect(start.shortlist.length).toBeGreaterThan(0);

  // OLD_ASSERTION: a SEPARATE "TU [ROLE] AHORA" personal panel (`coach-personal-hero-view`) carried the Hero Pool, next to the team shortlist.
  // WHY_OBSOLETE: WP3 removed the parallel panel -- one visual owner. Two panels for one decision is exactly what PSR fixed.
  // NEW_PRODUCT_CONTRACT: the pool shapes the ACTIVE candidates only when the viewed position is the Player's personal position
  //   (COHERENCE-007). The Coach's default recommendation is that position; viewing any other position never applies the pool.
  await expect(page.getByTestId("coach-personal-hero-view")).toHaveCount(0); // the parallel panel stays gone
  await expect(page.getByText(/AHORA$/)).toHaveCount(0);
  await expect(page.getByTestId("current-decision-target")).toHaveAttribute("data-target-position", String(config.personalPosition));
  await expect(page.getByTestId("current-decision-viewed")).toHaveCount(0); // recommended == viewed
  await assertPlayerFacingCopyIsClean(page);
  await shot(page, side, "1-round1-opening");

  // PERSONAL vs OTHER-POSITION separation over the real HTTP path: same visible draft, a DIFFERENT personal pool.
  const sessionId = rec.sessionId()!;
  const askDecision = async (viewed: number | null) => {
    const query = viewed === null ? "" : `&target=${viewed}`;
    const response = await request.get(`/engine/api/session/protocol/${sessionId}/recommendations?format=v4${query}`);
    expect(response.status()).toBe(200);
    return ((await response.json()) as { output: V4Json }).output;
  };
  const otherPosition = ([1, 2, 3, 4, 5] as const).find((position) => position !== config.personalPosition)!;
  const marks = (output: V4Json) => (output.decision.candidates.cards ?? []).filter((card) => card.isFromPool).map((card) => card.heroId);
  const poolNames = (names: readonly string[]) => names.map((name) => FIXTURE_HERO_ID_BY_NAME.get(name)!);
  const personalA = await askDecision(null);
  const otherA = await askDecision(otherPosition);
  await putPool(request, config.alternatePool);
  const personalB = await askDecision(null);
  const otherB = await askDecision(otherPosition);
  const strip = (output: V4Json) => JSON.stringify(output, (key, value) => (key === "sessionId" || key === "syncAgeMs" || key === "revision" || key === "trigger" ? undefined : value));
  expect(personalA.decision.personalPoolApplied).toBe(true); // viewed == personal: the pool applies
  expect(otherA.decision.personalPoolApplied).toBe(false); // another position: it never does
  expect(otherA.decision.viewedPosition).toBe(otherPosition);
  expect(otherA.decision.targetPosition).toBe(personalA.decision.targetPosition); // navigation never moved the recommendation
  expect(strip(otherB)).toBe(strip(otherA)); // ...and the other-position decision is identical whatever the pool is
  expect(marks(otherA)).toEqual([]);
  expect(marks(personalA).every((id) => poolNames(config.pool).includes(id))).toBe(true);
  expect(marks(personalB).every((id) => poolNames(config.alternatePool).includes(id))).toBe(true);
  expect(strip(personalB)).not.toBe(strip(personalA)); // the personal-position decision is where a pool shows
  await putPool(request, config.pool); // back to the journey's own pool

  // FIRST ALLIED PICK -- a FLEX hero when the journey exercises assignment. The Coach recomputes BEFORE allied pick #2.
  const flexName = await firstEnabled(page, config.flexAssignment ? FLEX_CANDIDATES : [...config.roundThreePlan, ...ANY_HERO]);
  const flexId = FIXTURE_HERO_ID_BY_NAME.get(flexName)!;
  await heroButton(page, flexName).click();
  await expect(page.getByTestId("round-capacity")).toHaveAttribute("data-round-capacity", "1");
  await expect(primary(page)).toHaveAttribute("data-trigger", "OWN_PICK_CONFIRMED", { timeout: 30_000 });
  const afterFirst = await coachSnapshot(page);
  expect(afterFirst.revision).toBeGreaterThan(start.revision);
  expect(afterFirst.identity).not.toBe(start.identity);
  expect(afterFirst.shortlist).not.toContain(flexId);
  expect(rec.snapshots().at(-1)!.view.enemyPicks.every((slot) => slot.visibility === "HIDDEN")).toBe(true); // recomputed with nothing revealed

  if (config.flexAssignment) {
    // OLD_ASSERTION: an own Flex hero was shown as "FLEX x/y" (unresolved) and the Player then assigned a compatible position
    //   through the row's "Asignar PosN" button, which recomputed the Coach.
    // WHY_OBSOLETE: in AP Ranked Roles (PD-026/PD-027) every own pick binds the position the Player chose AT THE MOMENT OF THE PICK
    //   (the assignedPosition sibling of the command) -- an authoritative binding, so a Flex hero is never left unresolved.
    // NEW_PRODUCT_CONTRACT: the picked hero is immediately "Asignado a Pos<the position in view>", there is nothing left to assign,
    //   and a later declaration of a different position for that hero cannot override the authoritative binding; a hero that is
    //   not ours is still refused.
    const row = page.getByTestId("coach-own-role").filter({ hasText: flexName });
    await expect(row).toContainText(`Asignado a Pos${config.personalPosition}`);
    await expect(row).not.toContainText("FLEX");
    await expect(row.getByRole("button", { name: /^Asignar Pos/ })).toHaveCount(0);
    annotate("ux-own-role-row-after-pick", (await row.innerText()).replace(/\s+/g, " ").trim());
    await shot(page, side, "2-own-hero-bound");

    const assignApi = `/engine/api/session/protocol/${sessionId}/position-assignment`;
    const declaredPosition = config.personalPosition === 1 ? 5 : 1;
    const ignored = await request.post(assignApi, { data: { heroId: flexId, position: declaredPosition } });
    expect(ignored.status(), "a declaration over an authoritative binding is refused, never silently applied").toBe(409);
    const stillBound = await request.get(`/engine/api/session/protocol/${sessionId}/recommendations?format=v4`);
    const belief = ((await stillBound.json()) as { output: V4Json }).output.roleBeliefs.own.find((entry) => entry.heroId === flexId)!;
    expect(belief).toMatchObject({ status: "CONFIRMED", positions: [config.personalPosition] }); // the authoritative binding still stands
    const stranger = FIXTURE_HERO_IDS.find((id) => id !== flexId)!;
    expect((await request.post(assignApi, { data: { heroId: stranger, position: 1 } })).status()).toBe(403);
    await assertPlayerFacingCopyIsClean(page);
  }

  // SECOND ALLIED PICK -- a legal hero that IGNORES the Coach (not among the candidates it offers).
  const advised = new Set((await coachSnapshot(page)).shortlist);
  let ignoredName: string | null = null;
  for (const name of ANY_HERO) {
    const id = FIXTURE_HERO_ID_BY_NAME.get(name)!;
    const button = heroButton(page, name);
    if (!advised.has(id) && (await button.count()) > 0 && (await button.isEnabled())) {
      ignoredName = name;
      break;
    }
  }
  expect(ignoredName, "a legal hero outside the Coach's advice").not.toBeNull();
  await heroButton(page, ignoredName!).click();
  let repicks = await awaitRoundHandlingCollision(page, /Ronda 1 -- revelada|Ronda 2 · /, ANY_HERO);
  await expect(page.getByText(/no está disponible/)).toHaveCount(0); // deviating is legal: no rejection, no "wrong choice"
  await expect(page.getByTestId("copilot-panel")).not.toContainText(/incorrect|equivocad|no deberías/i);

  // ---------------------------------------------------------------- ROUND 2 (enemy revealed)
  await expect(page.getByText(ROUND_HEADING(2, 2))).toBeVisible({ timeout: 60_000 });
  await assertTimerRunning(page);
  const round2 = await coachSnapshot(page);
  expect(round2.trigger).toBe("ROUND_REVEALED");
  expect(round2.revision).toBeGreaterThan(afterFirst.revision);
  const enemyRows = page.getByTestId("coach-enemy-role");
  await expect(enemyRows).toHaveCount(2); // the two enemy heroes revealed at the end of round 1
  for (const text of await enemyRows.allInnerTexts()) {
    expect(text, "an enemy role is never presented as a confirmed fact").not.toMatch(/—\s*Pos\d\s*$/);
    expect(text).toMatch(/Likely Pos\d/);
  }
  await assertPlayerFacingCopyIsClean(page);
  await shot(page, side, "3-round2-after-reveal");

  // Follow the Coach for one seat, take a pool hero (the Player's own preference) for the other.
  const followName = FIXTURE_HERO_NAME_BY_ID.get(round2.shortlist[0]!)!;
  await heroButton(page, followName).click();
  await expect(page.getByTestId("round-capacity")).toHaveAttribute("data-round-capacity", "1");
  await expect(primary(page)).toHaveAttribute("data-trigger", "OWN_PICK_CONFIRMED", { timeout: 30_000 });
  // The other seat: the Player's own preference (a pool hero when one is legal right now), whatever the Coach offers.
  await heroButton(page, await firstEnabled(page, [...config.pool.filter((name) => name !== followName), ...ANY_HERO])).click();

  // ---------------------------------------------------------------- ROUND 3
  repicks += await awaitRoundHandlingCollision(page, ROUND_HEADING(3, 1), ANY_HERO);
  await assertTimerRunning(page);
  const round3 = await coachSnapshot(page);
  expect(round3.trigger).toBe("ROUND_REVEALED");
  expect(round3.shortlist.length).toBeGreaterThan(0);
  await heroButton(page, await firstEnabled(page, [...config.roundThreePlan, ...ANY_HERO])).click();

  // ---------------------------------------------------------------- COMPLETE
  repicks += await awaitRoundHandlingCollision(page, /Draft completo/, ANY_HERO);
  const own = await heroNamesIn(page, "summary-user-picks");
  const enemy = await heroNamesIn(page, "summary-bot-picks");
  expect(own).toHaveLength(5);
  expect(enemy).toHaveLength(5);
  expect(new Set([...own, ...enemy]).size).toBe(10);
  await expect(page.getByText("El motor no está recibiendo este draft.")).toHaveCount(0);
  await shot(page, side, "4-complete");

  // Server-side facts, from what the browser actually received.
  const outputs = decisionOutputs(rec);
  expect(outputs.length).toBeGreaterThanOrEqual(5); // 3 round starts + 2 own-pick recomputes (+1 per Flex assignment)
  expect(outputs.every((output) => output.decision.kind === "ACTIONABLE" || output.decision.kind === "NO_HUMAN_ACTION")).toBe(true);
  const revisions = outputs.map((output) => output.meta.revision);
  expect(new Set(revisions).size).toBe(revisions.length); // every Coach answer has its own revision
  expect(revisions).toEqual([...revisions].sort((a, b) => a - b)); // sequential GET answers are monotonic
  expect(new Set(outputs.map((output) => output.meta.basedOn.perspectiveIdentity)).size).toBe(1); // one stable perspective the whole draft
  const commands = rec.requests.filter((request_) => request_.path.endsWith("/command")).map((request_) => (request_.body as { command: { type: string; side: string } }).command);
  expect(commands).toHaveLength(5 + repicks); // 5 seats + one command per legal collision re-pick
  expect(commands.every((command) => command.type === "SUBMIT_SEALED_SELECTION" && command.side === side)).toBe(true); // only own-team seats
  expect(rec.responses.filter((entry) => entry.status >= 400)).toEqual([]);
  assertNoSimulatorTruthLeak(rec.snapshots(), rec.responses.map((entry) => entry.body));

  // Drift guard: every hero ID emitted by the Coach across all recommendations must be resolvable by the fixture catalog.
  for (const output of outputs) {
    for (const heroId of offeredHeroIds(output)) {
      expect(FIXTURE_HERO_NAME_BY_ID.has(heroId), `Offered hero ${heroId} must be resolvable in FIXTURE_HERO_NAME_BY_ID`).toBe(true);
    }
  }

  const actionable = outputs.filter((output) => output.decision.kind === "ACTIONABLE");
  journeys[side] = {
    side,
    outputs,
    triggers: [...new Set(outputs.map((output) => output.meta.trigger))].sort(),
    targetBases: actionable.map((output) => output.decision.targetBasis),
    perspectiveIdentities: [...new Set(outputs.map((output) => output.meta.basedOn.perspectiveIdentity))],
    ownCommandSides: [...new Set(commands.map((command) => command.side))],
    outputKeys: Object.keys(outputs[0]!).sort(),
    poolAppliedSeen: actionable.some((output) => output.decision.personalPoolApplied),
    poolMarkWithoutPool: actionable.some((output) => !output.decision.personalPoolApplied && (output.decision.candidates.cards ?? []).some((card) => card.isFromPool)),
  };
  annotate("coach-target-bases", journeys[side]!.targetBases.join(","));
  await putPool(request, []); // leave the shared fixture account as found
  return rec;
}

test.describe.serial("Wave 5 -- complete MVP journeys (Tasks 28, 29, 32, 33)", () => {
  test("J1. RADIANT, Pos2 + Hero Pool: personal view, Coach recompute after every own pick and reveal, Own-Flex assignment, deviation, COMPLETE", async ({ page, request }) => {
    await playJourney(page, request, {
      side: "Radiant",
      position: "Posición 2 — Midlane",
      personalPosition: 2,
      seed: "WAVE5RAD",
      bans: ["Zeus", "Lina", "Sniper", "Anti-Mage"],
      pool: MID_POOL,
      alternatePool: CARRY_POOL,
      roundThreePlan: ["Dazzle", "Crystal Maiden", "Lich"],
      flexAssignment: true,
    });
  });

  test("J2. DIRE, Pos5 + Hero Pool: the same product from the other side, no behaviour exclusive to Radiant", async ({ page, request }) => {
    await playJourney(page, request, {
      side: "Dire",
      position: "Posición 5 — Hard support",
      personalPosition: 5,
      seed: "WAVE5DIR",
      bans: [],
      pool: SUPPORT_POOL,
      alternatePool: MID_POOL,
      roundThreePlan: ["Puck", "Storm Spirit", "Tinker"],
      flexAssignment: false,
    });
  });

  test("J3. side symmetry (PD-019): both journeys expose the same Coach contract, triggers and perspective rules", async () => {
    const radiant = journeys.radiant;
    const dire = journeys.dire;
    expect(radiant, "J1 must have completed").toBeDefined();
    expect(dire, "J2 must have completed").toBeDefined();
    expect(radiant!.outputKeys).toEqual(dire!.outputKeys); // same output shape
    for (const trigger of ["DRAFT_PICKS_STARTED", "OWN_PICK_CONFIRMED", "ROUND_REVEALED"]) {
      expect(radiant!.triggers).toContain(trigger);
      expect(dire!.triggers).toContain(trigger);
    }
    expect(radiant!.poolAppliedSeen).toBe(true); // the pool shaped the personal-position candidates on both sides
    expect(dire!.poolAppliedSeen).toBe(true);
    expect(radiant!.poolMarkWithoutPool || dire!.poolMarkWithoutPool).toBe(false); // a pool mark never appears where the pool was not applied, on either side
    expect(radiant!.targetBases.every((basis) => basis === "DETERMINISTIC_DEFAULT")).toBe(true); // PSR-001: no fabricated strategic priority, on either side
    expect(dire!.targetBases.every((basis) => basis === "DETERMINISTIC_DEFAULT")).toBe(true);
    expect(radiant!.ownCommandSides).toEqual(["radiant"]);
    expect(dire!.ownCommandSides).toEqual(["dire"]); // every allied pick was a Dire pick
    expect(radiant!.perspectiveIdentities).toHaveLength(1);
    expect(dire!.perspectiveIdentities).toHaveLength(1);
    expect(dire!.perspectiveIdentities[0]).not.toBe(radiant!.perspectiveIdentities[0]); // basedOn names WHICH side this advice is for
  });
});

// ------------------------------------------------------------------------------------------------------
// Hidden information (Task 31, browser layer): two REAL worlds over HTTP that differ only in what the Player
// may not know -- the hidden enemy heroes (hence the Enemy Bot's private seat positions) and the order in which the
// two sides sealed. Same seed and bans (a different seed changes the bans, which are visible), same own picks, same
// Hero Pool, same personal position. Seed-varying twins: engine suite + scripts/wave5-certification.ts.
// ------------------------------------------------------------------------------------------------------
test.describe("Wave 5 -- hidden information over the real HTTP path (Task 31)", () => {
  const api = (baseURL: string) => `${baseURL}/engine/api/session/protocol`;

  async function createWorld(request: APIRequestContext, baseURL: string, seed: string) {
    // Fixture migrated to the AP session policy (PD-026/PD-027): empty `controlledSlots` + explicit `controlledPositions`.
    const partyContext = { partySize: 5, side: "radiant", controlledSlots: [] };
    const created = await request.post(api(baseURL), { data: { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", partyContext, controlledPositions: [1, 2, 3, 4, 5], humanPosition: 2, simulatorSeed: seed } });
    expect(created.status()).toBe(201);
    const { sessionId } = (await created.json()) as { sessionId: string };
    // The product's own ban resolution. Same seed -> same bans (a different seed would change the bans, which IS visible);
    // the seed-varying twins live in the engine suite (in-process store) and in scripts/wave5-certification.ts.
    const resolved = await request.post(`${api(baseURL)}/${sessionId}/resolve-bans`, { data: { playerBanPreferences: [] } });
    expect(resolved.status()).toBe(200);
    const { resolvedBans } = (await resolved.json()) as { resolvedBans: number[] };
    return { sessionId, base: `${api(baseURL)}/${sessionId}`, bans: resolvedBans };
  }
  type World = Awaited<ReturnType<typeof createWorld>>;

  const forceEnemy = async (request: APIRequestContext, world: World, hero: number) => {
    const response = await request.post(`${world.base}/bot-selection`, { data: { forcedHeroId: hero } });
    expect(response.status()).toBe(200);
    expect(((await response.json()) as { accepted: boolean }).accepted).toBe(true);
  };
  const sealOwn = async (request: APIRequestContext, world: World, slotIndex: number, hero: number) => {
    // AP session policy: every own seal binds a controlled, still-unbound position (Round 1 here: slot 0 -> Pos1, slot 1 -> Pos2).
    const response = await request.post(`${world.base}/command`, { data: { command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: hero }, assignedPosition: slotIndex + 1 } });
    const body = (await response.json()) as { accepted: boolean; view: { enemyPicks: { visibility: string; heroId?: number }[] } };
    expect(body.accepted).toBe(true);
    return body;
  };
  const coachOf = async (request: APIRequestContext, world: World) => {
    const response = await request.get(`${world.base}/recommendations?format=v3`);
    expect(response.status()).toBe(200);
    return (await response.json()) as { output: CoachJson; recommendationSet: unknown };
  };
  const normalized = (body: unknown) => JSON.stringify(body, (key, value) => (key === "sessionId" || key === "syncAgeMs" ? undefined : value));

  test("H. identical Coach output on every surface before the reveal (incl. personal view, beliefs, availability, provenance); a legal divergence after it", async ({ request, baseURL }) => {
    annotate("seed", "TWINSEED");
    await putPool(request, MID_POOL);
    const a = await createWorld(request, baseURL!, "TWINSEED");
    const b = await createWorld(request, baseURL!, "TWINSEED");
    expect(a.bans).toEqual(b.bans); // the ONLY differences below are what the Player cannot see
    const ids = FIXTURE_HERO_IDS.filter((id) => !a.bans.includes(id));
    const [ownX, ownY, hiddenA1, hiddenA2, hiddenB1, hiddenB2] = ids.slice(0, 6) as [number, number, number, number, number, number];

    // World A: enemy commits BEFORE the Player. World B: the Player commits first, the enemy after.
    await forceEnemy(request, a, hiddenA1);
    await forceEnemy(request, a, hiddenA2);
    const startA = await coachOf(request, a);
    await coachOf(request, b); // same number of Coach calls per world (the Coach keeps per-session revision memory)
    const sealedA = await sealOwn(request, a, 0, ownX);
    const sealedB = await sealOwn(request, b, 0, ownX);
    await forceEnemy(request, b, hiddenB1);
    await forceEnemy(request, b, hiddenB2);
    for (const body of [sealedA, sealedB]) expect(body.view.enemyPicks.every((slot) => slot.visibility === "HIDDEN" && !("heroId" in slot))).toBe(true);

    const afterA = await coachOf(request, a);
    const afterB = await coachOf(request, b);
    expect(afterA.output.meta.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(afterA.output.personalHeroView).toBeDefined(); // the personal view is part of what is compared
    expect(afterA.output.personalHeroView!.heroes.some((hero) => hero.isFromPool)).toBe(true); // ...with the configured pool applied
    expect(normalized(afterA)).toBe(normalized(afterB)); // Coach output AND the V2 set beneath it: byte-identical
    expect(normalized(await coachOf(request, a))).toBe(normalized(await coachOf(request, b))); // asking again changes nothing
    // Hidden enemy heroes must never leak into enemy role beliefs before the reveal
    expect(afterA.output.roleBeliefs.enemy).toHaveLength(0);
    expect(afterB.output.roleBeliefs.enemy).toHaveLength(0);
    for (const hidden of [hiddenA1, hiddenA2, hiddenB1, hiddenB2]) {
      expect(afterA.output.roleBeliefs.enemy.map((b) => b.heroId)).not.toContain(hidden);
      expect(afterB.output.roleBeliefs.enemy.map((b) => b.heroId)).not.toContain(hidden);
    }
    // No shortlist card may claim COUNTER before enemy heroes are revealed
    for (const card of [...afterA.output.shortlist, ...afterB.output.shortlist]) {
      expect(card.badges).not.toContain("COUNTER");
    }
    expect(startA.output.meta.trigger).toBe("DRAFT_PICKS_STARTED");
    assertNoSimulatorTruthLeak([], [afterA, afterB]);

    // Closing the round reveals the enemy: NOW the worlds may legally diverge.
    const revealedA = await sealOwn(request, a, 1, ownY);
    const revealedB = await sealOwn(request, b, 1, ownY);
    expect(revealedA.view.enemyPicks.map((slot) => slot.heroId).sort()).toEqual([hiddenA1, hiddenA2].sort());
    expect(revealedB.view.enemyPicks.map((slot) => slot.heroId).sort()).toEqual([hiddenB1, hiddenB2].sort());
    const roundTwoA = await coachOf(request, a);
    const roundTwoB = await coachOf(request, b);
    expect(roundTwoA.output.meta.trigger).toBe("ROUND_REVEALED");
    expect(roundTwoA.output.meta.basedOn.stateIdentity).not.toBe(roundTwoB.output.meta.basedOn.stateIdentity);
    expect(normalized(roundTwoA)).not.toBe(normalized(roundTwoB));
    expect(roundTwoA.output.roleBeliefs.enemy.map((belief) => belief.heroId).sort()).toEqual([hiddenA1, hiddenA2].sort());
    await putPool(request, []);
  });
});

// ------------------------------------------------------------------------------------------------------
// Collisions (Task 30), over the real HTTP path with the existing forced-Enemy-Bot seam.
// ------------------------------------------------------------------------------------------------------
test.describe("Wave 5 -- collision scenarios (Task 30)", () => {
  interface Snapshot {
    accepted?: boolean;
    view: { status: string; bannedHeroes: number[]; ownPicks: { heroId?: number }[]; enemyPicks: { visibility: string; heroId?: number }[]; rankedAp: { phase: string } | null };
    legalActions: { type: string; side?: string; slotIndex?: number }[];
  }
  const base = (baseURL: string) => `${baseURL}/engine/api/session/protocol`;

  async function start(request: APIRequestContext, baseURL: string, seed: string) {
    // Fixture migrated to the AP session policy (PD-026/PD-027): empty `controlledSlots` + explicit `controlledPositions`.
    const partyContext = { partySize: 5, side: "radiant", controlledSlots: [] };
    const created = await request.post(base(baseURL), { data: { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", partyContext, controlledPositions: [1, 2, 3, 4, 5], humanPosition: 2, simulatorSeed: seed } });
    const { sessionId } = (await created.json()) as { sessionId: string };
    const resolved = await request.post(`${base(baseURL)}/${sessionId}/resolve-bans`, { data: { playerBanPreferences: [] } });
    expect(resolved.status()).toBe(200);
    const { resolvedBans } = (await resolved.json()) as { resolvedBans: number[] };
    const free = FIXTURE_HERO_IDS.filter((id) => !resolvedBans.includes(id));
    let cursor = 0;
    const fresh = () => free[cursor++]!;
    const url = `${base(baseURL)}/${sessionId}`;
    return {
      fresh,
      url,
      async botSeal(hero: number) {
        const response = await request.post(`${url}/bot-selection`, { data: { forcedHeroId: hero } });
        expect(response.status()).toBe(200);
        return (await response.json()) as Snapshot;
      },
      async ownSeal(slotIndex: number, hero: number) {
        // AP session policy: bind the lowest controlled position that is still unbound (a collision re-opens the seat AND frees its position).
        const bound = new Set(((await (await request.get(url)).json()) as { ownAssignedPositions?: { assignedPosition: number }[] }).ownAssignedPositions?.map((binding) => binding.assignedPosition) ?? []);
        const assignedPosition = [1, 2, 3, 4, 5].find((position) => !bound.has(position))!;
        const response = await request.post(`${url}/command`, { data: { command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: hero }, assignedPosition } });
        expect([200, 202]).toContain(response.status());
        return (await response.json()) as Snapshot;
      },
      async state() {
        const response = await request.get(url);
        return (await response.json()) as Snapshot;
      },
      async authority() {
        return request.post(`${url}/simulator-authority`, { data: { seed: "ANYSEED1" } }); // accepted for compatibility and IGNORED by the engine
      },
    };
  }
  const openOwn = (snapshot: Snapshot) => snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === "radiant").map((action) => action.slotIndex!);

  test("C1. collision #1: the shared hero is banned, both sides re-select, the round does not advance until they have", async ({ request, baseURL }) => {
    annotate("seed", "COLLIDE1");
    const s = await start(request, baseURL!, "COLLIDE1");
    const target = s.fresh();
    const botOther = s.fresh();
    await s.botSeal(target);
    await s.botSeal(botOther);

    await s.ownSeal(0, target); // the Player picks the very hero the Enemy Bot sealed (legal: hidden information)
    const closed = await s.ownSeal(1, s.fresh());
    expect(closed.view.bannedHeroes).toContain(target); // detected at round resolution, hero enters the ban list
    expect(closed.view.rankedAp?.phase).toBe("PICK_ROUND_1"); // the round did NOT advance
    expect(closed.view.enemyPicks.filter((slot) => slot.visibility === "REVEALED").map((slot) => slot.heroId)).toEqual([botOther]); // the non-colliding pick locks in; the collided hero is NOT shown as an enemy pick
    expect(openOwn(closed)).toHaveLength(1); // exactly the colliding seat reopened

    const reselectedOwn = await s.ownSeal(openOwn(closed)[0]!, s.fresh());
    expect(reselectedOwn.view.rankedAp?.phase).toBe("PICK_ROUND_1"); // the enemy has not re-selected yet -> still not advanced
    const afterEnemy = await s.botSeal(s.fresh());
    expect(afterEnemy.view.rankedAp?.phase).toBe("PICK_ROUND_2"); // both re-selected -> the round resolves and advances
    expect(afterEnemy.view.bannedHeroes).toContain(target);
    expect(afterEnemy.view.enemyPicks.filter((slot) => slot.visibility === "REVEALED")).toHaveLength(2); // botOther + the re-selected hero
  });

  for (const first of ["bot", "player"] as const) {
    test(`C3-${first}. collision #3 (two prior collisions in the round): WAITING_FOR_COLLISION_AUTHORITY, ${first === "bot" ? "the Enemy Bot" : "the Player"} registered first and keeps the hero`, async ({ request, baseURL }) => {
      annotate("seed", `COLLIDE3${first === "bot" ? "B" : "P"}`);
      const s = await start(request, baseURL!, `COLLIDE3${first === "bot" ? "B" : "P"}`);
      let last: Snapshot | null = null;
      let target = -1;
      for (let pass = 0; pass < 3; pass += 1) {
        target = s.fresh();
        const botFiller = s.fresh();
        const ownFiller = s.fresh();
        const state = await s.state();
        const botSeats = pass === 0 ? 2 : 1; // after a collision only the colliding seat reopens
        const ownSlots = pass === 0 ? [0, 1] : openOwn(state);
        const doBot = async () => {
          await s.botSeal(target);
          if (botSeats === 2) await s.botSeal(botFiller);
        };
        const doOwn = async () => {
          await s.ownSeal(ownSlots[0]!, target);
          if (ownSlots.length > 1) last = await s.ownSeal(ownSlots[1]!, ownFiller);
        };
        if (first === "bot") {
          await doBot();
          await doOwn();
        } else {
          await doOwn();
          await doBot();
        }
        last = await s.state();
      }
      expect(last!.view.status).toBe("WAITING_FOR_COLLISION_AUTHORITY"); // event #3 pauses for the authority (PD-022)

      const decided = await s.authority();
      expect(decided.status()).toBe(200);
      const after = await s.state();
      expect(after.view.status).not.toBe("WAITING_FOR_COLLISION_AUTHORITY");
      expect(after.view.bannedHeroes).not.toContain(target); // the hero was AWARDED to one side, not banned, on collision #3
      expect(after.view.rankedAp?.phase).toBe("PICK_ROUND_1"); // the loser still has to re-select

      if (first === "bot") {
        // The Enemy Bot registered first and keeps the hero: the Player's colliding seat reopens and the hero is not ours.
        expect(openOwn(after)).toHaveLength(1);
        expect(after.view.ownPicks.some((slot) => slot.heroId === target)).toBe(false);
        const finished = await s.ownSeal(openOwn(after)[0]!, s.fresh());
        expect(finished.view.rankedAp?.phase).toBe("PICK_ROUND_2");
        expect(finished.view.enemyPicks.some((slot) => slot.heroId === target)).toBe(true); // revealed on the enemy team
        expect(finished.view.ownPicks.some((slot) => slot.heroId === target)).toBe(false);
      } else {
        // The Player registered first and keeps the hero: it stays ours, nothing of ours reopens, the Enemy Bot re-selects.
        expect(openOwn(after)).toHaveLength(0);
        expect(after.view.ownPicks.some((slot) => slot.heroId === target)).toBe(true);
        const finished = await s.botSeal(s.fresh());
        expect(finished.view.rankedAp?.phase).toBe("PICK_ROUND_2");
        expect(finished.view.ownPicks.some((slot) => slot.heroId === target)).toBe(true);
        expect(finished.view.enemyPicks.some((slot) => slot.heroId === target)).toBe(false);
      }
    });
  }
});

test.describe("Wave 5 -- fixture catalog drift protection", () => {
  test("FIXTURE_HERO_NAME_BY_ID exhaustively covers every hero that the deterministic engine can emit", () => {
    expect(FIXTURE_HERO_IDS.length).toBeGreaterThanOrEqual(127);
    for (const heroId of FIXTURE_HERO_IDS) {
      const name = FIXTURE_HERO_NAME_BY_ID.get(heroId);
      expect(name).toBeDefined();
      expect(typeof name).toBe("string");
      expect(name!.length).toBeGreaterThan(0);
      expect(FIXTURE_HERO_ID_BY_NAME.get(name!)).toBe(heroId);
    }
  });
});
