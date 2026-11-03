#!/usr/bin/env bun
// WAVE 5 -- DOTA JUDGE PACKET generator. Produces the evaluation dataset an INDEPENDENT Dota expert judges AFTER technical
// certification. This script does not judge anything and encodes no expected answer.
//
//   bun scripts/wave5-dota-judge-packet.ts                   -> docs/diagnostics/WAVE5_DOTA_JUDGE.{md,json}
//   bun scripts/wave5-dota-judge-packet.ts --suffix=_POST_FIX -> docs/diagnostics/WAVE5_DOTA_JUDGE_POST_FIX.{md,json}
// (the suffix lets a re-run after a remediation sit NEXT TO the original evidence instead of overwriting it; the
// scenario definitions and seed space are identical either way)
//
// Every decision point is built ONLY from what the Player may legally know at that moment: the perspective-safe Coach answer
// (`GET .../recommendations?format=v3`, the same JSON the browser renders) and the Player's own `PerspectiveDraftView`. The packet
// contains NO Simulator seed, NO hidden enemy hero, NO Enemy Bot private position and NO registration order -- and there is
// deliberately NO hidden ground-truth appendix. Scenarios are picked by deterministic coverage criteria over the same seed space as
// the Wave 4A/Wave 5 audits (first seed that satisfies each criterion), never hand-picked for how good the advice looks. The old
// Solo-Mid judge outputs (docs/diagnostics/ap-solo-mid-*) belong to the recovery product and are NOT reused.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_A,
  ACCOUNT_B,
  SIDES,
  createLab,
  loadWorldData,
  muteLog,
  playDraft,
  unmuteLog,
  type DraftRecord,
  type DraftSpec,
  type Policy,
  type Position,
  type StateRecord,
  type WorldData,
} from "./wave5/driver";
import { collectEvidenceIdentity } from "./wave5/evidence-identity";

const OUT_DIR = join(import.meta.dir, "../docs/diagnostics");
const SEEDS = Array.from({ length: 100 }, (_, i) => `AUDIT${String(i + 1).padStart(3, "0")}`);

interface ScenarioSpec {
  id: string;
  side: (typeof SIDES)[number];
  position: Position;
  policy: Policy;
  account: number;
  /** Coverage this scenario exists to provide (shown to the Judge as neutral labels, never as an expected outcome). */
  tags: string[];
  /** Index of the decision point the scenario centres on; the NEXT decision point of the same draft is included so the Judge can see how the advice reacts. */
  pick: (states: readonly StateRecord[]) => number;
  /** Extra guard beyond `pick` (seeds failing it are skipped). */
  accept?: (states: readonly StateRecord[], index: number) => boolean;
  /** Only used on a pinned draft whose `pick` criterion no longer holds (the criterion is a coverage tag, not what is being judged). */
  pinnedPick?: (states: readonly StateRecord[]) => number;
}

const firstIndex = (states: readonly StateRecord[], test: (state: StateRecord, index: number) => boolean): number => states.findIndex(test);

export const REQUIRED_SCENARIO_IDS = [
  "S01", "S02", "S03", "S04", "S05", "S06", "S07", "S08", "S09", "S10", "S11", "S12", "S13", "S14", "S15",
] as const;

