#!/usr/bin/env bun
// WAVE 4A -- Safe Core INCIDENCE AUDIT + SOAK. Measurement-only: it changes no production logic and asserts no
// acceptance percentage. It drives complete Simulator drafts through the SAME code the product
// runs (ProtocolSessionStore + createProtocolSessionRoutes + Enemy Bot + real `buildSuggestions` over the real
// meta snapshot + the real Coach with the real hero-counters.json) and records what the Coach says at every
// state where the Player has a seat to fill.
//
//   bun scripts/wave4a-safe-core-incidence.ts            -> writes docs/diagnostics/WAVE4A_SAFE_CORE_INCIDENCE.md
//   bun scripts/wave4a-safe-core-incidence.ts --stdout   -> prints the markdown instead of writing it
//
// Offline by construction: dota2coach.sqlite is opened `readonly: true` (via scripts/eval/run.ts `loadMeta`),
// zero network. Deterministic: same DB + same seeds => byte-identical output (run twice and diff to verify).
// Safe Core is informational (it never reorders the shortlist), so the shipped rule (coverage floor =
// MIN_CURATED_HARD_COUNTER_COVERAGE, read from the Coach's own output) and the pre-calibration rule (floor 1,
// reproduced by the audit-only `legacyFloorOneWindow` below -- the production detector has no threshold parameter)
// are replayed over the SAME states: the BEFORE/AFTER tables compare like with like. The run doubles as the 400-draft soak for the empty-shortlist blocker.
// This file is NOT a test (tests never read the real curated files / SQLite -- invariantes.md) and is never
// imported from apps/.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractHeroCandidates } from "../apps/engine/src/coach";
import type { RecommendationOutputV3 } from "../apps/engine/src/coach";
import { MIN_CURATED_HARD_COUNTER_COVERAGE } from "../apps/engine/src/coach/safe-core";
import { createCoachRecommendations } from "../apps/engine/src/server/routes/coach-recommendations";
import { createProtocolSessionRoutes } from "../apps/engine/src/server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../apps/engine/src/server/protocol-session";
import { buildSuggestions } from "../apps/engine/src/signals/mix";
import { loadHeroCounters, type CuratedCounter } from "../apps/engine/src/signals/hero-counters";
import { loadHeroPositions } from "../apps/engine/src/signals/hero-positions";
import type { HeroId, PerspectiveDraftView, TeamSide } from "../apps/engine/src/draft-protocol/types";
import type { SignalContribution } from "../apps/engine/src/signals/types";
import { loadMeta } from "./eval/run";

const ENGINE_DB = join(import.meta.dir, "../apps/engine/data/dota2coach.sqlite");
const OUT_PATH = join(import.meta.dir, "../docs/diagnostics/WAVE4A_SAFE_CORE_INCIDENCE.md");
const DRAFTS_PER_POLICY = 200; // 100 seeds x both sides
const SEEDS = Array.from({ length: DRAFTS_PER_POLICY / 2 }, (_, i) => `AUDIT${String(i + 1).padStart(3, "0")}`);
const SIDES: readonly TeamSide[] = ["radiant", "dire"];

/** The 19 drafts that aborted with an empty shortlist in the first incidence run (before the compound fallback). */
const PREVIOUSLY_ABORTED: readonly string[] = [
  "follow-coach:AUDIT033:dire", "follow-coach:AUDIT044:radiant", "follow-coach:AUDIT053:radiant", "follow-coach:AUDIT057:dire",
  "follow-coach:AUDIT059:radiant", "follow-coach:AUDIT078:radiant", "follow-coach:AUDIT079:dire", "follow-coach:AUDIT079:radiant",
  "varied:AUDIT015:radiant", "varied:AUDIT035:dire", "varied:AUDIT037:dire", "varied:AUDIT037:radiant", "varied:AUDIT039:radiant",
  "varied:AUDIT042:dire", "varied:AUDIT045:dire", "varied:AUDIT046:radiant", "varied:AUDIT078:radiant", "varied:AUDIT084:dire",
  "varied:AUDIT090:radiant",
];

type Policy = "follow-coach" | "varied";
const POLICIES: readonly Policy[] = ["follow-coach", "varied"];

// ---------------------------------------------------------------------------------------------
// Record shape
// ---------------------------------------------------------------------------------------------

interface StateRecord {
  policy: Policy;
  seed: string;
  side: TeamSide;
  draftKey: string;
  /** 0-based index among the Coach decision states of this draft. */
  stateIndex: number;
  round: 1 | 2 | 3 | null;
  ownPicksRemaining: number;
  bannedCount: number;
  topHero: HeroId | null;
  topPosition: number | null;
  topRoleStatus: string | null;
  topHardCounters: number;
  /** Funnel flags (informational, recomputed from the data; cross-checked against the Coach's own block). */
  topIsResolvedCore: boolean;
  topHasHardCounters: boolean;
  topHardBanned: number;
  topHardOwn: number;
  topHardAvailable: number;
  topCuratedCounterRevealed: boolean;
  fires: boolean;
  /** The PRE-calibration rule (coverage floor 1) replayed on the same state: null when it would not fire. */
  legacy: null | { heroId: HeroId; hardCounterCount: number };
  /** The Coach answered with the single-step compound fallback (no feasible pair). */
  fallbackUsed: boolean;
  opportunity: null | {
    heroId: HeroId;
    evidence: string;
    hardCounterCount: number;
    banned: number;
    ownPick: number;
    composition: "ALL_BANNED" | "BANNED_PLUS_OWN_PICK";
    counterIds: HeroId[];
    bansSnapshot: HeroId[];
    ownPicks: HeroId[];
    revealedEnemy: HeroId[];
    primaryActionLabel: string;
    shortlist: HeroId[];
  };
  chosen: HeroId;
}

// ---------------------------------------------------------------------------------------------
// Draft driver (production route code, real V6, real Coach)
// ---------------------------------------------------------------------------------------------

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/audit", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

function visibleHeroes(slots: PerspectiveDraftView["ownPicks"], allowed: readonly string[]): HeroId[] {
  const ids: HeroId[] = [];
  for (const slot of slots) if (slot.visibility !== "HIDDEN" && allowed.includes(slot.visibility)) ids.push(slot.heroId);
  return ids;
}

