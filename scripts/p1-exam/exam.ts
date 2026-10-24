#!/usr/bin/env bun
// F1 / TSK-250 -- DRAFTER EXAM, baseline. Measures how the Coach recommends heroes TODAY; changes no behaviour.
//
//   bun scripts/p1-exam/exam.ts --out=ENGINE_P1_EXAM_BASELINE [--drafts=60]
//     -> docs/diagnostics/<out>.{md,json}
//
// Same real-data driver as Wave 5 (scripts/wave5/driver.ts: protocol routes + Enemy Bot + V6 over the FROZEN snapshot + curated data), but
// at every decision point it also asks for what the real simulator path shows: `?format=v4` and the Team Coach Board. Nothing here is
// imported from apps/; it only READS engine code to measure it. Deterministic: same code + same data => byte-identical artifacts
// (latency is printed to the console, never written to the artifact). Refuses to overwrite an existing report.
//
// "Ladder mode": re-run after each F1 ticket with a new --out and compare with `bun scripts/wave5/packet-diff.ts`-style diffs of the JSON.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import { SIDES, loadWorldData, muteLog, percentile, unmuteLog, type WorldData } from "../wave5/driver";
import { POLICIES, runExam } from "./session";
import { collectEvidenceIdentity } from "../wave5/evidence-identity";
import {
  M1_THRESHOLDS, adverseFillersInField, availableHardCounters, criticalGapOnCards, criticalWithheldByUncuratedPick, examNeeds, exposureCommunication, fillsCritical, i11Basis, fieldStats, m1Tension, unevaluable, i1Illegal, i6bInitiation, needsChange, pairedChange, revealedCounterProfile, tiedAtCut, topThree, i2Roles, i3Order, i6Gap, i7Damage, i9Counters, inMorePlayedHalf, mean, meanPairwiseJaccard, notCredibleShown, rate, varianceShare,
  type ExamState, type ExamWorld, type Pos,
} from "./checks";

const OUT_DIR = join(import.meta.dir, "../../docs/diagnostics");
const SCHEMA = "engine-p1-exam/v1";
type JudgeKind = "t3" | "t4";
const POSITIONS: Pos[] = [1, 2, 3, 4, 5];
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

// ---- Summary ------------------------------------------------------------------------------------------------------------------------------
type FieldCandidateList = NonNullable<ExamState["positionFitField"]>;
const EXAMPLES = 5;
const examples = (items: readonly string[]): string[] => items.slice(0, EXAMPLES);
const round4 = (x: number | null): number | null => (x === null ? null : Math.round(x * 10_000) / 10_000);

/** TSK-252: I5 over the whole credible field (see `fieldStats`): is the cut at 6 made by popularity? Medians over the states where the column has >= 6 credible heroes. */
function fieldObservation(states: readonly ExamState[]) {
  const all = states.flatMap((s) => { const stats = s.positionFitField === null ? null : fieldStats(s.positionFitField); return stats === null ? [] : [stats]; });
  const med = (xs: number[]): number | null => (xs.length === 0 ? null : round4(percentile([...xs].sort((a, b) => a - b), 50)));
  const shares = all.flatMap((x) => (x.orderShareField === null ? [] : [x.orderShareField]));
  const halfShares = all.flatMap((x) => (x.orderShareMorePlayedHalf === null ? [] : [x.orderShareMorePlayedHalf]));
  return {
    states: all.length,
    fieldSizeMedian: med(all.map((x) => x.fieldSize)),
    top3InMorePlayedHalf: round4(mean(all.map((x) => x.top3MorePlayed))),
    top6InMorePlayedHalf: round4(mean(all.map((x) => x.top6MorePlayed))),
    orderShareMedian: med(shares),
    orderShareInMorePlayedHalfMedian: med(halfShares),
    top3KeptWithoutPositionFit: round4(mean(all.map((x) => x.top3WithoutPositionFit))),
    top6KeptWithoutPositionFit: round4(mean(all.map((x) => x.top6WithoutPositionFit))),
    note: "Whole credible field of the recommended column, scored by V6 and peeled past its TOP_N cut. A fair cut is ~0.5 in the more-played half; 'kept without position_fit' = Jaccard between the real top-k and the top-k of the same scores with position_fit's contribution removed (1 = it decides nothing).",
  };
}

/** TSK-252: the SAME decisions scored under the old rule (volume) and the new one (credible-median): how many tops changed, and which way. */
function pairedObservation(states: readonly ExamState[], world: ExamWorld) {
  const changes = states.flatMap((s) => { const p = s.positionFitPaired; const c = p === null ? null : pairedChange(p.volume, p.credibleMedian); return c === null ? [] : [{ s, c }]; });
  const changed = changes.filter((x) => !x.c.top3Same);
  const lessPlayed = changed.filter((x) => x.c.meanMatchesTop3New < x.c.meanMatchesTop3Old).length;
  // Against what the Player can SEE (curated hard counters only): does the top-3 punish the revealed enemy, and does it walk into one?
  const seen = states.flatMap((s) => {
    const p = s.positionFitPaired;
    if (p === null || s.revealedEnemy.length === 0 || pairedChange(p.volume, p.credibleMedian) === null) return [];
    return [{ old: revealedCounterProfile(topThree(p.volume), s.revealedEnemy, world.counters), now: revealedCounterProfile(topThree(p.credibleMedian), s.revealedEnemy, world.counters) }];
  });
  // Ties at the cut of the top-3, under each rule, over every state whose column has more than 3 credible heroes.
  const ties = (pick: (p: NonNullable<ExamState["positionFitPaired"]>) => FieldCandidateList): number | null => {
    const flags = states.flatMap((s) => { const flag = s.positionFitPaired === null ? null : tiedAtCut(pick(s.positionFitPaired), 3); return flag === null ? [] : [flag]; });
    return round4(rate(flags.filter(Boolean).length, flags.length));
  };
  return {
    tieAtTop3CutOld: ties((p) => p.volume),
    tieAtTop3CutNew: ties((p) => p.credibleMedian),
    states: changes.length,
    top3Changed: changed.length,
    top3ChangedRate: round4(rate(changed.length, changes.length)),
    meanJaccardTop3: round4(mean(changes.map((x) => x.c.jaccard3))),
    meanJaccardTop6: round4(mean(changes.map((x) => x.c.jaccard6))),
    changedTopsThatLeanOnLessVolume: lessPlayed,
    meanMatchesTop3Old: round4(mean(changes.map((x) => x.c.meanMatchesTop3Old))),
    meanMatchesTop3New: round4(mean(changes.map((x) => x.c.meanMatchesTop3New))),
    againstRevealedEnemies: {
      states: seen.length,
      meanHeroesCounteringAnEnemyOld: round4(mean(seen.map((x) => x.old.counters))),
      meanHeroesCounteringAnEnemyNew: round4(mean(seen.map((x) => x.now.counters))),
      meanHeroesExposedToAnEnemyOld: round4(mean(seen.map((x) => x.old.exposed))),
      meanHeroesExposedToAnEnemyNew: round4(mean(seen.map((x) => x.now.exposed))),
    },
    note: "Same decision points, two rules. 'Changed' = the set of the top-3 differs. This says WHAT moved, not whether it is better: that is the judge's call (changedDecisions in the judge packet).",
  };
}

const CLOSING_WINDOW = 2;

/**
 * TSK-253: the team's critical gaps in the closing window and what the stage-aware `team_synergy` does about them, on the SAME states and the
 * SAME credible field (legacy `flat` vs `closing`, both with `position_fit` saturated at the credible median). Describes what moved and what it
 * costs under the legacy score; whether it is better is the judge's call (changedDecisions in the judge packet).
 */