export const SCENARIOS: ScenarioSpec[] = [
  { id: "S01", side: "radiant", position: 1, policy: "follow-coach", account: ACCOUNT_A, tags: ["radiant", "personal-pos1", "early", "round-1-opening", "hero-pool"], pick: (s) => firstIndex(s, (x) => x.round === 1 && x.ownSealedInRound === 0) },
  { id: "S02", side: "dire", position: 2, policy: "follow-coach", account: ACCOUNT_B, tags: ["dire", "personal-pos2", "early", "round-1-opening", "hero-pool"], pick: (s) => firstIndex(s, (x) => x.round === 1 && x.ownSealedInRound === 0) },
  { id: "S03", side: "radiant", position: 3, policy: "follow-coach", account: ACCOUNT_A, tags: ["radiant", "personal-pos3", "mid-draft", "after-enemy-reveal", "hero-pool"], pick: (s) => firstIndex(s, (x) => x.round === 2 && x.ownSealedInRound === 0) },
  { id: "S04", side: "dire", position: 4, policy: "follow-coach", account: ACCOUNT_B, tags: ["dire", "personal-pos4", "mid-draft", "second-seat-of-round", "hero-pool"], pick: (s) => firstIndex(s, (x) => x.round === 2 && x.ownSealedInRound === 1) },
  { id: "S05", side: "radiant", position: 5, policy: "follow-coach", account: ACCOUNT_A, tags: ["radiant", "personal-pos5", "late", "round-3-closing-pick", "hero-pool"], pick: (s) => firstIndex(s, (x) => x.round === 3) },
  { id: "S06", side: "dire", position: 1, policy: "follow-coach", account: ACCOUNT_B, tags: ["dire", "personal-pos1", "core-position-named", "hero-pool"], pick: (s) => firstIndex(s, (x) => x.round === 2 && x.strategyKind === "REVEAL_POSITION" && x.strategyPositions.every((p) => p <= 3)) },
  { id: "S07", side: "radiant", position: 2, policy: "deviate", account: ACCOUNT_A, tags: ["radiant", "personal-pos2", "flex-reveal-strategy", "own-flex", "player-ignored-the-advice-earlier"], pick: (s) => firstIndex(s, (x) => x.strategyKind === "REVEAL_FLEX"), pinnedPick: (s) => firstIndex(s, (x) => x.round === 2 && x.ownSealedInRound === 1) },
  { id: "S08", side: "dire", position: 3, policy: "follow-coach", account: ACCOUNT_B, tags: ["dire", "personal-pos3", "enemy-flex-visible", "mid-draft"], pick: (s) => firstIndex(s, (x) => x.round === 2 && x.enemyBeliefs.some((b) => b.positions.length > 1)) },
  { id: "S09", side: "radiant", position: 5, policy: "follow-coach", account: ACCOUNT_A, tags: ["radiant", "personal-pos5", "hero-pool-in-personal-ranking", "support-first-context"], pick: (s) => { const withPool = firstIndex(s, (x) => x.round === 1 && x.ownSealedInRound === 0 && (x.personalHeroes ?? []).some((h) => h.isFromPool)); return withPool >= 0 ? withPool : firstIndex(s, (x) => x.round === 1 && x.ownSealedInRound === 0); }, pinnedPick: (s) => firstIndex(s, (x) => x.round === 1 && x.ownSealedInRound === 0) },
  { id: "S10", side: "radiant", position: 2, policy: "varied", account: ACCOUNT_A, tags: ["safe-core-opportunity", "natural-occurrence"], pick: (s) => firstIndex(s, (x) => x.hasOpportunity) },
  { id: "S11", side: "dire", position: 2, policy: "varied", account: ACCOUNT_B, tags: ["safe-core-opportunity", "natural-occurrence", "dire"], pick: (s) => firstIndex(s, (x) => x.hasOpportunity), pinnedPick: (s) => firstIndex(s, (x) => x.round === 3) },
  { id: "S12", side: "radiant", position: 3, policy: "deviate", account: ACCOUNT_A, tags: ["radiant", "personal-pos3", "player-ignored-the-advice", "reaction-to-deviation"], pick: (s) => firstIndex(s, (x) => x.round === 1 && x.ownSealedInRound === 0), accept: (s, i) => s[i + 1] !== undefined },
  { id: "S13", side: "dire", position: 4, policy: "follow-coach", account: ACCOUNT_B, tags: ["dire", "personal-pos4", "compound-single-step-fallback"], pick: (s) => firstIndex(s, (x) => x.fallbackUsed) },
  { id: "S14", side: "radiant", position: 1, policy: "follow-coach", account: ACCOUNT_A, tags: ["radiant", "personal-pos1", "revealed-hard-counter-demotion", "real-curated-catalog"], pick: (s) => firstIndex(s, (x) => x.round === 3 && x.revealedEnemy.includes(2)) },
  { id: "S15", side: "dire", position: 3, policy: "follow-coach", account: ACCOUNT_B, tags: ["dire", "personal-pos3", "counter-truthfulness", "revealed-enemy-counters", "badge-semantics"], pick: (s) => firstIndex(s, (x) => x.round === 2 && x.revealedEnemy.length >= 2 && x.cardBadges.includes("COUNTER")) },
];

