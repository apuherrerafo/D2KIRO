/**
 * D2KIRO Phase 1 (Ownership Invariant Gate) -- deterministic scenario generator.
 *
 * Drives the REAL ProtocolSessionStore through the REAL public routes (`createProtocolSessionRoutes`)
 * for every legal AP Ranked Roles V1 human-control set (PD-026/PD-027), on both sides, and records a
 * checkpoint at every legally observable state transition. Nothing here mocks away session semantics:
 * the only fixtures are the V6 scorer, the hero-position evidence, and the hero universe (same seam
 * discipline as `apps/engine/src/server/routes/protocol-sessions.ap-simulator.test.ts` -- S2/S10).
 *
 * This file is a GENERATOR, not the oracle. `qa/invariants/ownership.test.ts` imports it and judges
 * the checkpoints it produces; this file only produces them.
 *
 * CONTROL SETS (PD-026): Solo (5 singletons) + Party2 (all 10 pairs) + Party3 (all 10 triples) +
 * Party5 (the one 5-set) = 26, exactly as spec'd.
 *
 * FILL-ORDER COVERAGE (PD-001/PD-027 "position != pick order"): for every control set with more than
 * one position, at least two scenarios are generated -- the ascending order and the fully reversed
 * order. Control sets with an Ally Bot complement (Party2/Party3) get a THIRD "deferred" variant that
 * explicitly yields round 1 (PD-020: the human decides WHEN), because greedy round-capacity-first
 * filling makes ascending and descending converge onto the SAME per-round partition whenever round
 * capacity absorbs a control set in one round -- there is nothing left to reorder, so that pair alone
 * under-tests "position != chronology". This is a documented, bounded interpretation of "every legal
 * fill order", not the full factorial permutation set (which would be up to 5! = 120 for Party5
 * alone): this bounded set is sufficient to detect order-DEPENDENCE (what INV-CHRONO-001 tests for)
 * without a combinatorial explosion that would make this generator too slow to run on every
 * invocation. Scope decision, not a silent shortcut.
 */
import type { DraftState } from "../../apps/engine/src/draft/reducer";
import type { HeroPositions } from "../../apps/engine/src/signals/hero-positions";
import type { SuggestionSet } from "../../apps/engine/src/signals/mix";
import type { HeroUniverse } from "../../apps/engine/src/simulator/ban-resolution";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { createProtocolSessionRoutes, type ComputeSuggestionsForDraftState } from "../../apps/engine/src/server/routes/protocol-sessions";
import type { PublicCoachCard, PublicCoachStrategy } from "../mvp/oracles/coach-primary-action-oracle";

export type Position = 1 | 2 | 3 | 4 | 5;
export type Side = "radiant" | "dire";
export type PartySize = 1 | 2 | 3 | 5;
export type OrderLabel = "ascending" | "descending" | "deferred";
export type CheckpointStep = "after_bans" | "before_human_turn" | "after_own_pick" | "complete" | "stalled";

// -------------------------------------------------------------------------------------------------
// Fixture hero universe (S2/S10 seam discipline): 30 heroes per position (offset*100 + position),
// never the real curated file. Offsets 0..19 are left for bot picks (ally + enemy); offset 20 is
// reserved exclusively for the human's own submission of that position -- one pick per position per
// session, so no collision is possible between the human's fixed offset and the bots' low offsets.
// -------------------------------------------------------------------------------------------------
const FILLER = Array.from({ length: 48 }, (_, index) => index + 1);
const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
export const HERO_POSITIONS: HeroPositions = {};
for (const position of POSITIONS) {
  for (let offset = 0; offset < 30; offset += 1) {
    const hero = position * 100 + offset;
    HERO_POSITIONS[hero] = [{ position, matches: 1000 }];
  }
}

/** The human's fixed hero for one of their own positions. One pick per position per session -- no collision with bot offsets (0..19). */
export function humanHeroFor(position: Position): number {
  return position * 100 + 20;
}

/**
 * Deterministic V6 fixture: never omitted (VACUOUS-PASS PROTECTION -- an omitted `computeSuggestions`
 * degrades silently into SNAPSHOT_UNAVAILABLE, which the invariant oracle must never mistake for a
 * real, actionable result). Always returns non-empty suggestions while any position hero remains
 * untaken -- deterministic, no network, no curated dataset.
 */
