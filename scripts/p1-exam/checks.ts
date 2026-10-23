// F1 / TSK-250 -- pure mechanical checks of the "drafter exam" (plan v2, table C). No I/O, no engine calls, no clock: every function
// takes a compact `ExamState` observed from the real simulator path (V3 + V4 + Team Coach Board) and the curated world data, and
// returns counts/violations. Tests feed inline fixtures (invariantes.md: no test reads curated data).
//
// Three kinds of result, never mixed:
//   HARD         a violation is a defect (I1, I2, I3-conformity, I6-visible, I9-visible, I11)
//   OBSERVATION  a number to look at, not a law (I4, I5, I7, I8, I10, concentration)
//   NOT_MEASURABLE  the thing the invariant needs does not exist in the system yet (reported honestly, never as PASS)
import type { HeroId } from "../../apps/engine/src/draft/reducer";
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
  v4: { kind: string; targetPosition: Pos | null; /** The position the cards belong to (== target unless the Player opens on their own position). */ viewedPosition: Pos | null; targetBasis: string | null; state: string | null; cards: { heroId: HeroId; rationale: string }[] } | null;
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

export function i6Gap(state: ExamState, world: ExamWorld): I6Result {
  const fills = (hero: HeroId): boolean => { const c = world.capabilities.get(hero); return c !== undefined && (c.hasInitiation || c.hasCatch); };
  const applies = state.ownPicksRemaining <= 2 && state.ownPicks.length >= 3 && !state.ownPicks.some(fills);
  if (!applies) return { applies: false, top3Fills: false, credibleFillerExists: false, gapNotVisible: false };
  const credible = new Set<HeroId>([...state.v3.map((c) => c.heroId), ...(state.board?.columns ?? []).flatMap((c) => c.top.map((t) => t.heroId))]);
  const texts = [state.v3PrimaryRationale, ...state.v3.map((c) => c.rationale), ...(state.board?.columns ?? []).flatMap((c) => c.top.map((t) => t.reason))];
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