const QUESTIONS = [
  { id: "Q1", text: "Is the Primary Action (what to reveal / hold back now) reasonable for this draft state?" },
  { id: "Q2", text: "Is the position the Coach tells the Player to reveal (or defer) reasonable — is it the right role to show first / hold?" },
  { id: "Q3", text: "Are the shortlist heroes plausible for that role in this state? Name any that are not." },
  { id: "Q4", text: "Is the personal-position ranking (\"TU … AHORA\") useful for a player of that position, and is the Hero Pool marker (\"Tu pool\") used sensibly?" },
  { id: "Q5", text: "Is Flex uncertainty (\"FLEX x/y\" for own heroes, \"Likely Pos… / Possible Pos…\" for enemy heroes) represented honestly — neither over-claimed nor over-hedged?" },
  { id: "Q6", text: "If a \"Ventana de core\" (Safe Core) block is shown, is it warranted by the state? If it is absent, should it have been shown?" },
  { id: "Q7", text: "Is any IMPORTANT visible counter, synergy or draft-shape consideration missing from the advice?" },
  { id: "Q8", text: "Is any part of the advice overconfident given the evidence stated in it?" },
  { id: "Q9", text: "Comparing the decision points: does the advice react sensibly to the Player's pick and to newly revealed information?" },
  { id: "Q10", text: "Overall: would this advice help a serious Ranked player make the decision at this point? (1 = harmful, 3 = neutral, 5 = clearly helpful)" },
];

const PROVENANCE = {
  ruleset: "Dota 2 Ranked Roles All Pick — ruleset verified through patch 7.41f (mechanics: blind 2+2 / 2+2 / 1+1 rounds, collisions banned)",
  dataSnapshot: "Statistical meta (hero pick/win stats and hero-vs-hero matchups) is a snapshot LABELLED 7.41e and is flagged sync-stale by the product. OpenDota provides no patch column, so the window is not independently verified.",
  curatedData: "Position evidence (hero-positions.json) is a curated Dota2ProTracker scrape (7000+ MMR bracket, ~2026-08-22), not patch-verified. Counter evidence (hero-counters.json) is hand-curated domain reasoning with no patch claim.",
  notInMvp: ["side (Radiant/Dire) specific intelligence", "one-ply opponent-response lookahead", "verified current-patch statistical counters", "deep composition / win-condition model", "rank/bracket intelligence"],
  simulatedContext: "Bans come from the Simulator's own ban policy (no real ban-rate data exists in the project). The Enemy Bot is scripted. The opponent is not a human team.",
  informationRule: "Only information a Player could legally have is given. Enemy picks not yet revealed are absent; only the COUNT of sealed enemy seats is shown, as the real client shows it.",
};

// ---------------------------------------------------------------------------------------------

interface CoachCard { heroId: number; position: number; roleStatus: string; confidence: string; badges: string[]; rationale: string; isFromPool: boolean }
interface CoachJson {
  primaryAction: { strategy: { kind: string; position?: number; possiblePositions?: number[]; rationale: string }; label: string };
  shortlist: CoachCard[];
  roleCollision?: { infeasible: boolean; conflicts: { position: number; heroIds: number[] }[] };
  opportunity?: { label: string; heroId: number; evidence: string; counterEvidence: { sourceType: string; totalHardCounters: number; relieved: { heroId: number; level: string; status: string }[] } };
  personalHeroView?: { position: number; positionLabel: string; seatCovered?: boolean; heroes: { heroId: number; rank: number; isFromPool: boolean }[] };
  outsidePoolRecommendation?: { heroId: number; label: string; rationale: string };
  meta: { round: number | null; ownPicksRemaining: number; confidence: string; decisionContext: string };
}

const POSITION_NAME: Record<number, string> = { 1: "Carry (Pos 1)", 2: "Midlane (Pos 2)", 3: "Offlane (Pos 3)", 4: "Support (Pos 4)", 5: "Hard support (Pos 5)" };

function heroRef(data: WorldData, heroId: number) {
  const shares = [...(data.heroPositions[heroId] ?? [])].sort((a, b) => b.matches - a.matches);
  return { heroId, name: data.name(heroId), curatedPositionEvidence: shares.map((share) => ({ position: share.position, matches: share.matches })) };
}