// ---------------------------------------------------------------------------------------------
// AUDIT-ONLY: the pre-calibration Safe Core rule (coverage floor 1), for the BEFORE column.
// The production detector (`coach/safe-core.ts`) enforces MIN_CURATED_HARD_COUNTER_COVERAGE with no override, so this
// script keeps its own private copy of the historical rule. It is never exported and never imported from apps/.
// Every other condition is identical to production; the only difference is `hard.length >= 1` instead of `>= 2`.
// ---------------------------------------------------------------------------------------------

function legacyFloorOneWindow(
  heroId: HeroId,
  view: PerspectiveDraftView,
  signals: readonly SignalContribution[],
  heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]>,
  role: { position: number; roleStatus: string },
): boolean {
  if (role.roleStatus === "UNRESOLVED" || ![1, 2, 3].includes(role.position)) return false;
  const curated = heroCounters.get(heroId) ?? [];
  const hard = distinctHard(curated);
  if (hard.length === 0) return false;
  const positionFit = signals.find((signal) => signal.signal === "position_fit");
  if (!positionFit || positionFit.raw === null || positionFit.applicable === false) return false;

  const banned = new Set<HeroId>(view.bannedHeroes);
  const own = new Set<HeroId>(visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"]));
  const enemy = new Set<HeroId>(visibleHeroes(view.enemyPicks, ["REVEALED"]));
  if (curated.some((entry) => enemy.has(entry.vs))) return false;

  const bannedCount = hard.filter((entry) => banned.has(entry.vs)).length;
  const relieved = hard.filter((entry) => banned.has(entry.vs) || own.has(entry.vs)).length;
  return relieved === hard.length && bannedCount > 0;
}

function distinctHard(curated: readonly CuratedCounter[]): CuratedCounter[] {
  const seen = new Set<HeroId>();
  return curated.filter((entry) => {
    if (entry.level !== "hard" || seen.has(entry.vs)) return false;
    seen.add(entry.vs);
    return true;
  });
}

/** Deterministic tiny PRNG for the "varied" policy (never touches the engine's RNGs). */
function seededIndex(key: string, modulo: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % modulo;
}

async function main(): Promise<void> {
  const { meta, syncedAt } = loadMeta(ENGINE_DB);
  const heroPositions = loadHeroPositions();
  const heroCounters = loadHeroCounters();
  const heroName = (id: HeroId): string => meta.heroes[id]?.localizedName ?? `#${id}`;

  const computeSuggestions = async (state: Parameters<typeof buildSuggestions>[0], _accountId: number | null, options?: Parameters<typeof buildSuggestions>[2]) =>
    buildSuggestions(state, meta, { metaIsStale: true, heroPositions, ...options });

  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: (state, accountId, options) => computeSuggestions(state, accountId, options),
    heroUniverse: async () => {
      const allHeroIds = Object.keys(meta.heroes).map(Number);
      const totalPicks = (heroId: number): number => (meta.patchStats?.[heroId] ?? []).reduce((sum, stat) => sum + stat.picks, 0);
      const metaOrder = [...allHeroIds].sort((a, b) => totalPicks(b) - totalPicks(a) || a - b);
      return { allHeroIds, metaOrder };
    },
    heroPositions,
    heroCounters,
  });
  const coachRoutes = createCoachRecommendations({ source: store, computeSuggestions: (state, accountId, options) => computeSuggestions(state, accountId, options), heroPositions, heroCounters });

  const records: StateRecord[] = [];
  const failures: string[] = [];

  async function runDraft(policy: Policy, seed: string, side: TeamSide): Promise<void> {
    const draftKey = `${policy}:${seed}:${side}`;
    const created = await routes.post(
      jsonRequest({
        rulesetId: "dota2/ranked-all-pick",
        patch: "7.41e",
        localSide: side,
        adapterKind: "simulator",
        humanPosition: 2,
        simulatorSeed: seed,
        partyContext: { partySize: 5, side, controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side, slotIndex, controllerId: "player" })) },
      }),
    );
    if (created.status !== 201) {
      failures.push(`${draftKey}: create ${created.status}`);
      return;
    }
    const { sessionId } = (await created.json()) as { sessionId: string };
    const resolved = await routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);
    if (resolved.status !== 200) {
      failures.push(`${draftKey}: resolve-bans ${resolved.status}`);
      return;
    }

    let stateIndex = 0;
    for (let guard = 0; guard < 40; guard += 1) {
      const drive = await routes.postAutoDrive(sessionId);
      const body = (await drive.json()) as { stopReason?: string; error?: string };
      if (drive.status !== 200) {
        failures.push(`${draftKey}: auto-drive ${drive.status} ${body.error ?? ""}`);
        return;
      }
      if (body.stopReason === "complete") return;
      if (body.stopReason !== "human_input") continue; // round_revealed -> drive the next round

      const recomputation = await coachRoutes.recommend(sessionId, null);
      const output: RecommendationOutputV3 | null = recomputation?.output ?? null;
      if (!recomputation || !output) {
        failures.push(`${draftKey}: no coach output at human_input`);
        return;
      }
      const context = store.perspectiveRecommendationContext(sessionId)!;
      const view = context.view;
      const candidates = extractHeroCandidates(recomputation.recommendationSet, heroPositions);
      const top = candidates[0] ?? null;

      // Funnel, recomputed from the data (informational). The Coach's own block is the source of truth for `fires`.
      const curated: readonly CuratedCounter[] = top ? (heroCounters.get(top.heroId) ?? []) : [];
      const hard = distinctHard(curated);
      const banned = new Set<HeroId>(view.bannedHeroes);
      const own = new Set<HeroId>(visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"]));
      const revealedEnemy = visibleHeroes(view.enemyPicks, ["REVEALED"]);
      const enemy = new Set<HeroId>(revealedEnemy);
      const topIsResolvedCore = top !== null && top.roleStatus !== "UNRESOLVED" && [1, 2, 3].includes(top.position);
      const hardBanned = hard.filter((entry) => banned.has(entry.vs)).length;
      const hardOwn = hard.filter((entry) => !banned.has(entry.vs) && own.has(entry.vs)).length;

      const legacyFires = top !== null && legacyFloorOneWindow(top.heroId, view, top.signals, heroCounters, { position: top.position, roleStatus: top.roleStatus });
      const legacy = top && legacyFires ? { heroId: top.heroId, hardCounterCount: distinctHard(curated).length } : null;
      const fallbackUsed = recomputation.recommendationSet.degradations.some((d) => d.reason === "COMPOUND_FALLBACK_SINGLE_STEP");

      const opp = output.opportunity ?? null;
      // Cross-check that the private legacy copy has not drifted from production: with coverage >= the shipped floor
      // the two rules are the same rule, so they must agree on every state.
      if (top && hard.length >= MIN_CURATED_HARD_COUNTER_COVERAGE && (opp !== null) !== legacyFires) failures.push(`${draftKey}#${stateIndex}: INVARIANT VIOLATED audit-only legacy rule drifted from production at coverage >= floor`);
      let opportunity: StateRecord["opportunity"] = null;
      if (opp) {
        if (!top || top.heroId !== opp.heroId) failures.push(`${draftKey}#${stateIndex}: opportunity hero != V6 top`);
        // Structural invariants of the coverage floor (a violation is reported, never hidden).
        if (opp.counterEvidence.totalHardCounters < MIN_CURATED_HARD_COUNTER_COVERAGE) failures.push(`${draftKey}#${stateIndex}: INVARIANT VIOLATED one-hard-counter hero emitted Safe Core`);
        if (!legacy) failures.push(`${draftKey}#${stateIndex}: INVARIANT VIOLATED shipped rule fired but the pre-calibration rule did not`);
        const relieved = opp.counterEvidence.relieved;
        const bannedN = relieved.filter((r) => r.status === "BANNED").length;
        const ownN = relieved.filter((r) => r.status === "OWN_PICK").length;
        opportunity = {
          heroId: opp.heroId,
          evidence: opp.evidence,
          hardCounterCount: opp.counterEvidence.totalHardCounters,
          banned: bannedN,
          ownPick: ownN,
          composition: ownN === 0 ? "ALL_BANNED" : "BANNED_PLUS_OWN_PICK",
          counterIds: relieved.map((r) => r.heroId),
          bansSnapshot: [...view.bannedHeroes],
          ownPicks: visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"]),
          revealedEnemy,
          primaryActionLabel: output.primaryAction.label,
          shortlist: output.shortlist.map((card) => card.heroId),
        };
      }

      // Player policy.
      const shortlist = output.shortlist.map((card) => card.heroId);
      let chosen: HeroId | undefined;
      if (policy === "follow-coach") chosen = shortlist[0];
      else chosen = shortlist[seededIndex(`${draftKey}:${stateIndex}`, Math.max(shortlist.length, 1))];
      if (chosen === undefined) {
        // Observed product edge, NOT patched here: an odd own-pick pair can leave no legal role assignment, so the
        // Coach returns a role-level action with an empty shortlist. The draft is aborted and reported.
        const reasons = recomputation.recommendationSet.degradations.map((d) => d.reason).join("+");
        const ownDescribed = visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"])
          .map((id) => `${heroName(id)} [Pos ${(heroPositions[id] ?? []).map((entry) => entry.position).join("/") || "?"}]`)
          .join(", ");
        failures.push(`${draftKey}#${stateIndex}: empty shortlist (${reasons}); own picks: ${ownDescribed}`);
        return;
      }

      records.push({
        policy,
        seed,
        side,
        draftKey,
        stateIndex,
        round: output.meta.round,
        ownPicksRemaining: output.meta.ownPicksRemaining,
        bannedCount: view.bannedHeroes.length,
        topHero: top?.heroId ?? null,
        topPosition: top?.position ?? null,
        topRoleStatus: top?.roleStatus ?? null,
        topHardCounters: hard.length,
        topIsResolvedCore,
        topHasHardCounters: hard.length > 0,
        topHardBanned: hardBanned,
        topHardOwn: hardOwn,
        topHardAvailable: hard.length - hardBanned - hardOwn,
        topCuratedCounterRevealed: curated.some((entry) => enemy.has(entry.vs)),
        fires: opportunity !== null,
        legacy,
        fallbackUsed,
        opportunity,
        chosen,
      });
      stateIndex += 1;

      const openOwn = context.openOwnSlots[0];
      if (!openOwn) {
        failures.push(`${draftKey}#${stateIndex}: no open own slot`);
        return;
      }
      const applied = store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: openOwn.slotIndex, heroId: chosen });
      if (!applied || applied.rejected) {
        failures.push(`${draftKey}#${stateIndex}: own pick rejected ${applied?.rejected}`);
        return;
      }
    }
    failures.push(`${draftKey}: guard exhausted`);
  }

  const startedAt = Date.now();
  for (const policy of POLICIES) {
    for (const seed of SEEDS) {
      for (const side of SIDES) await runDraft(policy, seed, side);
    }
  }
  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);

  const markdown = renderReport({ records, failures, meta, heroCounters, syncedAt, heroName, elapsedSec });
  if (process.argv.includes("--stdout")) console.log(markdown);
  else {
    writeFileSync(OUT_PATH, markdown, "utf8");
    console.error(`wrote ${OUT_PATH} (${records.length} states, ${failures.length} failures, ${elapsedSec}s)`);
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify(records));
}

