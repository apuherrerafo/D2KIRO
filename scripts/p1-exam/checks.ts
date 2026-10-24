// F1 / TSK-250 -- pure mechanical checks of the "drafter exam" (plan v2, table C). No I/O, no engine calls, no clock: every function
// takes a compact `ExamState` observed from the real simulator path (V3 + V4 + Team Coach Board) and the curated world data, and
// returns counts/violations. Tests feed inline fixtures (invariantes.md: no test reads curated data).
//
// Three kinds of result, never mixed:
//   HARD         a violation is a defect (I1, I2, I3-conformity, I6-visible, I9-visible, I11)
//   OBSERVATION  a number to look at, not a law (I4, I5, I7, I8, I10, concentration)
//   NOT_MEASURABLE  the thing the invariant needs does not exist in the system yet (reported honestly, never as PASS)
import type { DraftState, HeroId } from "../../apps/engine/src/draft/reducer";
import { assessCompositionNeeds, criticalPressure, unfilledCriticalGaps, type CompositionNeeds } from "../../apps/engine/src/draft-paths/gaps";
import type { HeroCapabilities } from "../../apps/engine/src/draft-paths/types";
import type { CuratedCounter } from "../../apps/engine/src/signals/hero-counters";
import { isCandidateAdmittedForPosition, isCredibleForPosition, type HeroPositions } from "../../apps/engine/src/signals/hero-positions";

export type Pos = 1 | 2 | 3 | 4 | 5;

export interface ExamColumn {
  position: Pos;
  /** RANKED | UNRANKED_POSITIONAL | UNAVAILABLE | FILLED | WAITING (the board's own vocabulary). */
  state: string;
  eligibleNow: boolean;
  /** Primary first, then the position's own ranking. */
  top: { heroId: HeroId; reason: string }[];
}

/** What the exam keeps of a V4 card. `basis` / `risks` are null / empty on reports written before TSK-254. */
export interface ExamV4Card {
  heroId: HeroId;
  rationale: string;
  basis: { kind: string; sources: { kind: string; sampleSize: number | null }[] } | null;
  risks: { kind: string; detail: string; heroIds: HeroId[] }[];
}

export interface ExamState {
  draftKey: string;
  index: number;
  round: 1 | 2 | 3 | null;
  ownPicksRemaining: number;
  banned: HeroId[];
  ownPicks: HeroId[];
  revealedEnemy: HeroId[];
  /** V3 team shortlist (what the older surface shows), in order. */
  v3: { heroId: HeroId; rationale: string }[];
  v3PrimaryRationale: string;
  board: { recommendedPosition: Pos | null; targetBasis: string | null; columns: ExamColumn[] } | null;
  v4: { kind: string; targetPosition: Pos | null; /** The position the cards belong to (== target unless the Player opens on their own position). */ viewedPosition: Pos | null; targetBasis: string | null; state: string | null; cards: ExamV4Card[] } | null;
  /** Counterfactual: what LivePositionPriorityV1 WOULD pick over the same columns (it does not run in the simulator today). */
  lpp: { position: Pos; basis: string; signal: string } | null;
  /** Covariance share of `position_fit` in the spread of V6's score among the candidates the recommended column keeps; null when undefined. */
  positionFitShare: number | null;
  /** Mean of position_fit.weighted / score over those same candidates (how much of the score LEVEL is position_fit). */
  positionFitLevelShare: number | null;
  /** Fraction of those candidates whose position_fit raw is saturated at 1 (then it adds the same constant to all of them). */
  positionFitSaturated: number | null;
  /** How many candidates those numbers were computed over. */
  candidateCount: number;
  /** TSK-252: the WHOLE credible field of the recommended column scored by V6 (peeled past the TOP_N cut); null when there is no recommended column. */
  positionFitField: FieldCandidate[] | null;
  /** TSK-252: the same column scored under each `position_fit` rule at THIS state, to compare the rules on identical decisions. */
  positionFitPaired: { volume: FieldCandidate[]; credibleMedian: FieldCandidate[] } | null;
  /** TSK-253: the same column scored with the legacy `team_synergy` (`flat`) and with the stage-aware one (`closing`); both with `credible-median`. */
  teamNeedsPaired: { flat: FieldCandidate[]; closing: FieldCandidate[] } | null;
}

export interface ExamWorld {
  legalHeroIds: ReadonlySet<HeroId>;
  positions: HeroPositions;
  counters: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  capabilities: ReadonlyMap<HeroId, HeroCapabilities>;
}

const unavailable = (state: ExamState): Set<HeroId> => new Set<HeroId>([...state.banned, ...state.ownPicks, ...state.revealedEnemy]);

/** Everything the Player is shown as a hero suggestion in this state, with where it came from. */
function shownHeroes(state: ExamState): { source: string; heroId: HeroId }[] {
  const shown = state.v3.map((card) => ({ source: "v3", heroId: card.heroId }));
  for (const column of state.board?.columns ?? []) for (const candidate of column.top) shown.push({ source: `board:pos${column.position}`, heroId: candidate.heroId });
  for (const card of state.v4?.cards ?? []) shown.push({ source: "v4", heroId: card.heroId });
  return shown;
}

const where = (state: ExamState): string => `${state.draftKey}#${state.index}`;

