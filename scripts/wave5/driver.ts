// WAVE 5 -- real-data draft driver shared by the certification evidence script and the Dota Judge packet generator.
//
// It drives complete Ranked All Pick Simulator drafts through the SAME code the product runs: ProtocolSessionStore +
// createProtocolSessionRoutes (create / resolve-bans / auto-drive / command / bot-selection / recommendations) + the Enemy
// Bot + the REAL V6 `buildSuggestions` over the REAL meta snapshot (`loadMeta`) + the REAL curated positions/counters + the
// REAL perspective-safe Coach. Nothing is faked. It is a measurement/evidence tool, NOT a test (tests never read the real
// curated files or SQLite -- invariantes.md), and it is never imported from apps/. The SQLite is opened readonly by `loadMeta`.
import { join } from "node:path";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { buildSuggestions } from "../../apps/engine/src/signals/mix";
import { loadHeroCounters } from "../../apps/engine/src/signals/hero-counters";
import { isCandidateAdmittedForPosition, loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { createEnemyBotConfig } from "../../apps/engine/src/simulator/enemy-bot-roles";
import type { RecommendationOutputV3 } from "../../apps/engine/src/coach";
import type { HeroId, PerspectiveDraftView, TeamSide } from "../../apps/engine/src/draft-protocol/types";
import type { HeroPoolEntry, MetaSnapshot } from "../../apps/engine/src/signals/types";
import { loadMeta } from "../eval/run";
import { withWidestDenominator } from "../positions/bounds";
import { hasDistinctPositionAssignment, seededIndex } from "./pure";

export { hasDistinctPositionAssignment, percentile, seededIndex } from "./pure";

export const ENGINE_DB = join(import.meta.dir, "../../apps/engine/data/dota2coach.sqlite");
/** The frozen empirical snapshot certification runs against (scripts/eval/freeze-empirical-snapshot.ts). */
export const CERTIFICATION_SNAPSHOT_ID = "W5-EMP-001";

export interface SnapshotChoice { id: string | null; path: string; live: boolean }

/**
 * Certification never reads the mutable live database: a sync between two runs would silently change the data under a packet.
 * Default = the frozen snapshot; `--snapshot=<id>` picks another frozen one; `--live-db` is the explicit escape hatch and marks the
 * run as NOT certifiable in its evidence identity.
 */
export function resolveSnapshot(argv: readonly string[] = process.argv): SnapshotChoice {
  if (argv.includes("--live-db")) return { id: null, path: ENGINE_DB, live: true };
  const id = argv.find((arg) => arg.startsWith("--snapshot="))?.slice("--snapshot=".length) ?? CERTIFICATION_SNAPSHOT_ID;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error("--snapshot must be a frozen snapshot id");
  return { id, path: join(import.meta.dir, `../../eval/snapshots/${id}.sqlite`), live: false };
}
export const SIDES: readonly TeamSide[] = ["radiant", "dire"];
export type Policy = "follow-coach" | "varied" | "deviate";
export type Position = 1 | 2 | 3 | 4 | 5;

// Stand-ins for two different authenticated accounts. They are NOT real Steam identities (security.md: the Steam32 is
// personal data) -- only opaque keys for the two pool overlays below.
export const ACCOUNT_A = 900000001;
export const ACCOUNT_B = 900000002;

export type PositionsMode = "as-loaded" | "synthetic-envelope:widest-denominator";

export interface WorldData {
  snapshot: SnapshotChoice;
  /** `as-loaded` = the dataset exactly as the product loads it. The envelope is a SENSITIVITY probe, never certifiable evidence. */
  positionsMode: PositionsMode;
  meta: MetaSnapshot;
  syncedAt: string | null;
  heroPositions: ReturnType<typeof loadHeroPositions>;
  heroCounters: ReturnType<typeof loadHeroCounters>;
  heroIds: number[];
  name: (id: HeroId) => string;
  /** Two deliberately different personal pools (5 heroes each, from the snapshot's most-picked heroes, disjoint). */
  pools: Record<number, HeroPoolEntry[]>;
}

export function loadWorldData(): WorldData {
  const snapshot = resolveSnapshot();
  const { meta, syncedAt } = loadMeta(snapshot.path);
  const positionsMode: PositionsMode = process.argv.includes("--positions-envelope=widest") ? "synthetic-envelope:widest-denominator" : "as-loaded";
  const loadedPositions = loadHeroPositions();
  const heroPositions = positionsMode === "as-loaded" ? loadedPositions : withWidestDenominator(loadedPositions);
  const heroCounters = loadHeroCounters();
  const heroIds = Object.keys(meta.heroes).map(Number).sort((a, b) => a - b);
  const totalPicks = (id: number): number => (meta.patchStats?.[id] ?? []).reduce((sum, stat) => sum + stat.picks, 0);
  const byPopularity = [...heroIds].sort((a, b) => totalPicks(b) - totalPicks(a) || a - b);
  const entry = (hero: number): HeroPoolEntry => ({ hero, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-01-01T00:00:00.000Z" });
  const pools = {
    [ACCOUNT_A]: byPopularity.filter((_, index) => index % 2 === 0).slice(0, 5).map(entry),
    [ACCOUNT_B]: byPopularity.filter((_, index) => index % 2 === 1).slice(0, 5).map(entry),
  };
  return { snapshot, positionsMode, meta, syncedAt, heroPositions, heroCounters, heroIds, name: (id) => meta.heroes[id]?.localizedName ?? `#${id}`, pools };
}

export function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/wave5", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

export interface Lab {
  data: WorldData;
  store: ProtocolSessionStore;
  routes: ReturnType<typeof createProtocolSessionRoutes>;
  /** Every non-2xx status the routes returned during VALID operation, with the call that produced it. */
  badStatuses: string[];
}

export function createLab(data: WorldData, options: { allowForce?: boolean } = {}): Lab {
  const store = new ProtocolSessionStore();
  const computeSuggestions = async (state: Parameters<typeof buildSuggestions>[0], accountId: number | null, opts?: Parameters<typeof buildSuggestions>[2]) => {
    // The account overlay is exactly what production does: `meta.heroPool` from the account's pool, nothing else.
    const meta = accountId === null ? data.meta : { ...data.meta, heroPool: data.pools[accountId] ?? [], personalBaselineWinrate: null };
    return buildSuggestions(state, meta, { metaIsStale: true, heroPositions: data.heroPositions, ...opts });
  };
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions,
    heroUniverse: async () => {
      const totalPicks = (id: number): number => (data.meta.patchStats?.[id] ?? []).reduce((sum, stat) => sum + stat.picks, 0);
      return { allHeroIds: data.heroIds, metaOrder: [...data.heroIds].sort((a, b) => totalPicks(b) - totalPicks(a) || a - b) };
    },
    heroPositions: data.heroPositions,
    heroCounters: data.heroCounters,
    allowClientForcedBotSelection: options.allowForce === true,
  });
  return { data, store, routes, badStatuses: [] };
}

export interface StartSpec {
  seed: string;
  side: TeamSide;
  humanPosition: Position;
  /** Identical resolved bans supplied by the harness (lets a twin vary the seed while holding the visible bans equal). Absent -> the product's own resolve-bans. */
  bans?: readonly number[];
}

function noteStatus(lab: Lab, label: string, response: Response, accepted: readonly number[]): void {
  if (!accepted.includes(response.status)) lab.badStatuses.push(`${label}:${response.status}`);
}

export async function startSession(lab: Lab, spec: StartSpec): Promise<string | null> {
  const created = await lab.routes.post(jsonRequest({
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: spec.side,
    adapterKind: "simulator",
    humanPosition: spec.humanPosition,
    simulatorSeed: spec.seed,
    partyContext: { partySize: 5, side: spec.side, controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: spec.side, slotIndex, controllerId: "player" })) },
  }));
  noteStatus(lab, "create", created, [201]);
  if (created.status !== 201) return null;
  const { sessionId } = (await created.json()) as { sessionId: string };
  if (spec.bans) {
    const applied = lab.store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [...spec.bans] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    if (!applied?.ok) {
      lab.badStatuses.push("record-bans:rejected");
      return null;
    }
    return sessionId;
  }
  const resolved = await lab.routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);
  noteStatus(lab, "resolve-bans", resolved, [200]);
  return resolved.status === 200 ? sessionId : null;
}