export function needsObservation(states: readonly ExamState[], world: ExamWorld) {
  const inWindow = states.filter((s) => s.ownPicksRemaining >= 1 && s.ownPicksRemaining <= CLOSING_WINDOW);
  const critical = inWindow.map((s) => ({ s, needs: examNeeds(s, world) })).filter(({ needs }) => needs.critical.length > 0);
  const byKind: Record<string, number> = {};
  for (const { needs } of critical) for (const gap of needs.critical) byKind[gap] = (byKind[gap] ?? 0) + 1;

  // Lock: outside the closing window the stage-aware rule must score the field EXACTLY like the legacy one.
  const outside = states.filter((s) => s.ownPicksRemaining > CLOSING_WINDOW && s.teamNeedsPaired !== null);
  const outsideDifferent = outside.filter((s) => s.teamNeedsPaired!.flat.some((c) => s.teamNeedsPaired!.closing.find((o) => o.heroId === c.heroId)?.score !== c.score)).length;

  const changes = critical.flatMap(({ s, needs }) => {
    const p = s.teamNeedsPaired;
    const c = p === null ? null : needsChange(p.flat, p.closing, needs, world);
    return p === null || c === null ? [] : [{ s, c, p }];
  });
  const changed = changes.filter(({ c }) => !c.top3Same);
  const withFiller = changes.filter(({ c }) => c.fillerInField);
  const seen = changes.filter(({ s }) => s.revealedEnemy.length > 0).map(({ s, p }) => ({ old: revealedCounterProfile(topThree(p.flat), s.revealedEnemy, world.counters), now: revealedCounterProfile(topThree(p.closing), s.revealedEnemy, world.counters) }));
  const roundOf = (r: number): number => changes.filter(({ s }) => s.round === r).length;
  return {
    windowStates: inWindow.length,
    statesWithCriticalGap: critical.length,
    criticalGapsByKind: byKind,
    criticalWithheldByUncuratedOwnPick: inWindow.filter((s) => criticalWithheldByUncuratedPick(s, world)).length,
    identicalOutsideWindow: { states: outside.length, withDifferentScores: outsideDifferent },
    comparable: { states: changes.length, round2: roundOf(2), round3: roundOf(3), withAFillerInTheField: withFiller.length },
    top3Changed: changed.length,
    top3ChangedRate: round4(rate(changed.length, changes.length)),
    top3WithAFiller: { legacy: changes.filter(({ c }) => c.top3FillersFlat > 0).length, stageAware: changes.filter(({ c }) => c.top3FillersClosing > 0).length, ofStatesWhereAFillerExists: withFiller.length },
    meanFillersInTop3: { legacy: round4(mean(changes.map(({ c }) => c.top3FillersFlat))), stageAware: round4(mean(changes.map(({ c }) => c.top3FillersClosing))) },
    costUnderLegacyScore: { meanLegacyTop3: round4(mean(changed.map(({ c }) => c.meanFlatScoreOfFlatTop3))), meanStageAwareTop3: round4(mean(changed.map(({ c }) => c.meanFlatScoreOfClosingTop3))) },
    meanMatchesTop3: { legacy: round4(mean(changes.map(({ c }) => c.meanMatchesTop3Flat))), stageAware: round4(mean(changes.map(({ c }) => c.meanMatchesTop3Closing))) },
    againstRevealedEnemies: {
      states: seen.length,
      meanHeroesCounteringAnEnemyLegacy: round4(mean(seen.map((x) => x.old.counters))), meanHeroesCounteringAnEnemyStageAware: round4(mean(seen.map((x) => x.now.counters))),
      meanHeroesExposedToAnEnemyLegacy: round4(mean(seen.map((x) => x.old.exposed))), meanHeroesExposedToAnEnemyStageAware: round4(mean(seen.map((x) => x.now.exposed))),
    },
    note: "Same decision points, same credible field. 'Critical' = initiation / catch / damage_mix open with <= 2 own picks left and every own pick curated. It says what moved and what it gives up under the legacy score; whether it is better is the judge's call.",
  };
}


const median = (xs: readonly number[]): number | null => (xs.length === 0 ? null : percentile([...xs].sort((a, b) => a - b), 50));

/**
 * TSK-255 (M1): how often does the stage-aware `team_synergy` put a hero that fills a critical gap FIRST, over what the legacy rule had first, even though that
 * hero has an adverse STATISTICAL counter against a revealed enemy? Reported at three fixed thresholds, by pressure, with the evidence behind the counter and
 * whether the card says anything. The scoring is not touched; this only counts.
 */
export function m1Observation(states: readonly ExamState[], world: ExamWorld, name: (id: number) => string) {
  const first = M1_THRESHOLDS.map((threshold) => {
    const all = states.flatMap((s) => { const t = m1Tension(s, world, threshold); return t === null ? [] : [{ s, t }]; });
    const promoted = all.filter(({ t }) => t.promoted);
    const adverse = promoted.filter(({ t }) => t.promotedAdverse);
    const strict = adverse.filter(({ t }) => t.displacedNeutralOrBetter);
    const bucket = (xs: typeof all) => ({ applicable: xs.length, promotedFirst: xs.filter(({ t }) => t.promoted).length, promotedWithAdverseCounter: xs.filter(({ t }) => t.promoted && t.promotedAdverse).length, strict: xs.filter(({ t }) => t.promoted && t.promotedAdverse && t.displacedNeutralOrBetter).length });
    return {
      threshold: threshold.label,
      applicable: all.length,
      promotedFirst: promoted.length,
      promotedWithAdverseCounter: adverse.length,
      promotedWithAdverseCounterAndANeutralOrBetterAlternativeDisplaced: strict.length,
      rateOfApplicable: round4(rate(adverse.length, all.length)),
      byPressure: { pressure1: bucket(all.filter(({ t }) => t.pressure >= 1)), belowOne: bucket(all.filter(({ t }) => t.pressure < 1)) },
      byRound: { round2: bucket(all.filter(({ t }) => t.round === 2)), round3: bucket(all.filter(({ t }) => t.round === 3)) },
      evidenceOfTheAdverseCounter: { gamesMin: adverse.length === 0 ? null : Math.min(...adverse.map(({ t }) => t.promotedGames)), gamesMedian: median(adverse.map(({ t }) => t.promotedGames)), counterRawMedian: round4(median(adverse.flatMap(({ t }) => (t.promotedCounterRaw === null ? [] : [t.promotedCounterRaw])))), scoreLeadOverDisplacedMedian: round4(median(adverse.map(({ t }) => t.scoreLead))) },
      cardOfThePromotedHero: { onTheCards: adverse.filter(({ t }) => t.promotedCardRisks !== null).length, withAnyRisk: adverse.filter(({ t }) => t.promotedCardRisks !== null && t.promotedCardRisks.length > 0).length, withoutAnyRisk: adverse.filter(({ t }) => t.promotedCardRisks !== null && t.promotedCardRisks.length === 0).length },
      reachability: (() => {
        const seen = states.flatMap((s) => { const r = adverseFillersInField(s, world, threshold); return r === null ? [] : [r]; });
        const withOne = seen.filter((r) => r.adverseFillers > 0);
        return { statesMeasured: seen.length, candidatesAdverse: seen.reduce((sum, r) => sum + r.adverse, 0), candidatesAdverseThatAlsoFillTheGap: seen.reduce((sum, r) => sum + r.adverseFillers, 0), statesWithAnAdverseFiller: withOne.length, statesWithAnAdverseFillerInTheTop3: withOne.filter((r) => r.bestFillerRank !== null && r.bestFillerRank <= 3).length, statesWithAnAdverseFillerFirst: withOne.filter((r) => r.bestFillerRank === 1).length };
      })(),
      examples: adverse.slice(0, 5).map(({ s, t }) => `${s.draftKey}#${s.index} r${t.round} p=${round4(t.pressure)}: ${name(t.promotedHero)} (counter ${round4(t.promotedCounterRaw)} en ${t.promotedGames} partidas) por delante de ${name(t.displacedHero)} (counter ${round4(t.displacedCounterRaw)}), ventaja ${round4(t.scoreLead)}`),
    };
  });
  const hardCoveredByRb4 = states.flatMap((s) => { const t = m1Tension(s, world, M1_THRESHOLDS[0]!); return t !== null && t.promoted && t.promotedHardCountered ? [t] : []; }).length;
  // Sanity: the paired `closing` field is what the product ranks. Same top-3 as the product field => the measurement reads the real thing.
  const withBoth = states.filter((s) => s.positionFitField !== null && s.teamNeedsPaired !== null && s.positionFitField.length >= 6 && s.teamNeedsPaired.closing.length >= 6);
  const sameTop3 = withBoth.filter((s) => { const a = topThree(s.positionFitField!); const b = topThree(s.teamNeedsPaired!.closing); return a.length === b.length && a.every((id) => b.includes(id)); }).length;
  return {
    thresholds: first,
    promotedFirstThatRb4AlreadyDemotes: hardCoveredByRb4,
    productFieldMatchesPairedClosing: { states: withBoth.length, identicalTop3: sameTop3 },
    note: "Applicable = a critical gap in the closing window AND a revealed enemy. 'Promoted' = the stage-aware rule has a hero that fills the gap first where the legacy rule had somebody else. 'Adverse' = that hero's STATISTICAL counter against a revealed enemy is at or below the threshold with at least that many games, and no curated hard counter (RB-4 demotes those). It counts how often the trade-off exists; whether it hurts is the judge's call.",
  };
}

