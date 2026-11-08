import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { ProtocolSessionStore } from "../server/protocol-session";
import { LiveCaptureRegistry } from "../live/live-capture-registry";
import { createCoachRecommendations, type CoachRecommendations } from "../server/routes/coach-recommendations";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { HeroCapabilities } from "../draft-paths/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { TeamCoachBoard } from "./team-coach-board";
import type { RecommendationOutputV4 } from "./recommendation-output-v4";
import { fakeCompute, HERO_POSITIONS, POOL } from "./session-harness.fixtures";

// P0-02 -- Simulator <-> Live Companion strategic-core parity (Party 5, Ranked All Pick).
//
// WHAT THIS MEASURES. Both products feed the SAME ProtocolSessionStore; they differ in (a) how facts are
// captured (simulator commands vs LiveCaptureRegistry observations) and (b) which read entrypoint the
// web calls: the Simulator reads `?format=v4` (CurrentHumanDecision), Live reads `team-recommendations`
// (TeamCoachBoard). Per scenario we feed identical visible facts and compare THREE stages, in order:
//
//   S1 INPUT         the PerspectiveRecommendationContext each store hands the Coach
//   S2 RANKING       the TeamCoachBoard each store yields (same builder, same V6 stand-in) -- isolates capture
//   S3 PRESENTATION  Simulator's V4 per-position cards + target  vs  Live's board (the real product surfaces)
//
// The FIRST stage that differs names where the pipelines separate. Nothing here edits production code,
// weights, curated JSON or the web. Curated evidence is injected as inline fixtures (never the real files).
// Scorer: the shared `fakeCompute` (a deterministic stand-in for V6, same for both) -- the V6 numbers
// themselves are out of scope; this isolates the pipelines AROUND it.

const POSITIONS = [1, 2, 3, 4, 5] as Position[];
const BAN = 99;
const NO_COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map();
const NO_SYNERGIES: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map();

// ---------- scenario facts (what a player can SEE, in the order it became visible) ----------
interface Pick { side: "radiant" | "dire"; heroId: number; position: Position | null }
const own = (heroId: number, position: Position): Pick => ({ side: "radiant", heroId, position });
const enemy = (heroId: number): Pick => ({ side: "dire", heroId, position: null });
interface Facts {
  bans: number[];
  picks: Pick[];
  counters?: ReadonlyMap<number, readonly CuratedCounter[]>;
  synergies?: ReadonlyMap<number, readonly CuratedSynergy[]>;
  capabilities?: readonly HeroCapabilities[];
}

// ---------- the two ingestion paths ----------
function coachFor(store: ProtocolSessionStore, facts: Facts): CoachRecommendations {
  return createCoachRecommendations({
    source: store,
    computeSuggestions: fakeCompute(POOL, HERO_POSITIONS),
    heroPositions: HERO_POSITIONS,
    heroCounters: facts.counters ?? NO_COUNTERS,
    heroSynergies: facts.synergies ?? NO_SYNERGIES,
    heroCapabilities: facts.capabilities ?? [],
    advertirApproved: new Set(),
  });
}

/**
 * Simulator ingestion through the REAL command route (`POST .../command`): an own pick travels with its
 * `assignedPosition` exactly as the simulator UI sends it, so the queue-bound position is structural truth.
 */
async function ingestSimulator(facts: Facts): Promise<{ store: ProtocolSessionStore; sessionId: string }> {
  const store = new ProtocolSessionStore();
  const sessionId = "sim-p0-02";
  const created = store.create({
    sessionId,
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "radiant",
    adapterKind: "simulator",
    simulatorSeed: "P0020001",
    partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
    controlledPositions: POSITIONS,
  });
  if (!created.ok) throw new Error("simulator create failed");
  const banned = store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: facts.bans }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  if (!banned?.ok) throw new Error("simulator bans failed");
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(POOL, HERO_POSITIONS), heroPositions: HERO_POSITIONS, heroCounters: facts.counters ?? NO_COUNTERS });
  const nextSlot = { radiant: 0, dire: 0 };
  for (const pick of facts.picks) {
    const slotIndex = nextSlot[pick.side]++ % 2; // slot indexes restart every round (2 seats a side in rounds 1-2)
    if (pick.side === "radiant") {
      const request = new Request("http://127.0.0.1/x", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: pick.heroId }, assignedPosition: pick.position }),
      });
      const response = await routes.postCommand(request, sessionId);
      if (response.status !== 202) throw new Error(`simulator own pick refused: ${response.status} ${await response.text()}`);
    } else {
      const result = store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex, heroId: pick.heroId });
      if (!result || result.rejected) throw new Error(`simulator enemy pick rejected: ${result?.rejected}`);
    }
  }
  return { store, sessionId };
}

