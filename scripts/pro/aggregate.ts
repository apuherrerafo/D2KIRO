import type { ProSourceRef } from "../../apps/engine/src/pro/types";
import { wilsonInterval } from "../../apps/engine/src/signals/relationship-index";
import type { NormalizedDraft } from "./normalize";

export const PRO_POSITION_MIN_GAMES = 30;
export interface AggregateInput { readonly draft: NormalizedDraft; readonly patch: string; readonly tier: "tier_1" | "tier_2"; readonly ref: ProSourceRef; readonly winningSide?: "radiant" | "dire"; }
export interface PositionAggregate {
  readonly heroId: number; readonly positionEst: 1 | 2 | 3 | 4 | 5; readonly patch: string; readonly tier: AggregateInput["tier"];
  readonly sampleSize: number; readonly openingPicks: number; readonly averagePickOrder: number;
  readonly earlyPicks: number; readonly intermediatePicks: number; readonly lastPicks: number;
  readonly positionConfidence: number; readonly isFlexible: boolean; readonly ref: ProSourceRef; readonly confidence: "medium";
}
interface Accumulator { heroId: number; positionEst: 1 | 2 | 3 | 4 | 5; patch: string; tier: AggregateInput["tier"]; ref: ProSourceRef; orders: number[]; openingPicks: number; concordance: number; }
export interface PairPattern { readonly heroes: readonly [number, number]; readonly patch: string; readonly tier: AggregateInput["tier"]; readonly observedWinrate: number; readonly expectedWinrate: number; readonly delta: number; readonly sampleSize: number; readonly ref: ProSourceRef; readonly confidence: "medium"; }
export interface TriplePattern { readonly heroes: readonly [number, number, number]; readonly patch: string; readonly tier: AggregateInput["tier"]; readonly observedWinrate: number; readonly expectedWinrate: number; readonly delta: number; readonly sampleSize: number; readonly ref: ProSourceRef; readonly confidence: "medium"; }
export interface BanResponsePattern { readonly bannedHero: number; readonly nextPickHero: number; readonly patch: string; readonly tier: AggregateInput["tier"]; readonly sampleSize: number; readonly observedWinrate: number; readonly ref: ProSourceRef; readonly confidence: "exploratory"; }

function positionAgreement(position: 1 | 2 | 3 | 4 | 5, laneRole: number, roaming: boolean): number {
  return position === laneRole || (roaming && position === 4) ? 1 : 0;
}

export function aggregatePosition(inputs: readonly AggregateInput[], heroId = 1): PositionAggregate | null {
  if (inputs.length < PRO_POSITION_MIN_GAMES) return null;
  const first = inputs[0]!; const slots = inputs.flatMap((input) => input.draft.slots.filter((slot) => slot.heroId === heroId));
  if (slots.length < PRO_POSITION_MIN_GAMES) return null;
  const position = slots[0]!.positionEst;
  const orders = inputs.flatMap((input) => input.draft.turns.filter((turn) => turn.isPick && turn.heroId === heroId).map((turn) => turn.order));
  const games = slots.length;
  const agreement = slots.reduce((sum, slot) => sum + positionAgreement(slot.positionEst, slot.laneRole, slot.isRoaming), 0) / games;
  const interval = wilsonInterval(Math.round(games * agreement), games);
  const positionConfidence = Math.max(0, Math.min(1, (1 - (interval.upper - interval.lower)) * agreement));
  const openingPicks = orders.filter((order) => order <= 8).length;
  return { heroId, positionEst: position, patch: first.patch, tier: first.tier, sampleSize: games, openingPicks,
    averagePickOrder: orders.reduce((sum, order) => sum + order, 0) / Math.max(1, orders.length),
    earlyPicks: orders.filter((order) => order <= 8).length, intermediatePicks: orders.filter((order) => order >= 9 && order <= 17).length,
    lastPicks: orders.filter((order) => order >= 22).length, positionConfidence, isFlexible: false, ref: first.ref, confidence: "medium" };
}

export function aggregateDrafts(inputs: readonly AggregateInput[]): PositionAggregate[] {
  const groups = new Map<string, Accumulator>();
  for (const input of inputs) for (const slot of input.draft.slots) {
    const key = `${slot.heroId}:${slot.positionEst}:${input.patch}:${input.tier}`;
    const group = groups.get(key) ?? { heroId: slot.heroId, positionEst: slot.positionEst, patch: input.patch, tier: input.tier, ref: input.ref, orders: [], openingPicks: 0, concordance: 0 };
    const picks = input.draft.turns.filter((turn) => turn.isPick && turn.heroId === slot.heroId && turn.team === slot.team);
    group.orders.push(...picks.map((turn) => turn.order)); group.openingPicks += picks.some((order) => order.order <= 8) ? 1 : 0;
    group.concordance += positionAgreement(slot.positionEst, slot.laneRole, slot.isRoaming); groups.set(key, group);
  }
  const rows = [...groups.values()].filter((group) => group.orders.length >= PRO_POSITION_MIN_GAMES).map((group) => {
    const games = group.orders.length; const agreement = group.concordance / games; const interval = wilsonInterval(Math.round(games * agreement), games);
    return { heroId: group.heroId, positionEst: group.positionEst, patch: group.patch, tier: group.tier, sampleSize: games, openingPicks: group.openingPicks,
      averagePickOrder: group.orders.reduce((sum, order) => sum + order, 0) / games, earlyPicks: group.orders.filter((order) => order <= 8).length,
      intermediatePicks: group.orders.filter((order) => order >= 9 && order <= 17).length, lastPicks: group.orders.filter((order) => order >= 22).length,
      positionConfidence: Math.max(0, Math.min(1, (1 - (interval.upper - interval.lower)) * agreement)), isFlexible: false, ref: group.ref, confidence: "medium" as const };
  });
  for (const row of rows) { const siblings = rows.filter((candidate) => candidate.heroId === row.heroId && candidate.patch === row.patch && candidate.tier === row.tier); const total = siblings.reduce((sum, candidate) => sum + candidate.sampleSize, 0); (row as { isFlexible: boolean }).isFlexible = siblings.length >= 2 && siblings.every((candidate) => candidate.sampleSize / total >= 0.15); }
  return rows;
}