const computeSuggestions: ComputeSuggestionsForDraftState = async (state: DraftState, _accountId, options): Promise<SuggestionSet> => {
  const taken = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  // Ally/Enemy Bot decisions post-validate that the chosen hero lies within the candidate universe
  // they requested (position-credible heroes for that seat) -- honoring `candidateHeroIds` here is
  // required, not optional, or every bot decision is rejected as "no valid candidate".
  const basePool = options?.candidateHeroIds ?? Object.keys(HERO_POSITIONS).map(Number);
  const pool = basePool.filter((hero) => !taken.has(hero));
  const heroes = pool.slice(0, 6);
  return {
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: state.lastSeq,
    decisionContext: "team_opening",
    suggestions: heroes.map((hero, index) => ({
      hero,
      rank: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6,
      score: 100 - index,
      signals: [],
      reason: "qa fixture (deterministic, no network, no curated dataset)",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
    // REQUIRED at runtime despite the optional `?` in the type: build-from-perspective.ts / build.ts
    // degrade to SNAPSHOT_UNAVAILABLE and an EMPTY recommendation set the instant this is falsy
    // ("computeSuggestions no entregó evidencia funcional"). Omitting it is exactly the vacuous-pass
    // failure mode task section 8 warns about ("[] == []" must never count as correctness) -- keep it.
    functionalEvidence: {
      metaIsStale: false,
      signalEvidence: heroes.map((hero) => ({ hero, signals: [] })),
      heroPositions: [],
      teamOpening: null,
      partyPreferredPositions: [],
    },
  };
};

export type Routes = ReturnType<typeof createProtocolSessionRoutes>;

/**
 * Universe for a given `HeroPositions` map -- filler bot-pick offsets (0..19, S2/S10 seam
 * discipline) plus every hero the map itself registers. Factored out so a caller with its OWN
 * (e.g. flex-hero) `HeroPositions` map -- see `createFixtureRoutes` below -- gets a matching
 * universe instead of the stock one, which would silently exclude its extra hero ids from ban
 * resolution / Ally Bot eligibility.
 */
export function heroUniverseFor(heroPositions: HeroPositions): HeroUniverse {
  const ids = [...FILLER, ...Object.keys(heroPositions).map(Number)];
  return { allHeroIds: ids, metaOrder: ids };
}

/**
 * Fresh, isolated store + routes wired to the deterministic fixtures above. One per scenario run.
 * Optional `heroPositions` override (default: the stock single-position-only `HERO_POSITIONS`) --
 * added for the FLEX-HERO reproducer (`qa/invariants/binding.test.ts`, INV-BIND-001): stock
 * fixture heroes are all single-position, which trivially agrees with any explicit position
 * assignment and hides the "RoleBelief vs authoritative binding" defect that only a genuinely
 * flexible hero (credible at 2+ positions, weighted AWAY from the bound one) can expose. Every
 * EXISTING no-arg call site (the 26x2x3 ownership matrix) is byte-identical: `HERO_POSITIONS` and
 * `heroUniverseFor(HERO_POSITIONS)` reproduce exactly what this function built before this change.
 */
export function createFixtureRoutes(heroPositions: HeroPositions = HERO_POSITIONS): { store: ProtocolSessionStore; routes: Routes } {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions,
    heroPositions,
    heroUniverse: async () => heroUniverseFor(heroPositions),
  });
  return { store, routes };
}

// -------------------------------------------------------------------------------------------------
// Control sets (PD-026): Solo / Party2 / Party3 / Party5. 26 total, exactly.
// -------------------------------------------------------------------------------------------------
export interface ControlSet {
  id: string;
  partySize: PartySize;
  positions: readonly Position[]; // ascending
}

function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [head, ...rest] = items;
  const withHead = combinations(rest, size - 1).map((combo) => [head as T, ...combo]);
  const withoutHead = combinations(rest, size);
  return [...withHead, ...withoutHead];
}

export function enumerateControlSets(): readonly ControlSet[] {
  const solo: ControlSet[] = POSITIONS.map((position) => ({ id: `solo-${position}`, partySize: 1, positions: [position] }));
  const party2: ControlSet[] = combinations(POSITIONS, 2).map((positions) => ({
    id: `party2-${positions.join("-")}`,
    partySize: 2,
    positions,
  }));
  const party3: ControlSet[] = combinations(POSITIONS, 3).map((positions) => ({
    id: `party3-${positions.join("-")}`,
    partySize: 3,
    positions,
  }));
  const party5: ControlSet[] = [{ id: "party5", partySize: 5, positions: POSITIONS }];
  return [...solo, ...party2, ...party3, ...party5];
}