/** Live ingestion: observations through the real LiveCaptureRegistry (GSI/Overwolf/manual all land here). */
function ingestLive(facts: Facts, options: { reportPositions?: boolean } = {}): { store: ProtocolSessionStore; registry: LiveCaptureRegistry; sessionId: string } {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
  const sessionId = "live-p0-02";
  registry.ensureSession(sessionId, 7);
  registry.observe(sessionId, { type: "draft_started", patch: "7.41e" });
  registry.observe(sessionId, { type: "side", side: "radiant" });
  for (const heroId of facts.bans) registry.observe(sessionId, { type: "ban", heroId });
  registry.observe(sessionId, { type: "bans_closed" });
  for (const pick of facts.picks) {
    const position = pick.side === "radiant" && options.reportPositions === false ? null : pick.position;
    const result = registry.observe(sessionId, { type: "pick", side: pick.side, heroId: pick.heroId, position });
    if (!result.accepted) throw new Error(`live pick refused: ${JSON.stringify(result)}`);
  }
  return { store, registry, sessionId };
}

// ---------- normalised views ----------
/** Capture-identity flags: they legitimately differ (a live capture is not a simulator). Reported, never counted as divergence. */
interface CaptureFlags { liveCapture: boolean; isSimulator: boolean; occupiedByPicks: number[] | null }
function flagsOf(store: ProtocolSessionStore, sessionId: string): CaptureFlags {
  const context = store.perspectiveRecommendationContext(sessionId)!;
  return { liveCapture: context.liveCapture === true, isSimulator: context.isSimulator === true, occupiedByPicks: context.ownPositionOccupancy ? [...context.ownPositionOccupancy.necessarilyOccupied] : null };
}

interface InputView {
  banned: number[];
  ownPicks: { heroId: number | null; visibility: string }[];
  enemyPicks: { heroId: number | null; visibility: string }[];
  phase: string | null;
  partySize: number | null;
  patch: string;
  controlledPositions: number[] | null;
  humanOpenPositions: number[] | null;
  humanActionable: number[] | null;
  roundCapacity: number | null;
  ownAssignedPositions: [number, number][] | null;
}

function inputOf(store: ProtocolSessionStore, sessionId: string): InputView {
  const context = store.perspectiveRecommendationContext(sessionId)!;
  const view = context.view;
  return {
    banned: [...view.bannedHeroes].sort((a, b) => a - b),
    ownPicks: view.ownPicks.map((slot) => ({ heroId: slot.visibility === "HIDDEN" ? null : slot.heroId, visibility: slot.visibility })),
    enemyPicks: view.enemyPicks.map((slot) => ({ heroId: slot.visibility === "HIDDEN" ? null : slot.heroId, visibility: slot.visibility })),
    phase: view.rankedAp?.phase ?? null,
    partySize: context.partyContext?.partySize ?? null,
    patch: context.patch,
    controlledPositions: context.controlledPositions ? [...context.controlledPositions] : null,
    humanOpenPositions: context.humanOpenPositions ? [...context.humanOpenPositions] : null,
    humanActionable: context.humanActionability?.hasHumanAction ? [...context.humanActionability.eligiblePositions] : null,
    roundCapacity: context.humanActionability?.hasHumanAction ? context.humanActionability.roundCapacity : null,
    ownAssignedPositions: context.ownAssignedPositions ? [...context.ownAssignedPositions.entries()].sort((a, b) => a[0] - b[0]) : null,
  };
}

interface CandidateView { heroId: number; rank: number; score: number | null; evidenceStrength: string; reasons: string[]; risks: string[]; steals: number[] }
interface StrategyView {
  recommendedPosition: number | null;
  recommendedBasis: string | null;
  /** Hero at the head of the column of the recommended position (what ELIGE AHORA would point at). */
  targetHead: number | null;
  actionable: number[];
  perPosition: Record<number, CandidateView[]>;
}