function decisionPoint(data: WorldData, record: DraftRecord, index: number, label: string) {
  const state = record.states[index]!;
  const coach = JSON.parse(state.raw!).output as CoachJson;
  const beliefNote = (belief: { status: string; positions: number[] }) => `${belief.status === "CONFIRMED" ? "declared by the Player" : "inferred from public data"}: ${belief.positions.map((p) => `Pos${p}`).join(" / ")}`;
  return {
    label,
    round: coach.meta.round,
    ownSeatsStillToFillThisRound: coach.meta.ownPicksRemaining,
    decisionContext: coach.meta.decisionContext,
    confirmedBans: state.banned.map((id) => ({ heroId: id, name: data.name(id) })),
    ownRevealedPicks: state.ownPicks.map((id) => ({ ...heroRef(data, id), roleBelief: (() => { const b = state.ownBeliefs.find((entry) => entry.heroId === id); return b ? beliefNote(b) : "n/a"; })() })),
    revealedEnemyPicks: state.revealedEnemy.map((id) => ({ ...heroRef(data, id), roleBelief: (() => { const b = state.enemyBeliefs.find((entry) => entry.heroId === id); return b ? beliefNote(b) : "n/a"; })() })),
    sealedEnemySeatsNotYetRevealed: state.hiddenEnemySlots,
    coach: {
      overallConfidence: coach.meta.confidence,
      roleCollision: coach.roleCollision
        ? {
            infeasible: coach.roleCollision.infeasible,
            conflicts: coach.roleCollision.conflicts.map((c) => ({
              position: POSITION_NAME[c.position] ?? `Pos ${c.position}`,
              conflictingHeroes: c.heroIds.map((id) => heroRef(data, id)),
            })),
          }
        : null,
      primaryAction: {
        kind: coach.primaryAction.strategy.kind,
        positionsNamed: (coach.primaryAction.strategy.position !== undefined ? [coach.primaryAction.strategy.position] : coach.primaryAction.strategy.possiblePositions ?? []).map((p) => POSITION_NAME[p]),
        label: coach.primaryAction.label,
        rationale: coach.primaryAction.strategy.rationale,
      },
      teamShortlist: coach.shortlist.map((card, rank) => ({
        rank: rank + 1,
        ...heroRef(data, card.heroId),
        // The Player sees a position ONLY when the engine has resolved it; otherwise the card says "Rol por definir" (the engine's
        // internal fallback position is not shown, so it is not given to the Judge either).
        positionShown: card.roleStatus === "UNRESOLVED" ? "— (\"Rol por definir\")" : `${card.roleStatus === "LIKELY" ? "Probable: " : "Posición: "}${POSITION_NAME[card.position]}`,
        roleStatus: card.roleStatus === "CONFIRMED_FORCED" ? "position forced by the draft" : card.roleStatus === "LIKELY" ? "position likely" : "position undefined",
        confidence: card.confidence,
        badges: card.badges,
        rationale: card.rationale,
      })),
      personalHeroView: coach.personalHeroView
        ? { label: coach.personalHeroView.positionLabel, seatCovered: coach.personalHeroView.seatCovered === true, ranking: coach.personalHeroView.heroes.map((hero) => ({ rank: hero.rank, ...heroRef(data, hero.heroId), inPlayersHeroPool: hero.isFromPool })) }
        : null,
      safeCoreOpportunity: coach.opportunity
        ? {
            ...heroRef(data, coach.opportunity.heroId),
            text: coach.opportunity.label,
            evidenceSource: `${coach.opportunity.counterEvidence.sourceType} (hand-curated, not statistical, not patch-verified)`,
            curatedHardCounters: coach.opportunity.counterEvidence.relieved.map((r) => ({ ...heroRef(data, r.heroId), level: r.level, status: r.status === "BANNED" ? "banned" : "on the Player's own team" })),
          }
        : null,
      outsidePoolRecommendation: coach.outsidePoolRecommendation ? { ...heroRef(data, coach.outsidePoolRecommendation.heroId), text: coach.outsidePoolRecommendation.label } : null,
    },
  };
}

type Selection = "by-definition" | "pinned-to-earlier-packet-draft" | "pinned-draft-with-declared-fallback-criterion";

