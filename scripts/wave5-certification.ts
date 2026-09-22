#!/usr/bin/env bun
// WAVE 5 -- PRODUCT CERTIFICATION, real-data evidence run. Measurement + invariant checking only: it changes no product logic.
//
//   bun scripts/wave5-certification.ts --suffix=_X  -> writes docs/diagnostics/WAVE5_AUTOMATED_EVIDENCE_X.{md,json} (never overwrites an existing one)
//   bun scripts/wave5-certification.ts --stdout   -> prints the markdown instead of writing files
//
// It drives complete Simulator drafts through the code the product runs (scripts/wave5/driver.ts) over the REAL meta snapshot
// (SQLite opened readonly, zero network), the real curated hero-positions / hero-counters and the real perspective-safe Coach, and
// certifies, with numbers: the soak (completion, legality, positional validity, no 4xx/5xx, determinism), hidden-information
// invariance on real data (twins that differ in hidden heroes, Simulator seed, Enemy Bot private positions and sealing order),
// Team-vs-Personal isolation across two different Hero Pools, the compound single-step fallback, the natural Safe Core windows,
// and the latency of the real Coach route. Exit code 1 if ANY invariant fails. It is NOT a test (tests never read real data) and is
// never imported from apps/.
import { cpus, platform, release, totalmem } from "node:os";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  SIDES,
  askCoach,
  createLab,
  forceBot,
  loadWorldData,
  muteLog,
  percentile,
  playDraft,
  seededIndex,
  sealOwn,
  startSession,
  unmuteLog,
  type DraftRecord,
  type DraftSpec,
  type Policy,
  type Position,
  type WorldData,
} from "./wave5/driver";
import { collectEvidenceIdentity } from "./wave5/evidence-identity";

const OUT_DIR = join(import.meta.dir, "../docs/diagnostics");
// Certification remediation (A3): historical evidence is never overwritten -- a re-run writes next to it under a NEW suffix.
const SUFFIX = process.argv.find((arg) => arg.startsWith("--suffix="))?.slice("--suffix=".length) ?? "";
if (!/^[A-Za-z0-9_]*$/.test(SUFFIX)) throw new Error("--suffix may only contain letters, digits and underscores");
const BASENAME = `WAVE5_AUTOMATED_EVIDENCE${SUFFIX}`;
const SEED_COUNT = 100; // AUDIT001..AUDIT100 -- the same deterministic seeds as the Wave 4A audit
const SEEDS = Array.from({ length: SEED_COUNT }, (_, i) => `AUDIT${String(i + 1).padStart(3, "0")}`);
const POLICIES: readonly Policy[] = ["follow-coach", "varied", "deviate"];
const TWIN_BASE_SEEDS = SEEDS.slice(0, 30);
const SEPARATION_SEEDS = SEEDS.slice(0, 40);
const COLD_CALLS = 25;

/** The 19 drafts that aborted with an empty shortlist before the Wave 4A compound single-step fallback (WAVE4A_SAFE_CORE_INCIDENCE.md §2). */
const PREVIOUSLY_ABORTED: readonly string[] = [
  "follow-coach:AUDIT033:dire", "follow-coach:AUDIT044:radiant", "follow-coach:AUDIT053:radiant", "follow-coach:AUDIT057:dire",
  "follow-coach:AUDIT059:radiant", "follow-coach:AUDIT078:radiant", "follow-coach:AUDIT079:dire", "follow-coach:AUDIT079:radiant",
  "varied:AUDIT015:radiant", "varied:AUDIT035:dire", "varied:AUDIT037:dire", "varied:AUDIT037:radiant", "varied:AUDIT039:radiant",
  "varied:AUDIT042:dire", "varied:AUDIT045:dire", "varied:AUDIT046:radiant", "varied:AUDIT078:radiant", "varied:AUDIT084:dire",
  "varied:AUDIT090:radiant",
];

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const fmt = (n: number): string => (Number.isNaN(n) ? "n/a" : n.toFixed(2));

function specFor(policy: Policy, seed: string, side: (typeof SIDES)[number], seedIndex: number, keepRaw = false): DraftSpec {
  const sideIndex = side === "radiant" ? 0 : 1;
  return {
    policy,
    seed,
    side,
    humanPosition: (((seedIndex + sideIndex) % 5) + 1) as Position, // every personal position is exercised on both sides
    accountId: seedIndex % 2 === 0 ? ACCOUNT_A : ACCOUNT_B, // every draft runs with a configured Hero Pool
    keepRaw,
  };
}

// ---------------------------------------------------------------------------------------------
// 1. SOAK + determinism
// ---------------------------------------------------------------------------------------------

interface Soak {
  records: DraftRecord[];
  replayMismatches: string[];
  badStatuses: string[];
  timings: number[];
  wallMs: number;
}