function strategyOfBoard(board: TeamCoachBoard): StrategyView {
  return {
    recommendedPosition: board.currentDecision.recommendedPosition,
    recommendedBasis: board.currentDecision.targetBasis,
    targetHead: board.currentDecision.recommendedHeroId,
    actionable: [...board.currentDecision.actionablePositions],
    perPosition: Object.fromEntries(board.positions.map((column) => [column.position, column.top.map((candidate): CandidateView => ({
      heroId: candidate.heroId,
      rank: candidate.rank,
      score: candidate.score,
      evidenceStrength: candidate.evidenceStrength,
      reasons: [...candidate.reasons],
      risks: candidate.risks.map((risk) => `${risk.vsHeroId}:${risk.why}`),
      steals: candidate.steals.map((steal) => steal.protectsHeroId),
    }))])),
  };
}

async function strategyOfV4(coach: CoachRecommendations, sessionId: string): Promise<StrategyView> {
  const headline = await coach.recommendCurrentDecision(sessionId, null, null, null);
  if (!headline || headline.output.decision.kind !== "ACTIONABLE") return { recommendedPosition: null, recommendedBasis: null, targetHead: null, actionable: [], perPosition: {} };
  const decision = headline.output.decision;
  const perPosition: Record<number, CandidateView[]> = {};
  for (const position of decision.actionablePositions) {
    const view = await coach.recommendCurrentDecision(sessionId, null, null, position);
    const output = view?.output as RecommendationOutputV4 | undefined;
    if (!output || output.decision.kind !== "ACTIONABLE") continue;
    perPosition[position] = output.decision.candidates.cards.slice(0, 5).map((card): CandidateView => ({
      heroId: card.heroId,
      rank: card.rank,
      score: card.score,
      evidenceStrength: card.evidenceStrength,
      reasons: card.rationale === "" ? [] : [card.rationale],
      risks: card.risks.map((risk) => risk.kind),
      steals: card.context.steals.map((steal) => steal.protectsHeroId),
    }));
  }
  return { recommendedPosition: decision.targetPosition, recommendedBasis: decision.targetBasis, targetHead: perPosition[decision.targetPosition]?.[0]?.heroId ?? null, actionable: [...decision.actionablePositions], perPosition };
}

// ---------- divergence report ----------
type Stage = "S1_INPUT" | "S2_RANKING" | "S3_PRESENTATION";
type Layer = "inputs" | "normalization" | "scoring" | "eligibility" | "construction" | "presentation";
interface Divergence { stage: Stage; layer: Layer; field: string; simulator: unknown; live: unknown }

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function diffInput(sim: InputView, live: InputView): Divergence[] {
  const out: Divergence[] = [];
  for (const key of Object.keys(sim) as (keyof InputView)[]) {
    if (!same(sim[key], live[key])) out.push({ stage: "S1_INPUT", layer: "inputs", field: `context.${key}`, simulator: sim[key], live: live[key] });
  }
  return out;
}

function layerOf(field: string, sim: CandidateView[] | undefined, live: CandidateView[] | undefined): Layer {
  const simHeroes = (sim ?? []).map((c) => c.heroId);
  const liveHeroes = (live ?? []).map((c) => c.heroId);
  if (!same([...simHeroes].sort(), [...liveHeroes].sort())) return "eligibility";
  if (field.endsWith("evidenceStrength")) return "eligibility";
  if (field.endsWith("score") || field.endsWith("heroId")) return "scoring";
  return "construction";
}

function diffStrategy(stage: Stage, a: StrategyView, b: StrategyView, presentationLayer: Layer): Divergence[] {
  const out: Divergence[] = [];
  if (a.recommendedPosition !== b.recommendedPosition) out.push({ stage, layer: presentationLayer, field: "recommendedPosition", simulator: a.recommendedPosition, live: b.recommendedPosition });
  if (a.recommendedBasis !== b.recommendedBasis) out.push({ stage, layer: presentationLayer, field: "targetBasis", simulator: a.recommendedBasis, live: b.recommendedBasis });
  if (a.targetHead !== b.targetHead) out.push({ stage, layer: presentationLayer, field: "targetHead(ELIGE AHORA)", simulator: a.targetHead, live: b.targetHead });
  if (!same(a.actionable, b.actionable)) out.push({ stage, layer: "inputs", field: "actionablePositions", simulator: a.actionable, live: b.actionable });
  for (const position of POSITIONS) {
    const sa = a.perPosition[position];
    const sb = b.perPosition[position];
    const fields: [string, (c: CandidateView) => unknown][] = [
      ["heroId", (c) => c.heroId],
      ["rank", (c) => c.rank],
      ["score", (c) => c.score],
      ["evidenceStrength", (c) => c.evidenceStrength],
    ];
    for (const [name, pick] of fields) {
      const va = (sa ?? []).map(pick);
      const vb = (sb ?? []).map(pick);
      if (!same(va, vb)) out.push({ stage, layer: layerOf(name, sa, sb), field: `pos${position}.${name}`, simulator: va, live: vb });
    }
    // Reasons / risks / steals are compared only when the PRODUCT SURFACES expose the same field (board <-> board).
    if (stage === "S2_RANKING") {
      for (const name of ["reasons", "risks", "steals"] as const) {
        const va = (sa ?? []).map((c) => c[name]);
        const vb = (sb ?? []).map((c) => c[name]);
        if (!same(va, vb)) out.push({ stage, layer: "construction", field: `pos${position}.${name}`, simulator: va, live: vb });
      }
    }
  }
  return out;
}