/** TSK-255: round-1 exposure as the Player sees it: per V4 card, the curated hard counters still on the table and whether the card says so. */
export function exposureObservation(states: readonly ExamState[], world: ExamWorld, name: (id: number) => string) {
  const opens = states.flatMap((s) => { const e = exposureCommunication(s, world); return e === null ? [] : [e]; });
  const cards = opens.flatMap((e) => e.cards);
  const primary = opens.map((e) => e.cards[0]!);
  const byRank = [1, 2, 3, 4, 5].map((rank) => ({ rank, cards: cards.filter((c) => c.rank === rank).length, meanAvailableHardCounters: round4(mean(cards.filter((c) => c.rank === rank).map((c) => c.availableHardCounters))), warned: cards.filter((c) => c.rank === rank && c.warned).length }));
  const byHero = new Map<number, { openings: number; available: number }>();
  for (const card of primary) { const entry = byHero.get(card.heroId) ?? { openings: 0, available: card.availableHardCounters }; entry.openings += 1; byHero.set(card.heroId, entry); }
  return {
    openingStates: opens.length,
    primary: { exposed: primary.filter((c) => c.availableHardCounters > 0).length, warned: primary.filter((c) => c.warned).length, meanAvailableHardCounters: round4(mean(primary.map((c) => c.availableHardCounters))) },
    cards: { total: cards.length, exposed: cards.filter((c) => c.availableHardCounters > 0).length, warned: cards.filter((c) => c.warned).length },
    inconsistencies: cards.filter((c) => (c.availableHardCounters > 0) !== c.warned).length,
    statesWhereEveryCardIsWarned: opens.filter((e) => e.cards.every((c) => c.warned)).length,
    statesWithAnUnwarnedAlternativeBelowAWarnedPrimary: opens.filter((e) => e.cards[0]!.warned && e.cards.slice(1).some((c) => !c.warned)).length,
    byRank,
    primaryHeroes: [...byHero.entries()].sort((a, b) => b[1].openings - a[1].openings || a[0] - b[0]).slice(0, 8).map(([hero, v]) => ({ hero: name(hero), openings: v.openings, hardCountersAvailable: v.available })),
    note: "Cards, not the board's primary (I8): the V4 card is what carries `exposed_to_counter`. `inconsistencies` must be 0: a card with an available curated hard counter always says so in round 1, and never says so without one.",
  };
}

/** TSK-255 (D1): how much of the closing window cannot be evaluated for lack of curated capabilities (the product stays silent there on purpose). */
export function unevaluableObservation(states: readonly ExamState[], world: ExamWorld, name: (id: number) => string) {
  const all = states.map((s) => unevaluable(s, world));
  const inWindow = all.filter((u) => u.inWindow);
  const shown = new Map<number, number>();
  for (const u of all) for (const hero of u.cardsOfUncuratedHero) shown.set(hero, (shown.get(hero) ?? 0) + 1);
  const notFullyEvaluable = inWindow.filter((u) => u.uncuratedOwnPick || u.cardsOfUncuratedHero.length > 0);
  return {
    states: states.length,
    curatedHeroes: world.capabilities.size,
    window: { states: inWindow.length, withAnUncuratedOwnPick: inWindow.filter((u) => u.uncuratedOwnPick).length, gapWithheldByThat: inWindow.filter((u) => u.gapWithheld).length, cards: inWindow.reduce((sum, u) => sum + u.cards, 0), cardsOfAnUncuratedHero: inWindow.reduce((sum, u) => sum + u.cardsOfUncuratedHero.length, 0), statesNotFullyEvaluable: notFullyEvaluable.length },
    uncuratedHeroesShownOnCards: [...shown.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([hero, count]) => ({ hero: name(hero), cards: count })),
    note: "'Not evaluable' = an own pick or the card's hero has no curated capabilities, so CRITICAL_GAP can neither be raised nor ruled out. The card then shows nothing, which looks the same as 'evaluated, no gap'. No card ever says 'no risk'.",
  };
}

