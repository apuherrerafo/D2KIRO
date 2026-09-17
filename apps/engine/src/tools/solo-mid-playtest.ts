import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as schema from "../db/schema";
import type { DraftState } from "../draft/reducer";
import type { PerspectiveHeroSlot } from "../draft-protocol";
import { getCachedMetaSnapshot } from "../meta/provider";
import { loadHeroPositions, isCandidateAdmittedForPosition, positionShare } from "../signals/hero-positions";
import { buildSuggestions, type BuildSuggestionsOptions, type Suggestion } from "../signals/mix";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";

const PATCH = "7.41e";
const BASE_SEED = "D2K00001";
const DEFAULT_BANS = [14, 26, 11, 25, 86, 35, 74, 54, 2, 8, 84, 21, 36, 71, 30, 7];
const OUTPUT_DIR = resolve(process.cwd(), "docs/diagnostics");
const JSON_PATH = resolve(OUTPUT_DIR, "ap-solo-mid-playtest.json");
const JUDGE_PATH = resolve(OUTPUT_DIR, "ap-solo-mid-judge-pack.md");
const CONTEXT_CASE_IDS = [
  "meaningful-bans",
  "enemy-puck",
  "enemy-huskar",
  "enemy-viper",
  "mobility",
  "illusion-carry",
  "greedy",
  "physical",
  "magic",
  "catch",
  "sustain",
  "allied-need-catch",
  "allied-need-waveclear",
  "damage-profile",
  "tempo",
] as const;

type MetaSnapshot = Awaited<ReturnType<typeof getCachedMetaSnapshot>>;

interface ScenarioDefinition {
  caseId: string;
  label: string;
  seed: string;
  banned?: number[];
  allies?: number[];
  enemies?: number[];
}

interface FullDraftResult {
  seed: string;
  top6: number[];
  radiant: number[];
  dire: number[];
  externalPicks: unknown[];
  acceptedHumanPicks: number;
  collisions: number;
  externalCommandRejected: boolean;
  humanContextCorrect: boolean;
}

// Report entries vary by shape (per-scenario Top6 vs the aggregate 10-seed batch) -- this is a
// diagnostic JSON report, not a typed product contract, so machineFlags/top6/externalPicks stay
// loose on purpose rather than forcing every case into one rigid interface.
interface PlaytestCase {
  caseId: string;
  label: string;
  seed: string;
  state: { banned: number[]; allies: number[]; enemies: number[] };
  top6: unknown;
  externalPicks: unknown;
  machineFlags: Record<string, unknown>;
}

function request(body: unknown): Request {
  return new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function visible(slots: readonly PerspectiveHeroSlot[]): number[] {
  return slots.flatMap((slot) => slot.visibility === "HIDDEN" ? [] : [slot.heroId]);
}

function stateFor(definition: ScenarioDefinition): DraftState {
  return {
    sessionId: definition.caseId,
    schema: "draft-state/v1",
    format: "all_pick",
    patch: PATCH,
    localSide: "radiant",
    phase: "active",
    banned: [...(definition.banned ?? DEFAULT_BANS)],
    picks: { radiant: [...(definition.allies ?? [])], dire: [...(definition.enemies ?? [])] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-09-17T00:00:00.000Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
  };
}

function normalizedName(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^a-z0-9]/g, "");
}

function heroResolver(meta: MetaSnapshot): (name: string) => number {
  const byName = new Map(Object.values(meta.heroes).map((hero) => [normalizedName(hero.localizedName), hero.id]));
  return (name: string) => {
    const hero = byName.get(normalizedName(name));
    if (hero === undefined) throw new Error(`hero not found for playtest fixture: ${name}`);
    return hero;
  };
}

function suggestionRecord(suggestion: Suggestion, heroPositions: ReturnType<typeof loadHeroPositions>, meta: MetaSnapshot) {
  return {
    heroId: suggestion.hero,
    heroName: meta.heroes[suggestion.hero]?.localizedName ?? `Hero ${suggestion.hero}`,
    rank: suggestion.rank,
    score: suggestion.score,
    midShare: positionShare(suggestion.hero, 2, heroPositions),
    midAdmitted: isCandidateAdmittedForPosition(suggestion.hero, 2, heroPositions),
    signals: suggestion.signals.map((signal) => ({
      signal: signal.signal,
      raw: signal.raw,
      weighted: signal.weighted,
    })),
  };
}