interface ScenarioResult { divergences: Divergence[]; firstStage: Stage | null; sim: StrategyView; simBoard: StrategyView; live: StrategyView; flags: { simulator: CaptureFlags; live: CaptureFlags } }

async function runScenario(facts: Facts, options: { reportPositions?: boolean } = {}): Promise<ScenarioResult> {
  const sim = await ingestSimulator(facts);
  const live = ingestLive(facts, options);
  const simCoach = coachFor(sim.store, facts);
  const liveCoach = coachFor(live.store, facts);
  const simBoardRaw = await simCoach.recommendTeamBoard(sim.sessionId, null, null);
  const liveBoardRaw = await liveCoach.recommendTeamBoard(live.sessionId, null, null);
  if (!simBoardRaw || !liveBoardRaw) throw new Error("board unavailable");
  const simBoard = strategyOfBoard(simBoardRaw);
  const liveBoardView = strategyOfBoard(liveBoardRaw);
  const simV4 = await strategyOfV4(simCoach, sim.sessionId);

  const s1 = diffInput(inputOf(sim.store, sim.sessionId), inputOf(live.store, live.sessionId));
  // S2: same builder, different capture -> any difference came from capture/normalization.
  const s2 = diffStrategy("S2_RANKING", simBoard, liveBoardView, "normalization");
  // S3: the real product surfaces. Different entrypoints by design (V4 vs board).
  const s3 = diffStrategy("S3_PRESENTATION", simV4, liveBoardView, "presentation");
  const divergences = [...s1, ...s2, ...s3];
  return { divergences, firstStage: divergences[0]?.stage ?? null, sim: simV4, simBoard, live: liveBoardView, flags: { simulator: flagsOf(sim.store, sim.sessionId), live: flagsOf(live.store, live.sessionId) } };
}

// ---------- fixtures (inline; no real curated data) ----------
// Direction as in party5-live-parity.test.ts: heroCounters.get(<revealed enemy>) lists the entries whose `vs` is the hero that beats it.
const counter9ByHero5 = new Map<number, readonly CuratedCounter[]>([[9, [{ vs: 5, level: "hard", why: "fixture: 5 le gana a 9 en la linea" }]]]);
const synergyOneWithTwo = new Map<number, readonly CuratedSynergy[]>([[3, [{ with: 1, why: "fixture: 3 inmoviliza para que 1 conecte" }]], [1, [{ with: 3, why: "fixture: 1 aprovecha la inmovilizacion de 3" }]]]);

function print(name: string, result: ScenarioResult): void {
  if (process.env.PARITY_DUMP !== "1") return;
  console.log(`\n=== ${name}: first stage = ${result.firstStage ?? "NONE (parity)"} ===`);
  for (const d of result.divergences) console.log(JSON.stringify(d));
}

const cap = (hero: number, over: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...over } as HeroCapabilities);
// The team (1,2,3,4) already has a catch and a second damage type; the ONLY open critical gap is initiation, and hero 5 alone fills it with one pick left.
const capabilitiesNeedInitiation: HeroCapabilities[] = [cap(1, { hasCatch: true }), cap(2, { damageType: "magical" }), cap(3), cap(4), cap(5, { hasInitiation: true }), cap(6)];