async function findScenario(data: WorldData, spec: ScenarioSpec, pinnedKey: string | undefined): Promise<{ record: DraftRecord; index: number; selection: Selection } | null> {
  if (pinnedKey) {
    for (const seed of SEEDS) {
      const key = `${spec.policy}:${seed}:${spec.side}`;
      if (createHash("sha256").update(key).digest("hex").slice(0, 12) !== pinnedKey) continue;
      const record = await playDraft(createLab(data), { policy: spec.policy, seed, side: spec.side, humanPosition: spec.position, accountId: spec.account, keepRaw: true });
      if (!record.completed) break;
      const index = spec.pick(record.states);
      if (index >= 0 && (!spec.accept || spec.accept(record.states, index))) return { record, index, selection: "pinned-to-earlier-packet-draft" };
      const fallback = spec.pinnedPick?.(record.states) ?? -1;
      if (fallback >= 0) return { record, index: fallback, selection: "pinned-draft-with-declared-fallback-criterion" };
      break;
    }
  }
  for (const seed of SEEDS) {
    const draftSpec: DraftSpec = { policy: spec.policy, seed, side: spec.side, humanPosition: spec.position, accountId: spec.account, keepRaw: true };
    const record = await playDraft(createLab(data), draftSpec);
    if (!record.completed) continue;
    const index = spec.pick(record.states);
    if (index < 0) continue;
    if (spec.accept && !spec.accept(record.states, index)) continue;
    return { record, index, selection: "by-definition" };
  }
  return null;
}