export function summarize(states: readonly ExamState[], world: ExamWorld, name: (id: number) => string = (id) => `#${id}`) {
  const total = states.length;
  const i1 = states.flatMap((s) => i1Illegal(s, world));
  const i2 = states.flatMap((s) => i2Roles(s, world));
  const i3 = states.map((s) => i3Order(s));
  const divergences = i3.flatMap((r) => r.divergences);
  const unrankedOpen = i3.flatMap((r) => r.unrankedOpenColumns);
  const phaseAsStrategic = i3.filter((r) => r.phasePresentedAsStrategic).length;
  const opening = i3.filter((r) => r.coreFirstWithoutWindow !== null);
  const coreFirst = opening.filter((r) => r.coreFirstWithoutWindow === true).length;

  const i6 = states.map((s) => i6Gap(s, world)).filter((r) => r.applies);
  const i6Original = states.map((s) => i6Gap(s, world, "original")).filter((r) => r.applies);
  const i7 = states.map((s) => i7Damage(s, world)).filter((r) => r.applies);
  const i6b = states.map((s) => i6bInitiation(s, world)).filter((r) => r.applies);
  const gapCards = states.map((s) => criticalGapOnCards(s, world));
  const i11 = states.map((s) => i11Basis(s));
  const i11Violations = i11.flatMap((r) => r.violations);
  const basisKinds: Record<string, number> = {};
  for (const r of i11) for (const [kind, n] of Object.entries(r.kinds)) basisKinds[kind] = (basisKinds[kind] ?? 0) + n;
  const i9 = states.flatMap((s) => i9Counters(s, world).shown);
  const statesWithI9 = new Set(i9.map((x) => x.where.split(" ")[0]));

  // I4: top-3 reactivity for the same position across different drafts, at the very first decision of each draft (drafts differ by seed/bans).
  const firsts = states.filter((s) => s.ownPicks.length === 0 && s.board);
  const jaccardByPosition: Record<string, number | null> = {};
  const concentration: Record<string, { distinctPrimaries: number; sample: number; mostCommonShare: number | null }> = {};
  for (const position of POSITIONS) {
    const columns = firsts.map((s) => s.board!.columns.find((c) => c.position === position && c.state === "RANKED")).filter((c): c is NonNullable<typeof c> => c !== undefined && c.top.length > 0);
    jaccardByPosition[`pos${position}`] = round4(meanPairwiseJaccard(columns.map((c) => c.top.slice(0, 3).map((t) => t.heroId))));
    const counts = new Map<number, number>();
    for (const c of columns) counts.set(c.top[0]!.heroId, (counts.get(c.top[0]!.heroId) ?? 0) + 1);
    concentration[`pos${position}`] = { distinctPrimaries: counts.size, sample: columns.length, mostCommonShare: round4(columns.length === 0 ? null : Math.max(...counts.values()) / columns.length) };
  }
  const jaccardAll = round4(mean(Object.values(jaccardByPosition).filter((x): x is number => x !== null)));

  const shares = states.map((s) => s.positionFitShare).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const levels = states.map((s) => s.positionFitLevelShare).filter((x): x is number => x !== null).sort((a, b) => a - b);

  // I8 / I10 at the first own decision of round 1.
  const round1 = states.filter((s) => s.round === 1 && s.ownPicks.length === 0 && s.board);
  const exposures = round1.flatMap((s) => { const hero = s.board!.columns.find((c) => c.position === s.board!.recommendedPosition)?.top[0]?.heroId; return hero === undefined ? [] : [availableHardCounters(hero, s, world)]; });
  const popularity = round1.flatMap((s) => s.board!.columns.filter((c) => c.state === "RANKED").flatMap((c) => c.top.slice(0, 3).map((t) => inMorePlayedHalf(t.heroId, c.position, world.positions)))).filter((x): x is boolean => x !== null);
  const notCredible = states.flatMap((s) => notCredibleShown(s, world));

  return {
    states: total,
    hard: {
      I1_illegal: { violations: i1.length, examples: examples(i1) },
      I2_roleFeasibility: { violations: i2.length, examples: examples(i2) },
      I3_conformity: {
        targetDivergesFromDeclaredPrecedence: { states: divergences.length, of: total, rate: round4(rate(divergences.length, total)), examples: examples(divergences) },
        openColumnNotRanked: { violations: unrankedOpen.length, examples: examples(unrankedOpen) },
        phaseShownAsStrategic: phaseAsStrategic,
      },
      // Same key and same definition as every report up to T4_AFTER, so the ladder stays comparable. NOT the same ruler as I6_visible_revised.
      I6_visible: {
        definition: "original (T2..T4_AFTER): an uncurated own pick counts as lacking; only V3/board texts make the gap visible",
        gapOpenStates: i6Original.length,
        gapNotVisibleOnAnyCard: i6Original.filter((r) => r.gapNotVisible).length,
        note: "A late open initiation/catch gap that no card mentions. T4/T5 are expected to close it; at baseline it is a known defect.",
      },
      I6_visible_revised: {
        definition: "revised (T5, TSK-254): applies only with every own pick curated; a V4 card risk text also makes the gap visible",
        gapOpenStates: i6.length,
        gapNotVisibleOnAnyCard: i6.filter((r) => r.gapNotVisible).length,
        note: "Smaller denominator than I6_visible by construction. A drop from the original to this one is a change of ruler, NOT an improvement: do not compare the two numbers.",
      },
      I9_visible: {
        hardCounteredHeroesInTop3: i9.length,
        statesAffected: statesWithI9.size,
        withoutVisibleRisk: i9.filter((x) => !x.riskVisible).length,
        examples: examples(i9.filter((x) => !x.riskVisible).map((x) => `${x.where}: hero ${x.heroId} hard-countered by revealed ${x.by.join("+")}`)),
        note: "Plan v2: allowed in the top-3 only when fewer than 3 credible alternatives exist AND the risk is shown. At baseline the risk is never shown.",
      },
      I11_honestBasis: {
        status: "MEASURED" as const,
        cards: i11.reduce((sum, r) => sum + r.cards, 0),
        violations: i11Violations.length,
        examples: examples(i11Violations),
        basisKinds,
        statisticalWithoutSample: i11.reduce((sum, r) => sum + r.statisticalWithoutSample, 0),
        note: "Every V4 card carries a coherent basis, and it does not contradict its reason (a capability claim is curated, a quoted statistic is statistical). Reports before TSK-254 had no basis (NOT_MEASURABLE).",
      },
      I6c_criticalGapOnCards: {
        cardsCarryingIt: gapCards.reduce((sum, r) => sum + r.shown, 0),
        cardsInCriticalStates: gapCards.reduce((sum, r) => sum + r.cardsInCriticalStates, 0),
        shownWithoutProof: gapCards.flatMap((r) => r.shownWithoutProof).length,
        missingOnADemonstrableCard: gapCards.flatMap((r) => r.missingOnCard).length,
        examples: examples([...gapCards.flatMap((r) => r.shownWithoutProof), ...gapCards.flatMap((r) => r.missingOnCard)]),
        note: "CRITICAL_GAP is shown only when the gap is critical (<= 2 own picks left, every own pick curated) and the card's hero is curated and does not fill it; and it is never missing from such a card.",
      },
    },
    observations: {
      I3_openingOnCore: { openingStates: opening.length, coreFirstWithoutWindow: coreFirst, rate: round4(rate(coreFirst, opening.length)), note: "Simulator recommends Pos 1/2 on the Player's first decision of round 1 with no COUNTER_WINDOW/POOL_SCARCITY behind it." },
      I4_reactivityJaccardTop3: { overall: jaccardAll, byPosition: jaccardByPosition, sampleStates: firsts.length, note: "1.0 = the same three heroes for a position in every draft." },
      I5_positionFitShareOfScore: {
        levelMedian: round4(levels.length === 0 ? null : percentile(levels, 50)), levelP10: round4(levels.length === 0 ? null : percentile(levels, 10)), levelP90: round4(levels.length === 0 ? null : percentile(levels, 90)),
        orderMedian: round4(shares.length === 0 ? null : percentile(shares, 50)), orderP10: round4(shares.length === 0 ? null : percentile(shares, 10)), orderP90: round4(shares.length === 0 ? null : percentile(shares, 90)),
        saturatedShareMean: round4(mean(states.flatMap((s) => (s.positionFitSaturated === null ? [] : [s.positionFitSaturated])))),
        states: levels.length, candidatesPerState: round4(mean(states.map((s) => s.candidateCount))),
        note: "level = share of V6's score that is position_fit; order = cov(position_fit, score)/var(score) among the candidates V6 keeps (TOP_N) for the recommended column. Not the whole credible field: V6 truncates before the exam can see it.",
      },
      I5_positionFitOverWholeField: fieldObservation(states),
      T3_pairedRuleChange: pairedObservation(states, world),
      I7_damageMix: { monoDamageStates: i7.length, top3Diversifies: i7.filter((r) => r.top3Diversifies).length },
      I6b_initiation: { gapOpenStates: i6b.length, top3Fills: i6b.filter((r) => r.top3Fills).length, fillerInField: i6b.filter((r) => r.fillerInField).length, note: "Initiation on its own (TSK-253). The original I6 asks for initiation OR catch: 69% of curated heroes have one of the two, so that union is almost never missing." },
      T4_closingNeeds: needsObservation(states, world),
      M1_criticalGapVsAdverseCounter: m1Observation(states, world, name),
      T6_round1ExposureOnCards: exposureObservation(states, world, name),
      D1_notEvaluable: unevaluableObservation(states, world, name),
      I6_fill: { gapOpenStates: i6.length, top3Fills: i6.filter((r) => r.top3Fills).length, fillerExistsInShownSet: i6.filter((r) => r.credibleFillerExists).length },
      I8_exposureOfRound1Primary: { states: exposures.length, meanHardCountersAvailable: round4(mean(exposures)), maxHardCountersAvailable: exposures.length === 0 ? null : Math.max(...exposures) },
      I10_round1Top3InMorePlayedHalf: { candidates: popularity.length, inMorePlayedHalf: popularity.filter(Boolean).length, rate: round4(rate(popularity.filter(Boolean).length, popularity.length)), note: "Observation only (plan v2 removed it as a gate): high = the ranking leans on popularity." },
      top1Concentration: concentration,
      shownButNotCredibleAtColumn: { count: notCredible.length, examples: examples(notCredible) },
    },
  };
}

// ---- Judge packet (what a human judges; filled in at T6) -----------------------------------------------------------------------------
const COMPONENT_QUESTIONS = [
  { id: "C1-position", text: "Position order: is the position the board recommends the right one to commit to NOW (and not just the lowest open one)?" },
  { id: "C2-ranking", text: "Hero ranking: are the heroes shown for that position the ones you would consider, or do they look chosen for being popular?" },
  { id: "C3-composition", text: "Composition: does the advice notice what the team still lacks (initiation / catch / damage mix)?" },
  { id: "C4-exposure", text: "Exposure: is any recommended hero a clear counter-target of what the rival has shown, and does the card say so?" },
];
const PLAN_QUESTIONS = [
  { id: "P1-tempo", text: "Does this team need to win early, or can it scale?" },
  { id: "P2-objectives", text: "Can this draft convert an advantage into objectives?" },
  { id: "P3-plan", text: "Does the recommendation improve the plan, or only the score?" },
];

function judgePacket(states: readonly ExamState[], world: ExamWorld, data: WorldData, judge: JudgeKind) {
  const criteria: { label: string; test: (s: ExamState) => boolean }[] = [
    { label: "round-1 opening recommends a core without a window", test: (s) => i3Order(s).coreFirstWithoutWindow === true },
    { label: "round-1 opening recommends hard support / support", test: (s) => s.round === 1 && s.ownPicks.length === 0 && (s.board?.recommendedPosition === 5 || s.board?.recommendedPosition === 4) },
    { label: "simulator target differs from the declared precedence", test: (s) => i3Order(s).divergences.length > 0 },
    { label: "a hard-countered hero sits in a top-3", test: (s) => i9Counters(s, world).shown.length > 0 },
    { label: "late open initiation/catch gap", test: (s) => i6Gap(s, world).applies },
    { label: "mono-damage team", test: (s) => i7Damage(s, world).applies },
    { label: "round 2 after rival reveals", test: (s) => s.round === 2 && s.revealedEnemy.length >= 2 },
    { label: "M1: a hero that fills the critical gap leads despite an adverse statistical counter", test: (s) => { const t = m1Tension(s, world, M1_THRESHOLDS[1]!); return t !== null && t.promoted && t.promotedAdverse; } },
    { label: "round-1 opening whose first card has a curated hard counter still available", test: (s) => (exposureCommunication(s, world)?.cards[0]?.availableHardCounters ?? 0) > 0 },
    { label: "round 3 closing pick", test: (s) => s.round === 3 },
  ];
  const used = new Set<string>();
  const points = criteria.flatMap((criterion) => {
    const hit = states.find((s) => !used.has(`${s.draftKey}#${s.index}`) && s.board && criterion.test(s));
    if (!hit) return [];
    used.add(`${hit.draftKey}#${hit.index}`);
    const name = (id: number): string => data.name(id);
    return [{
      coverage: criterion.label,
      opaqueKey: createHash("sha256").update(`${hit.draftKey}#${hit.index}`).digest("hex").slice(0, 12),
      round: hit.round,
      bans: hit.banned.map(name),
      ownPicks: hit.ownPicks.map(name),
      revealedEnemy: hit.revealedEnemy.map(name),
      boardRecommendedPosition: hit.board!.recommendedPosition,
      boardTop3ByPosition: Object.fromEntries(hit.board!.columns.filter((c) => c.top.length > 0).map((c) => [`pos${c.position}`, c.top.slice(0, 3).map((t) => name(t.heroId))])),
      v3Top3: hit.v3.slice(0, 3).map((c) => name(c.heroId)),
      precedenceWouldPick: hit.lpp ? `pos${hit.lpp.position} (${hit.lpp.signal})` : null,
      v4ViewedPosition: hit.v4?.viewedPosition ?? null,
      v4Top3: (hit.v4?.cards ?? []).slice(0, 3).map((card) => ({
        hero: name(card.heroId),
        reason: card.rationale,
        basis: card.basis === null ? null : card.basis.kind,
        risks: card.risks.map((risk) => `${risk.kind}${risk.heroIds.length > 0 ? ` (${risk.heroIds.map(name).join(", ")})` : ""}`),
        hardCountersStillAvailable: (world.counters.get(card.heroId) ?? []).filter((entry) => entry.level === "hard" && ![...hit.banned, ...hit.ownPicks, ...hit.revealedEnemy].includes(entry.vs)).map((entry) => name(entry.vs)),
      })),
      judgeAnswers: Object.fromEntries([...COMPONENT_QUESTIONS, ...PLAN_QUESTIONS].map((q) => [q.id, { answer: null, notes: null }])),
    }];
  });
  return { schema: "engine-p1-judge-packet/v2", componentQuestions: COMPONENT_QUESTIONS, planQuestions: PLAN_QUESTIONS, points, changedBy: judge === "t4" ? "TSK-253" : "TSK-252", changedDecisions: judge === "t4" ? changedDecisionsT4(states, data, world) : changedDecisions(states, data), m1Decisions: m1Decisions(states, data, world) };
}