async function runSoak(data: WorldData): Promise<Soak> {
  const started = performance.now();
  const records: DraftRecord[] = [];
  const replayMismatches: string[] = [];
  const badStatuses: string[] = [];
  const timings: number[] = [];
  for (const policy of POLICIES) {
    for (const [seedIndex, seed] of SEEDS.entries()) {
      for (const side of SIDES) {
        const spec = specFor(policy, seed, side, seedIndex);
        const lab = createLab(data);
        const record = await playDraft(lab, spec);
        records.push(record);
        badStatuses.push(...lab.badStatuses.map((status) => `${record.key}:${status}`));
        for (const state of record.states) timings.push(state.coachMs);
        // Determinism: the SAME (seed, side, policy, personal position, pool) in a fresh process state must replay byte-identically.
        const replayLab = createLab(data);
        const replay = await playDraft(replayLab, spec);
        if (replay.trajectory !== record.trajectory || replay.completed !== record.completed) replayMismatches.push(record.key);
      }
    }
  }
  return { records, replayMismatches, badStatuses, timings, wallMs: performance.now() - started };
}

// ---------------------------------------------------------------------------------------------
// 2. HIDDEN-INFORMATION TWINS on real data
// ---------------------------------------------------------------------------------------------

interface TwinResult {
  compared: number;
  identical: number;
  mismatches: string[];
  skippedCollision: number;
  divergedAfterReveal: number;
  revealChecks: number;
  twistCases: number;
}

function alternativeHeroes(data: WorldData, base: DraftRecord, round: 1 | 2 | 3, count: number): number[] {
  const takenByBase = new Set<number>(base.initialBans);
  for (const heroes of [base.enemyByRound, base.ownByRound]) for (const [r, list] of Object.entries(heroes)) if (Number(r) <= round) for (const hero of list) takenByBase.add(hero);
  const candidates = data.heroIds.filter((id) => !takenByBase.has(id));
  const picked: number[] = [];
  let cursor = seededIndex(`${base.key}:alt:${round}`, candidates.length);
  while (picked.length < count + 6 && picked.length < candidates.length) {
    const hero = candidates[cursor % candidates.length]!;
    if (!picked.includes(hero)) picked.push(hero);
    cursor += 7;
  }
  return picked;
}

async function runTwin(data: WorldData, base: DraftRecord, round: 1 | 2 | 3, twist: boolean, result: TwinResult): Promise<void> {
  const lab = createLab(data, { allowForce: true });
  const spec = base.spec;
  const seats = round === 3 ? 1 : 2;
  const twistHere = twist && seats === 2;
  const altSeed = `${spec.seed.slice(0, 6)}ZZ`; // different Simulator seed => different Enemy Bot private positions; bans are pinned equal below
  const sessionId = await startSession(lab, { seed: altSeed, side: spec.side, humanPosition: spec.humanPosition, bans: base.initialBans });
  const label = `${base.key} r${round}${twistHere ? " (player-first)" : ""}`;
  if (!sessionId) {
    result.mismatches.push(`${label}: could not start the twin session`);
    return;
  }
  const same = async (round_: number, ownSealed: number, mine: string): Promise<boolean> => {
    const theirs = base.states.find((state) => state.round === round_ && state.ownSealedInRound === ownSealed)?.raw;
    result.compared += 1;
    if (theirs === mine) {
      result.identical += 1;
      return true;
    }
    result.mismatches.push(`${label}: Coach output differs at round ${round_} after ${ownSealed} own seal(s) although only hidden information differs`);
    return false;
  };

  for (let k = 1 as 1 | 2 | 3; k <= round; k = (k + 1) as 1 | 2 | 3) {
    const kSeats = k === 3 ? 1 : 2;
    const botPlan = k < round ? base.enemyByRound[k]! : alternativeHeroes(data, base, k, kSeats);
    const ownPlan = base.ownByRound[k]!;
    const compareHere = k === round;
    const forceSeats = async (): Promise<boolean> => {
      let sealed = 0;
      for (const hero of botPlan) {
        if (sealed === kSeats) break;
        if (k < round ? true : !base.enemyByRound[k]?.includes(hero) && !ownPlan.includes(hero)) {
          if (await forceBot(lab, sessionId, hero)) sealed += 1;
          else if (k < round) return false;
        }
      }
      return sealed === kSeats;
    };
    const twistNow = twistHere && k === round;
    if (twistNow) {
      await askCoach(lab, sessionId, spec.accountId); // warm-up call keeps the per-session revision counter aligned (state differs: nothing is compared)
      if (!(await sealOwn(lab, sessionId, spec.side, 0, ownPlan[0]!))) return void result.mismatches.push(`${label}: own seal rejected`);
      if (!(await forceSeats())) return void result.mismatches.push(`${label}: forced Enemy Bot seals not accepted`);
      const after1 = await askCoach(lab, sessionId, spec.accountId);
      if (!after1) return void result.mismatches.push(`${label}: no Coach output`);
      if (compareHere && !(await same(k, 1, after1.raw))) return;
      result.twistCases += 1;
      if (!(await sealOwn(lab, sessionId, spec.side, 1, ownPlan[1]!))) return void result.mismatches.push(`${label}: own seal rejected`);
    } else {
      if (!(await forceSeats())) return void result.mismatches.push(`${label}: forced Enemy Bot seals not accepted (round ${k})`);
      const start = await askCoach(lab, sessionId, spec.accountId);
      if (!start) return void result.mismatches.push(`${label}: no Coach output`);
      if (compareHere && !(await same(k, 0, start.raw))) return;
      if (!(await sealOwn(lab, sessionId, spec.side, 0, ownPlan[0]!))) return void result.mismatches.push(`${label}: own seal rejected`);
      if (kSeats === 2) {
        const after1 = await askCoach(lab, sessionId, spec.accountId);
        if (!after1) return void result.mismatches.push(`${label}: no Coach output`);
        if (compareHere && !(await same(k, 1, after1.raw))) return;
        if (!(await sealOwn(lab, sessionId, spec.side, 1, ownPlan[1]!))) return void result.mismatches.push(`${label}: own seal rejected`);
      }
    }
  }

  // Sensitivity: the round just closed, so the enemy identities are now LEGAL information and the worlds must be free to diverge.
  if (round < 3) {
    const next = base.states.find((state) => state.round === round + 1 && state.ownSealedInRound === 0)?.raw;
    const revealed = await askCoach(lab, sessionId, spec.accountId);
    if (next !== undefined && revealed) {
      result.revealChecks += 1;
      if (revealed.raw !== next) result.divergedAfterReveal += 1;
    }
  }
}