// ---- I1: nothing illegal --------------------------------------------------------------------------------------------------------
export function i1Illegal(state: ExamState, world: ExamWorld): string[] {
  const taken = unavailable(state);
  const found: string[] = [];
  for (const { source, heroId } of shownHeroes(state)) {
    if (taken.has(heroId)) found.push(`${where(state)} ${source}: hero ${heroId} is banned/picked`);
    else if (!world.legalHeroIds.has(heroId)) found.push(`${where(state)} ${source}: hero ${heroId} does not exist`);
  }
  const lists: [string, HeroId[]][] = [["v3", state.v3.map((c) => c.heroId)], ...(state.board?.columns ?? []).map((c): [string, HeroId[]] => [`board:pos${c.position}`, c.top.map((t) => t.heroId)])];
  for (const [source, ids] of lists) if (new Set(ids).size !== ids.length) found.push(`${where(state)} ${source}: duplicate hero inside one list`);
  return found;
}

// ---- I2: role feasibility -------------------------------------------------------------------------------------------------------
/** Every RANKED column's candidates are admitted for THAT column's position, and no hero is the primary of two positions. */
export function i2Roles(state: ExamState, world: ExamWorld): string[] {
  const found: string[] = [];
  const primaries = new Map<HeroId, Pos>();
  for (const column of state.board?.columns ?? []) {
    if (column.state !== "RANKED") continue;
    column.top.forEach((candidate, rank) => {
      if (!isCandidateAdmittedForPosition(candidate.heroId, column.position, world.positions)) found.push(`${where(state)} board:pos${column.position}: hero ${candidate.heroId} has no curated evidence for that position`);
      if (rank === 0) {
        const other = primaries.get(candidate.heroId);
        if (other !== undefined) found.push(`${where(state)} hero ${candidate.heroId} is the primary of pos${other} and pos${column.position}`);
        primaries.set(candidate.heroId, column.position);
      }
    });
  }
  const v4 = state.v4;
  const cardsPosition = v4 ? (v4.viewedPosition ?? v4.targetPosition) : null;
  if (v4 && v4.state === "RANKED" && cardsPosition !== null) {
    for (const card of v4.cards) if (!isCandidateAdmittedForPosition(card.heroId, cardsPosition, world.positions)) found.push(`${where(state)} v4: hero ${card.heroId} has no curated evidence for pos${cardsPosition}`);
  }
  return found;
}

/** OBSERVATION: board candidates admitted at their column (I2) but not CREDIBLE there (neither dominant nor >= the approved share). */
export function notCredibleShown(state: ExamState, world: ExamWorld): string[] {
  const found: string[] = [];
  for (const column of state.board?.columns ?? []) {
    if (column.state !== "RANKED") continue;
    for (const candidate of column.top) if (!isCredibleForPosition(candidate.heroId, column.position, world.positions)) found.push(`${where(state)} board:pos${column.position}: hero ${candidate.heroId}`);
  }
  return found;
}

// ---- I3: position order (conformity + the plan's hypothesis) --------------------------------------------------------------------
export interface I3Result {
  /** HARD (conformity): the suggested target is not what the declared precedence (LPP) would choose. */
  divergences: string[];
  /** HARD (conformity): an open column the Player may pick for is not ranked. */
  unrankedOpenColumns: string[];
  /** OBSERVATION: first own decision of round 1 recommends Pos 1/2 with no COUNTER_WINDOW/POOL_SCARCITY behind it. */
  coreFirstWithoutWindow: boolean | null;
  /** HARD: a PHASE_FALLBACK presented as STRATEGIC. */
  phasePresentedAsStrategic: boolean;
}

export function i3Order(state: ExamState): I3Result {
  const divergences: string[] = [];
  const unrankedOpenColumns: string[] = [];
  const board = state.board;
  if (board && board.recommendedPosition !== null && state.lpp && state.lpp.position !== board.recommendedPosition) {
    divergences.push(`${where(state)} board recommends pos${board.recommendedPosition} (${board.targetBasis}); declared precedence (LPP/${state.lpp.signal}) would pick pos${state.lpp.position}`);
  }
  for (const column of board?.columns ?? []) if (column.eligibleNow && column.state !== "RANKED") unrankedOpenColumns.push(`${where(state)} pos${column.position} is open but ${column.state}`);
  const firstOfRound1 = state.round === 1 && state.ownPicks.length === 0;
  const coreFirstWithoutWindow = firstOfRound1 && board?.recommendedPosition ? (board.recommendedPosition === 1 || board.recommendedPosition === 2) && !(state.lpp && (state.lpp.signal === "COUNTER_WINDOW" || state.lpp.signal === "POOL_SCARCITY")) : null;
  return { divergences, unrankedOpenColumns, coreFirstWithoutWindow, phasePresentedAsStrategic: board?.targetBasis === "STRATEGIC" && state.lpp?.basis === "PHASE_FALLBACK" };
}

// ---- I6: composition gap at the closing picks -----------------------------------------------------------------------------------
const GAP_WORDS = /initiat|iniciaci|catch|captur/i;

export interface I6Result {
  applies: boolean;
  /** Top-3 of the V3 shortlist contains a hero with initiation or catch. */
  top3Fills: boolean;
  /** A hero with initiation/catch exists somewhere in the credible set the Player is shown (V3 shortlist + every board column). */
  credibleFillerExists: boolean;
  /** HARD (I6-visible): the gap is open and nothing on the Player's cards says so. */
  gapNotVisible: boolean;
}