const CHANGED_DECISIONS_SAMPLE = 12;

/** TSK-252: decisions whose top-3 differs between the old and the new `position_fit` rule, spread evenly over the changed ones (deterministic), old and new unlabeled-by-order for a blind read. */
function changedDecisions(states: readonly ExamState[], data: WorldData) {
  const changed = states.flatMap((s) => {
    const p = s.positionFitPaired;
    const c = p === null || s.board?.recommendedPosition == null ? null : pairedChange(p.volume, p.credibleMedian);
    return c === null || c.top3Same ? [] : [{ s, c, p: p! }];
  });
  const step = Math.max(1, Math.floor(changed.length / CHANGED_DECISIONS_SAMPLE));
  const picked = changed.filter((_, i) => i % step === 0).slice(0, CHANGED_DECISIONS_SAMPLE);
  const top3 = (field: readonly { heroId: number; score: number }[]): number[] => [...field].sort((a, b) => b.score - a.score || a.heroId - b.heroId).slice(0, 3).map((c) => c.heroId);
  return picked.map(({ s, p }) => blindPair(s, top3(p.volume), top3(p.credibleMedian), data, "C2"));
}

/** One decision as a blind A/B read: which rule is A and which is B is decided by the key, so the read cannot learn "A is always the old one". */
function blindPair(s: ExamState, oldIds: readonly number[], newIds: readonly number[], data: WorldData, question: "C2" | "C3") {
  const name = (id: number): string => data.name(id);
  const key = createHash("sha256").update(`${s.draftKey}#${s.index}`).digest("hex").slice(0, 12);
  const swap = parseInt(key.slice(0, 1), 16) % 2 === 1;
  const oldTop = oldIds.map(name);
  const newTop = newIds.map(name);
  return {
    opaqueKey: key,
    round: s.round,
    position: s.board!.recommendedPosition,
    bans: s.banned.map(name),
    ownPicks: s.ownPicks.map(name),
    revealedEnemy: s.revealedEnemy.map(name),
    optionA: swap ? newTop : oldTop,
    optionB: swap ? oldTop : newTop,
    answerKey: { optionAIs: swap ? "new" : "old" },
    judgeAnswers: { [question]: { better: null as "A" | "B" | "equivalent" | null, harmfulReason: null as string | null } },
  };
}

/**
 * TSK-253: decisions whose top-3 differs between the legacy and the stage-aware `team_synergy`, all of them when there are at most
 * CHANGED_DECISIONS_SAMPLE (the interesting set is small by construction: critical gap x closing window x a filler that moves the cut).
 */
function changedDecisionsT4(states: readonly ExamState[], data: WorldData, world: ExamWorld) {
  const changed = states.flatMap((s) => {
    const p = s.teamNeedsPaired;
    if (p === null || s.board?.recommendedPosition == null) return [];
    const needs = examNeeds(s, world);
    const c = needs.critical.length === 0 ? null : needsChange(p.flat, p.closing, needs, world);
    return c === null || c.top3Same ? [] : [{ s, p }];
  });
  const step = Math.max(1, Math.floor(changed.length / CHANGED_DECISIONS_SAMPLE));
  const top3 = (field: readonly { heroId: number; score: number }[]): number[] => [...field].sort((a, b) => b.score - a.score || a.heroId - b.heroId).slice(0, 3).map((c) => c.heroId);
  return changed.filter((_, i) => i % step === 0).slice(0, CHANGED_DECISIONS_SAMPLE).map(({ s, p }) => blindPair(s, top3(p.flat), top3(p.closing), data, "C3"));
}

/**
 * TSK-255 (M1): the decisions where the stage-aware rule put a gap-filling hero first despite an adverse statistical counter, as a blind A/B
 * (legacy top-3 vs stage-aware top-3). Each hero shows its counter evidence so the read can weigh "covers the gap" against "loses the matchup".
 */
function m1Decisions(states: readonly ExamState[], data: WorldData, world: ExamWorld) {
  const threshold = M1_THRESHOLDS[0]!;
  const hits = states.flatMap((s) => { const t = m1Tension(s, world, threshold); return t !== null && t.promoted && t.promotedAdverse && s.teamNeedsPaired !== null && s.board?.recommendedPosition != null ? [{ s, p: s.teamNeedsPaired }] : []; });
  const step = Math.max(1, Math.floor(hits.length / CHANGED_DECISIONS_SAMPLE));
  const top3 = (field: readonly { heroId: number; score: number }[]): number[] => [...field].sort((a, b) => b.score - a.score || a.heroId - b.heroId).slice(0, 3).map((c) => c.heroId);
  return hits.filter((_, i) => i % step === 0).slice(0, CHANGED_DECISIONS_SAMPLE).map(({ s, p }) => {
    const heroEvidence = Object.fromEntries([...new Set([...top3(p.flat), ...top3(p.closing)])].map((id) => {
      const counter = (p.closing.find((c) => c.heroId === id) ?? p.flat.find((c) => c.heroId === id))?.counter ?? null;
      const needs = examNeeds(s, world);
      return [data.name(id), { fillsTheCriticalGap: fillsCritical(id, needs, world), counterVsRevealed: counter === null || !counter.vsRevealed || counter.raw === null ? "sin dato suficiente" : `${(counter.raw * 100).toFixed(1)} pts de contrapick en ${counter.sampleSize} partidas` }];
    }));
    return { ...blindPair(s, top3(p.flat), top3(p.closing), data, "C3"), criticalGaps: examNeeds(s, world).critical, picksLeft: s.ownPicksRemaining, heroEvidence };
  });
}

// ---- Markdown ------------------------------------------------------------------------------------------------------------------------------
const pct = (x: number | null): string => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