async function main(): Promise<void> {
  const SUFFIX = process.argv.find((arg) => arg.startsWith("--suffix="))?.slice("--suffix=".length) ?? "";
  if (!/^[A-Za-z0-9_]*$/.test(SUFFIX)) throw new Error("--suffix may only contain letters, digits and underscores");
  const BASENAME = `WAVE5_DOTA_JUDGE${SUFFIX}`;
  // Certification remediation (A3): historical packets are never overwritten -- a re-run needs a NEW suffix.
  if (existsSync(join(OUT_DIR, `${BASENAME}.json`)) || existsSync(join(OUT_DIR, `${BASENAME}.md`))) {
    throw new Error(`${BASENAME}.{md,json} already exists -- historical evidence is never overwritten; pass a new --suffix=`);
  }
  const CERTIFICATION_ID = process.argv.find((arg) => arg.startsWith("--certification-id="))?.slice("--certification-id=".length) ?? BASENAME;
  const PIN_FROM = process.argv.find((arg) => arg.startsWith("--pin-from="))?.slice("--pin-from=".length);
  const data = loadWorldData();
  const identity = collectEvidenceIdentity({
    certificationId: CERTIFICATION_ID,
    snapshot: { id: data.snapshot.id, live: data.snapshot.live },
    positionsMode: data.positionsMode,
    reproduce: [
      `bun scripts/eval/freeze-empirical-snapshot.ts --verify=${data.snapshot.id ?? "<snapshot id>"}`,
      `bun scripts/wave5-dota-judge-packet.ts ${process.argv.slice(2).join(" ")}`.trim(),
      "bun scripts/wave5/evidence-identity.ts --compare=<packetA.json>,<packetB.json>",
    ],
  });
  const head = identity.code.head;
  const empirical = identity.data.empiricalSnapshot as { id: string | null; logicalFingerprint?: string; retrievalWindow?: { from: string | null; to: string | null }; interruptedSyncRunPresent?: boolean; patchClaim?: { label: string | null } };
  const provenanceNotes = {
    ...PROVENANCE,
    ruleset: `Dota 2 Ranked Roles All Pick — ruleset mechanics verified through patch ${identity.data.rulesetTarget} (blind 2+2 / 2+2 / 1+1 rounds, collisions banned). This is the PRODUCT TARGET; it is not a claim about what the statistical data measured.`,
    dataSnapshot: `Statistical meta (hero pick/win stats and hero-vs-hero matchups) comes from the frozen snapshot ${empirical.id ?? "(LIVE DB -- NOT certifiable)"} (${empirical.logicalFingerprint ?? "no fingerprint"}), retrieved from OpenDota between ${empirical.retrievalWindow?.from ?? "?"} and ${empirical.retrievalWindow?.to ?? "?"}${empirical.interruptedSyncRunPresent ? " (one sync run was interrupted; the snapshot mixes two retrievals)" : ""}. The rows carry the label "${empirical.patchClaim?.label ?? "none"}", which is applied by our ingestion — OpenDota reports no patch and no observation window, so the label is UNVERIFIED and the window is unknown. The product flags this data sync-stale.`,
    curatedData: identity.data.positionalDataset.denominatorCorrected
      ? "Position evidence (hero-positions.json) retains every observed per-position count; shares use the complete denominator. Counter evidence (hero-counters.json) is hand-curated domain reasoning with no patch claim."
      : "Position evidence (hero-positions.json) is a curated Dota2ProTracker scrape (7000+ MMR as selected on the site, ~2026-08-21), NOT patch-verified and FLOOR-TRUNCATED: positions under 200 matches were discarded before shares were computed, so a hero's true position shares are unknown and the listed shares are upper bounds (see WAVE5_POSITION_DATA_AUDIT). Counter evidence (hero-counters.json) is hand-curated domain reasoning with no patch claim.",
  };
  muteLog();
  const pinnedKeys = new Map<string, string>();
  if (PIN_FROM) for (const entry of (JSON.parse(readFileSync(join(OUT_DIR, PIN_FROM), "utf8")) as { scenarios: { id: string; opaqueScenarioKey: string }[] }).scenarios) pinnedKeys.set(entry.id, entry.opaqueScenarioKey);
  const scenarios: unknown[] = [];
  const unmatched: string[] = [];
  const usedDrafts = new Set<string>();
  for (const spec of SCENARIOS) {
    const found = await findScenario(data, spec, pinnedKeys.get(spec.id));
    if (!found) {
      unmatched.push(spec.id);
      continue;
    }
    const { record, index } = found;
    usedDrafts.add(record.key);
    const state = record.states[index]!;
    const points = [decisionPoint(data, record, index, "DECISION POINT (before the Player picks)")];
    const choice = {
      heroPickedByPlayer: heroRef(data, state.chosen),
      wasFirstHeroOfTeamShortlist: state.shortlist[0] === state.chosen,
      wasOnTeamShortlist: state.shortlist.includes(state.chosen),
      wasInPersonalRanking: (state.personalHeroes ?? []).some((hero) => hero.heroId === state.chosen),
    };
    const next = record.states[index + 1];
    if (next) points.push(decisionPoint(data, record, index + 1, "NEXT DECISION POINT (after the Player's pick and any information revealed since)"));
    scenarios.push({
      id: spec.id,
      coverageLabels: spec.tags,
      viewpoint: { side: spec.side, playerPersonalPosition: POSITION_NAME[spec.position], playerHeroPool: (data.pools[spec.account] ?? []).map((entry) => ({ heroId: entry.hero, name: data.name(entry.hero) })) },
      opaqueScenarioKey: createHash("sha256").update(record.key).digest("hex").slice(0, 12),
      selection: found.selection,
      decisionPoints: points,
      playerChoiceAtFirstDecisionPoint: choice,
      judgeAnswers: Object.fromEntries(QUESTIONS.map((question) => [question.id, { answer: null, score1to5: null, notes: null }])),
    });
  }
  unmuteLog();
  if (unmatched.length > 0) console.log(`[dota-judge-packet] NOTE: no draft in the seed space satisfied: ${unmatched.join(", ")}`);

  const packet = {
    schema: "wave5-dota-judge-packet/v1",
    product: "AP Ranked Roles V1 — Draft Coach (MVP candidate)",
    gitHead: head,
    purpose: "Independent domain review of recommendation QUALITY. Technical correctness is certified elsewhere (WAVE5_PRODUCT_CERTIFICATION.md). Do not treat the Coach as ground truth; judge it.",
    instructionsForJudge: [
      "Judge ONLY from this packet. Do not try to reconstruct hidden information; none is included and none is needed.",
      "The Coach speaks to a Player who controls all five allied seats of a Ranked Roles All Pick draft; the Player may ignore any advice.",
      "\"Team\" recommendations (primary action + shortlist) are independent of the Player's personal position and Hero Pool. \"TU … AHORA\" is the personal-position view and is where the Hero Pool appears.",
      "Positions are the game's 1–5 roles. \"curatedPositionEvidence\" is the product's own hero-role evidence (matches played per position); it is data the Coach used, not a verdict.",
      "Fill `judgeAnswers` per scenario. Free-text notes are expected wherever an answer is not clearly positive.",
    ],
    provenanceAndLimitations: provenanceNotes,
    questions: QUESTIONS,
    scenarios,
  };
  // Leak guard: nothing the packet must never contain may appear in it. It runs on the packet WITHOUT the evidence identity (a list of
  // repository paths, not information a Player could or could not have had); the identity is attached after the guard.
  const guardedJson = JSON.stringify(packet, null, 2);
  const forbidden = /AUDIT\d{3}|internalPosition|positionsByRosterSlot|pendingSelections|"sealed"|simulatorSeed|registration/i;
  const leak = guardedJson.match(forbidden)?.[0];
  if (leak) {
    console.error(`[dota-judge-packet] FAIL — forbidden token in the packet: ${leak}`);
    process.exit(1);
  }
  const json = JSON.stringify({ evidenceIdentity: identity, ...packet }, null, 2);

  // ---- Human-readable version ----
  const lines: string[] = [];
  lines.push(`# ${BASENAME} — evaluation packet for an independent Dota expert`, "");
  lines.push(`Product: **${packet.product}** · git \`${head.slice(0, 7)}\` · schema \`${packet.schema}\` · machine-readable twin: \`${BASENAME}.json\``, "");
  lines.push(`Certification id \`${identity.certificationId}\` · code state \`${identity.code.contentStateHash.slice(0, 16)}\` (${identity.code.isolation}, ${identity.code.dirtyPathCount} path(s) differ from HEAD; diff hash \`${identity.code.dirtyDiffHash.slice(0, 16)}\`) · empirical snapshot \`${empirical.id ?? "LIVE"}\` \`${(empirical.logicalFingerprint ?? "").slice(0, 22)}\` · positions \`${(identity.data.positionalDataset.sha256 ?? "").slice(0, 16)}\` (${identity.data.positionalDataset.format}) · ruleset target ${identity.data.rulesetTarget} · comparable key \`${identity.comparableKey.slice(0, 16)}\``, "");
  lines.push("> **This packet contains no verdict.** It was generated by a script, not judged by the implementer. It carries no expected answers.", "");
  lines.push("## How to use", "", ...packet.instructionsForJudge.map((line) => `- ${line}`), "");
  lines.push("## Provenance and limitations of what the Coach knows", "");
  lines.push(`- **Ruleset:** ${provenanceNotes.ruleset}`, `- **Statistical data:** ${provenanceNotes.dataSnapshot}`, `- **Curated data:** ${provenanceNotes.curatedData}`, `- **Not part of this MVP:** ${provenanceNotes.notInMvp.join("; ")}.`, `- **Context:** ${provenanceNotes.simulatedContext}`, `- **Information rule:** ${provenanceNotes.informationRule}`, "");
  lines.push("## Questions asked for every scenario", "", ...QUESTIONS.map((q) => `- **${q.id}.** ${q.text}`), "");
  const names = (list: { name: string; curatedPositionEvidence: { position: number; matches: number }[]; roleBelief?: string }[]) => (list.length === 0 ? "_none_" : list.map((hero) => `${hero.name} (${hero.roleBelief ?? ""}; data: ${hero.curatedPositionEvidence.slice(0, 3).map((e) => `Pos${e.position}×${e.matches}`).join(", ") || "none"})`).join("; "));
  for (const scenario of scenarios as { id: string; coverageLabels: string[]; selection: string; viewpoint: { side: string; playerPersonalPosition: string; playerHeroPool: { name: string }[] }; decisionPoints: ReturnType<typeof decisionPoint>[]; playerChoiceAtFirstDecisionPoint: { heroPickedByPlayer: { name: string }; wasFirstHeroOfTeamShortlist: boolean; wasOnTeamShortlist: boolean; wasInPersonalRanking: boolean } }[]) {
    lines.push("---", "", `## ${scenario.id}`, "");
    lines.push(`Coverage labels: ${scenario.coverageLabels.join(", ")}${scenario.selection === "by-definition" ? "" : ` · draft selection: ${scenario.selection}`}`, "");
    lines.push(`Viewpoint: **${scenario.viewpoint.side}** · Player's personal position: **${scenario.viewpoint.playerPersonalPosition}** · Hero Pool: ${scenario.viewpoint.playerHeroPool.map((h) => h.name).join(", ")}`, "");
    for (const point of scenario.decisionPoints) {
      lines.push(`### ${point.label}`, "");
      lines.push(`Round ${point.round} · seats still to fill this round: ${point.ownSeatsStillToFillThisRound} · context: ${point.decisionContext} · overall confidence: ${point.coach.overallConfidence}`, "");
      lines.push(`- Confirmed bans: ${point.confirmedBans.map((b) => b.name).join(", ") || "_none_"}`);
      lines.push(`- Own revealed picks: ${names(point.ownRevealedPicks)}`);
      lines.push(`- Revealed enemy picks: ${names(point.revealedEnemyPicks)}`);
      lines.push(`- Enemy seats already sealed but not revealed: ${point.sealedEnemySeatsNotYetRevealed}`, "");
      if (point.coach.roleCollision?.infeasible) {
        const conflictDetails = point.coach.roleCollision.conflicts
          .map((c) => `${c.position}: ${c.conflictingHeroes.map((h) => h.name).join(", ")}`)
          .join("; ");
        lines.push(`> ⚠️ **Role Collision detected:** ${conflictDetails || "No legal full team seating exists"}. Advice is recovery-mode.`, "");
      }
      lines.push(`**Primary action:** ${point.coach.primaryAction.label}`, `_(kind ${point.coach.primaryAction.kind}; names: ${point.coach.primaryAction.positionsNamed.join(" / ") || "—"})_ — ${point.coach.primaryAction.rationale}`, "");
      lines.push("**Team shortlist:**", "", ...table(point.coach.teamShortlist.map((card) => [card.rank, card.name, card.positionShown, card.roleStatus, card.badges.join(", ") || "—", card.rationale.replaceAll("|", "\\|")]), ["#", "Hero", "Position shown", "Role status", "Badges", "Rationale"]), "");
      if (point.coach.personalHeroView) {
        if (point.coach.personalHeroView.seatCovered) lines.push(`**${point.coach.personalHeroView.label}:** Tu posición ya está cubierta (your own picks already fill it; no ranking is shown).`, "");
        else lines.push(`**${point.coach.personalHeroView.label}:** ${point.coach.personalHeroView.ranking.map((hero) => `${hero.rank}. ${hero.name}${hero.inPlayersHeroPool ? " (Tu pool)" : ""}`).join(" · ")}`, "");
      }
      if (point.coach.safeCoreOpportunity) {
        const sc = point.coach.safeCoreOpportunity;
        lines.push(`**Ventana de core (Safe Core):** ${sc.name} — ${sc.text}`, `_Evidence: ${sc.evidenceSource}. Curated hard counters: ${sc.curatedHardCounters.map((c) => `${c.name} (${c.status})`).join(", ")}_`, "");
      }
      if (point.coach.outsidePoolRecommendation) lines.push(`**Outside your pool:** ${point.coach.outsidePoolRecommendation.name} — ${point.coach.outsidePoolRecommendation.text}`, "");
    }
    lines.push(`**The Player then picked:** ${scenario.playerChoiceAtFirstDecisionPoint.heroPickedByPlayer.name} (first hero of the team shortlist: ${scenario.playerChoiceAtFirstDecisionPoint.wasFirstHeroOfTeamShortlist ? "yes" : "no"}; on the team shortlist: ${scenario.playerChoiceAtFirstDecisionPoint.wasOnTeamShortlist ? "yes" : "no"}; in the personal ranking: ${scenario.playerChoiceAtFirstDecisionPoint.wasInPersonalRanking ? "yes" : "no"}).`, "");
    lines.push("**Judge answers** (Q1–Q10): _to be filled in the JSON `judgeAnswers` block._", "");
  }
  if (unmatched.length > 0) lines.push("---", "", `_Scenarios with no matching draft in the seed space (reported, not fabricated): ${unmatched.join(", ")}._`, "");

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${BASENAME}.json`), json);
  writeFileSync(join(OUT_DIR, `${BASENAME}.md`), lines.join("\n"));
  console.log(`[dota-judge-packet] ${scenarios.length} scenarios (${unmatched.length} unmatched) → docs/diagnostics/${BASENAME}.{md,json}`);
}

function table(rows: readonly (readonly (string | number)[])[], header: readonly string[]): string[] {
  return [`| ${header.join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.join(" | ")} |`)];
}

if (import.meta.main) {
  await main();
}