// -------------------------------------------------------------------------------------------------
// Scenario specs: control set x side x fill-order variant, each with a fixed deterministic seed.
// -------------------------------------------------------------------------------------------------
export interface ScenarioSpec {
  id: string;
  side: Side;
  controlSet: ControlSet;
  order: readonly Position[]; // the order in which the human WILL submit their own positions
  orderLabel: OrderLabel;
  seed: string;
  /**
   * PD-020/PD-001 ("the human decides WHEN"): when true, the human explicitly yields round 1's own
   * capacity to the Ally Bot (via `postYield`) instead of greedily filling as soon as a slot opens,
   * deferring every controlled position to round 2+. Only meaningful for control sets that HAVE an
   * Ally Bot complement to absorb round 1 (Party2/Party3) -- Solo's single position carries no
   * order, and Party5 has no Ally Bot at all (`yieldRound` fails closed with
   * `no_ally_bot_capacity`). Without this, greedy round-capacity-first filling makes ascending and
   * descending orders converge onto the SAME per-round partition for most control sets (round
   * capacity absorbs everything immediately), so the ascending/descending pair alone under-tests
   * "position != chronology" -- deferral is what actually forces a genuinely different
   * round-partition of the same positions to compare against.
   */
  deferRound1: boolean;
}

export function enumerateScenarios(): readonly ScenarioSpec[] {
  const sets = enumerateControlSets();
  const sides: readonly Side[] = ["radiant", "dire"];
  const specs: ScenarioSpec[] = [];
  let counter = 1;
  for (const controlSet of sets) {
    for (const side of sides) {
      const ascending = [...controlSet.positions].sort((a, b) => a - b);
      const hasAllyBotComplement = controlSet.partySize === 2 || controlSet.partySize === 3;
      const variants: { orderLabel: OrderLabel; order: readonly Position[]; deferRound1: boolean }[] =
        controlSet.positions.length > 1
          ? [
              { orderLabel: "ascending", order: ascending, deferRound1: false },
              { orderLabel: "descending", order: [...ascending].reverse(), deferRound1: false },
              ...(hasAllyBotComplement ? [{ orderLabel: "deferred" as const, order: ascending, deferRound1: true }] : []),
            ]
          : [{ orderLabel: "ascending", order: ascending, deferRound1: false }];
      for (const variant of variants) {
        const seed = `OWNGATE${String(counter).padStart(4, "0")}`;
        counter += 1;
        specs.push({ id: `${controlSet.id}-${side}-${variant.orderLabel}`, side, controlSet, order: variant.order, orderLabel: variant.orderLabel, seed, deferRound1: variant.deferRound1 });
      }
    }
  }
  return specs;
}

// -------------------------------------------------------------------------------------------------
// Checkpoint capture -- public HTTP route responses ONLY (serialized JSON), plus the session-layer
// ownership TRUTH (`humanOpenPositions`/`controlledPositions`/`ownAssignedPositions`) the task
// explicitly allows the oracle to read. Never a call into coach/recommendation decision logic.
// -------------------------------------------------------------------------------------------------
interface PublicLegalAction {
  type: string;
  side?: string;
  slotIndex?: number;
}

interface PublicSnapshot {
  view: {
    status: string;
    rankedAp: { phase: string; banResolutionComplete: boolean } | null;
    ownPicks: { visibility: string; heroId?: number }[];
    enemyPicks: { visibility: string; heroId?: number }[];
    bannedHeroes: number[];
  };
  legalActions: PublicLegalAction[];
  ownAssignedPositions: { round: number; slotIndex: number; assignedPosition: Position }[];
  stopReason?: string;
  completedRound?: number | null;
  accepted?: boolean;
  error?: string;
}

interface PublicV2 {
  decision: { controlledSlots: { side: string; slotIndex: number; position?: Position | null }[] };
  recommendations: { actions: { slot: { position?: Position | null }; hero: number }[] }[];
}

interface PublicV3 {
  primaryAction: { strategy: PublicCoachStrategy; label: string };
  shortlist: PublicCoachCard[];
}

export interface Checkpoint {
  scenarioId: string;
  side: Side;
  controlSetId: string;
  orderLabel: OrderLabel;
  seed: string;
  step: CheckpointStep;
  round: number | null;
  filledPosition: Position | null;
  controlledPositions: readonly Position[];
  humanOpenPositions: readonly Position[];
  /**
   * PD-026/PD-027 -- true once the human has explicitly handed this round's remaining Own Team
   * capacity to the Ally Bot (`postYield`). Read directly from `ProtocolSessionStore.hasYieldedCurrentRound`
   * (session-layer truth, not re-derived) so INV-OWN-004 can compute humanRoundCapacity without ever
   * treating `authorizedLegalActions`/`snapshot.legalActions` -- side/protocol legality, which still
   * advertises the round's own-side slots for the Ally Bot to fill -- as if it meant human capacity.
   */
  hasYieldedCurrentRound: boolean;
  snapshot: PublicSnapshot;
  v2: PublicV2 | null;
  v3: PublicV3 | null;
  rawResponseText: string; // full serialized text of every response folded into this checkpoint, for INV-LEAK-001's mechanical scan
}