function markdown(report: { identity: ReturnType<typeof collectEvidenceIdentity>; config: Record<string, unknown>; coverage: Record<string, unknown>; summary: ReturnType<typeof summarize> }): string {
  const { summary, identity } = report;
  const h = summary.hard;
  const o = summary.observations;
  const lines: string[] = [];
  lines.push(`# ENGINE_P1_EXAM — examen de drafter de F1 (\`${identity.certificationId}\`)`, "");
  lines.push(`Código: \`${identity.code.head.slice(0, 7)}\` (${identity.code.cleanAtHead ? "árbol limpio" : `${identity.code.dirtyPathCount} archivo(s) distintos de HEAD`}) · estado \`${identity.code.contentStateHash.slice(0, 16)}\` · snapshot \`${(identity.data.empiricalSnapshot as { id?: string }).id}\` · clave comparable \`${identity.comparableKey.slice(0, 16)}\``, "");
  lines.push("Este reporte **mide, no juzga y no cambia comportamiento**. Camino medido: el del simulador (Team Coach Board + `?format=v4`) más la lista V3 que el juez de Wave 5 ya conocía.", "");
  lines.push(`Muestra: ${JSON.stringify(report.coverage)}`, "");
  lines.push("## Defectos duros (plan v2, tabla C)", "", "| Invariante | Resultado |", "| --- | --- |");
  lines.push(`| I1 nada ilegal | ${h.I1_illegal.violations} violaciones |`);
  lines.push(`| I2 factibilidad de roles | ${h.I2_roleFeasibility.violations} violaciones |`);
  lines.push(`| I3 conformidad: objetivo = precedencia declarada | ${h.I3_conformity.targetDivergesFromDeclaredPrecedence.states}/${summary.states} estados divergen (${pct(h.I3_conformity.targetDivergesFromDeclaredPrecedence.rate)}) |`);
  lines.push(`| I3 toda columna abierta rankeada | ${h.I3_conformity.openColumnNotRanked.violations} violaciones |`);
  lines.push(`| I3 PHASE presentado como ventaja | ${h.I3_conformity.phaseShownAsStrategic} |`);
  lines.push(`| I6-visible (definición ORIGINAL, comparable con T2..T4_AFTER) | ${h.I6_visible.gapNotVisibleOnAnyCard}/${h.I6_visible.gapOpenStates} estados con hueco abierto sin que ninguna tarjeta lo diga |`);
  lines.push(`| I6-visible (definición REVISADA T5, solo con todos los picks propios curados; NO comparable con la fila anterior ni con reportes previos) | ${h.I6_visible_revised.gapNotVisibleOnAnyCard}/${h.I6_visible_revised.gapOpenStates} estados con hueco abierto sin que ninguna tarjeta lo diga |`);
  lines.push(`| I9-visible counter duro en top-3 | ${h.I9_visible.hardCounteredHeroesInTop3} apariciones en ${h.I9_visible.statesAffected} estados; ${h.I9_visible.withoutVisibleRisk} sin riesgo visible |`);
  lines.push(`| I11 honestidad de la base | ${h.I11_honestBasis.violations} violaciones en ${h.I11_honestBasis.cards} tarjetas V4 (bases ${JSON.stringify(h.I11_honestBasis.basisKinds)}; estadísticas sin muestra: ${h.I11_honestBasis.statisticalWithoutSample}) |`);
  lines.push(`| I6c CRITICAL_GAP en la tarjeta | ${h.I6c_criticalGapOnCards.cardsCarryingIt} tarjetas lo llevan (de ${h.I6c_criticalGapOnCards.cardsInCriticalStates} en estados con hueco crítico); sin prueba: ${h.I6c_criticalGapOnCards.shownWithoutProof}; faltante donde era demostrable: ${h.I6c_criticalGapOnCards.missingOnADemonstrableCard} |`, "");
  lines.push("## Observaciones (no son ley)", "");
  lines.push(`- **I3 apertura en cores:** ${o.I3_openingOnCore.coreFirstWithoutWindow}/${o.I3_openingOnCore.openingStates} aperturas de ronda 1 recomiendan Pos 1/2 sin ventana de counter ni escasez de pool (${pct(o.I3_openingOnCore.rate)}).`);
  lines.push(`- **I4 reactividad (Jaccard del top-3, misma posición entre drafts distintos):** global ${o.I4_reactivityJaccardTop3.overall}; por posición ${JSON.stringify(o.I4_reactivityJaccardTop3.byPosition)}. 1.0 = siempre los mismos tres.`);
  const f5 = o.I5_positionFitOverWholeField;
  const t3 = o.T3_pairedRuleChange;
  const i5 = o.I5_positionFitShareOfScore;
  lines.push(`- **I5 peso de \`position_fit\`:** ${pct(i5.levelMedian)} del score (mediana; p10 ${pct(i5.levelP10)}, p90 ${pct(i5.levelP90)}) y ${pct(i5.orderMedian)} de la dispersión que ordena a los candidatos (mediana; p10 ${pct(i5.orderP10)}, p90 ${pct(i5.orderP90)}); ${i5.states} estados, ~${i5.candidatesPerState} candidatos por estado; en ${pct(i5.saturatedShareMean)} de ellos \`position_fit\` está saturado en 1 (suma la misma constante a todos). Es sobre lo que V6 conserva (TOP_N), no sobre todo el campo.`);
  lines.push(`- **I5 sobre todo el campo creíble (TSK-252):** ${f5.states} estados con ≥6 creíbles (mediana ${f5.fieldSizeMedian}). El top-3 cae en la mitad más jugada ${pct(f5.top3InMorePlayedHalf)} de las veces y el top-6 ${pct(f5.top6InMorePlayedHalf)} (un corte neutro daría ~50%). \`position_fit\` explica ${pct(f5.orderShareMedian)} de la dispersión (mediana). Quitando su aporte, el top-3 se conserva en ${pct(f5.top3KeptWithoutPositionFit)} (Jaccard) y el top-6 en ${pct(f5.top6KeptWithoutPositionFit)}; 100% = no decide nada. Dentro de la mitad más jugada, \`position_fit\` explica ${pct(f5.orderShareInMorePlayedHalfMedian)} de la dispersión.`);
  lines.push(`- **T3 misma decisión, dos reglas (volumen vs mediana de creíbles):** ${t3.states} estados; el top-3 cambia en ${t3.top3Changed} (${pct(t3.top3ChangedRate)}); Jaccard medio del top-3 ${t3.meanJaccardTop3}, del top-6 ${t3.meanJaccardTop6}; de los cambiados, ${t3.changedTopsThatLeanOnLessVolume} se apoyan en menos volumen (partidas medias del top-3: ${t3.meanMatchesTop3Old} → ${t3.meanMatchesTop3New}). Describe qué se movió, no si mejora. Empates exactos en el corte del top-3 (decide el id del héroe, no el draft): ${pct(t3.tieAtTop3CutOld)} → ${pct(t3.tieAtTop3CutNew)} de los estados.`);
  const t3seen = t3.againstRevealedEnemies;
  lines.push(`- **T3 frente a los rivales ya revelados (solo capa curada "hard"):** en ${t3seen.states} estados con rival visible, héroes del top-3 que counterean a un rival: ${t3seen.meanHeroesCounteringAnEnemyOld} → ${t3seen.meanHeroesCounteringAnEnemyNew}; héroes del top-3 expuestos a un rival: ${t3seen.meanHeroesExposedToAnEnemyOld} → ${t3seen.meanHeroesExposedToAnEnemyNew}.`);
  lines.push(`- **I6 relleno:** de ${o.I6_fill.gapOpenStates} estados con hueco abierto, el top-3 lo llena en ${o.I6_fill.top3Fills}; existe un relleno en lo mostrado en ${o.I6_fill.fillerExistsInShownSet}.`);
  const i6bo = o.I6b_initiation;
  lines.push(`- **I6b iniciación sola (TSK-253):** de ${i6bo.gapOpenStates} estados con los últimos picks y sin ningún iniciador, el top-3 del board lo llena en ${i6bo.top3Fills}; existe un iniciador creíble en la columna en ${i6bo.fillerInField}.`);
  const t4 = o.T4_closingNeeds;
  lines.push(`- **T4 huecos críticos en la ventana de cierre (TSK-253):** ${t4.statesWithCriticalGap} de ${t4.windowStates} estados con ≤2 picks propios por delante tienen un hueco crítico ${JSON.stringify(t4.criticalGapsByKind)}; en ${t4.criticalWithheldByUncuratedOwnPick} más no se declara por un pick propio sin capacidades curadas. Fuera de la ventana la regla nueva puntúa idéntico a la vieja: ${t4.identicalOutsideWindow.withDifferentScores}/${t4.identicalOutsideWindow.states} estados con scores distintos.`);
  lines.push(`- **T4 misma decisión, dos reglas (team_synergy plano vs por etapa):** ${t4.comparable.states} estados comparables (ronda 2: ${t4.comparable.round2}, ronda 3: ${t4.comparable.round3}); el top-3 cambia en ${t4.top3Changed} (${pct(t4.top3ChangedRate)}). Top-3 con al menos un héroe que llena lo crítico: ${t4.top3WithAFiller.legacy} → ${t4.top3WithAFiller.stageAware} de ${t4.top3WithAFiller.ofStatesWhereAFillerExists} estados donde existe uno en el campo; promedio de rellenos en el top-3 ${t4.meanFillersInTop3.legacy} → ${t4.meanFillersInTop3.stageAware}. Costo bajo el score viejo (top-3 cambiados): ${t4.costUnderLegacyScore.meanLegacyTop3} → ${t4.costUnderLegacyScore.meanStageAwareTop3}; partidas medias del top-3 ${t4.meanMatchesTop3.legacy} → ${t4.meanMatchesTop3.stageAware}.`);
  lines.push(`- **T4 frente a los rivales ya revelados (capa curada "hard"):** en ${t4.againstRevealedEnemies.states} estados con rival visible, héroes del top-3 que counterean a un rival ${t4.againstRevealedEnemies.meanHeroesCounteringAnEnemyLegacy} → ${t4.againstRevealedEnemies.meanHeroesCounteringAnEnemyStageAware}; expuestos a un rival ${t4.againstRevealedEnemies.meanHeroesExposedToAnEnemyLegacy} → ${t4.againstRevealedEnemies.meanHeroesExposedToAnEnemyStageAware}.`);
  lines.push(`- **I7 daño:** de ${o.I7_damageMix.monoDamageStates} estados mono-daño, el top-3 diversifica en ${o.I7_damageMix.top3Diversifies}.`);
  lines.push(`- **I8 exposición del primary de ronda 1:** ${o.I8_exposureOfRound1Primary.meanHardCountersAvailable} counters duros disponibles en promedio (máx ${o.I8_exposureOfRound1Primary.maxHardCountersAvailable}) sobre ${o.I8_exposureOfRound1Primary.states} aperturas.`);
  lines.push(`- **I10 popularidad:** ${pct(o.I10_round1Top3InMorePlayedHalf.rate)} de los top-3 de ronda 1 caen en la mitad más jugada de su posición (${o.I10_round1Top3InMorePlayedHalf.inMorePlayedHalf}/${o.I10_round1Top3InMorePlayedHalf.candidates}).`);
  lines.push(`- **Concentración del #1:** ${JSON.stringify(o.top1Concentration)}`);
  lines.push(`- **Mostrado pero no creíble en su columna:** ${o.shownButNotCredibleAtColumn.count}.`, "");
  const m1 = o.M1_criticalGapVsAdverseCounter;
  lines.push("", "## M1 — cubrir un hueco crítico frente a un counter estadístico adverso (mide, no cambia el scoring)", "", `${m1.note}`, "", "| Umbral de 'adverso' | Estados aplicables | Hueco-relleno primero (≠ regla vieja) | …con counter adverso | …y alternativa desplazada neutra o mejor | p=1 (adverso / aplicables) | Evidencia (partidas mín / mediana) | Tarjeta sin ningún riesgo |", "| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const t of m1.thresholds) lines.push(`| ${t.threshold} | ${t.applicable} | ${t.promotedFirst} | ${t.promotedWithAdverseCounter} (${pct(t.rateOfApplicable)}) | ${t.promotedWithAdverseCounterAndANeutralOrBetterAlternativeDisplaced} | ${t.byPressure.pressure1.promotedWithAdverseCounter}/${t.byPressure.pressure1.applicable} | ${t.evidenceOfTheAdverseCounter.gamesMin ?? "n/a"} / ${t.evidenceOfTheAdverseCounter.gamesMedian ?? "n/a"} | ${t.cardOfThePromotedHero.withoutAnyRisk}/${t.cardOfThePromotedHero.onTheCards} |`);
  for (const t of m1.thresholds) lines.push("", `Alcanzabilidad (${t.threshold}): en ${t.reachability.statesMeasured} estados medidos hay ${t.reachability.candidatesAdverse} candidatos con counter adverso en todo el campo, ${t.reachability.candidatesAdverseThatAlsoFillTheGap} de ellos además cubren el hueco; ${t.reachability.statesWithAnAdverseFiller} estados tienen alguno, ${t.reachability.statesWithAnAdverseFillerInTheTop3} en el top-3 y ${t.reachability.statesWithAnAdverseFillerFirst} en primer lugar.`);
  lines.push("", `Héroes promovidos que RB-4 ya demociona (counter duro curado): ${m1.promotedFirstThatRb4AlreadyDemotes}. El campo medido coincide con el del producto en ${m1.productFieldMatchesPairedClosing.identicalTop3}/${m1.productFieldMatchesPairedClosing.states} estados (top-3 idéntico).`);
  for (const t of m1.thresholds.slice(0, 1)) for (const example of t.examples) lines.push(`- ${example}`);
  const ex = o.T6_round1ExposureOnCards;
  lines.push("", "## Exposición de ronda 1 en la tarjeta (TSK-254)", "", `- ${ex.openingStates} aperturas de ronda 1 con tarjetas V4. Primera tarjeta: ${ex.primary.exposed} con algún counter duro curado todavía disponible, ${ex.primary.warned} lo avisan (\`exposed_to_counter\`); media ${ex.primary.meanAvailableHardCounters} counters disponibles.`, `- Todas las tarjetas: ${ex.cards.exposed}/${ex.cards.total} expuestas, ${ex.cards.warned} avisadas. **Inconsistencias aviso↔realidad: ${ex.inconsistencies}** (debe ser 0).`, `- Estados donde TODAS las tarjetas llevan el aviso: ${ex.statesWhereEveryCardIsWarned}/${ex.openingStates}; estados donde la primera avisa y hay una alternativa sin aviso en pantalla: ${ex.statesWithAnUnwarnedAlternativeBelowAWarnedPrimary}.`, `- Por posición en la lista: ${ex.byRank.map((r) => `#${r.rank}: ${r.meanAvailableHardCounters} counters, ${r.warned}/${r.cards} avisadas`).join(" · ")}.`, `- Primeras tarjetas más frecuentes: ${ex.primaryHeroes.map((h) => `${h.hero} ×${h.openings} (${h.hardCountersAvailable} counters disponibles)`).join(", ")}.`);
  const d1 = o.D1_notEvaluable;
  lines.push("", "## D1 — hueco crítico que no se puede evaluar por falta de capacidades curadas", "", `${d1.note}`, "", `- ${d1.curatedHeroes} héroes con capacidades curadas. En la ventana de cierre (≤2 picks): ${d1.window.states} estados; ${d1.window.withAnUncuratedOwnPick} con un pick propio sin curar (en ${d1.window.gapWithheldByThat} de ellos había un hueco abierto que el producto calla); ${d1.window.cardsOfAnUncuratedHero}/${d1.window.cards} tarjetas de un héroe sin curar; ${d1.window.statesNotFullyEvaluable}/${d1.window.states} estados no totalmente evaluables.`, `- Héroes sin curar que aparecieron en tarjetas (todas las rondas): ${d1.uncuratedHeroesShownOnCards.map((h) => `${h.hero} ×${h.cards}`).join(", ") || "ninguno"}.`, "");
  lines.push("## Cómo reproducir", "", ...identity.reproduce.map((r) => `- \`${r}\``), "");
  return `${lines.join("\n")}\n`;
}

// ---- main -------------------------------------------------------------------------------------------------------------------------------
async function main(): Promise<void> {
  const out = arg("out");
  if (!out || !/^[A-Za-z0-9_]+$/.test(out)) throw new Error("usage: --out=<BASENAME> [--drafts=N]");
  if (existsSync(join(OUT_DIR, `${out}.json`)) || existsSync(join(OUT_DIR, `${out}.md`))) throw new Error(`${out}.{md,json} already exists -- evidence is never overwritten; pass a new --out=`);
  const draftCount = Number(arg("drafts") ?? 60);
  const judgeArg = arg("judge") ?? "t3";
  if (judgeArg !== "t3" && judgeArg !== "t4") throw new Error("--judge must be t3 or t4 (which change is put to the blind read; default t3 keeps older commands reproducible)");
  const judge: JudgeKind = judgeArg;
  if (!Number.isInteger(draftCount) || draftCount < 1 || draftCount > 200) throw new Error("--drafts must be an integer in 1..200");

  const data = loadWorldData();
  const capabilities = new Map(loadHeroCapabilities().map((c) => [c.hero, c]));
  const world: ExamWorld = { legalHeroIds: new Set(data.heroIds), positions: data.heroPositions, counters: data.heroCounters, capabilities };

  muteLog();
  const run = await runExam(data, draftCount);
  unmuteLog();

  const summary = summarize(run.states, world, data.name);
  const judgeFull = judgePacket(run.states, world, data, judge);
  const byRound = (r: number): number => run.states.filter((s) => s.round === r).length;
  const coverage = { drafts: run.drafts, completed: run.completed, decisionPoints: run.states.length, round1: byRound(1), round2: byRound(2), round3: byRound(3), harnessFailures: run.failures.length, harnessBadStatuses: run.badStatuses.length };
  const identity = collectEvidenceIdentity({
    certificationId: out,
    snapshot: { id: data.snapshot.id, live: data.snapshot.live },
    positionsMode: data.positionsMode,
    reproduce: [`bun scripts/p1-exam/exam.ts --out=${out} --drafts=${draftCount}${judge === "t3" ? "" : ` --judge=${judge}`}`],
  });
  // The wall clock is the only non-deterministic field of the identity: dropped so two runs of the same system are byte-identical.
  const { generatedAt: _generatedAt, ...stableIdentity } = identity;
  const report = {
    schema: SCHEMA,
    purpose: "Drafter exam of F1 (TSK-250 .. TSK-255): how the Coach recommends heroes. Measures; changes nothing. PASS technical != strategic improvement.",
    identity: stableIdentity,
    config: { drafts: draftCount, policies: POLICIES, personalPositions: POSITIONS, sides: SIDES, seeds: "AUDIT001.." },
    coverage,
    limitations: [
      "Frozen statistical snapshot labelled 7.41e (label unverified); curated positions/counters are hand-curated. Absolute numbers are comparative baselines, not truth.",
      "The simulated Player follows V3 (follow-coach / varied / deviate); the Enemy Bot is scripted. States are realistic, not human.",
      "The lab saves no team pools, so POOL_SCARCITY cannot fire: the declared-precedence reference reads the session's own pools/occupancy (R2). R1 approximated pools with the Player's personal pool and invented scarcity (found in the TSK-251 T2 run).",
      "I3 'declared precedence' is LivePositionPriorityV1 evaluated offline over the board's own columns; it does not run in the simulator today.",
      "I11 (honest basis) is measured from TSK-254 on; reports written before it had no `basis` field and say so.",
      "I6 has two rulers: `I6_visible` keeps the ORIGINAL definition of every report up to T4_AFTER; `I6_visible_revised` (TSK-254) applies only with every own pick curated and also reads V4 card risks. Their numbers are not comparable; a drop from one to the other is a change of rule, not an improvement.",
      "M1 / exposure / D1 are counts over the simulator's own states (a scripted rival, a frozen snapshot): they say how often a trade-off exists, never whether it hurts a real game. That is the judge's call.",
    ],
    summary,
    judgePacket: withoutKeys(judgeFull),
    harnessFailures: run.failures.slice(0, 20),
  };
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, `${out}.json`), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, `${out}.md`), markdown({ identity, config: report.config, coverage, summary }) + `\n## Paquete del juez\n\nVa aparte, para que quien lo lea no vea la clave de la lectura ciega: \`${out}_JUDGE.md\` (preguntas y situaciones; sin respuestas) y \`${out}_JUDGE_KEY.json\` (qué lado es la regla vieja; **no abrir antes de responder**).\n`);
  writeFileSync(join(OUT_DIR, `${out}_JUDGE.md`), judgeMarkdown(report.judgePacket, out));
  writeFileSync(join(OUT_DIR, `${out}_JUDGE_KEY.json`), `${JSON.stringify({ schema: "engine-p1-judge-key/v1", certificationId: out, keys: blindKeys(judgeFull) }, null, 2)}\n`);

  const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);
  console.log(`[p1-exam] ${coverage.drafts} drafts (${coverage.completed} completed), ${coverage.decisionPoints} decision points -> docs/diagnostics/${out}.{md,json}`);
  console.log(`[p1-exam] latency (not in the artifact): v3 p50/p95 ${percentile(sorted(run.v3Ms), 50).toFixed(0)}/${percentile(sorted(run.v3Ms), 95).toFixed(0)} ms, board ${percentile(sorted(run.boardMs), 50).toFixed(0)}/${percentile(sorted(run.boardMs), 95).toFixed(0)} ms, v4 ${percentile(sorted(run.v4Ms), 50).toFixed(0)}/${percentile(sorted(run.v4Ms), 95).toFixed(0)} ms`);
  if (run.failures.length > 0) console.log(`[p1-exam] harness failures: ${run.failures.length} (first: ${run.failures[0]})`);
}