async function runFullDraft(
  seed: string,
  meta: MetaSnapshot,
  heroPositions: ReturnType<typeof loadHeroPositions>,
): Promise<FullDraftResult> {
  let humanContextCorrect = false;
  const computeSuggestions = async (state: DraftState, _accountId: null, options: BuildSuggestionsOptions = {}) => {
    if (options.targetPosition === 2 && options.diversitySeed === seed) {
      humanContextCorrect = options.teamOpening === false;
    }
    return buildSuggestions(state, meta, { heroPositions, ...options });
  };
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions });
  const created = await routes.post(request({
    rulesetId: "dota2/ranked-all-pick",
    patch: PATCH,
    localSide: "radiant",
    adapterKind: "simulator",
    partyContext: {
      partySize: 1,
      side: "radiant",
      controlledSlots: [{ side: "radiant", slotIndex: 4, controllerId: "solo-mid-human" }],
    },
    humanPosition: 2,
    humanRosterSlot: 4,
    simulatorSeed: seed,
  }));
  if (created.status !== 201) throw new Error(`session create failed: ${created.status}`);
  const { sessionId } = await created.json() as { sessionId: string };
  await routes.postCommand(request({ command: { type: "RECORD_RESOLVED_BANS", heroes: DEFAULT_BANS } }), sessionId);
  await routes.postCommand(request({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), sessionId);
  const unauthorizedExternal = await routes.postCommand(request({
    command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 },
  }), sessionId);
  const externalCommandRejected = unauthorizedExternal.status === 403;

  let externalPicks: unknown[] = [];
  let acceptedHumanPicks = 0;
  let top6: number[] = [];
  for (let guard = 0; guard < 12; guard += 1) {
    const driven = await routes.postAutoDrive(sessionId);
    if (!driven.ok) throw new Error(`auto-drive failed: ${driven.status}`);
    const body = await driven.json() as {
      stopReason: "round_revealed" | "human_input" | "complete";
      externalPicks: unknown[];
      view: { status: string; ownPicks: PerspectiveHeroSlot[]; enemyPicks: PerspectiveHeroSlot[]; bannedHeroes: number[] };
      legalActions: { type: string; side: "radiant"; slotIndex: number }[];
    };
    externalPicks = body.externalPicks;
    if (body.stopReason === "human_input") {
      const recommendationResponse = await routes.getRecommendations(
        sessionId,
        new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations`),
      );
      const recommendation = await recommendationResponse.json() as {
        recommendations: { actions: { hero: number }[] }[];
      };
      top6 = recommendation.recommendations.map((entry) => entry.actions[0]!.hero);
      const action = body.legalActions[0];
      const heroId = top6[0];
      if (!action || heroId === undefined) throw new Error("human recommendation/action unavailable");
      const submitted = await routes.postCommand(request({ command: { ...action, heroId } }), sessionId);
      const submittedBody = await submitted.json() as { accepted?: boolean };
      if (submittedBody.accepted) acceptedHumanPicks += 1;
      continue;
    }
    if (body.view.status === "COMPLETE" || body.stopReason === "complete") {
      return {
        seed,
        top6,
        radiant: visible(body.view.ownPicks),
        dire: visible(body.view.enemyPicks),
        externalPicks,
        acceptedHumanPicks,
        collisions: Math.max(0, body.view.bannedHeroes.length - DEFAULT_BANS.length),
        externalCommandRejected,
        humanContextCorrect,
      };
    }
  }
  throw new Error(`full draft guard exhausted for ${seed}`);
}

function scenarioDefinitions(hero: (name: string) => number, meaningfulBans: number[]): ScenarioDefinition[] {
  return [
    { caseId: "opening-baseline", label: "Opening baseline", seed: BASE_SEED },
    { caseId: "exact-replay", label: "Exact replay", seed: BASE_SEED },
    { caseId: "irrelevant-ban", label: "Irrelevant ban", seed: "D2K00003", banned: [...DEFAULT_BANS, hero("Chen")] },
    { caseId: "meaningful-bans", label: "Meaningful bans", seed: "D2K00004", banned: [...DEFAULT_BANS, ...meaningfulBans] },
    { caseId: "enemy-puck", label: "Enemy Puck", seed: "D2K00005", enemies: [hero("Puck")] },
    { caseId: "enemy-huskar", label: "Enemy Huskar", seed: "D2K00006", enemies: [hero("Huskar")] },
    { caseId: "enemy-viper", label: "Enemy Viper", seed: "D2K00007", enemies: [hero("Viper")] },
    { caseId: "mobility", label: "Mobility", seed: "D2K00008", enemies: [hero("Storm Spirit"), hero("Puck")] },
    { caseId: "illusion-carry", label: "Illusion carry", seed: "D2K00009", enemies: [hero("Phantom Lancer")] },
    { caseId: "greedy", label: "Greedy", seed: "D2K00010", enemies: [hero("Anti-Mage"), hero("Doom")] },
    { caseId: "physical", label: "Heavy physical", seed: "D2K00011", enemies: [hero("Drow Ranger"), hero("Sven")] },
    { caseId: "magic", label: "Heavy magic", seed: "D2K00012", enemies: [hero("Zeus"), hero("Leshrac")] },
    { caseId: "catch", label: "Dive / catch", seed: "D2K00013", enemies: [hero("Clockwerk"), hero("Batrider")] },
    { caseId: "sustain", label: "Sustain", seed: "D2K00014", enemies: [hero("Oracle"), hero("Dazzle")] },
    { caseId: "allied-need-catch", label: "Allied need catch", seed: "D2K00015", allies: [hero("Drow Ranger"), hero("Dazzle")] },
    { caseId: "allied-need-waveclear", label: "Allied need waveclear", seed: "D2K00016", allies: [hero("Lifestealer"), hero("Bane")] },
    { caseId: "damage-profile", label: "Magic-heavy allies need physical damage", seed: "D2K00017", allies: [hero("Zeus"), hero("Leshrac")] },
    { caseId: "tempo", label: "Greedy allies need tempo", seed: "D2K00018", allies: [hero("Anti-Mage"), hero("Doom")] },
  ];
}

function formatDistribution(values: number[], meta: MetaSnapshot): Record<string, number> {
  const result: Record<string, number> = {};
  for (const heroId of values) {
    const name = meta.heroes[heroId]?.localizedName ?? String(heroId);
    result[name] = (result[name] ?? 0) + 1;
  }
  return result;
}

async function main(): Promise<void> {
  const dbPath = resolve(process.cwd(), "apps/engine/data/dota2coach.sqlite");
  const sqlite = new Database(dbPath, { readonly: true, create: false });
  const db = drizzle(sqlite, { schema });
  const meta = await getCachedMetaSnapshot(db, null);
  const heroPositions = loadHeroPositions();
  const hero = heroResolver(meta);

  const baselineDefinition: ScenarioDefinition = { caseId: "baseline-probe", label: "Baseline probe", seed: BASE_SEED };
  const baselineSuggestions = buildSuggestions(stateFor(baselineDefinition), meta, {
    targetPosition: 2,
    teamOpening: false,
    diversitySeed: BASE_SEED,
    heroPositions,
  }).suggestions;
  const definitions = scenarioDefinitions(hero, baselineSuggestions.slice(0, 2).map((entry) => entry.hero));
  const cases: PlaytestCase[] = definitions.map((definition) => {
    const state = stateFor(definition);
    const result = buildSuggestions(state, meta, {
      targetPosition: 2,
      teamOpening: false,
      diversitySeed: definition.seed,
      heroPositions,
    });
    const top6 = result.suggestions.map((suggestion) => suggestionRecord(suggestion, heroPositions, meta));
    const legal = top6.every((entry) => !state.banned.includes(entry.heroId)
      && !state.picks.radiant.includes(entry.heroId)
      && !state.picks.dire.includes(entry.heroId));
    return {
      caseId: definition.caseId,
      label: definition.label,
      seed: definition.seed,
      state: { banned: state.banned, allies: state.picks.radiant, enemies: state.picks.dire },
      top6,
      externalPicks: [...state.picks.radiant, ...state.picks.dire],
      machineFlags: {
        legal,
        top6Count: top6.length === 6,
        allMidAdmitted: top6.length === 6 && top6.every((entry) => entry.midAdmitted),
        noTeamOpening: result.decisionContext !== "team_opening",
      },
    };
  });

  const seeds = Array.from({ length: 10 }, (_, index) => `D2K${String(index + 1).padStart(5, "0")}`);
  const batch = [] as FullDraftResult[];
  for (const seed of seeds) batch.push(await runFullDraft(seed, meta, heroPositions));
  const replayBatch = [] as FullDraftResult[];
  for (const seed of seeds) replayBatch.push(await runFullDraft(seed, meta, heroPositions));
  const replayA = await runFullDraft(BASE_SEED, meta, heroPositions);
  const replayB = await runFullDraft(BASE_SEED, meta, heroPositions);
  const late = batch[0]!;
  const lateState: ScenarioDefinition = {
    caseId: "late-pick",
    label: "Late pick: four allies + four enemies visible",
    seed: late.seed,
    allies: late.radiant.slice(0, 4),
    enemies: late.dire.slice(0, 4),
  };
  const lateSuggestions = buildSuggestions(stateFor(lateState), meta, {
    targetPosition: 2,
    teamOpening: false,
    diversitySeed: late.seed,
    heroPositions,
  }).suggestions.map((suggestion) => suggestionRecord(suggestion, heroPositions, meta));
  cases.push({
    caseId: lateState.caseId,
    label: lateState.label,
    seed: lateState.seed,
    state: { banned: DEFAULT_BANS, allies: lateState.allies ?? [], enemies: lateState.enemies ?? [] },
    top6: lateSuggestions,
    externalPicks: late.externalPicks,
    machineFlags: {
      legal: lateSuggestions.every((entry) => !DEFAULT_BANS.includes(entry.heroId)),
      top6Count: lateSuggestions.length === 6,
      allMidAdmitted: lateSuggestions.length === 6 && lateSuggestions.every((entry) => entry.midAdmitted),
      productTop6Matches: JSON.stringify(lateSuggestions.map((entry) => entry.heroId)) === JSON.stringify(late.top6),
    },
  });

  const uniqueDrafts = new Set(batch.map((entry) => JSON.stringify([entry.radiant, entry.dire]))).size;
  const top1Distribution = formatDistribution(batch.map((entry) => entry.top6[0]!), meta);
  const oneHumanPickEach = batch.every((entry) => entry.acceptedHumanPicks === 1);
  const alliedExternalEach = batch.every((entry) => entry.externalPicks.filter((pick) => (pick as { side: string }).side === "radiant").length === 4);
  const enemyExternalEach = batch.every((entry) => entry.externalPicks.filter((pick) => (pick as { side: string }).side === "dire").length === 5);
  const externalCommandRejected = batch.every((entry) => entry.externalCommandRejected);
  const humanContextCorrect = batch.every((entry) => entry.humanContextCorrect);
  const batchMidValid = batch.every((entry) => entry.top6.length === 6
    && entry.top6.every((heroId) => isCandidateAdmittedForPosition(heroId, 2, heroPositions)));
  cases.push({
    caseId: "ten-seed-batch",
    label: "10-seed batch",
    seed: "D2K00001..D2K00010",
    state: { banned: DEFAULT_BANS, allies: [], enemies: [] },
    top6: batch.map((entry) => ({ seed: entry.seed, heroes: entry.top6 })),
    externalPicks: batch.map((entry) => ({ seed: entry.seed, picks: entry.externalPicks })),
    machineFlags: {
      uniqueDrafts,
      top1Distribution,
      allDraftsLegal: batch.every((entry) => new Set([...entry.radiant, ...entry.dire]).size === 10),
      oneHumanPickEach,
      alliedExternalEach,
      enemyExternalEach,
      externalCommandRejected,
      humanContextCorrect,
      batchMidValid,
    },
  });

  const replayPass = JSON.stringify([replayA.radiant, replayA.dire, replayA.top6, replayA.externalPicks])
    === JSON.stringify([replayB.radiant, replayB.dire, replayB.top6, replayB.externalPicks]);
  const allSeedReplayPass = JSON.stringify(batch) === JSON.stringify(replayBatch);
  const allMidValid = cases.slice(0, 19).every((entry) => {
    const flags = entry.machineFlags as { allMidAdmitted?: boolean };
    return flags.allMidAdmitted === true;
  });
  const legal = batch.every((entry) => new Set([...entry.radiant, ...entry.dire]).size === 10);
  const variationPass = uniqueDrafts > 1 && Object.keys(top1Distribution).length > 1;
  const productModelPass = oneHumanPickEach && alliedExternalEach && enemyExternalEach;
  const baselineFingerprint = JSON.stringify(cases[0]!.top6);
  const changedContextCases = cases
    .filter((entry) => CONTEXT_CASE_IDS.includes(entry.caseId as typeof CONTEXT_CASE_IDS[number]))
    .filter((entry) => JSON.stringify(entry.top6) !== baselineFingerprint)
    .map((entry) => entry.caseId);
  // Runner-only sanity gate: at least two thirds of the deliberately contextual cases must alter
  // ranking or signal evidence. This is not a Dota-quality score and never changes recommendations.
  const contextSensitivityPass = changedContextCases.length >= 10;
  const machinePass = replayPass && allSeedReplayPass && variationPass && allMidValid && batchMidValid && legal
    && productModelPass && externalCommandRejected && humanContextCorrect && contextSensitivityPass
    && cases.length === 20;
  const report = {
    schema: "ap-solo-mid-playtest/v1",
    generatedAt: new Date().toISOString(),
    patch: PATCH,
    policy: {
      mode: "Ranked All Pick",
      party: "Solo",
      side: "Radiant",
      humanRosterSlot: 4,
      humanPosition: 2,
      intent: null,
      midCandidateAdmission: "Position 2 dominant OR historical Position 2 share >= 25%",
      externalSelection: "seeded among Top3 within 5 score points of best",
    },
    summary: {
      scenarioCount: cases.length,
      replayPass,
      allSeedReplayPass,
      uniqueDrafts,
      top1Distribution,
      allMidValid,
      legal,
      variationPass,
      productModelPass,
      externalCommandRejected,
      humanContextCorrect,
      contextSensitivity: {
        pass: contextSensitivityPass,
        changed: changedContextCases,
        unchanged: CONTEXT_CASE_IDS.filter((caseId) => !changedContextCases.includes(caseId)),
      },
      humanPicksPerDraft: batch.map((entry) => entry.acceptedHumanPicks),
      collisions: batch.reduce((sum, entry) => sum + entry.collisions, 0),
    },
    cases,
  };

  const judgeLines = [
    "# AP Solo Mid judge pack",
    "",
    "Machine checks only. This pack does not claim Dota expertise; review Top6 quality and context reaction independently.",
    "",
    `- Patch: ${PATCH}`,
    `- Scenarios: ${cases.length}`,
    `- Same-seed replay: ${replayPass ? "PASS" : "FAIL"}`,
    `- All 10 seeds replay identically in fresh sessions: ${allSeedReplayPass ? "PASS" : "FAIL"}`,
    `- Unique full drafts across 10 seeds: ${uniqueDrafts}`,
    `- All Top6 candidates pass Mid admission: ${allMidValid ? "PASS" : "FAIL"}`,
    `- All full drafts have 10 unique heroes: ${legal ? "PASS" : "FAIL"}`,
    `- Product model (1 human + 4 allied external + 5 enemy external): ${productModelPass ? "PASS" : "FAIL"}`,
    `- External-slot browser command rejected: ${externalCommandRejected ? "PASS" : "FAIL"}`,
    `- Human V6 context (targetPosition=2, teamOpening=false): ${humanContextCorrect ? "PASS" : "FAIL"}`,
    `- Context sensitivity: ${contextSensitivityPass ? "PASS" : "FAIL"} (${changedContextCases.length}/${CONTEXT_CASE_IDS.length} designed cases changed ranking/signals)`,
    `- Human accepted picks per draft: ${batch.map((entry) => entry.acceptedHumanPicks).join(", ")}`,
    `- Top1 distribution: ${JSON.stringify(top1Distribution)}`,
    "",
    "## Review queue",
    "",
    ...cases.slice(0, 19).map((entry) => {
      const top = entry.top6 as ReturnType<typeof suggestionRecord>[];
      return `- ${entry.caseId}: ${top.map((candidate) => `${candidate.heroName} (${(candidate.midShare * 100).toFixed(1)}%)`).join("; ")}`;
    }),
    "",
    "Review questions: Is every candidate a credible Mid? Do Puck/Huskar/Viper and composition cases move the ranking for defensible reasons? Are any machine-valid picks strategically bad?",
    "",
  ];
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(JSON_PATH, `${JSON.stringify(report)}\n`, "utf8");
  await writeFile(JUDGE_PATH, `${judgeLines.join("\n")}\n`, "utf8");
  sqlite.close();

  console.log(`AP Solo Mid playtest: ${machinePass ? "PASS" : "FAIL"}`);
  console.log(`20 scenarios: ${cases.length}`);
  console.log(`10-seed unique drafts: ${uniqueDrafts}`);
  console.log(`10-seed Top1 distribution: ${JSON.stringify(top1Distribution)}`);
  console.log(`JSON: ${JSON_PATH}`);
  console.log(`Judge pack: ${JUDGE_PATH}`);
  if (!machinePass) process.exitCode = 1;
}

await main();