function post(body: unknown): Request {
  return new Request("http://qa.local/session/protocol", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

export async function fetchRecommendations(routes: Routes, sessionId: string): Promise<{ v2: PublicV2 | null; v3: PublicV3 | null; rawText: string }> {
  const v2Response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations`));
  const v2Text = await v2Response.clone().text();
  const v2 = v2Response.status === 200 ? (JSON.parse(v2Text) as PublicV2) : null;

  const v3Response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
  const v3Text = await v3Response.clone().text();
  let v3: PublicV3 | null = null;
  if (v3Response.status === 200) {
    const body = JSON.parse(v3Text) as { output: PublicV3 | null };
    v3 = body.output;
  }
  return { v2, v3, rawText: `${v2Text}\n${v3Text}` };
}

function buildCheckpoint(
  spec: ScenarioSpec,
  store: ProtocolSessionStore,
  sessionId: string,
  step: CheckpointStep,
  filledPosition: Position | null,
  snapshot: PublicSnapshot,
  rec: { v2: PublicV2 | null; v3: PublicV3 | null; rawText: string },
  snapshotRawText: string,
): Checkpoint {
  const controlledPositions = store.metadata(sessionId)?.controlledPositions ?? [];
  const humanOpenPositions = store.humanOpenPositions(sessionId) ?? [];
  const round = snapshot.view.rankedAp
    ? ({ PICK_ROUND_1: 1, PICK_ROUND_2: 2, PICK_ROUND_3: 3 } as Record<string, number>)[snapshot.view.rankedAp.phase] ?? null
    : null;
  return {
    scenarioId: spec.id,
    side: spec.side,
    controlSetId: spec.controlSet.id,
    orderLabel: spec.orderLabel,
    seed: spec.seed,
    step,
    round,
    filledPosition,
    controlledPositions,
    humanOpenPositions,
    hasYieldedCurrentRound: store.hasYieldedCurrentRound(sessionId),
    snapshot,
    v2: rec.v2,
    v3: rec.v3,
    rawResponseText: `${snapshotRawText}\n${rec.rawText}`,
  };
}

export interface ScenarioRunResult {
  spec: ScenarioSpec;
  checkpoints: Checkpoint[];
}

/**
 * Drives ONE scenario end to end through the real public routes: create -> resolve bans -> repeated
 * auto-drive/human-submit cycles (human fills THEIR positions in `spec.order`; the Ally Bot fills the
 * complement, per PD-026 HUMAN-FIRST scheduling) -> COMPLETE. A checkpoint is recorded after bans,
 * before every human turn (round start / post-Ally-Bot-progression, whichever the engine actually
 * produced), after every own human pick, and at completion.
 */
export async function runScenario(routes: Routes, store: ProtocolSessionStore, spec: ScenarioSpec): Promise<ScenarioRunResult> {
  const checkpoints: Checkpoint[] = [];
  const createBody = {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41f", // PD-025: current product patch
    localSide: spec.side,
    adapterKind: "simulator",
    partyContext: { partySize: spec.controlSet.partySize, side: spec.side, controlledSlots: [] },
    controlledPositions: [...spec.controlSet.positions],
    humanPosition: spec.order[0],
    simulatorSeed: spec.seed,
  };
  const created = await routes.post(post(createBody));
  if (created.status !== 201) throw new Error(`scenario ${spec.id}: session creation failed with ${created.status}`);
  const { sessionId } = await json<{ sessionId: string }>(created);

  const bansResponse = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
  const bansText = await bansResponse.clone().text();
  const bansSnapshot = JSON.parse(bansText) as PublicSnapshot;
  checkpoints.push(buildCheckpoint(spec, store, sessionId, "after_bans", null, bansSnapshot, await fetchRecommendations(routes, sessionId), bansText));

  const remainingOrder = [...spec.order];
  let guard = 0;
  const GUARD_LIMIT = 64; // draft has at most 3 rounds x up to 2 slots; this is a generous ceiling against a real infinite loop bug
  let completed = false;
  let deferredRound1Applied = false;
  while (guard < GUARD_LIMIT) {
    guard += 1;
    const driveResponse = await routes.postAutoDrive(sessionId);
    const driveText = await driveResponse.clone().text();
    const drive = JSON.parse(driveText) as PublicSnapshot;

    if (drive.view?.status === "COMPLETE") {
      checkpoints.push(buildCheckpoint(spec, store, sessionId, "complete", null, drive, await fetchRecommendations(routes, sessionId), driveText));
      completed = true;
      break;
    }
    if (drive.error !== undefined) {
      checkpoints.push(buildCheckpoint(spec, store, sessionId, "stalled", null, drive, await fetchRecommendations(routes, sessionId), driveText));
      throw new Error(`scenario ${spec.id}: auto-drive returned an unexpected error: ${driveText}`);
    }
    if (drive.stopReason === "round_revealed") {
      // The whole round's remaining Own Team capacity was Ally-Bot-filled without ever needing
      // human input this round (every human-controlled position was already bound earlier). Record
      // the progression and keep driving toward the next round / completion.
      checkpoints.push(buildCheckpoint(spec, store, sessionId, "before_human_turn", null, drive, await fetchRecommendations(routes, sessionId), driveText));
      continue;
    }
    if (drive.stopReason !== "human_input") {
      checkpoints.push(buildCheckpoint(spec, store, sessionId, "stalled", null, drive, await fetchRecommendations(routes, sessionId), driveText));
      throw new Error(`scenario ${spec.id}: auto-drive stopped with unexpected reason "${drive.stopReason}"`);
    }

    checkpoints.push(buildCheckpoint(spec, store, sessionId, "before_human_turn", null, drive, await fetchRecommendations(routes, sessionId), driveText));

    if (spec.deferRound1 && !deferredRound1Applied && drive.view?.rankedAp?.phase === "PICK_ROUND_1") {
      deferredRound1Applied = true;
      const yieldResponse = await routes.postYield(sessionId);
      if (yieldResponse.status !== 200) throw new Error(`scenario ${spec.id}: expected round 1 yield to succeed (Ally Bot has complement capacity), got ${yieldResponse.status}`);
      const yieldText = await yieldResponse.clone().text();
      const yieldSnapshot = JSON.parse(yieldText) as PublicSnapshot;
      checkpoints.push(buildCheckpoint(spec, store, sessionId, "before_human_turn", null, yieldSnapshot, await fetchRecommendations(routes, sessionId), yieldText));
      continue; // round 1's own capacity is now entirely the Ally Bot's -- keep driving toward round 2, where the human resumes filling `order` normally
    }

    const ownOpenSlots = drive.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === spec.side);
    if (ownOpenSlots.length === 0) throw new Error(`scenario ${spec.id}: human_input stop with no open own-side slot`);

    for (const slot of ownOpenSlots) {
      const nextPosition = remainingOrder.shift();
      if (nextPosition === undefined) break; // human has no more controlled positions left to bind this stop
      const heroId = humanHeroFor(nextPosition);
      const submitResponse = await routes.postCommand(
        post({ command: { type: "SUBMIT_SEALED_SELECTION", side: spec.side, slotIndex: slot.slotIndex, heroId }, assignedPosition: nextPosition }),
        sessionId,
      );
      const submitText = await submitResponse.clone().text();
      const submitSnapshot = JSON.parse(submitText) as PublicSnapshot;
      if (submitResponse.status !== 202 || submitSnapshot.accepted !== true) {
        throw new Error(`scenario ${spec.id}: human submission for Pos${nextPosition} rejected (${submitResponse.status}): ${submitText}`);
      }
      checkpoints.push(buildCheckpoint(spec, store, sessionId, "after_own_pick", nextPosition, submitSnapshot, await fetchRecommendations(routes, sessionId), submitText));
    }
  }
  if (!completed) throw new Error(`scenario ${spec.id}: exceeded guard limit without reaching COMPLETE -- likely an infinite auto-drive loop`);

  return { spec, checkpoints };
}

// -------------------------------------------------------------------------------------------------
// Standalone entry point: `bun run qa/scenarios/generate.ts` prints the REAL measured counts.
// Never hardcoded elsewhere -- this is the one place that actually runs the matrix and counts it.
// -------------------------------------------------------------------------------------------------
if (import.meta.main) {
  const controlSets = enumerateControlSets();
  const specs = enumerateScenarios();
  console.log(`control sets: ${controlSets.length}`);
  console.log(`scenario specs (control set x side x fill-order variant): ${specs.length}`);
  let totalCheckpoints = 0;
  for (const spec of specs) {
    const { store, routes } = createFixtureRoutes();
    const result = await runScenario(routes, store, spec);
    totalCheckpoints += result.checkpoints.length;
  }
  console.log(`checkpoints captured: ${totalCheckpoints}`);
}