/**
 * I6 has two DEFINITIONS and their numbers are not comparable with each other:
 *  - "original" (T2..T4_AFTER): an own pick without curated capabilities counts as lacking, and only V3/board texts can make the gap visible.
 *  - "revised" (T5, TSK-254): the gap applies only when EVERY own pick is curated, and a V4 card risk text also makes it visible.
 * The revised rule shrinks the denominator (2 -> 0 states on the same seeds), so a drop from original to revised is a change of ruler, not an improvement.
 */
export type I6Definition = "original" | "revised";

export function i6Gap(state: ExamState, world: ExamWorld, definition: I6Definition = "revised"): I6Result {
  const fills = (hero: HeroId): boolean => { const c = world.capabilities.get(hero); return c !== undefined && (c.hasInitiation || c.hasCatch); };
  // TSK-254: an own pick without curated capabilities is unknown, not "lacking" -- the gap is not established, so nothing is owed to the Player
  // (the same rule as the engine's critical gap and as I6b). Before T5 this made the exam flag 2 states that the product rightly leaves silent.
  const allCurated = definition === "original" || state.ownPicks.every((hero) => world.capabilities.has(hero));
  const applies = state.ownPicksRemaining <= 2 && state.ownPicks.length >= 3 && allCurated && !state.ownPicks.some(fills);
  if (!applies) return { applies: false, top3Fills: false, credibleFillerExists: false, gapNotVisible: false };
  const credible = new Set<HeroId>([...state.v3.map((c) => c.heroId), ...(state.board?.columns ?? []).flatMap((c) => c.top.map((t) => t.heroId))]);
  const texts = [state.v3PrimaryRationale, ...state.v3.map((c) => c.rationale), ...(state.board?.columns ?? []).flatMap((c) => c.top.map((t) => t.reason)), ...(definition === "revised" ? (state.v4?.cards ?? []).flatMap((c) => c.risks.map((r) => r.detail)) : [])];
  return { applies, top3Fills: state.v3.slice(0, 3).some((c) => fills(c.heroId)), credibleFillerExists: [...credible].some(fills), gapNotVisible: !texts.some((text) => GAP_WORDS.test(text)) };
}

// ---- I7: damage mix -------------------------------------------------------------------------------------------------------------
export interface I7Result { applies: boolean; top3Diversifies: boolean }

export function i7Damage(state: ExamState, world: ExamWorld): I7Result {
  const types = state.ownPicks.map((hero) => world.capabilities.get(hero)?.damageType).filter((t): t is NonNullable<typeof t> => t !== undefined);
  const dominant = types[0];
  const applies = state.ownPicks.length >= 4 && types.length >= 4 && (dominant === "physical" || dominant === "magical") && types.every((t) => t === dominant);
  if (!applies) return { applies: false, top3Diversifies: false };
  return { applies, top3Diversifies: state.v3.slice(0, 3).some((c) => { const t = world.capabilities.get(c.heroId)?.damageType; return t !== undefined && t !== dominant; }) };
}

// ---- I9: hard counters shown ----------------------------------------------------------------------------------------------------
const RISK_WORDS = /countere|contrarrest|riesgo|expuest|vulnerab|te gana|le gana|débil contra|debil contra/i;

export function hardCounteredBy(hero: HeroId, enemies: readonly HeroId[], counters: ReadonlyMap<HeroId, readonly CuratedCounter[]>): HeroId[] {
  const entries = counters.get(hero) ?? [];
  return enemies.filter((enemy) => entries.some((entry) => entry.vs === enemy && entry.level === "hard"));
}

export interface I9Result {
  /** Hard-countered heroes inside a top-3 (V3 shortlist or any board column), each with whether the card states the risk. */
  shown: { where: string; heroId: HeroId; by: HeroId[]; riskVisible: boolean }[];
}

export function i9Counters(state: ExamState, world: ExamWorld): I9Result {
  const shown: I9Result["shown"] = [];
  const consider = (source: string, heroId: HeroId, text: string): void => {
    const by = hardCounteredBy(heroId, state.revealedEnemy, world.counters);
    if (by.length > 0) shown.push({ where: `${where(state)} ${source}`, heroId, by, riskVisible: RISK_WORDS.test(text) });
  };
  state.v3.slice(0, 3).forEach((card) => consider("v3", card.heroId, card.rationale));
  for (const column of state.board?.columns ?? []) column.top.slice(0, 3).forEach((c) => consider(`board:pos${column.position}`, c.heroId, c.reason));
  return { shown };
}

// ---- I8: exposure of the round-1 primary ----------------------------------------------------------------------------------------
/** Hard counters still available (not banned/picked) against `hero`. */
export function availableHardCounters(hero: HeroId, state: ExamState, world: ExamWorld): number {
  const taken = unavailable(state);
  return (world.counters.get(hero) ?? []).filter((entry) => entry.level === "hard" && !taken.has(entry.vs)).length;
}