// ---------------------------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------------------------

interface ReportInput {
  records: StateRecord[];
  failures: string[];
  meta: ReturnType<typeof loadMeta>["meta"];
  heroCounters: Map<HeroId, CuratedCounter[]>;
  syncedAt: string | null;
  heroName: (id: HeroId) => string;
  elapsedSec: string;
}

const pct = (n: number, d: number): string => (d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`);
const count = <T,>(items: T[], key: (item: T) => string | number): Map<string, number> => {
  const out = new Map<string, number>();
  for (const item of items) out.set(String(key(item)), (out.get(String(key(item))) ?? 0) + 1);
  return out;
};
const table = (headers: string[], rows: (string | number)[][]): string =>
  [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)].join("\n");

interface Window {
  draftKey: string;
  heroId: HeroId;
  firstIndex: number;
  length: number;
  round: number | null;
}

type Rule = "before" | "after";
/** The hero a state's Safe Core block names under the pre-calibration (before) or shipped (after) rule. */
const heroOf = (r: StateRecord, rule: Rule): HeroId | null => (rule === "after" ? (r.opportunity?.heroId ?? null) : (r.legacy?.heroId ?? null));
const hardOf = (r: StateRecord, rule: Rule): number => (rule === "after" ? (r.opportunity?.hardCounterCount ?? 0) : (r.legacy?.hardCounterCount ?? 0));

function windowsOf(records: StateRecord[], rule: Rule = "after"): Window[] {
  const windows: Window[] = [];
  const byDraft = new Map<string, StateRecord[]>();
  for (const r of records) byDraft.set(r.draftKey, [...(byDraft.get(r.draftKey) ?? []), r]);
  for (const [draftKey, states] of byDraft) {
    states.sort((a, b) => a.stateIndex - b.stateIndex);
    let open: Window | null = null;
    for (const state of states) {
      const hero = heroOf(state, rule);
      if (hero !== null && open && open.heroId === hero) {
        open.length += 1;
        continue;
      }
      open = null;
      if (hero !== null) {
        open = { draftKey, heroId: hero, firstIndex: state.stateIndex, length: 1, round: state.round };
        windows.push(open);
      }
    }
  }
  return windows;
}

function abortedFor(policy: Policy, input: ReportInput): number {
  return input.failures.filter((failure) => failure.startsWith(`${policy}:`)).length;
}

function sectionForPolicy(policy: Policy, all: StateRecord[], input: ReportInput): string {
  const records = all.filter((r) => r.policy === policy);
  const fires = records.filter((r) => r.fires);
  const windows = windowsOf(records);
  const distinctPairs = new Set(fires.map((r) => `${r.draftKey}|${r.opportunity!.heroId}`));
  const draftsWithFire = new Set(fires.map((r) => r.draftKey));
  const { heroName } = input;

  const lines: string[] = [];
  lines.push(`#### Headline counts — policy \`${policy}\``);
  lines.push("");
  lines.push(
    table(
      ["Measure", "Value"],
      [
        ["Drafts started / aborted early", `${DRAFTS_PER_POLICY} / ${abortedFor(policy, input)}`],
        ["Coach decision states evaluated", records.length],
        ["**Raw Safe Core appearances** (states with an `opportunity` block)", `${fires.length} (${pct(fires.length, records.length)} of states)`],
        ["**Distinct opportunity windows** (maximal runs of consecutive states, same hero)", `${windows.length} (${pct(windows.length, records.length)} of states)`],
        ["Distinct (draft, hero) pairs", `${distinctPairs.size}`],
        ["Repeated appearances beyond the first per (draft, hero)", `${fires.length - distinctPairs.size}`],
        ["**Drafts with ≥ 1 Safe Core**", `${draftsWithFire.size} of ${DRAFTS_PER_POLICY} started (${pct(draftsWithFire.size, DRAFTS_PER_POLICY)})`],
      ],
    ),
  );

  // Funnel: why does it (not) fire? Counts are states; each row is a subset of the previous row.
  const f1 = records.filter((r) => r.topHero !== null);
  const f2 = f1.filter((r) => r.topIsResolvedCore);
  const f3 = f2.filter((r) => r.topHasHardCounters);
  const f3b = f3.filter((r) => r.topHardCounters >= MIN_CURATED_HARD_COUNTER_COVERAGE);
  const f4 = f3b.filter((r) => !r.topCuratedCounterRevealed);
  const f5 = f4.filter((r) => r.topHardAvailable === 0);
  const f6 = f5.filter((r) => r.topHardBanned > 0);
  lines.push("");
  lines.push(`#### Funnel — why states do / do not fire (policy \`${policy}\`; informational recomputation, cross-checked against the Coach's own block)`);
  lines.push("");
  lines.push(
    table(
      ["Stage (each is a subset of the previous)", "States", "% of all states"],
      [
        ["All Coach decision states", records.length, "100.0%"],
        ["V6 top candidate exists", f1.length, pct(f1.length, records.length)],
        ["… and it is a resolved core (Pos 1-3, role status ≠ UNRESOLVED)", f2.length, pct(f2.length, records.length)],
        ["… and it has ≥ 1 curated HARD counter in hero-counters.json", f3.length, pct(f3.length, records.length)],
        [`… and it has ≥ ${MIN_CURATED_HARD_COUNTER_COVERAGE} curated HARD counters (evidence-coverage floor)`, f3b.length, pct(f3b.length, records.length)],
        ["… and no curated counter of it is already revealed on the enemy team", f4.length, pct(f4.length, records.length)],
        ["… and zero curated hard counters still available", f5.length, pct(f5.length, records.length)],
        ["… and ≥ 1 of them actually BANNED (fires)", f6.length, pct(f6.length, records.length)],
      ],
    ),
  );
  const crossCheck = f6.length === fires.length ? "matches" : `DIFFERS (${f6.length} vs ${fires.length}; the Coach block is the source of truth — position-data precondition not modelled in the funnel)`;
  lines.push("");
  lines.push(`Funnel final stage vs Coach's own \`opportunity\` count: ${crossCheck}.`);

  // Fire rate conditioned on how many curated hard counters V6's top has (answers "is it dominated by 1-counter heroes?").
  lines.push("");
  lines.push(`#### Fire rate by number of curated hard counters of V6's top (policy \`${policy}\`; states where the top is a resolved core with ≥ 1 hard counter)`);
  lines.push("");
  const conditioned = records.filter((r) => r.topIsResolvedCore && r.topHasHardCounters);
  const hardBuckets: [string, (n: number) => boolean][] = [["exactly 1", (n) => n === 1], ["2 or more", (n) => n >= 2]];
  lines.push(
    table(
      ["Hard counters of the top hero", "States", "Fires", "Fire rate"],
      hardBuckets.map(([label, test]) => {
        const inBucket = conditioned.filter((r) => test(r.topHardCounters));
        return [label, inBucket.length, inBucket.filter((r) => r.fires).length, pct(inBucket.filter((r) => r.fires).length, inBucket.length)];
      }),
    ),
  );

  // by round
  lines.push("");
  lines.push(`#### By round (policy \`${policy}\`)`);
  lines.push("");
  const rounds = [1, 2, 3] as const;
  lines.push(
    table(
      ["Round", "States", "Raw appearances", "Rate", "Distinct windows starting here"],
      rounds.map((round) => {
        const inRound = records.filter((r) => r.round === round);
        return [round, inRound.length, inRound.filter((r) => r.fires).length, pct(inRound.filter((r) => r.fires).length, inRound.length), windows.filter((w) => w.round === round).length];
      }),
    ),
  );

  // by position
  lines.push("");
  lines.push(`#### By core position of the triggered hero (policy \`${policy}\`)`);
  lines.push("");
  const positions = [1, 2, 3] as const;
  lines.push(
    table(
      ["Position", "Raw appearances", "Share of appearances", "States where V6 top was a resolved core at this position", "Fire rate within those"],
      positions.map((position) => {
        const atPos = fires.filter((r) => r.topPosition === position).length;
        const topAtPos = records.filter((r) => r.topIsResolvedCore && r.topPosition === position).length;
        return [`Pos ${position}`, atPos, pct(atPos, fires.length), topAtPos, pct(atPos, topAtPos)];
      }),
    ),
  );

  // by hero
  lines.push("");
  lines.push(`#### Triggered heroes (policy \`${policy}\`)`);
  lines.push("");
  const byHero = new Map<HeroId, { raw: number; drafts: Set<string>; hard: number }>();
  for (const r of fires) {
    const entry = byHero.get(r.opportunity!.heroId) ?? { raw: 0, drafts: new Set<string>(), hard: r.opportunity!.hardCounterCount };
    entry.raw += 1;
    entry.drafts.add(r.draftKey);
    byHero.set(r.opportunity!.heroId, entry);
  }
  const heroRows = [...byHero.entries()].sort((a, b) => b[1].raw - a[1].raw || a[0] - b[0]);
  lines.push(
    heroRows.length === 0
      ? "_No triggers._"
      : table(["Hero", "Curated hard counters", "Raw appearances", "Distinct drafts"], heroRows.map(([id, e]) => [heroName(id), e.hard, e.raw, e.drafts.size])),
  );

  const topThree = heroRows.slice(0, 3).reduce((sum, [, e]) => sum + e.raw, 0);
  if (heroRows.length > 0) {
    lines.push("");
    lines.push(`Distinct triggered heroes: ${heroRows.length}. Top 3 heroes account for ${topThree} of ${fires.length} raw appearances (${pct(topThree, fires.length)}).`);
  }

  // hard-counter coverage
  lines.push("");
  lines.push(`#### Hard-counter coverage of triggered heroes (policy \`${policy}\`)`);
  lines.push("");
  const byHard = count(fires, (r) => r.opportunity!.hardCounterCount);
  const one = fires.filter((r) => r.opportunity!.hardCounterCount === 1).length;
  const multi = fires.length - one;
  const windowsOne = windows.filter((w) => fires.some((r) => r.draftKey === w.draftKey && r.opportunity!.heroId === w.heroId && r.opportunity!.hardCounterCount === 1)).length;
  lines.push(
    table(
      ["Hard counters of the triggered hero", "Raw appearances"],
      [...byHard.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => [k, v]),
    ),
  );
  lines.push("");
  lines.push(
    table(
      ["Trigger type", "Raw appearances", "Distinct windows"],
      [
        ["Exactly 1 curated hard counter", `${one} (${pct(one, fires.length)})`, windowsOne],
        ["2+ curated hard counters", `${multi} (${pct(multi, fires.length)})`, windows.length - windowsOne],
      ],
    ),
  );

  // relief composition
  lines.push("");
  lines.push(`#### Relief composition (policy \`${policy}\`)`);
  lines.push("");
  const allBanned = fires.filter((r) => r.opportunity!.composition === "ALL_BANNED").length;
  lines.push(
    table(
      ["Composition", "Raw appearances"],
      [
        ["All relieved counters BANNED", `${allBanned} (${pct(allBanned, fires.length)})`],
        ["BANNED + OWN_PICK", `${fires.length - allBanned} (${pct(fires.length - allBanned, fires.length)})`],
      ],
    ),
  );

  // persistence
  lines.push("");
  lines.push(`#### Persistence across consecutive decisions (policy \`${policy}\`)`);
  lines.push("");
  const lengthDist = count(windows, (w) => w.length);
  const persisting = windows.filter((w) => w.length > 1);
  lines.push(
    windows.length === 0
      ? "_No windows._"
      : table(
          ["Window length (consecutive states)", "Windows"],
          [...lengthDist.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => [k, v]),
        ),
  );
  lines.push("");
  lines.push(
    `Windows lasting ≥ 2 consecutive states: ${persisting.length} of ${windows.length} (${pct(persisting.length, windows.length)}). ` +
      `Same-hero re-appearances that were NOT consecutive (the window closed and the hero came back): ${fires.length - distinctPairs.size - persisting.reduce((sum, w) => sum + (w.length - 1), 0)}.`,
  );
  return lines.join("\n");
}