type JudgePacket = ReturnType<typeof judgePacket>;
type BlindEntry = { opaqueKey: string; answerKey?: { optionAIs: string } };

/** The packet as the reader sees it: the A/B pairs without their `answerKey`. */
function withoutKeys(packet: JudgePacket) {
  const strip = <T extends BlindEntry>(entry: T): Omit<T, "answerKey"> => { const { answerKey: _answerKey, ...rest } = entry; return rest; };
  return { ...packet, changedDecisions: packet.changedDecisions.map(strip), m1Decisions: packet.m1Decisions.map(strip) };
}

function blindKeys(packet: JudgePacket): Record<string, string> {
  return Object.fromEntries([...packet.changedDecisions, ...packet.m1Decisions].map((entry) => [entry.opaqueKey, entry.answerKey.optionAIs]));
}

const BLANK = "_______________";

function judgeMarkdown(packet: ReturnType<typeof withoutKeys>, out: string): string {
  const lines = [
    `# Paquete del juez de F1 — \`${out}\``, "",
    "**Sin respuestas.** Este documento reúne situaciones reales del examen (120 drafts del simulador) para que una persona que sabe de Dota juzgue la **calidad estratégica**, que ningún número del examen puede medir. Nadie rellenó nada por ti.", "",
    "Cómo responder: una respuesta corta por pregunta y, si dices \"dañino\", el motivo de Dota en una frase. \"No sé\" es una respuesta válida. La clave de las lecturas ciegas está en `" + out + "_JUDGE_KEY.json`: ábrela **después** de responder.", "",
    "## Preguntas por componente", ...packet.componentQuestions.map((q) => `- **${q.id}** ${q.text}`), "",
    "## Preguntas de plan", ...packet.planQuestions.map((q) => `- **${q.id}** ${q.text}`), "",
  ];
  lines.push("## Parte 1 — Situaciones (C1–C4 y P1–P3)", "", "Para cada situación: lo que el Coach muestra. Responde C1, C2, C3, C4 (¿bien / mal / no aplica?) y P1, P3.", "");
  for (const point of packet.points) {
    lines.push(`### ${point.opaqueKey} — ${point.coverage}`, "", `Ronda ${point.round} · bans: ${point.bans.join(", ") || "—"} · propios: ${point.ownPicks.join(", ") || "—"} · rivales: ${point.revealedEnemy.join(", ") || "—"}`);
    lines.push(`- Posición recomendada por el board: Pos ${point.boardRecommendedPosition} · la precedencia declarada elegiría: ${point.precedenceWouldPick ?? "—"}`);
    lines.push(`- Top-3 V3: ${point.v3Top3.join(", ")}`);
    for (const [position, heroes] of Object.entries(point.boardTop3ByPosition)) lines.push(`- Board ${position}: ${(heroes as string[]).join(", ")}`);
    lines.push(`- Tarjetas que ve el jugador (Pos ${point.v4ViewedPosition ?? "—"}):`);
    for (const card of point.v4Top3) lines.push(`  - **${card.hero}** — ${card.reason} · base: ${card.basis ?? "—"} · riesgos: ${card.risks.join("; ") || "ninguno"} · counters duros aún disponibles: ${card.hardCountersStillAvailable.join(", ") || "ninguno"}`);
    lines.push("", `Respuestas: C1 ${BLANK} · C2 ${BLANK} · C3 ${BLANK} · C4 ${BLANK} · P1 ${BLANK} · P2 ${BLANK} · P3 ${BLANK}`, `Notas: ${BLANK}`, "");
  }
  const pairs = (title: string, question: string, entries: typeof packet.changedDecisions) => {
    if (entries.length === 0) return;
    lines.push(title, "", question, "");
    for (const d of entries) {
      lines.push(`### ${d.opaqueKey} — Pos ${d.position} · ronda ${d.round}`, "", `bans: ${d.bans.join(", ") || "—"} · propios: ${d.ownPicks.join(", ") || "—"} · rivales: ${d.revealedEnemy.join(", ") || "—"}`, `- A: ${d.optionA.join(", ")}`, `- B: ${d.optionB.join(", ")}`);
      if ("heroEvidence" in d) {
        const evidence = (d as { heroEvidence: Record<string, { fillsTheCriticalGap: boolean; counterVsRevealed: string }> }).heroEvidence;
        for (const [hero, e] of Object.entries(evidence)) lines.push(`  - ${hero}: ${e.fillsTheCriticalGap ? "cubre el hueco crítico" : "no cubre el hueco crítico"} · contrapick vs rivales: ${e.counterVsRevealed}`);
      }
      lines.push("", `Mejor (A / B / equivalente): ${BLANK} · ¿alguna es dañina? motivo de Dota: ${BLANK}`, "");
    }
  };
  pairs(`## Parte 2 — Decisiones cambiadas por ${packet.changedBy} (lectura ciega)`, "¿Cuál de las dos ternas elegirías para esa posición? (A y B no indican cuál es la regla vieja.)", packet.changedDecisions);
  pairs("## Parte 3 — M1: cubrir el hueco crítico frente a un counter adverso (lectura ciega)", "Una de las dos ternas pone primero a un héroe que cubre lo que le falta al equipo aunque pierde el contrapick contra un rival ya visible. ¿Cuál elegirías? ¿Cubrir el hueco compensa perder el matchup?", packet.m1Decisions);
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) await main();