// ---- I10: popularity -----------------------------------------------------------------------------------------------------------
/** Is `hero` in the more-played half of the heroes with curated evidence at `position`? */
export function inMorePlayedHalf(hero: HeroId, position: Pos, positions: HeroPositions): boolean | null {
  const rows: { hero: number; matches: number }[] = [];
  for (const [id, shares] of Object.entries(positions)) {
    const share = shares.find((s) => s.position === position);
    if (share) rows.push({ hero: Number(id), matches: share.matches });
  }
  if (rows.length === 0) return null;
  rows.sort((a, b) => b.matches - a.matches || a.hero - b.hero);
  const rank = rows.findIndex((row) => row.hero === hero);
  if (rank < 0) return null;
  return rank < Math.ceil(rows.length / 2);
}

// ---- I4: reactivity -------------------------------------------------------------------------------------------------------------
export function jaccard(a: readonly number[], b: readonly number[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  let common = 0;
  for (const value of left) if (right.has(value)) common += 1;
  return common / (left.size + right.size - common);
}

/** Mean pairwise Jaccard of the given top-N lists (null with fewer than 2 lists). */
export function meanPairwiseJaccard(lists: readonly (readonly number[])[]): number | null {
  if (lists.length < 2) return null;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < lists.length; i += 1) for (let j = i + 1; j < lists.length; j += 1) { sum += jaccard(lists[i]!, lists[j]!); pairs += 1; }
  return sum / pairs;
}

// ---- I5: how much of the score's spread is position_fit ------------------------------------------------------------------------
/** cov(part, total) / var(total): the additive share of the total's variance that `part` accounts for. null when the total does not vary. */
export function varianceShare(part: readonly number[], total: readonly number[]): number | null {
  if (part.length !== total.length || total.length < 2) return null;
  const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mp = mean(part);
  const mt = mean(total);
  let cov = 0;
  let variance = 0;
  for (let i = 0; i < total.length; i += 1) { cov += (part[i]! - mp) * (total[i]! - mt); variance += (total[i]! - mt) ** 2; }
  return variance === 0 ? null : cov / variance;
}

export const mean = (xs: readonly number[]): number | null => (xs.length === 0 ? null : xs.reduce((s, x) => s + x, 0) / xs.length);
export const rate = (hits: number, total: number): number | null => (total === 0 ? null : hits / total);

// ---- I5-field: position_fit over the WHOLE credible field, not only the TOP_N that V6 keeps -----------------------------------------
// TSK-252. The original I5 (above) is computed among the ~6 candidates V6 returns, so it cannot see the selection `position_fit` already
// made by deciding who survives the cut. Here the exam peels V6 (re-asking with the heroes already returned excluded) until the whole
// credible field of the column is scored, and these pure functions read that field.

/** One credible candidate of the recommended column, scored by V6 in the state. `matches` is the hero's recorded matches AT that position. */
export interface FieldCandidate {
  heroId: HeroId;
  /** V6 score (0..100). */
  score: number;
  /** `position_fit.weighted` inside that score. */
  positionFit: number;
  /** The hero's recorded matches at the target position (formula-independent popularity). */
  matches: number;
  /** TSK-255 (M1): the `counter` signal V6 read for this hero in this state; null/absent when the signal did not exist. */
  counter?: FieldCounter | null;
}

/** The part of V6's `counter` signal the M1 measurement needs. `raw` is null when there is not enough data (never a made-up 0). */
export interface FieldCounter {
  raw: number | null;
  weighted: number;
  /** Games behind the statistical layer (0 when only curated/ban-relief evidence spoke). */
  sampleSize: number;
  /** The signal quoted evidence about a REVEALED enemy (not just ban relief). */
  vsRevealed: boolean;
}

export interface FieldStats {
  fieldSize: number;
  /** Fraction of the top-3 / top-6 (by V6 score) that sit in the more-played half of the field by matches; a fair ranking would be ~0.5. */
  top3MorePlayed: number;
  top6MorePlayed: number;
  /** Share of the score's variance that `position_fit` explains over the whole field (null when the score does not vary). */
  orderShareField: number | null;
  /** The same, among ONLY the more-played half of the field: is the order inside the popular half decided by volume or by the draft? */
  orderShareMorePlayedHalf: number | null;
  /** Jaccard between the real top-k and the top-k of the same score with `position_fit`'s contribution removed: 1 = it decides nothing. */
  top3WithoutPositionFit: number;
  top6WithoutPositionFit: number;
}

const topIds = (items: readonly FieldCandidate[], key: (c: FieldCandidate) => number, k: number): HeroId[] =>
  [...items].sort((a, b) => key(b) - key(a) || a.heroId - b.heroId).slice(0, k).map((c) => c.heroId);

/** Pure; needs at least 6 candidates (otherwise null: a column too thin to say anything about a cut at 6). */
export function fieldStats(field: readonly FieldCandidate[]): FieldStats | null {
  if (field.length < 6) return null;
  const byMatches = [...field].sort((a, b) => b.matches - a.matches || a.heroId - b.heroId);
  const morePlayed = new Set(byMatches.slice(0, Math.ceil(field.length / 2)).map((c) => c.heroId));
  const popularHalf = field.filter((c) => morePlayed.has(c.heroId));
  const share = (ids: readonly HeroId[]): number => ids.filter((id) => morePlayed.has(id)).length / ids.length;
  const real3 = topIds(field, (c) => c.score, 3);
  const real6 = topIds(field, (c) => c.score, 6);
  const rest = (c: FieldCandidate): number => c.score - c.positionFit;
  return {
    fieldSize: field.length,
    top3MorePlayed: share(real3),
    top6MorePlayed: share(real6),
    orderShareField: varianceShare(field.map((c) => c.positionFit), field.map((c) => c.score)),
    orderShareMorePlayedHalf: varianceShare(popularHalf.map((c) => c.positionFit), popularHalf.map((c) => c.score)),
    top3WithoutPositionFit: jaccard(real3, topIds(field, rest, 3)),
    top6WithoutPositionFit: jaccard(real6, topIds(field, rest, 6)),
  };
}