function beforeAfterSection(records: StateRecord[], input: ReportInput): string {
  const { heroName } = input;
  const groups: [string, StateRecord[], number][] = [
    ["follow-coach", records.filter((r) => r.policy === "follow-coach"), DRAFTS_PER_POLICY],
    ["varied", records.filter((r) => r.policy === "varied"), DRAFTS_PER_POLICY],
    ["pooled", records, POLICIES.length * DRAFTS_PER_POLICY],
  ];
  const headers = ["Measure", ...groups.flatMap(([name]) => [`${name} BEFORE (floor 1)`, `${name} AFTER (floor ${MIN_CURATED_HARD_COUNTER_COVERAGE})`])];
  const fired = (rs: StateRecord[], rule: Rule): StateRecord[] => rs.filter((r) => heroOf(r, rule) !== null);
  const row = (label: string, measure: (rs: StateRecord[], rule: Rule, drafts: number) => string | number): (string | number)[] => [
    label,
    ...groups.flatMap(([, rs, drafts]) => [measure(rs, "before", drafts), measure(rs, "after", drafts)]),
  ];
  const rows: (string | number)[][] = [
    row("Coach decision states evaluated", (rs) => rs.length),
    row("**Raw appearances**", (rs, rule) => `${fired(rs, rule).length} (${pct(fired(rs, rule).length, rs.length)})`),
    row("**Distinct windows**", (rs, rule) => windowsOf(rs, rule).length),
    row("**Drafts with ≥ 1 Safe Core**", (rs, rule, drafts) => {
      const n = new Set(fired(rs, rule).map((r) => r.draftKey)).size;
      return `${n} of ${drafts} (${pct(n, drafts)})`;
    }),
    ...([1, 2, 3] as const).map((round) => row(`Round ${round} — raw appearances`, (rs, rule) => fired(rs, rule).filter((r) => r.round === round).length)),
    ...([1, 2, 3] as const).map((position) => row(`Pos ${position} — raw appearances`, (rs, rule) => fired(rs, rule).filter((r) => r.topPosition === position).length)),
    row("**One-hard-counter triggers** (raw)", (rs, rule) => fired(rs, rule).filter((r) => hardOf(r, rule) === 1).length),
    row("**2+-hard-counter triggers** (raw)", (rs, rule) => fired(rs, rule).filter((r) => hardOf(r, rule) >= 2).length),
    row("Distinct triggered heroes", (rs, rule) => new Set(fired(rs, rule).map((r) => heroOf(r, rule))).size),
  ];
  const oneAfter = fired(records, "after").filter((r) => hardOf(r, "after") === 1).length;

  const heroIds = new Set<HeroId>(fired(records, "before").map((r) => heroOf(r, "before")!));
  const heroRows = [...heroIds]
    .map((id) => {
      const before = fired(records, "before").filter((r) => heroOf(r, "before") === id);
      const after = fired(records, "after").filter((r) => heroOf(r, "after") === id);
      return { id, hard: before[0]!.legacy!.hardCounterCount, before: before.length, after: after.length };
    })
    .sort((a, b) => b.before - a.before || a.id - b.id);

  const lines: string[] = [];
  lines.push(table(headers, rows));
  lines.push("");
  lines.push(
    `**Structural invariant** — one-hard-counter heroes must produce ZERO Safe Core opportunities under the shipped rule: **${oneAfter === 0 ? "HOLDS" : "VIOLATED"}** ` +
      `(${oneAfter} one-counter triggers AFTER, out of ${fired(records, "before").filter((r) => hardOf(r, "before") === 1).length} BEFORE).`,
  );
  lines.push("");
  lines.push("#### Hero distribution, pooled (both policies) — BEFORE vs AFTER");
  lines.push("");
  lines.push(
    heroRows.length === 0
      ? "_No triggers BEFORE._"
      : table(["Hero", "Curated hard counters", "Raw BEFORE", "Raw AFTER"], heroRows.map((h) => [heroName(h.id), h.hard, h.before, h.after])),
  );
  return lines.join("\n");
}