interface PatternAccumulator { heroes: number[]; patch: string; tier: AggregateInput["tier"]; ref: ProSourceRef; wins: number; samples: number; }
function won(input: AggregateInput, team: 0 | 1): boolean { return (input.winningSide ?? "radiant") === (team === 0 ? "radiant" : "dire"); }
function individualWinrates(inputs: readonly AggregateInput[]): Map<number, number> {
  const totals = new Map<number, { wins: number; games: number }>();
  for (const input of inputs) for (const turn of input.draft.turns.filter((candidate) => candidate.isPick)) {
    const current = totals.get(turn.heroId) ?? { wins: 0, games: 0 }; current.games += 1; if (won(input, turn.team)) current.wins += 1; totals.set(turn.heroId, current);
  }
  return new Map([...totals].map(([hero, value]) => [hero, value.wins / value.games]));
}

export function aggregatePair(inputs: readonly AggregateInput[]): PairPattern[] {
  const groups = new Map<string, PatternAccumulator>();
  for (const input of inputs) for (const team of [0, 1] as const) {
    const heroes = [...new Set(input.draft.turns.filter((turn) => turn.isPick && turn.team === team).map((turn) => turn.heroId))].sort((a, b) => a - b);
    for (let i = 0; i < heroes.length; i += 1) for (let j = i + 1; j < heroes.length; j += 1) { const key = `${heroes[i]}:${heroes[j]}:${input.patch}:${input.tier}`; const group = groups.get(key) ?? { heroes: [heroes[i]!, heroes[j]!], patch: input.patch, tier: input.tier, ref: input.ref, wins: 0, samples: 0 }; group.samples += 1; if (won(input, team)) group.wins += 1; groups.set(key, group); }
  }
  const rates = individualWinrates(inputs);
  return [...groups.values()].filter((group) => group.samples >= PRO_POSITION_MIN_GAMES).map((group) => { const observed = group.wins / group.samples; const expected = (rates.get(group.heroes[0]!) ?? 0.5) * (rates.get(group.heroes[1]!) ?? 0.5); return { heroes: group.heroes as [number, number], patch: group.patch, tier: group.tier, observedWinrate: observed, expectedWinrate: expected, delta: observed - expected, sampleSize: group.samples, ref: group.ref, confidence: "medium" as const }; });
}

export function aggregateTriple(inputs: readonly AggregateInput[]): TriplePattern[] {
  const groups = new Map<string, PatternAccumulator>();
  for (const input of inputs) for (const team of [0, 1] as const) { const heroes = [...new Set(input.draft.turns.filter((turn) => turn.isPick && turn.team === team).map((turn) => turn.heroId))].sort((a, b) => a - b); for (let i = 0; i < heroes.length; i += 1) for (let j = i + 1; j < heroes.length; j += 1) for (let k = j + 1; k < heroes.length; k += 1) { const key = `${heroes[i]}:${heroes[j]}:${heroes[k]}:${input.patch}:${input.tier}`; const group = groups.get(key) ?? { heroes: [heroes[i]!, heroes[j]!, heroes[k]!], patch: input.patch, tier: input.tier, ref: input.ref, wins: 0, samples: 0 }; group.samples += 1; if (won(input, team)) group.wins += 1; groups.set(key, group); } }
  const rates = individualWinrates(inputs); return [...groups.values()].filter((group) => group.samples >= PRO_POSITION_MIN_GAMES).map((group) => { const expected = group.heroes.reduce((result, hero) => result * (rates.get(hero) ?? 0.5), 1); const observed = group.wins / group.samples; return { heroes: group.heroes as [number, number, number], patch: group.patch, tier: group.tier, observedWinrate: observed, expectedWinrate: expected, delta: observed - expected, sampleSize: group.samples, ref: group.ref, confidence: "medium" as const }; });
}

export function aggregateBanResponses(inputs: readonly AggregateInput[]): BanResponsePattern[] {
  const groups = new Map<string, PatternAccumulator>();
  for (const input of inputs) for (const ban of input.draft.turns.filter((turn) => !turn.isPick)) {
    const next = input.draft.turns.filter((turn) => turn.isPick && turn.team === ban.team && turn.order > ban.order).sort((a, b) => a.order - b.order)[0]; if (!next) continue;
    const key = `${ban.heroId}:${next.heroId}:${input.patch}:${input.tier}`; const group = groups.get(key) ?? { heroes: [ban.heroId, next.heroId], patch: input.patch, tier: input.tier, ref: input.ref, wins: 0, samples: 0 }; group.samples += 1; if (won(input, next.team)) group.wins += 1; groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.samples >= 10).map((group) => ({ bannedHero: group.heroes[0]!, nextPickHero: group.heroes[1]!, patch: group.patch, tier: group.tier, sampleSize: group.samples, observedWinrate: group.wins / group.samples, ref: group.ref, confidence: "exploratory" as const }));
}