/** Two rankings of the SAME state's credible field (old rule vs new rule): did the top change, and how far did it move toward the less played? */
export interface PairedChange {
  top3Same: boolean;
  jaccard3: number;
  jaccard6: number;
  entered3: HeroId[];
  left3: HeroId[];
  /** Mean matches of the top-3 under each rule (a drop means the new top leans on less volume). */
  meanMatchesTop3Old: number;
  meanMatchesTop3New: number;
}

export function pairedChange(oldField: readonly FieldCandidate[], newField: readonly FieldCandidate[]): PairedChange | null {
  if (oldField.length < 6 || newField.length < 6) return null;
  const score = (c: FieldCandidate): number => c.score;
  const old3 = topIds(oldField, score, 3);
  const new3 = topIds(newField, score, 3);
  const matchesOf = (field: readonly FieldCandidate[], ids: readonly HeroId[]): number => ids.reduce((sum, id) => sum + (field.find((c) => c.heroId === id)?.matches ?? 0), 0) / ids.length;
  return {
    top3Same: old3.length === new3.length && old3.every((id) => new3.includes(id)),
    jaccard3: jaccard(old3, new3),
    jaccard6: jaccard(topIds(oldField, score, 6), topIds(newField, score, 6)),
    entered3: new3.filter((id) => !old3.includes(id)),
    left3: old3.filter((id) => !new3.includes(id)),
    meanMatchesTop3Old: matchesOf(oldField, old3),
    meanMatchesTop3New: matchesOf(newField, new3),
  };
}

/**
 * What a top-3 does against the enemies the Player can SEE (curated layer only): `counters` = heroes of the top-3 that hard-counter at least one
 * revealed enemy (the offensive reason to pick them); `exposed` = heroes of the top-3 that a revealed enemy hard-counters. Pure.
 */
export function revealedCounterProfile(top3: readonly HeroId[], revealedEnemy: readonly HeroId[], counters: ReadonlyMap<HeroId, readonly CuratedCounter[]>): { counters: number; exposed: number } {
  const countersAnEnemy = (hero: HeroId): boolean => revealedEnemy.some((enemy) => (counters.get(enemy) ?? []).some((entry) => entry.vs === hero && entry.level === "hard"));
  return {
    counters: top3.filter(countersAnEnemy).length,
    exposed: top3.filter((hero) => hardCounteredBy(hero, revealedEnemy, counters).length > 0).length,
  };
}

/** The top-3 of a scored field, by score (ties by hero id): the same cut every other field helper uses. */
export const topThree = (field: readonly FieldCandidate[]): HeroId[] => topIds(field, (c) => c.score, 3);

/**
 * Is the cut of the top-`k` decided by an exact tie? When the k-th and the (k+1)-th have the same score, which one is shown falls to the hero-id
 * tie-break, not to the draft -- a rule that saturates many heroes at the same `position_fit` can create exactly that.
 */
export function tiedAtCut(field: readonly FieldCandidate[], k: number): boolean | null {
  if (field.length <= k) return null;
  const sorted = [...field].sort((a, b) => b.score - a.score || a.heroId - b.heroId);
  return Math.abs(sorted[k - 1]!.score - sorted[k]!.score) < 1e-9;
}

// ---- T4 (TSK-253): the team's critical gaps, and what a top-3 does about them ---------------------------------------------------
// `needs` is read from the STATE (own picks + picks left + the curated capabilities), not from the code under test's scoring: the same
// `assessCompositionNeeds` the product exposes, applied to what the Player has actually picked.

/** The Player's team as the engine's own `DraftState` reads it (only `localSide` and `picks` are looked at by the gap functions). */
const ownTeamState = (ownPicks: readonly HeroId[]): DraftState => ({ localSide: "radiant", picks: { radiant: [...ownPicks], dire: [] } }) as unknown as DraftState;

export function examNeeds(state: ExamState, world: ExamWorld): CompositionNeeds {
  return assessCompositionNeeds(ownTeamState(state.ownPicks), [...world.capabilities.values()], state.ownPicksRemaining);
}

/** An open gap that was NOT declared critical only because an own pick has no curated capabilities (unknown is not "lacking"). */
export function criticalWithheldByUncuratedPick(state: ExamState, world: ExamWorld): boolean {
  const needs = examNeeds(state, world);
  const inWindow = state.ownPicksRemaining >= 1 && state.ownPicksRemaining <= 2;
  return inWindow && needs.critical.length === 0 && state.ownPicks.some((hero) => !world.capabilities.has(hero)) && needs.open.some((gap) => gap === "initiation" || gap === "catch" || gap === "damage_mix");
}