const SCENARIOS: Record<string, { facts: Facts; options?: { reportPositions?: boolean } }> = {
  A: { facts: { bans: [BAN], picks: [] } },
  B: { facts: { bans: [BAN], picks: [own(1, 1), own(2, 5), enemy(9), enemy(8)], counters: counter9ByHero5 } },
  C: { facts: { bans: [BAN], picks: [own(1, 1), own(2, 5), enemy(7), enemy(8)], synergies: synergyOneWithTwo } },
  D: { facts: { bans: [BAN], picks: [own(1, 1), own(2, 5), enemy(7), enemy(8), own(3, 4), own(4, 2), enemy(10), enemy(11)], capabilities: capabilitiesNeedInitiation } },
  E: { facts: { bans: [BAN], picks: [own(1, 1), own(2, 5), enemy(9), enemy(8)], counters: counter9ByHero5 }, options: { reportPositions: false } },
};

const byStage = (result: ScenarioResult, stage: Stage) => result.divergences.filter((divergence) => divergence.stage === stage);
const presentation = (result: ScenarioResult) => byStage(result, "S3_PRESENTATION").map(({ field, simulator, live }) => ({ field, simulator, live }));

// Where the two products' REAL surfaces separate. Source of truth for the PR table; every entry below is asserted, not narrated.
//   First separating function (S3): `CoachRecommendations.recommendCurrentDecision` (Simulator, V4) takes its target from
//   `buildTeamPositionPriority` -> `targetFromPriority(...) ?? selectDecisionTarget(...)`, while Live reads
//   `buildTeamCoachBoard` -> `deriveTeamDecision(...)`. `usesPositionPriority(liveCapture, n)` is true for a live capture with
//   >= 1 candidate position but for a simulator only with >= 2, so the same state yields a priority only on the Live side.
//   Probe (not kept as a test): B -> simulator priority = null, live priority = SINGLE_POSITION on Pos 3; liveCapture false/true.