function soakSection(records: StateRecord[], input: ReportInput): string {
  const { failures } = input;
  const drafts = POLICIES.length * DRAFTS_PER_POLICY;
  const causeOf = (failure: string): string => failure.replace(/^[^:]+: /, "").split(" (")[0]!.split(";")[0]!;
  const causes = count(failures, causeOf);
  const emptyShortlist = failures.filter((f) => f.includes("empty shortlist")).length;
  const abortedKeys = new Set(failures.map((f) => f.split(/[#:]/).slice(0, 3).join(":")));
  const fallbackStates = records.filter((r) => r.fallbackUsed);
  const lines: string[] = [];
  lines.push(
    table(
      ["Measure", "Value"],
      [
        ["Drafts started", drafts],
        ["**Completed**", drafts - failures.length],
        ["**Aborted**", failures.length],
        ["**Empty-shortlist aborts** (compound-recommendation failure)", `**${emptyShortlist}**`],
        ["Coach states answered with the single-step compound fallback", `${fallbackStates.length} (in ${new Set(fallbackStates.map((r) => r.draftKey)).size} drafts)`],
      ],
    ),
  );
  lines.push("");
  lines.push("**Exact abort causes**");
  lines.push("");
  lines.push(
    failures.length === 0
      ? "_None — every started draft reached `complete`._"
      : table(["Cause", "Drafts"], [...causes.entries()].map(([cause, n]) => [cause, n])),
  );
  if (failures.length > 0) {
    lines.push("");
    for (const failure of failures) lines.push(`- ${failure}`);
  }
  lines.push("");
  lines.push(`**Previously failing seeds (the ${PREVIOUSLY_ABORTED.length} drafts that aborted with an empty shortlist before the fallback)**`);
  lines.push("");
  const stillAborted = PREVIOUSLY_ABORTED.filter((key) => abortedKeys.has(key));
  lines.push(
    table(
      ["Draft (policy:seed:side)", "Now"],
      PREVIOUSLY_ABORTED.map((key) => [key, abortedKeys.has(key) ? "**STILL ABORTED**" : "completes"]),
    ),
  );
  lines.push("");
  lines.push(`Previously failing seeds now passing: **${PREVIOUSLY_ABORTED.length - stillAborted.length} of ${PREVIOUSLY_ABORTED.length}**.`);
  return lines.join("\n");
}

function examples(all: StateRecord[], input: ReportInput): string {
  const { heroName } = input;
  const fires = all.filter((r) => r.fires && r.policy === "follow-coach");
  const picked: StateRecord[] = [];
  const seenHeroes = new Set<HeroId>();
  // Diversity first: distinct heroes, spread over rounds, preferring one 1-counter and one multi-counter case.
  const ordered = [...fires].sort((a, b) => a.stateIndex - b.stateIndex || a.draftKey.localeCompare(b.draftKey));
  for (const r of ordered) {
    if (picked.length >= 8) break;
    if (seenHeroes.has(r.opportunity!.heroId)) continue;
    seenHeroes.add(r.opportunity!.heroId);
    picked.push(r);
  }
  if (picked.length === 0) return "_No triggers in the sampled `follow-coach` drafts._";
  return picked
    .map((r, i) => {
      const o = r.opportunity!;
      const names = (ids: HeroId[]): string => (ids.length === 0 ? "—" : ids.map(heroName).join(", "));
      return [
        `**Example ${i + 1}** — \`${r.draftKey}\`, state #${r.stateIndex} (round ${r.round}), V6 top = **${heroName(o.heroId)}** (Pos ${r.topPosition}, ${r.topRoleStatus}), ${o.hardCounterCount} curated hard counter(s)`,
        `- Coach wording: _${o.evidence}_`,
        `- Relieved counters: ${names(o.counterIds)} (${o.banned} banned, ${o.ownPick} own pick)`,
        `- Bans in play: ${o.bansSnapshot.length}; own picks visible: ${names(o.ownPicks)}; revealed enemy picks: ${names(o.revealedEnemy)}`,
        `- Primary action shown next to it: _${o.primaryActionLabel}_; shortlist: ${names(o.shortlist)}`,
        `- Player (policy) then picked: ${heroName(r.chosen)}`,
      ].join("\n");
    })
    .join("\n\n");
}

function renderReport(input: ReportInput): string {
  const { records, failures, meta, heroCounters, syncedAt, elapsedSec } = input;
  const followCoach = records.filter((r) => r.policy === "follow-coach");
  const drafts = POLICIES.length * DRAFTS_PER_POLICY;

  // dataset-level coverage of hero-counters.json (what the rule *can* see at all)
  const heroesInMeta = Object.keys(meta.heroes).length;
  const withHard = [...heroCounters.entries()].filter(([, entries]) => entries.some((e) => e.level === "hard"));
  const hardCountDist = count(withHard, ([, entries]) => entries.filter((e) => e.level === "hard").length);
  const oneHardHeroes = withHard.filter(([, entries]) => entries.filter((e) => e.level === "hard").length === 1).length;

  const out: string[] = [];
  out.push("# WAVE4A_SAFE_CORE_INCIDENCE — how often does the Safe Core rule fire?");
  out.push("");
  out.push(`- **Nature:** measurement, taken **after** two Product-Owner-approved product changes: (1) Safe Core now requires ≥ ${MIN_CURATED_HARD_COUNTER_COVERAGE} curated hard counters (\`MIN_CURATED_HARD_COUNTER_COVERAGE\`, derived from the first incidence run) and (2) the Coach degrades to a single-step recommendation when no compound pair is role-feasible (the empty-shortlist MVP blocker). **No target percentage was set**: the numbers below are the natural resulting incidence.`);
  out.push("- **Generated by:** `bun scripts/wave4a-safe-core-incidence.ts` (deterministic; re-running against the same SQLite reproduces this file byte for byte).");
  out.push(`- **Meta snapshot:** \`apps/engine/data/dota2coach.sqlite\`, opened \`readonly\`; last \`ok\` sync ${syncedAt ?? "unknown"}. ${heroesInMeta} heroes.`);
  out.push("");
  out.push("---");
  out.push("");
  out.push("## 0. BEFORE vs AFTER the coverage floor (same states, both rules replayed)");
  out.push("");
  out.push("Safe Core is informational (it never reorders the shortlist), so a Player following the Coach walks the **same trajectory** whichever rule is shown. BEFORE = the pre-calibration rule (floor 1: a hero with a single curated hard counter could fire), AFTER = the shipped rule. Both are computed on the same V6-top state, so the columns are directly comparable. (The population differs from the first published run only by the drafts that previously aborted with an empty shortlist and now complete — see §2.)");
  out.push("");
  out.push(beforeAfterSection(records, input));
  out.push("");
  out.push("---");
  out.push("");
  out.push("## 1. Methodology");
  out.push("");
  out.push("- **Real code path, no new framework.** Each draft is a full Ranked All Pick Simulator session created through `createProtocolSessionRoutes` (`POST` create → `resolve-bans` → repeated `auto-drive` for the Enemy Bot), i.e. the same store/kernel/bot the product uses. Bans come from the product's own `resolveSimulatorBans` policy (seeded; the Player nominated no bans).");
  out.push("- **Real engine.** V6 is the real `buildSuggestions` over the real meta snapshot (`loadMeta`, the same table→struct mapping the eval harness and `app.ts` use), real `hero-positions.json`, and the **real** `hero-counters.json` through `createCoachRecommendations` — the same entry point the HTTP route uses. Nothing is faked.");
  out.push("- **Coach decision state** = every state in which the Player has at least one open seat (`human_input`); the Coach is computed once per such state (≈5 per draft: 2 + 2 + 1 seats across the 3 rounds, more if a collision reopens a seat). The Coach is called with no personal position (Safe Core is independent of it — covered by tests).");
  out.push("- **Player policies** (the Player must pick something to move the draft forward; the audit reports both so the result is not an artefact of one script):");
  out.push("  - `follow-coach` (**primary**): the Player always takes the first hero of the Coach's shortlist.");
  out.push("  - `varied` (cross-check): the Player takes a seeded-random hero from the Coach's 5-hero shortlist, giving different trajectories.");
  out.push("- **Raw appearance** = one decision state whose Coach output carries an `opportunity` block. **Distinct opportunity window** = a maximal run of consecutive decision states of one draft in which the block is present for the same hero. Both are reported; nothing is deduplicated silently.");
  out.push("- The block is evaluated for **V6's top candidate** (accepted deviation #2), so “appearance” always names V6's #1 hero.");
  out.push("- A funnel per policy recomputes each pre-condition from the data purely to explain *why* states do or do not fire; it is cross-checked against the Coach's own block.");
  out.push("");
  out.push("## 2. Seeds / number of drafts");
  out.push("");
  out.push(`- Seeds \`${SEEDS[0]}\` … \`${SEEDS[SEEDS.length - 1]}\` (${SEEDS.length} seeds) × both sides (Radiant, Dire) × 2 policies = **${drafts} drafts started**, ${DRAFTS_PER_POLICY} per policy (the same deterministic population as the first run).`);
  out.push("- This run doubles as the **soak regression** for the empty-shortlist MVP blocker. An aborted draft (if any) contributes the states recorded before the abort. Nothing is hidden: every abort is listed with its cause.");
  out.push("");
  out.push(soakSection(records, input));
  out.push("");
  out.push("## 3–11. Results");
  out.push("");
  out.push(`**Total Coach decision states evaluated: ${records.length}** (${followCoach.length} \`follow-coach\` + ${records.length - followCoach.length} \`varied\`).`);
  out.push("");
  for (const policy of POLICIES) {
    out.push(`### Policy \`${policy}\`${policy === "follow-coach" ? " (primary)" : " (cross-check)"}`);
    out.push("");
    out.push(sectionForPolicy(policy, records, input));
    out.push("");
  }
  out.push("### Both policies pooled");
  out.push("");
  const pooledFires = records.filter((r) => r.fires);
  const pooledWindows = windowsOf(records);
  out.push(
    table(
      ["Measure", "Value"],
      [
        ["States", records.length],
        ["Raw appearances", `${pooledFires.length} (${pct(pooledFires.length, records.length)})`],
        ["Distinct windows", `${pooledWindows.length} (${pct(pooledWindows.length, records.length)})`],
        ["Drafts with ≥ 1 Safe Core", `${new Set(pooledFires.map((r) => r.draftKey)).size} of ${drafts} started (${pct(new Set(pooledFires.map((r) => r.draftKey)).size, drafts)})`],
      ],
    ),
  );
  out.push("");
  out.push("### Fire rate by number of bans in play (both policies pooled)");
  out.push("");
  const banBuckets = count(records, (r) => r.bannedCount);
  out.push(
    table(
      ["Bans in play", "States", "Raw appearances", "Rate"],
      [...banBuckets.entries()]
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([bans, states]) => {
          const inBucket = records.filter((r) => String(r.bannedCount) === bans);
          const fired = inBucket.filter((r) => r.fires).length;
          return [bans, states, fired, pct(fired, states)];
        }),
    ),
  );
  out.push("");
  out.push("### Coverage of `hero-counters.json` itself (what the rule can possibly see)");
  out.push("");
  out.push(`- Heroes in the meta snapshot: ${heroesInMeta}. Heroes with a curated entry: ${heroCounters.size}. Heroes with **≥ 1 curated HARD counter**: ${withHard.length}.`);
  out.push(`- Of those, heroes with **exactly one** hard counter: ${oneHardHeroes} (${pct(oneHardHeroes, withHard.length)}); with 2+: ${withHard.length - oneHardHeroes}.`);
  out.push("");
  out.push(table(["Hard counters per hero", "Heroes"], [...hardCountDist.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([k, v]) => [k, v])));
  out.push("");
  out.push("## 12. Representative examples (`follow-coach`, distinct heroes, earliest states)");
  out.push("");
  out.push(examples(records, input));
  out.push("");
  out.push("## 13. Do repeated opportunities persist across consecutive decisions?");
  out.push("");
  for (const policy of POLICIES) {
    const own = records.filter((r) => r.policy === policy);
    const windows = windowsOf(own);
    const fires = own.filter((r) => r.fires);
    const pairs = new Set(fires.map((r) => `${r.draftKey}|${r.opportunity!.heroId}`)).size;
    const longer = windows.filter((w) => w.length > 1);
    const consecutiveExtra = longer.reduce((sum, w) => sum + (w.length - 1), 0);
    out.push(
      `- \`${policy}\`: ${fires.length} raw appearances collapse to ${windows.length} windows; ${longer.length} window(s) last 2+ consecutive states (longest: ${Math.max(0, ...windows.map((w) => w.length))}); ` +
        `${consecutiveExtra} appearance(s) are consecutive repeats of an open window, and ${fires.length - pairs - consecutiveExtra} are same-hero re-appearances after the window closed. ` +
        `Within one draft the same hero appears in more than one state in ${new Set(fires.filter((r) => fires.filter((o) => o.draftKey === r.draftKey && o.opportunity!.heroId === r.opportunity!.heroId).length > 1).map((r) => r.draftKey)).size} draft(s).`,
    );
  }
  out.push("");
  out.push("Detail tables (window-length distribution) are under “Persistence across consecutive decisions” for each policy above.");
  out.push("");
  out.push("## 14. Important dataset / method limitations");
  out.push("");
  out.push("- **Curated, not measured.** `hero-counters.json` is hand-curated domain reasoning with no patch claim; Safe Core inherits that. This audit measures how often a curated rule fires, not whether the window is *really* safe.");
  out.push("- **Bans are simulated.** They come from the Simulator's ban-resolution policy (seeded; hero pick volume from `hero_patch_stats` orders the pool as a ban-likelihood proxy — the project has no real ban-rate data). Real Ranked All Pick ban distributions may differ, and ban count/composition drives this rule directly.");
  out.push("- **Enemy Bot and Player are scripted.** The Enemy Bot picks from V6 constrained by position; the Player policies above are not human behaviour. Real drafts will trace different trajectories, so absolute rates are indicative of this simulator, not of live play.");
  out.push("- **Single meta snapshot, mono-patch data, stale.** V6's top candidate depends on `hero_patch_stats`/`hero_matchups`, which carry no verified patch provenance (WAVE4_DATA_READINESS §7) and were last synced on the date above. A different snapshot changes which hero is V6's #1.");
  out.push(`- **Drafts are not independent.** ${SEEDS.length} seeds × 2 sides share the same meta, position and counter tables; states within a draft are strongly correlated. The counts are descriptive; no confidence interval is claimed.`);
  out.push("- **Sample size.** " + `${drafts} drafts / ${records.length} states is enough to see rarity vs. commonness, not to estimate a tight rate; the per-hero and per-position tables are small-count.`);
  out.push("- **Player personal position not modelled** (Coach called without it). Covered by tests: it does not change Safe Core.");
  out.push("- **Not covered:** side context (Task 26) and one-ply lookahead (Task 27) — both blocked and out of scope.");
  out.push("");
  return out.join("\n");
}

void main();