/** Does this hero fill at least one of the team's critical gaps? Unknown capabilities fill nothing (and are never counted as lacking either). */
export function fillsCritical(hero: HeroId, needs: CompositionNeeds, world: ExamWorld): boolean {
  const capability = world.capabilities.get(hero);
  if (capability === undefined || needs.critical.length === 0) return false;
  return unfilledCriticalGaps(capability, needs).length < needs.critical.length;
}

export interface NeedsChange {
  top3Same: boolean;
  entered3: HeroId[];
  left3: HeroId[];
  /** Heroes of the top-3 that fill a critical gap, under the legacy rule and under the stage-aware one. */
  top3FillersFlat: number;
  top3FillersClosing: number;
  /** A filler exists somewhere in the credible field of the column. */
  fillerInField: boolean;
  /** What the swap costs under the LEGACY score: mean flat score of the flat top-3 vs of the closing top-3 (a hero not in the flat field counts as the field's lowest). */
  meanFlatScoreOfFlatTop3: number;
  meanFlatScoreOfClosingTop3: number;
  meanMatchesTop3Flat: number;
  meanMatchesTop3Closing: number;
}

/** Same state, same credible field, legacy `team_synergy` vs stage-aware: did the top-3 move, did it move toward what the team critically lacks, and what did it give up. */
export function needsChange(flat: readonly FieldCandidate[], closing: readonly FieldCandidate[], needs: CompositionNeeds, world: ExamWorld): NeedsChange | null {
  if (flat.length < 6 || closing.length < 6) return null;
  const flat3 = topThree(flat);
  const closing3 = topThree(closing);
  const flatScore = (id: HeroId): number => flat.find((c) => c.heroId === id)?.score ?? Math.min(...flat.map((c) => c.score));
  const matchesIn = (field: readonly FieldCandidate[], ids: readonly HeroId[]): number => ids.reduce((sum, id) => sum + (field.find((c) => c.heroId === id)?.matches ?? 0), 0) / ids.length;
  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  return {
    top3Same: flat3.length === closing3.length && flat3.every((id) => closing3.includes(id)),
    entered3: closing3.filter((id) => !flat3.includes(id)),
    left3: flat3.filter((id) => !closing3.includes(id)),
    top3FillersFlat: flat3.filter((id) => fillsCritical(id, needs, world)).length,
    top3FillersClosing: closing3.filter((id) => fillsCritical(id, needs, world)).length,
    fillerInField: closing.some((c) => fillsCritical(c.heroId, needs, world)),
    meanFlatScoreOfFlatTop3: mean(flat3.map(flatScore)),
    meanFlatScoreOfClosingTop3: mean(closing3.map(flatScore)),
    meanMatchesTop3Flat: matchesIn(flat, flat3),
    meanMatchesTop3Closing: matchesIn(closing, closing3),
  };
}

// ---- I6b: INITIATION on its own (TSK-253). The original I6 asks for "initiation OR catch": 69% of curated heroes have one of the two, so that
// union is almost never missing and the exam could not see the gap that does occur. Kept as a separate measure so I6 stays comparable with older reports.
export interface I6bResult { applies: boolean; top3Fills: boolean; fillerInField: boolean }

export function i6bInitiation(state: ExamState, world: ExamWorld): I6bResult {
  const hasInitiation = (hero: HeroId): boolean => world.capabilities.get(hero)?.hasInitiation === true;
  const allCurated = state.ownPicks.every((hero) => world.capabilities.has(hero));
  const applies = state.ownPicksRemaining >= 1 && state.ownPicksRemaining <= 2 && state.ownPicks.length >= 3 && allCurated && !state.ownPicks.some(hasInitiation);
  if (!applies) return { applies: false, top3Fills: false, fillerInField: false };
  const column = state.board?.columns.find((c) => c.position === state.board?.recommendedPosition);
  return {
    applies,
    top3Fills: (column?.top ?? []).slice(0, 3).some((t) => hasInitiation(t.heroId)),
    fillerInField: (state.positionFitField ?? []).some((c) => hasInitiation(c.heroId)),
  };
}

// ---- T5 (TSK-254): CRITICAL_GAP on the cards, and the honesty of `basis` (I11) ----------------------------------------------------
// Both read the card the Player sees (`?format=v4`) against the STATE (own picks, picks left, curated capabilities), never against the
// scoring: the card is only read-only evidence.

export interface CriticalGapCardResult {
  /** Cards carrying CRITICAL_GAP. */
  shown: number;
  /** HARD: a CRITICAL_GAP card that is not demonstrable (gap not critical, a pick or the hero uncurated, or the hero fills it). */
  shownWithoutProof: string[];
  /** HARD: a demonstrable gap (curated hero, critical gap, not filled) whose card does not carry CRITICAL_GAP. */
  missingOnCard: string[];
  /** Cards of a curated hero that fills / of an uncurated hero while the gap is critical: the risk must NOT be there (counted, for the report). */
  cardsInCriticalStates: number;
}