describe("P0-02 Simulator <-> Live parity (Party 5)", () => {
  test("A. early draft without strong grounds: same inputs, same columns, no advice on either side; headline contract differs", async () => {
    const result = await runScenario(SCENARIOS.A!.facts);
    print("A", result);
    expect(byStage(result, "S1_INPUT")).toEqual([]);
    expect(byStage(result, "S2_RANKING")).toEqual([]); // capture is not the cause
    // No STRONG card exists anywhere, so neither product may name an ELIGE AHORA hero.
    for (const view of [result.simBoard, result.live]) {
      expect(Object.values(view.perPosition).flat().filter((candidate) => candidate.evidenceStrength === "STRONG")).toEqual([]);
    }
    expect(result.live.targetHead).toBeNull();
    // KNOWN (presentation, not strategy): V4 always names a default view; its own contract says DETERMINISTIC_DEFAULT is "never advice".
    expect(result.sim.recommendedBasis).toBe("DETERMINISTIC_DEFAULT");
    expect(presentation(result)).toEqual([
      { field: "recommendedPosition", simulator: 1, live: null },
      { field: "targetBasis", simulator: "DETERMINISTIC_DEFAULT", live: null },
      { field: "targetHead(ELIGE AHORA)", simulator: 1, live: null },
    ]);
  });

  test("B. STRONG counter vs revealed enemy: identical columns; the Simulator headline ignores the counter Live headlines", async () => {
    const result = await runScenario(SCENARIOS.B!.facts);
    print("B", result);
    expect(byStage(result, "S1_INPUT")).toEqual([]);
    expect(byStage(result, "S2_RANKING")).toEqual([]);
    // The strategic content exists in BOTH products: Pos 3 is headed by hero 5, STRONG.
    for (const view of [result.sim, result.live]) {
      expect(view.perPosition[3]?.[0]).toMatchObject({ heroId: 5, evidenceStrength: "STRONG" });
    }
    // KNOWN DIVERGENCE (unjustified strategic): same facts, same ranking, different headline.
    expect(presentation(result)).toEqual([
      { field: "recommendedPosition", simulator: 2, live: 3 },
      { field: "targetHead(ELIGE AHORA)", simulator: 4, live: 5 },
    ]);
    expect(result.sim.perPosition[2]?.[0]?.evidenceStrength).toBe("WEAK"); // V4 points the Player at a column with no strong ground
  });

  test("C. curated synergy with a selected ally: identical columns; headline diverges the same way as B", async () => {
    const result = await runScenario(SCENARIOS.C!.facts);
    print("C", result);
    expect(byStage(result, "S1_INPUT")).toEqual([]);
    expect(byStage(result, "S2_RANKING")).toEqual([]);
    // The curated pair is a STRONG ground in both products (hero 3 with ally 1).
    for (const view of [result.simBoard, result.live]) {
      expect(view.perPosition[4]?.[0]).toMatchObject({ heroId: 3, evidenceStrength: "STRONG" });
    }
    expect(presentation(result)).toEqual([
      { field: "recommendedPosition", simulator: 2, live: 4 },
      { field: "targetHead(ELIGE AHORA)", simulator: 4, live: 3 },
    ]);
    // NOTE: the contract has only STRONG | WEAK evidence (recommendation-eligibility.ts). There is no MEDIUM tier to test;
    // a reasoned curated synergy pair is STRONG. Reported as BLOCKED for the literal "MEDIUM" wording.
  });

  test("D. critical composition need (last pick, only initiation open): full parity, STRONG in both", async () => {
    const result = await runScenario(SCENARIOS.D!.facts);
    print("D", result);
    expect(result.divergences).toEqual([]);
    expect(result.sim.perPosition[3]?.[0]).toMatchObject({ heroId: 5, evidenceStrength: "STRONG" });
    expect(result.live.perPosition[3]?.[0]).toMatchObject({ heroId: 5, evidenceStrength: "STRONG" });
    expect(result.sim.perPosition[3]?.[1]).toMatchObject({ heroId: 6, evidenceStrength: "WEAK" }); // the hero that does not fill the gap stays WEAK
    expect(result.live.targetHead).toBe(5);
    expect(result.sim.targetHead).toBe(5);
  });

  test("E. live without reported positions: Live legitimately keeps more seats open and does not invent what the capture did not say", async () => {
    const result = await runScenario(SCENARIOS.E!.facts, SCENARIOS.E!.options);
    print("E", result);
    // Information difference, deliberately not asserted equal: the capture never said which seat heroes 1 and 2 hold.
    expect(byStage(result, "S1_INPUT").map((d) => d.field)).toEqual(["context.humanOpenPositions", "context.humanActionable", "context.ownAssignedPositions"]);
    expect(result.live.actionable).toEqual([1, 2, 3, 4, 5]);
    expect(result.simBoard.actionable).toEqual([2, 3, 4]);
    // Everything that follows from the missing information is confined to the actionable-position set: no column, order or strength moved.
    expect(byStage(result, "S2_RANKING").map((d) => d.field)).toEqual(["actionablePositions"]);
    // It still advises the counter that is VISIBLE in the draft (hero 5 vs revealed 9), exactly as when positions are known (scenario B).
    expect(result.live.perPosition[3]?.[0]).toMatchObject({ heroId: 5, evidenceStrength: "STRONG" });
    expect(result.live.recommendedPosition).toBe(3);
  });

  test("E2. a half-read live draft is refused (409), never ranked", async () => {
    const store = new ProtocolSessionStore();
    const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => 1_790_000_000_000, heroPositions: HERO_POSITIONS });
    registry.ensureSession("live-half", 7);
    registry.observe("live-half", { type: "draft_started", patch: "7.41e" });
    registry.observe("live-half", { type: "side", side: "radiant" });
    registry.observe("live-half", { type: "bans_closed" });
    // Dire shows a 3rd lock while round 1 still has only 2 seats: a lock of the round it closed was never read (FACTS_UNRESOLVED).
    for (const heroId of [7, 8, 10]) registry.observe("live-half", { type: "pick", side: "dire", heroId, position: null });
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(POOL, HERO_POSITIONS), heroPositions: HERO_POSITIONS, heroCounters: NO_COUNTERS, liveRecommendationGate: (id) => registry.recommendationGate(id) });
    const response = await routes.getTeamRecommendations("live-half", new URL("http://127.0.0.1/api/session/protocol/live-half/team-recommendations"));
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("live_draft_incomplete");
  });

  test("the harness is not vacuous: a real input difference is detected at S1 (different bans)", async () => {
    const facts = SCENARIOS.B!.facts;
    const sim = await ingestSimulator(facts);
    const live = ingestLive({ ...facts, bans: [BAN, 98] });
    const fields = diffInput(inputOf(sim.store, sim.sessionId), inputOf(live.store, live.sessionId)).map((d) => d.field);
    expect(fields).toContain("context.banned");
  });

  test("capture identity flags differ by design and are not counted as strategic divergence", async () => {
    const result = await runScenario(SCENARIOS.B!.facts);
    expect(result.flags.simulator).toMatchObject({ liveCapture: false, isSimulator: true });
    expect(result.flags.live).toMatchObject({ liveCapture: true, isSimulator: false });
  });
});