export interface CoachAnswer {
  output: RecommendationOutputV3 | null;
  recommendationSet: { degradations: { reason: string }[]; recommendations: unknown[] };
  ms: number;
  raw: string;
}

const realLog = console.log;
export function muteLog(): void {
  console.log = () => undefined; // the recommendations route emits one structured log line per call
}
export function unmuteLog(): void {
  console.log = realLog;
}

/** The REAL Coach route (`GET .../recommendations?format=v3`), in-process: perspective-safe context in, Coach out. Timed around the route only. */
export async function askCoach(lab: Lab, sessionId: string, accountId: number | null): Promise<CoachAnswer | null> {
  const url = new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v3`);
  const started = performance.now();
  const response = await lab.routes.getRecommendations(sessionId, url, accountId);
  const ms = performance.now() - started;
  noteStatus(lab, "recommendations", response, [200]);
  if (response.status !== 200) return null;
  const body = (await response.json()) as { output: RecommendationOutputV3 | null; recommendationSet: CoachAnswer["recommendationSet"] };
  return { output: body.output, recommendationSet: body.recommendationSet, ms, raw: JSON.stringify(body, (key, value) => (key === "sessionId" ? undefined : value)) };
}

export async function sealOwn(lab: Lab, sessionId: string, side: TeamSide, slotIndex: number, heroId: number): Promise<boolean> {
  const response = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId } }), sessionId);
  noteStatus(lab, "command", response, [200, 202]);
  const body = (await response.json()) as { accepted?: boolean; rejected?: string };
  return body.accepted === true && !body.rejected;
}

export async function forceBot(lab: Lab, sessionId: string, heroId: number): Promise<boolean> {
  const response = await lab.routes.postBotSelection(jsonRequest({ forcedHeroId: heroId }), sessionId);
  if (response.status !== 200) return false;
  return ((await response.json()) as { accepted?: boolean }).accepted === true;
}

export function visibleHeroes(slots: PerspectiveDraftView["ownPicks"], allowed: readonly string[]): HeroId[] {
  const ids: HeroId[] = [];
  for (const slot of slots) if (slot.visibility !== "HIDDEN" && allowed.includes(slot.visibility)) ids.push(slot.heroId);
  return ids;
}

// ---------------------------------------------------------------------------------------------
// One complete draft.
// ---------------------------------------------------------------------------------------------

export interface DraftSpec {
  policy: Policy;
  seed: string;
  side: TeamSide;
  humanPosition: Position;
  accountId: number | null;
  /** Keep the full Coach JSON per state (memory-heavy; only for twin bases). */
  keepRaw?: boolean;
}

export interface StateRecord {
  index: number;
  round: 1 | 2 | 3 | null;
  ownSealedInRound: number;
  ownPicksRemaining: number;
  coachMs: number;
  stateIdentity: string;
  perspectiveIdentity: string;
  strategyKind: string;
  /** Position the primary action names (REVEAL_POSITION / DEFER_POSITION / REVEAL_HERO) or the possible positions (REVEAL_FLEX). */
  strategyPositions: number[];
  primaryLabel: string;
  shortlist: HeroId[];
  /** Badges of every shortlist card, flattened (QA: how often each badge is shown). */
  cardBadges: string[];
  cardRoleStatuses: string[];
  personalHeroes: { heroId: HeroId; isFromPool: boolean }[] | null;
  personalLabel: string | null;
  hasOpportunity: boolean;
  /** Safe Core composition when the block is shown: total curated hard counters and how many are banned / on the Player's own team. */
  opportunityDetail: { totalHardCounters: number; banned: number; ownPick: number; sourceType: string } | null;
  fallbackUsed: boolean;
  /** The Coach answered EXPLICITLY that it has no hero ranking (role-level action, low confidence, degradations named). */
  explicitNoShortlist: boolean;
  /** Independent check (curated positions only) that the Player's own picks admit NO distinct-position assignment. */
  ownPicksRoleInfeasible: boolean;
  degradations: string[];
  confidence: string;
  ownBeliefs: { heroId: HeroId; status: string; positions: number[] }[];
  enemyBeliefs: { heroId: HeroId; status: string; positions: number[] }[];
  ownPicks: HeroId[];
  revealedEnemy: HeroId[];
  /** Enemy seats already sealed but not revealed: the Player legally sees THAT they exist, never which hero. */
  hiddenEnemySlots: number;
  banned: HeroId[];
  chosen: HeroId;
  raw?: string;
}

export interface DraftRecord {
  key: string;
  spec: DraftSpec;
  completed: boolean;
  failures: string[];
  states: StateRecord[];
  initialBans: HeroId[];
  finalOwn: HeroId[];
  finalEnemy: HeroId[];
  /** Confirmed enemy picks by round, in seat order (harness-side truth, used only to build twins). */
  enemyByRound: Record<number, HeroId[]>;
  ownByRound: Record<number, HeroId[]>;
  /** A round in which a collision reopened a seat (twins stop there). */
  firstCollisionRound: number | null;
  trajectory: string;
  sessionId: string | null;
}

/** Called at every Coach decision state, BEFORE the Player seals (used to ask the Coach for other observers of the same state). */
export type StateHook = (sessionId: string, lab: Lab, answer: CoachAnswer) => Promise<void>;

export async function playDraft(lab: Lab, spec: DraftSpec, onState?: StateHook): Promise<DraftRecord> {
  // Same key format (and therefore the same seeded `varied` / `deviate` choices) as the Wave 4A audit: the personal position is NOT part of it.
  const key = `${spec.policy}:${spec.seed}:${spec.side}`;
  const record: DraftRecord = { key, spec, completed: false, failures: [], states: [], initialBans: [], finalOwn: [], finalEnemy: [], enemyByRound: {}, ownByRound: {}, firstCollisionRound: null, trajectory: "", sessionId: null };
  const fail = (message: string): DraftRecord => {
    record.failures.push(`${key}: ${message}`);
    return record;
  };
  const sessionId = await startSession(lab, spec);
  if (!sessionId) return fail("could not start / resolve bans");
  record.sessionId = sessionId;
  record.initialBans = [...(lab.store.view(sessionId)?.bannedHeroes ?? [])];

  let stateIndex = 0;
  let ownSealedInRound = 0;
  let lastRound: number | null = null;
  const seenOwnAttempts = new Map<number, number>();
  for (let guard = 0; guard < 60; guard += 1) {
    const drive = await lab.routes.postAutoDrive(sessionId);
    noteStatus(lab, "auto-drive", drive, [200]);
    const body = (await drive.json()) as { stopReason?: string; error?: string };
    if (drive.status !== 200) return fail(`auto-drive ${drive.status} ${body.error ?? ""}`);
    if (body.stopReason === "complete") {
      record.completed = true;
      break;
    }
    if (body.stopReason !== "human_input") continue;

    const answer = await askCoach(lab, sessionId, spec.accountId);
    if (!answer || !answer.output) return fail("no Coach output at a state where the Player has an open seat");
    const output = answer.output;
    const context = lab.store.perspectiveRecommendationContext(sessionId)!;
    const view = context.view;
    const round = output.meta.round;
    if (round !== lastRound) {
      ownSealedInRound = 0;
      lastRound = round;
    }
    if (round !== null) {
      seenOwnAttempts.set(round, (seenOwnAttempts.get(round) ?? 0) + 1);
      if (record.firstCollisionRound === null && (seenOwnAttempts.get(round) ?? 0) > (round === 3 ? 1 : 2)) record.firstCollisionRound = round;
    }
    const shortlist = output.shortlist.map((card) => card.heroId);
    const own = visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"]);
    const revealedEnemy = visibleHeroes(view.enemyPicks, ["REVEALED"]);
    const taken = new Set<HeroId>([...view.bannedHeroes, ...own, ...revealedEnemy]);
    const degradationReasons = answer.recommendationSet.degradations.map((d) => d.reason);
    const legalOptionExists = lab.data.heroIds.some((id) => !taken.has(id));
    let explicitNoShortlist = false;
    if (shortlist.length === 0) {
      // Allowed ONLY as the approved explicit degradation (compound-fallback tests 5a/5b): a role-level action, low confidence and the
      // engine's own reasons. Anything else -- an empty answer with no explanation -- is a real failure.
      explicitNoShortlist = degradationReasons.includes("NO_LEGAL_HERO_UNIVERSE") && degradationReasons.includes("ROLE_ASSIGNMENT_IMPOSSIBLE") && output.meta.confidence === "baja" && output.primaryAction.strategy.rationale.trim().length > 0;
      if (!explicitNoShortlist || !legalOptionExists) return fail(`EMPTY shortlist without an explicit degradation at state #${stateIndex} (round ${round}); degradations ${degradationReasons.join("+")}`);
    }
    for (const hero of shortlist) if (taken.has(hero)) return fail(`shortlist proposes an unavailable hero ${hero} at state #${stateIndex}`);
    if (new Set(shortlist).size !== shortlist.length) return fail(`duplicate hero inside the shortlist at state #${stateIndex}`);
    if (output.primaryAction.label.trim().length === 0) return fail(`empty primary action label at state #${stateIndex}`);

    // Player policy: the Player must always pick a LEGAL hero to move the draft on.
    let chosen: HeroId | undefined;
    if (shortlist.length === 0) {
      const anyLegal = lab.data.heroIds.filter((id) => !taken.has(id));
      chosen = anyLegal[seededIndex(`${key}:${stateIndex}`, anyLegal.length)]; // the Coach has no ranking: the Player still picks any legal hero
    } else if (spec.policy === "follow-coach") chosen = shortlist[0];
    else if (spec.policy === "varied") chosen = shortlist[seededIndex(`${key}:${stateIndex}`, shortlist.length)];
    else {
      const outside = lab.data.heroIds.filter((id) => !taken.has(id) && !shortlist.includes(id));
      chosen = outside[seededIndex(`${key}:${stateIndex}`, outside.length)];
    }
    if (chosen === undefined) return fail(`no legal hero for policy ${spec.policy} at state #${stateIndex}`);

    const openOwn = context.openOwnSlots[0];
    if (!openOwn) return fail(`no open own slot at state #${stateIndex}`);
    if (onState) await onState(sessionId, lab, answer);
    record.states.push({
      index: stateIndex,
      round,
      ownSealedInRound,
      ownPicksRemaining: output.meta.ownPicksRemaining,
      coachMs: answer.ms,
      stateIdentity: output.meta.basedOn.stateIdentity,
      perspectiveIdentity: output.meta.basedOn.perspectiveIdentity,
      strategyKind: output.primaryAction.strategy.kind,
      strategyPositions: "position" in output.primaryAction.strategy ? [output.primaryAction.strategy.position] : "possiblePositions" in output.primaryAction.strategy ? [...output.primaryAction.strategy.possiblePositions] : [],
      primaryLabel: output.primaryAction.label,
      shortlist,
      cardBadges: output.shortlist.flatMap((card) => card.badges),
      cardRoleStatuses: output.shortlist.map((card) => card.roleStatus),
      personalHeroes: output.personalHeroView ? output.personalHeroView.heroes.map((hero) => ({ heroId: hero.heroId, isFromPool: hero.isFromPool })) : null,
      personalLabel: output.personalHeroView?.positionLabel ?? null,
      hasOpportunity: output.opportunity !== undefined,
      opportunityDetail: output.opportunity ? { totalHardCounters: output.opportunity.counterEvidence.totalHardCounters, banned: output.opportunity.counterEvidence.relieved.filter((r) => r.status === "BANNED").length, ownPick: output.opportunity.counterEvidence.relieved.filter((r) => r.status === "OWN_PICK").length, sourceType: output.opportunity.counterEvidence.sourceType } : null,
      fallbackUsed: degradationReasons.includes("COMPOUND_FALLBACK_SINGLE_STEP"),
      explicitNoShortlist,
      ownPicksRoleInfeasible: !hasDistinctPositionAssignment(own, lab.data.heroPositions),
      degradations: degradationReasons,
      confidence: output.meta.confidence,
      ownBeliefs: output.roleBeliefs.own.map((b) => ({ heroId: b.heroId, status: b.status, positions: [...b.positions] })),
      enemyBeliefs: output.roleBeliefs.enemy.map((b) => ({ heroId: b.heroId, status: b.status, positions: [...b.positions] })),
      ownPicks: own,
      revealedEnemy,
      hiddenEnemySlots: view.enemyPicks.filter((slot) => slot.visibility === "HIDDEN").length,
      banned: [...view.bannedHeroes],
      chosen,
      raw: spec.keepRaw ? answer.raw : undefined,
    });
    stateIndex += 1;
    if (!(await sealOwn(lab, sessionId, spec.side, openOwn.slotIndex, chosen))) return fail(`own pick ${chosen} rejected at state #${stateIndex - 1}`);
    ownSealedInRound += 1;
  }
  if (!record.completed) return fail("did not reach COMPLETE within the guard");

  // Final authoritative facts (harness-side truth; never fed back to the Coach).
  const ranked = lab.store.get(sessionId)?.rankedAp;
  if (!ranked) return fail("no ranked state at the end");
  const enemySide: TeamSide = spec.side === "radiant" ? "dire" : "radiant";
  for (const pick of ranked.confirmedPicks) {
    const bucket = pick.side === spec.side ? record.ownByRound : record.enemyByRound;
    (bucket[pick.round] ??= [])[pick.slotIndex] = pick.heroId;
  }
  record.finalOwn = ranked.confirmedPicks.filter((pick) => pick.side === spec.side).map((pick) => pick.heroId);
  record.finalEnemy = ranked.confirmedPicks.filter((pick) => pick.side === enemySide).map((pick) => pick.heroId);
  record.trajectory = JSON.stringify({
    bans: record.initialBans,
    states: record.states.map((state) => [state.stateIdentity, state.primaryLabel, state.shortlist, state.chosen]),
    own: record.finalOwn,
    enemy: record.finalEnemy,
  });

  // Structural invariants of a finished draft.
  const all = [...record.finalOwn, ...record.finalEnemy];
  if (record.finalOwn.length !== 5 || record.finalEnemy.length !== 5) fail(`unexpected team sizes ${record.finalOwn.length}/${record.finalEnemy.length}`);
  if (new Set(all).size !== all.length) fail("a hero was drafted twice (same-side or cross-side duplicate)");
  for (const side of [record.finalOwn, record.finalEnemy]) if (new Set(side).size !== side.length) fail("same-side duplicate hero");
  const banned = new Set<HeroId>(ranked.bannedHeroes);
  for (const hero of all) if (banned.has(hero)) fail(`banned hero ${hero} ended up on a team`);
  for (const hero of all) if (lab.data.meta.heroes[hero] === undefined) fail(`hero ${hero} does not exist in the snapshot`);

  // Enemy Bot positional validity: every confirmed enemy pick is admissible for the seat's private assignment.
  const botConfig = createEnemyBotConfig(spec.seed, enemySide);
  for (const pick of ranked.confirmedPicks.filter((entry) => entry.side === enemySide)) {
    const roster = (pick.round === 1 ? 0 : pick.round === 2 ? 2 : 4) + pick.slotIndex;
    const assigned = botConfig.internalPositionAssignments[roster]!;
    if (!isCandidateAdmittedForPosition(pick.heroId, assigned, lab.data.heroPositions)) fail(`Enemy Bot seat ${roster} (private Pos${assigned}) holds hero ${pick.heroId}, which has no evidence for that position`);
  }
  return record;
}