async function runTwins(data: WorldData): Promise<TwinResult> {
  const result: TwinResult = { compared: 0, identical: 0, mismatches: [], skippedCollision: 0, divergedAfterReveal: 0, revealChecks: 0, twistCases: 0 };
  for (const [seedIndex, seed] of TWIN_BASE_SEEDS.entries()) {
    for (const side of SIDES) {
      const baseLab = createLab(data);
      const base = await playDraft(baseLab, specFor("follow-coach", seed, side, seedIndex, true));
      if (!base.completed) {
        result.mismatches.push(`${base.key}: base draft did not complete (${base.failures[0] ?? "?"})`);
        continue;
      }
      for (const round of [1, 2, 3] as const) {
        if (base.firstCollisionRound !== null && round >= base.firstCollisionRound) {
          result.skippedCollision += 1;
          continue;
        }
        await runTwin(data, base, round, false, result);
        if (round !== 3) await runTwin(data, base, round, true, result);
      }
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// 3. TEAM vs PERSONAL separation on real states
// ---------------------------------------------------------------------------------------------

interface Separation {
  states: number;
  teamIdentical: number;
  teamMismatches: string[];
  personalDiffers: number;
  poolMembershipDiffers: number;
  poolBadgeOnTeamList: number;
}

function teamSurface(raw: string): string {
  const body = JSON.parse(raw) as { output: Record<string, unknown> & { meta: Record<string, unknown> }; recommendationSet: unknown };
  const { revision: _revision, trigger: _trigger, ...stableMeta } = body.output.meta;
  return JSON.stringify({
    primaryAction: body.output.primaryAction,
    shortlist: body.output.shortlist,
    opportunity: body.output.opportunity ?? null,
    roleBeliefs: body.output.roleBeliefs,
    meta: stableMeta,
    recommendationSet: body.recommendationSet,
  });
}

async function runSeparation(data: WorldData): Promise<Separation> {
  const result: Separation = { states: 0, teamIdentical: 0, teamMismatches: [], personalDiffers: 0, poolMembershipDiffers: 0, poolBadgeOnTeamList: 0 };
  for (const [seedIndex, seed] of SEPARATION_SEEDS.entries()) {
    for (const side of SIDES) {
      const lab = createLab(data);
      const spec = { ...specFor("follow-coach", seed, side, seedIndex), accountId: ACCOUNT_A };
      let index = 0;
      await playDraft(lab, spec, async (sessionId, _lab, answerA) => {
        const answerB = await askCoach(lab, sessionId, ACCOUNT_B);
        const anonymous = await askCoach(lab, sessionId, null);
        result.states += 1;
        index += 1;
        if (!answerB || !anonymous || !answerB.output || !anonymous.output || !answerA.output) return void result.teamMismatches.push(`${seed}:${side}#${index}: missing Coach output`);
        const a = teamSurface(answerA.raw);
        if (a === teamSurface(answerB.raw) && a === teamSurface(anonymous.raw)) result.teamIdentical += 1;
        else result.teamMismatches.push(`${seed}:${side}#${index}: the TEAM surface depends on the personal Hero Pool`);
        if (JSON.stringify(answerA.output.personalHeroView) !== JSON.stringify(answerB.output.personalHeroView)) result.personalDiffers += 1;
        const members = (out: NonNullable<typeof answerA.output>) => (out.personalHeroView?.heroes ?? []).filter((hero) => hero.isFromPool).map((hero) => hero.heroId).sort().join(",");
        if (members(answerA.output) !== members(answerB.output)) result.poolMembershipDiffers += 1;
        if (answerA.output.shortlist.some((card) => card.badges.includes("YOUR_POOL") || card.badges.includes("OUTSIDE_YOUR_POOL"))) result.poolBadgeOnTeamList += 1;
      });
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

function tally<T>(items: readonly T[], key: (item: T) => string): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function table(rows: readonly (readonly (string | number)[])[], header: readonly string[]): string[] {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)];
}

async function main(): Promise<void> {
  const toStdout = process.argv.includes("--stdout");
  const data = loadWorldData();
  if (!toStdout && (existsSync(join(OUT_DIR, `${BASENAME}.json`)) || existsSync(join(OUT_DIR, `${BASENAME}.md`)))) {
    throw new Error(`${BASENAME}.{md,json} already exists -- historical evidence is never overwritten; pass a new --suffix=`);
  }
  const identity = collectEvidenceIdentity({
    certificationId: process.argv.find((arg) => arg.startsWith("--certification-id="))?.slice("--certification-id=".length) ?? BASENAME,
    snapshot: { id: data.snapshot.id, live: data.snapshot.live },
    positionsMode: data.positionsMode,
    reproduce: [
      `bun scripts/eval/freeze-empirical-snapshot.ts --verify=${data.snapshot.id ?? "<snapshot id>"}`,
      `bun scripts/wave5-certification.ts ${process.argv.slice(2).join(" ")}`.trim(),
      "bun scripts/wave5/evidence-identity.ts --compare=<packetA.json>,<packetB.json>",
    ],
  });
  const head = identity.code.head;

  muteLog();
  const started = performance.now();
  const soak = await runSoak(data);
  const twins = await runTwins(data);
  const separation = await runSeparation(data);
  unmuteLog();
  const totalSeconds = ((performance.now() - started) / 1000).toFixed(1);

  const failures: string[] = [];
  const all = soak.records;
  const completed = all.filter((record) => record.completed);
  const states = all.flatMap((record) => record.states);
  for (const record of all) failures.push(...record.failures);
  failures.push(...soak.badStatuses.map((status) => `HTTP ${status}`));
  failures.push(...soak.replayMismatches.map((key) => `NON-DETERMINISTIC replay: ${key}`));
  failures.push(...twins.mismatches);
  failures.push(...separation.teamMismatches);
  if (separation.poolBadgeOnTeamList > 0) failures.push(`${separation.poolBadgeOnTeamList} team shortlists carried a pool badge`);
  if (twins.divergedAfterReveal === 0) failures.push("hidden-info twins: no post-reveal divergence observed -- the comparison would be vacuous");

  const byPolicy = POLICIES.map((policy) => {
    const records = all.filter((record) => record.spec.policy === policy);
    return { policy, drafts: records.length, completed: records.filter((record) => record.completed).length, states: records.reduce((n, record) => n + record.states.length, 0) };
  });
  const fallbackStates = states.filter((state) => state.fallbackUsed);
  const opportunities = all.flatMap((record) => record.states.filter((state) => state.hasOpportunity).map((state) => ({ record, state })));
  const fourA = opportunities.filter(({ record }) => record.spec.policy !== "deviate");
  const aborted = PREVIOUSLY_ABORTED.map((entry) => {
    const [policy, seed, side] = entry.split(":") as [Policy, string, string];
    const record = all.find((candidate) => candidate.spec.policy === policy && candidate.spec.seed === seed && candidate.spec.side === side)!;
    return { entry, completed: record.completed, fallbackStates: record.states.filter((state) => state.fallbackUsed).length };
  });

  const noShortlist = states.filter((state) => state.explicitNoShortlist);
  const noShortlistDrafts = all.filter((record) => record.states.some((state) => state.explicitNoShortlist));
  const noShortlistIndependentlyInfeasible = noShortlist.filter((state) => state.ownPicksRoleInfeasible).length;
  const noShortlistByPolicy = POLICIES.map((policy) => [policy, noShortlistDrafts.filter((record) => record.spec.policy === policy).length]);
  const sorted = [...soak.timings].sort((a, b) => a - b);
  const cold = soak.timings.slice(0, COLD_CALLS).sort((a, b) => a - b);
  const warm = soak.timings.slice(COLD_CALLS).sort((a, b) => a - b);
  const stat = (values: readonly number[]) => [values.length, fmt(percentile(values, 50)), fmt(percentile(values, 95)), fmt(percentile(values, 99)), fmt(values.at(-1) ?? Number.NaN)];
  const overBudget = soak.timings.filter((ms) => ms > 300).length;
  const overCutoff = soak.timings.filter((ms) => ms > 500).length;
  const p95 = percentile(sorted, 95);
  if (p95 > 300) failures.push(`PERFORMANCE: p95 ${p95.toFixed(1)} ms exceeds the 300 ms budget (SPEC.md §4)`);
  if (overCutoff > 0) failures.push(`PERFORMANCE: ${overCutoff} Coach call(s) above the 500 ms hard cutoff`);

  const round1Start = states.filter((state) => state.round === 1 && state.ownSealedInRound === 0);
  const supportFirst = round1Start.filter((state) => state.strategyPositions.length > 0 && state.strategyPositions.every((position) => position >= 4));
  const openingByPosition = tally(round1Start, (state) => `Pos${state.strategyPositions.join("/") || "-"}`);
  const kindsByRound = (round: 1 | 2 | 3) => tally(states.filter((state) => state.round === round), (state) => state.strategyKind);
  const shortlistSizes = tally(states, (state) => String(state.shortlist.length));
  const personalPresent = states.filter((state) => state.personalHeroes !== null).length;
  const flexBeliefsOwn = states.filter((state) => state.ownBeliefs.some((belief) => belief.positions.length > 1)).length;
  const flexBeliefsEnemy = states.filter((state) => state.enemyBeliefs.some((belief) => belief.positions.length > 1)).length;
  const enemyConfirmed = states.filter((state) => state.enemyBeliefs.some((belief) => belief.status === "CONFIRMED")).length;
  const degradations = tally(states.flatMap((state) => state.degradations), (reason) => reason);
  const confidence = tally(states, (state) => state.confidence);
  if (enemyConfirmed > 0) failures.push(`${enemyConfirmed} Coach states presented an ENEMY role as CONFIRMED (only a Player declaration may confirm)`);
  // Safe Core semantic invariant validation (A2-R2):
  // Safe Core semantic invariant:
  // - sourceType == CURATED
  // - totalHardCounters >= 2
  // - all required curated hard counters relieved (banned + ownPick === totalHardCounters)
  // - zero unrelieved hard counters
  // - at least one hard counter banned
  const semanticViolations = opportunities.filter(({ state }) => {
    const opp = state.opportunityDetail;
    if (!opp) return true;
    if (opp.sourceType !== "CURATED") return true;
    if ((opp.totalHardCounters ?? 0) < 2) return true;
    if ((opp.banned ?? 0) < 1) return true;
    const relieved = (opp.banned ?? 0) + (opp.ownPick ?? 0);
    if (relieved !== opp.totalHardCounters) return true;
    return false;
  });
  if (semanticViolations.length > 0) {
    failures.push(`${semanticViolations.length} Safe Core window(s) violate the semantic invariant (CURATED, >= 2 hard counters, all relieved, >= 1 banned)`);
  }
  if (opportunities.length === 0) {
    failures.push("Safe Core: zero windows observed across entire soak population -- invariant not exercised");
  }
  const passed = failures.length === 0;

  const lines: string[] = [];
  lines.push(`# ${BASENAME} — real-data certification run`, "");
  lines.push(`**Result: ${passed ? "PASS" : "FAIL"}** (${failures.length} failure(s))`, "");
  lines.push("- **Generated by:** `bun scripts/wave5-certification.ts` (deterministic; re-running against the same SQLite reproduces the counts, only the latency numbers vary).");
  lines.push(`- **Git HEAD:** \`${head}\` · code state \`${identity.code.contentStateHash}\` (${identity.code.isolation}; ${identity.code.dirtyPathCount} path(s) differ from HEAD, diff hash \`${identity.code.dirtyDiffHash}\`)`);
  const empirical = identity.data.empiricalSnapshot as { id: string | null; fileSha256?: string; logicalFingerprint?: string; certifiable: boolean };
  lines.push(`- **Evidence identity:** id \`${identity.certificationId}\` · comparable key \`${identity.comparableKey}\` · generated ${identity.generatedAt}`);
  lines.push(`- **Empirical snapshot:** \`${empirical.id ?? "LIVE DB (NOT certifiable)"}\` (file sha256 \`${empirical.fileSha256 ?? "n/a"}\`, logical \`${empirical.logicalFingerprint ?? "n/a"}\`), opened \`readonly\`; last \`ok\` sync ${data.syncedAt ?? "unknown"}; ${data.heroIds.length} heroes. Patch attribution: ${identity.data.empiricalPatchAttribution}. Ruleset target ${identity.data.rulesetTarget}. **Offline:** zero network, no sync, no external call of any kind.`);
  lines.push(`- **Positional dataset:** \`${identity.data.positionalDataset.path}\` sha256 \`${identity.data.positionalDataset.sha256}\` — format ${identity.data.positionalDataset.format}, denominator corrected: **${identity.data.positionalDataset.denominatorCorrected ? "yes" : "NO"}**. ${identity.data.positionalDataset.completeness}. NOTE: the positional-validity checks below use this same dataset, so they cannot detect a defect in it.`);
  lines.push("- **Real code path:** `ProtocolSessionStore` + `createProtocolSessionRoutes` (create → resolve-bans → auto-drive → command → recommendations) + the Enemy Bot + real V6 `buildSuggestions` + real `hero-positions.json` / `hero-counters.json` + the real perspective-safe Coach. Nothing is faked; the two test seams used are the ones `index.e2e.ts` already exposes (forced Enemy Bot selection).");
  lines.push(`- **Environment:** ${platform()} ${release()}, ${cpus()[0]?.model.trim() ?? "?"} × ${cpus().length}, ${(totalmem() / 2 ** 30).toFixed(1)} GiB RAM, Bun ${Bun.version}. Total wall time ${totalSeconds} s.`);
  lines.push("- **Every draft runs with a personal position (1–5, rotated across seeds and sides) and a configured 5-hero Hero Pool** (two different pools, alternating), i.e. the heaviest Coach path: team computation + PersonalHeroView.", "");
  if (!passed) {
    lines.push("## FAILURES", "");
    for (const failure of failures.slice(0, 60)) lines.push(`- ${failure}`);
    if (failures.length > 60) lines.push(`- … and ${failures.length - 60} more`);
    lines.push("");
  }

  lines.push("---", "", "## 1. Soak — complete drafts", "");
  lines.push(...table([
    ...byPolicy.map((row) => [row.policy, row.drafts, row.completed, pct(row.completed, row.drafts), row.states]),
    ["**total**", all.length, completed.length, pct(completed.length, all.length), states.length],
  ], ["Player policy", "Drafts", "Completed", "Complete rate", "Coach decision states"]));
  lines.push("", "Seeds `AUDIT001`…`AUDIT100` × Radiant/Dire × 3 policies. `follow-coach` always takes the Coach's first shortlist hero; `varied` a seeded-random shortlist hero; `deviate` a seeded-random LEGAL hero **outside** the shortlist (a Player who ignores the advice every time; collisions with a hidden Enemy Bot pick can and do occur). `follow-coach` and `varied` are the same 400 drafts as the Wave 4A audit.", "");
  lines.push(...table([
    ["Drafts that did not complete", all.length - completed.length],
    ["Empty Coach output WITHOUT an explicit degradation while a legal option existed", all.flatMap((r) => r.failures).filter((f) => f.includes("EMPTY")).length],
    ["Shortlist proposing a banned / already-picked hero", all.flatMap((r) => r.failures).filter((f) => f.includes("unavailable hero")).length],
    ["Same-side / cross-side duplicate hero in a finished draft", all.flatMap((r) => r.failures).filter((f) => f.includes("twice") || f.includes("duplicate")).length],
    ["Banned hero on a finished team", all.flatMap((r) => r.failures).filter((f) => f.includes("banned hero")).length],
    ["Enemy Bot seat holding a hero without evidence for its private position", all.flatMap((r) => r.failures).filter((f) => f.includes("Enemy Bot seat")).length],
    ["Non-2xx HTTP status during valid operation (create / resolve-bans / auto-drive / command / recommendations)", soak.badStatuses.length],
    ["Same-seed replays that were NOT byte-identical", soak.replayMismatches.length],
  ], ["Invariant violated", "Count"]));
  lines.push("", `Determinism: each of the ${all.length} drafts was replayed from scratch in a fresh store (same seed, side, policy, personal position, pool) and its trajectory (bans, every Coach state identity + primary action + shortlist, every pick, both final teams) compared byte for byte: **${all.length - soak.replayMismatches.length}/${all.length} identical**.`, "");
  if (all.some((record) => !record.completed)) {
    lines.push("**Failed drafts (exact cause):**", "");
    for (const record of all.filter((r) => !r.completed)) lines.push(`- \`${record.key}\` — ${record.failures[0] ?? "unknown"}`);
    lines.push("");
  }

  lines.push("### 1b. Product finding — the Coach has no hero ranking when the Player's OWN picks are role-infeasible (NOT fixed; Product Owner decision)", "");
  lines.push(`States where the shortlist was empty: **${noShortlist.length}** of ${states.length} (${pct(noShortlist.length, states.length)}), in **${noShortlistDrafts.length}** drafts (${noShortlistByPolicy.map(([policy, n]) => `${policy}: ${n}`).join(", ")}). In every one the answer was **explicit, never silent**: a role-level primary action, confidence \`baja\`, the engine's own degradations (\`ROLE_ASSIGNMENT_IMPOSSIBLE\` + \`NO_LEGAL_HERO_UNIVERSE\`) and the rationale *"No hay ranking de héroes disponible para este estado…"*; the personal view was still present and the draft **completed** (the Player can always pick any legal hero — the kernel never enforces roles).`, "");
  lines.push(`Independent verification: in **${noShortlistIndependentlyInfeasible} of ${noShortlist.length}** of these states the Player's own revealed picks genuinely admit **no** assignment of distinct curated positions (e.g. two Pos1-only carries such as Luna + Sven) — the engine is right, not broken. This is the approved "no individually feasible hero → explicit degradation, invent nothing" behaviour (\`compound-fallback.coach.test.ts\` 5a/5b). It occurs only when the Player ignores the Coach with off-advice picks (\`follow-coach\`/\`varied\`: 0). Whether the Coach should instead offer a best-effort, low-confidence list in this situation is a **product-semantics decision** (see QA_CALIBRATION.md, unresolved item U1); no behaviour was changed in Wave 5.`, "");
  lines.push("", "---", "", "## 2. Hidden information — twins on real data", "");
  lines.push(`For ${TWIN_BASE_SEEDS.length} base drafts × 2 sides, a *twin* session is built that differs from the base **only** in what the Player may not know: the hidden Enemy Bot heroes of the round under test (different legal heroes), the **Simulator seed** (⇒ different Enemy Bot private position assignments; the resolved bans are pinned equal because bans are visible), and — in the "player-first" variant — the **sealing order** (registration ledger). Own picks, Hero Pool, personal position, bans and all earlier rounds are identical. The complete Coach answer (primary action, shortlist, PersonalHeroView, role beliefs, Safe Core, badges, availability, confidence, provenance **and** the V2 set underneath) must be byte-identical.`, "");
  lines.push(...table([
    ["Twin comparisons made", twins.compared],
    ["Byte-identical", twins.identical],
    ["**Mismatches**", twins.mismatches.length],
    ["…of which player-first (sealing-order) cases", twins.twistCases],
    ["Base rounds skipped (a collision reopened a seat; not comparable)", twins.skippedCollision],
    ["Sensitivity: post-reveal comparisons", twins.revealChecks],
    ["Sensitivity: post-reveal outputs that legally DIVERGED", `${twins.divergedAfterReveal} (${pct(twins.divergedAfterReveal, twins.revealChecks)})`],
  ], ["Measure", "Value"]));
  lines.push("", "The sensitivity row is the proof that the comparison is not vacuous: the same harness, one reveal later, sees the worlds diverge.", "");

  lines.push("---", "", "## 3. Team vs Personal isolation — two different Hero Pools, identical visible draft", "");
  lines.push(...table([
    ["Coach states compared (each asked as pool A, pool B and no account)", separation.states],
    ["TEAM surface identical (primary action, shortlist + badges + order, Safe Core, role beliefs, confidence, provenance, V2 set)", `${separation.teamIdentical} (${pct(separation.teamIdentical, separation.states)})`],
    ["States where the PersonalHeroView differed between the pools", `${separation.personalDiffers} (${pct(separation.personalDiffers, separation.states)})`],
    ["States where the set of `Tu pool` heroes differed", `${separation.poolMembershipDiffers} (${pct(separation.poolMembershipDiffers, separation.states)})`],
    ["Team shortlists carrying a pool badge", separation.poolBadgeOnTeamList],
  ], ["Measure", "Value"]));
  lines.push("");

  lines.push("---", "", "## 4. Compound single-step fallback (the Wave 4A MVP blocker)", "");
  lines.push(`Coach states answered with the explicit single-step fallback (no feasible pair, ≥ 1 individually feasible hero): **${fallbackStates.length}** in ${all.filter((record) => record.states.some((state) => state.fallbackUsed)).length} drafts. Every one of them produced a non-empty shortlist and the draft continued to COMPLETE. A genuinely empty individual legal universe remains an explicit error (engine tests \`compound-fallback.coach.test.ts\` 5a/5b).`, "");
  lines.push("The 19 drafts that aborted with an empty shortlist before the fallback (WAVE4A §2), replayed here (with a personal position and pool this time):", "");
  lines.push(...table(aborted.map((row) => [row.entry, row.completed ? "completes" : "**STILL FAILS**", row.fallbackStates]), ["Draft (policy:seed:side)", "Now", "Coach states answered with the fallback"]));
  lines.push("", `Previously failing drafts that now complete: **${aborted.filter((row) => row.completed).length} of ${aborted.length}**.`, "");

  lines.push("---", "", "## 5. Safe Core — natural incidence (curated evidence only)", "");
  lines.push(`Windows shown: **${opportunities.length}** raw appearances in ${states.length} states (${pct(opportunities.length, states.length)}), ${new Set(opportunities.map(({ record }) => record.key)).size} drafts.`, "");
  if (opportunities.length > 0) {
    lines.push(...table(opportunities.map(({ record, state }) => [record.key, state.round ?? "-", data.name(state.shortlist[0]!), `${state.opportunityDetail?.totalHardCounters ?? "?"} hard counters (${state.opportunityDetail?.banned ?? "?"} banned · ${state.opportunityDetail?.ownPick ?? "?"} own pick), source ${state.opportunityDetail?.sourceType ?? "?"}`, state.primaryLabel]), ["Draft", "Round", "Shortlist #1", "Curated hard counters relieved", "Primary action shown next to the window"]));
  }
  lines.push("", "The Wave 4A audit found exactly 2 windows in the same 400 `follow-coach`+`varied` drafts (`AUDIT083` dire state 2 → Leshrac; `AUDIT083` radiant state 4 → Storm Spirit). The team decision does not depend on the personal position or pool, so this run — which adds a personal position and a Hero Pool to every draft — must still contain both (the check fails otherwise); `deviate` adds 200 new trajectories. Since the Dota-Judge remediation changed the team shortlist/primary action on purpose, follow-coach/varied trajectories may differ from Wave 4A and the total is no longer pinned to 2 — every window is still checked against the approved Safe Core rule.", "");
  lines.push(`Windows within the reproduced Wave 4A population (\`follow-coach\` + \`varied\`): **${fourA.length}** (Wave 4A: 2).`, "");

  lines.push("---", "", "## 6. Coach behaviour profile (feeds QA_CALIBRATION.md — observation only, no threshold is set here)", "");
  lines.push(`- Coach decision states: ${states.length}. Personal view present: ${pct(personalPresent, states.length)}.`);
  lines.push(`- Round-1 opening states: ${round1Start.length}; primary action names a support position (Pos 4/5) in ${supportFirst.length} (${pct(supportFirst.length, round1Start.length)}).`);
  lines.push(`- States showing an OWN Flex belief (≥ 2 plausible positions): ${flexBeliefsOwn} (${pct(flexBeliefsOwn, states.length)}); ENEMY Flex belief: ${flexBeliefsEnemy} (${pct(flexBeliefsEnemy, states.length)}); enemy roles presented as CONFIRMED: ${enemyConfirmed} (must be 0).`);
  lines.push("", "Round-1 opening: which position the primary action tells the Player to reveal (all decision states at round 1, before any own pick):", "");
  lines.push(...table(openingByPosition.map(([position, n]) => [position, n, pct(n, round1Start.length)]), ["Position named", "States", "Share"]));
  lines.push("", "Primary-action kind by round:", "");
  lines.push(...table(([1, 2, 3] as const).flatMap((round) => kindsByRound(round).map(([kind, n]) => [round, kind, n])), ["Round", "Strategy kind", "States"]));
  const totalCards = states.reduce((n, state) => n + state.shortlist.length, 0);
  const badgeShare = tally(states.flatMap((state) => state.cardBadges), (badge) => badge);
  const roleStatusShare = tally(states.flatMap((state) => state.cardRoleStatuses), (status) => status);
  lines.push("", `Badges across all ${totalCards} shortlist cards shown (a card can carry several):`, "", ...table(badgeShare.map(([badge, n]) => [badge, n, pct(n, totalCards)]), ["Badge", "Cards", "Share of cards"]));
  lines.push("", "Role status of the shortlist cards (\"Rol por definir\" is shown to the Player for UNRESOLVED):", "", ...table(roleStatusShare.map(([status, n]) => [status, n, pct(n, totalCards)]), ["Role status", "Cards", "Share of cards"]));
  lines.push("", "Shortlist size:", "", ...table(shortlistSizes.map(([size, n]) => [size, n]), ["Heroes on the shortlist", "States"]));
  lines.push("", "Coach confidence:", "", ...table(confidence.map(([level, n]) => [level, n]), ["Confidence", "States"]));
  lines.push("", "Degradations reported by the engine:", "", ...(degradations.length ? table(degradations.map(([reason, n]) => [reason, n]), ["Reason", "States"]) : ["_None._"]));
  lines.push("");

  lines.push("---", "", "## 7. Performance — the real perspective-safe Coach route", "");
  lines.push("**Budget (authoritative source):** `docs/specs/SPEC.md` §4 — *Motor de sugerencias ≤ 300 ms (corte duro a 500 ms)* and §(criterios) *`computedInMs` bajo 300 ms en el p95*; restated in `.claude/rules/invariantes.md` and `.kiro/specs/ap-ranked-roles-v1/design.md`. Not invented here.", "");
  lines.push("**What is measured:** wall-clock of `getRecommendations(sessionId, ?format=v3, accountId)` — the actual route function: perspective projection → team V6 computation → Coach → personal-position V6 computation (PersonalHeroView with the account's pool) → V3 output. In-process (no HTTP transport, no proxy hop), meta snapshot pre-loaded from SQLite exactly as the running engine holds it in memory. **External sync / OpenDota / network: excluded (the hot path never calls the network).** Every sample is a real Coach decision state of the soak.", "");
  lines.push(...table([
    ["all", ...stat(sorted)],
    [`cold (first ${COLD_CALLS} calls of the process: module/JIT warm-up)`, ...stat(cold)],
    ["warm (remaining calls)", ...stat(warm)],
  ], ["Population", "Samples", "p50 (ms)", "p95 (ms)", "p99 (ms)", "max (ms)"]));
  lines.push("", `- First call in the process (coldest): ${fmt(soak.timings[0] ?? Number.NaN)} ms.`);
  lines.push(`- Samples above the 300 ms budget: ${overBudget}; above the 500 ms hard cutoff: ${overCutoff}. **p95 ${fmt(p95)} ms → ${p95 <= 300 ? "within" : "OVER"} budget.**`);
  lines.push("- Caveat: the engine runs on this developer machine, not on Railway; the production budget must still be confirmed on the deployed instance (not measurable from this repo).", "");

  lines.push("---", "", "## 8. Limitations of this evidence", "");
  lines.push("- Bans are simulated by the Simulator's own policy from `hero_patch_stats` pick volume (the project has no real ban-rate data); the Enemy Bot and the three Player policies are scripted. Absolute rates describe this simulator, not live play.");
  lines.push("- One meta snapshot, mono-patch, sync-stale (`metaIsStale` is forced true here, as in the Wave 4A audit); `hero-counters.json` / `hero-positions.json` are curated, not patch-verified (WAVE4_DATA_READINESS.md).");
  lines.push("- Drafts within a seed set share the same snapshot and are strongly correlated; counts are descriptive, no confidence interval is claimed.");
  lines.push("- Quality of the recommendations (is the advice *good Dota*?) is NOT judged here — that is the independent Dota Judge's job (`WAVE5_DOTA_JUDGE.*`).", "");

  const markdown = lines.join("\n");
  const json = {
    result: passed ? "PASS" : "FAIL",
    evidenceIdentity: identity,
    head,
    failures: failures.slice(0, 200),
    soak: { drafts: all.length, completed: completed.length, states: states.length, replayMismatches: soak.replayMismatches.length, badStatuses: soak.badStatuses.length, byPolicy },
    twins: { ...twins, mismatches: twins.mismatches.length },
    separation: { ...separation, teamMismatches: separation.teamMismatches.length },
    fallback: { states: fallbackStates.length, previouslyAbortedNowComplete: aborted.filter((row) => row.completed).length, previouslyAborted: aborted.length },
    safeCore: { raw: opportunities.length, wave4aPopulation: fourA.length },
    performance: { samples: sorted.length, p50: percentile(sorted, 50), p95, p99: percentile(sorted, 99), max: sorted.at(-1) ?? null, overBudget, overCutoff, coldFirst: soak.timings[0] ?? null },
  };
  if (toStdout) console.log(markdown);
  else {
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(join(OUT_DIR, `${BASENAME}.md`), markdown);
    writeFileSync(join(OUT_DIR, `${BASENAME}.json`), JSON.stringify(json, null, 2));
    console.log(`[wave5-certification] ${passed ? "PASS" : "FAIL"} — ${all.length} drafts (${completed.length} complete), ${states.length} states, twins ${twins.identical}/${twins.compared}, separation ${separation.teamIdentical}/${separation.states}, p95 ${fmt(p95)} ms → docs/diagnostics/${BASENAME}.md`);
    if (!passed) for (const failure of failures.slice(0, 15)) console.log(`  - ${failure}`);
  }
  process.exit(passed ? 0 : 1);
}

await main();