export function criticalGapOnCards(state: ExamState, world: ExamWorld): CriticalGapCardResult {
  const result: CriticalGapCardResult = { shown: 0, shownWithoutProof: [], missingOnCard: [], cardsInCriticalStates: 0 };
  const needs = examNeeds(state, world);
  for (const card of state.v4?.cards ?? []) {
    const capability = world.capabilities.get(card.heroId);
    const demonstrable = needs.critical.length > 0 && capability !== undefined && unfilledCriticalGaps(capability, needs).length > 0;
    const carries = card.risks.some((risk) => risk.kind === "CRITICAL_GAP");
    if (needs.critical.length > 0) result.cardsInCriticalStates += 1;
    if (carries) result.shown += 1;
    if (carries && !demonstrable) result.shownWithoutProof.push(`${where(state)} hero ${card.heroId}`);
    if (demonstrable && !carries) result.missingOnCard.push(`${where(state)} hero ${card.heroId}`);
  }
  return result;
}

export interface I11Result {
  cards: number;
  /** HARD: the basis is missing, incoherent, or contradicts what the reason claims. */
  violations: string[];
  kinds: Record<string, number>;
  /** OBSERVATION: a statistical source whose sample is not known (shown as "estadística", never with a made-up n). */
  statisticalWithoutSample: number;
}

const QUOTES_A_STATISTIC = /\d+\s*(partidas|games)|\d+(?:[.,]\d+)?\s*%/i;
const CLAIMS_A_CAPABILITY = /^Aporta\b/;

export function i11Basis(state: ExamState): I11Result {
  const result: I11Result = { cards: 0, violations: [], kinds: {}, statisticalWithoutSample: 0 };
  for (const card of state.v4?.cards ?? []) {
    result.cards += 1;
    const at = `${where(state)} hero ${card.heroId}`;
    const basis = card.basis;
    if (basis === null || basis.sources.length === 0) { result.violations.push(`${at}: no basis`); continue; }
    result.kinds[basis.kind] = (result.kinds[basis.kind] ?? 0) + 1;
    const kinds = basis.sources.map((source) => source.kind);
    if (new Set(kinds).size !== kinds.length) result.violations.push(`${at}: a kind is repeated inside the basis`);
    if (basis.kind !== (basis.sources.length === 1 ? kinds[0] : "mixed")) result.violations.push(`${at}: basis.kind ${basis.kind} does not follow its sources`);
    for (const source of basis.sources) {
      if (source.kind !== "statistical" && source.sampleSize !== null) result.violations.push(`${at}: a ${source.kind} source claims a sample`);
      if (source.kind === "statistical" && source.sampleSize === null) result.statisticalWithoutSample += 1;
    }
    if (CLAIMS_A_CAPABILITY.test(card.rationale) && !kinds.includes("curated")) result.violations.push(`${at}: the reason claims a capability but the basis is not curated`);
    if (QUOTES_A_STATISTIC.test(card.rationale) && !kinds.includes("statistical")) result.violations.push(`${at}: the reason quotes a statistic but the basis is not statistical`);
  }
  return result;
}

// ---- T6 (TSK-255): M1, exposure of round 1 and D1 (a gap that cannot be evaluated) -------------------------------------------------------
// All three read the states the exam already captured; none scores, re-ranks or changes the engine.

/** What counts as an "adverse statistical counter" in M1. Three fixed thresholds, reported side by side so no single cut-off is chosen after seeing the result. */
export interface M1Threshold { label: string; adverseRaw: number; minGames: number }
export const M1_THRESHOLDS: readonly M1Threshold[] = [
  { label: "raw<=-0.03 y n>=30", adverseRaw: 0.03, minGames: 30 },
  { label: "raw<=-0.05 y n>=30", adverseRaw: 0.05, minGames: 30 },
  { label: "raw<=-0.075 y n>=100", adverseRaw: 0.075, minGames: 100 },
];

const sortedByScore = (field: readonly FieldCandidate[]): FieldCandidate[] => [...field].sort((a, b) => b.score - a.score || a.heroId - b.heroId);
const isAdverse = (candidate: FieldCandidate | undefined, threshold: M1Threshold): boolean => {
  const counter = candidate?.counter;
  return counter !== undefined && counter !== null && counter.vsRevealed && counter.raw !== null && counter.raw <= -threshold.adverseRaw && counter.sampleSize >= threshold.minGames;
};

export interface M1Tension {
  /** The pressure the engine applied (`criticalPressure`): 1 = the team has no picks left to wait on the critical gap. */
  pressure: number;
  round: number | null;
  ownPicksRemaining: number;
  /** The stage-aware rule put a hero that fills a critical gap in FIRST place, where the legacy rule had somebody else. */
  promoted: boolean;
  promotedHero: HeroId;
  displacedHero: HeroId;
  /** The promoted hero has an adverse STATISTICAL counter against a revealed enemy (and no curated hard counter, which RB-4 already demotes). */
  promotedAdverse: boolean;
  /** The promoted hero is hard-countered (curated) by a revealed enemy: the product demotes it afterwards (RB-4), so it is not a harm of M1. */
  promotedHardCountered: boolean;
  /** The displaced hero's counter against the revealed enemies is known and not negative. */
  displacedNeutralOrBetter: boolean;
  promotedCounterRaw: number | null;
  promotedGames: number;
  displacedCounterRaw: number | null;
  /** Score points the promoted hero leads by under the stage-aware rule. */
  scoreLead: number;
  /** Kinds of risk the promoted hero's V4 card carries; null when that hero is not on the cards (another column). */
  promotedCardRisks: string[] | null;
}

/** M1 on one state: null when it does not apply (no critical gap in the window, no revealed enemy, or the paired fields are too small). */
export function m1Tension(state: ExamState, world: ExamWorld, threshold: M1Threshold): M1Tension | null {
  const paired = state.teamNeedsPaired;
  if (paired === null || state.revealedEnemy.length === 0) return null;
  const needs = examNeeds(state, world);
  if (needs.critical.length === 0 || paired.flat.length < 6 || paired.closing.length < 6) return null;
  const closing = sortedByScore(paired.closing);
  const flat = sortedByScore(paired.flat);
  const top = closing[0]!;
  const was = flat[0]!;
  const promoted = top.heroId !== was.heroId && fillsCritical(top.heroId, needs, world);
  const hardCountered = hardCounteredBy(top.heroId, state.revealedEnemy, world.counters).length > 0;
  const displacedCounter = was.counter;
  const card = state.v4?.cards.find((c) => c.heroId === top.heroId);
  return {
    pressure: criticalPressure(needs), round: state.round, ownPicksRemaining: state.ownPicksRemaining, promoted, promotedHero: top.heroId, displacedHero: was.heroId,
    promotedAdverse: isAdverse(top, threshold) && !hardCountered, promotedHardCountered: hardCountered,
    displacedNeutralOrBetter: displacedCounter !== undefined && displacedCounter !== null && displacedCounter.vsRevealed && displacedCounter.raw !== null && displacedCounter.raw >= 0,
    promotedCounterRaw: top.counter?.raw ?? null, promotedGames: top.counter?.sampleSize ?? 0, displacedCounterRaw: was.counter?.raw ?? null,
    scoreLead: top.score - (closing.find((c) => c.heroId === was.heroId)?.score ?? top.score),
    promotedCardRisks: card === undefined ? null : card.risks.map((risk) => risk.kind),
  };
}

/** M1 reachability: in an applicable state, how many candidates of the whole field are adverse, how many of those also fill the critical gap, and how high the best one ranks under the stage-aware rule. */
export function adverseFillersInField(state: ExamState, world: ExamWorld, threshold: M1Threshold): { adverse: number; adverseFillers: number; bestFillerRank: number | null } | null {
  const paired = state.teamNeedsPaired;
  if (paired === null || state.revealedEnemy.length === 0) return null;
  const needs = examNeeds(state, world);
  if (needs.critical.length === 0 || paired.flat.length < 6 || paired.closing.length < 6) return null;
  const closing = sortedByScore(paired.closing);
  const fillers = closing.flatMap((candidate, index) => (isAdverse(candidate, threshold) && fillsCritical(candidate.heroId, needs, world) ? [index + 1] : []));
  return { adverse: closing.filter((candidate) => isAdverse(candidate, threshold)).length, adverseFillers: fillers.length, bestFillerRank: fillers[0] ?? null };
}

// ---- Exposure of round 1: does the card say what the ranking exposes? -------------------------------------------------------------------
/** `curatedHardCounters` = ALL the curated hard counters the hero has (taken or not): 0 means "nothing curated", which is not the same as "cannot be countered". */
export interface ExposureCard { heroId: HeroId; rank: number; availableHardCounters: number; curatedHardCounters: number; warned: boolean }

/** Round 1 only: for each V4 card, how many curated hard counters are still on the table and whether the card carries `exposed_to_counter`. Null outside round 1 or without cards. */
export function exposureCommunication(state: ExamState, world: ExamWorld): { cards: ExposureCard[] } | null {
  if (state.round !== 1 || state.v4 === null || state.v4.state !== "RANKED" || state.v4.cards.length === 0) return null;
  return {
    cards: state.v4.cards.map((card, index) => ({
      heroId: card.heroId, rank: index + 1, availableHardCounters: availableHardCounters(card.heroId, state, world), curatedHardCounters: (world.counters.get(card.heroId) ?? []).filter((entry) => entry.level === "hard").length, warned: card.risks.some((risk) => risk.kind === "exposed_to_counter"),
    })),
  };
}

// ---- D1: where CRITICAL_GAP cannot be evaluated -----------------------------------------------------------------------------------------
export interface UnevaluableResult {
  inWindow: boolean;
  /** An own pick has no curated capabilities: the team's gap is not established, no card can say anything. */
  uncuratedOwnPick: boolean;
  /** ...and an open initiation/catch/damage_mix gap among the curated picks means the product MIGHT have warned (it stays silent on purpose). */
  gapWithheld: boolean;
  cards: number;
  /** Cards whose hero has no curated capabilities: the card cannot say whether it covers the gap. */
  cardsOfUncuratedHero: HeroId[];
}

export function unevaluable(state: ExamState, world: ExamWorld): UnevaluableResult {
  const inWindow = state.ownPicksRemaining >= 1 && state.ownPicksRemaining <= 2;
  const cards = state.v4?.cards ?? [];
  return {
    inWindow, uncuratedOwnPick: state.ownPicks.some((hero) => !world.capabilities.has(hero)), gapWithheld: criticalWithheldByUncuratedPick(state, world),
    cards: cards.length, cardsOfUncuratedHero: cards.filter((card) => !world.capabilities.has(card.heroId)).map((card) => card.heroId),
  };
}
