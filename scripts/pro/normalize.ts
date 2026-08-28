import type { CaptainsModeTurnTable } from "../../apps/engine/src/draft/draft-format-turns";
import type { ProDraft, ProDraftSlot, ProDraftTurn } from "../../apps/engine/src/pro/types";

export type DraftPhase = "opening_bans" | "opening_picks" | "mid_bans" | "mid_picks" | "closing_bans" | "closing_picks";

export interface NormalizedTurn extends ProDraftTurn { readonly phase: DraftPhase | null; }
export interface NormalizedSlot extends ProDraftSlot { readonly netWorthRank: number; }
export interface NormalizedDraft {
  readonly turns: readonly NormalizedTurn[];
  readonly slots: readonly NormalizedSlot[];
  readonly revealedAtTurnByHero: Readonly<Record<string, number>>;
  readonly missingOrders: readonly number[];
  readonly unsupportedGameMode: boolean;
}

function phasesFor(table: CaptainsModeTurnTable): Map<number, DraftPhase> {
  const phases: DraftPhase[] = ["opening_bans", "opening_picks", "mid_bans", "mid_picks", "closing_bans", "closing_picks"];
  const result = new Map<number, DraftPhase>();
  let group = -1; let previous: string | undefined;
  table.turns.forEach((turn, order) => {
    const key = turn.action;
    if (key !== previous) { group += 1; previous = key; }
    result.set(order, phases[group] ?? "closing_picks");
  });
  return result;
}

export function normalizeDraft(draft: ProDraft, table: CaptainsModeTurnTable): NormalizedDraft {
  const unsupportedGameMode = draft.gameMode !== 2;
  const phaseByOrder = unsupportedGameMode ? new Map<number, DraftPhase>() : phasesFor(table);
  const turns = draft.turns.filter((turn) => Number.isInteger(turn.order)).map((turn) => ({
    ...turn,
    phase: phaseByOrder.get(turn.order) ?? null,
  }));
  const revealedAtTurnByHero: Record<string, number> = {};
  for (const turn of turns) {
    if (turn.isPick && revealedAtTurnByHero[String(turn.heroId)] === undefined) revealedAtTurnByHero[String(turn.heroId)] = turn.order;
  }
  const byTeam = new Map<0 | 1, ProDraftSlot[]>();
  for (const slot of draft.slots) byTeam.set(slot.team, [...(byTeam.get(slot.team) ?? []), slot]);
  const rankByHero = new Map<string, number>();
  for (const slots of byTeam.values()) {
    [...slots].sort((a, b) => b.netWorth - a.netWorth).forEach((slot, index) => rankByHero.set(`${slot.team}:${slot.heroId}`, index + 1));
  }
  const slots = draft.slots.map((slot) => ({ ...slot, netWorthRank: rankByHero.get(`${slot.team}:${slot.heroId}`) ?? 0 }));
  const known = new Set(turns.map((turn) => turn.order));
  const missingOrders = table.turns.map((_, order) => order).filter((order) => !known.has(order));
  return { turns, slots, revealedAtTurnByHero, missingOrders, unsupportedGameMode };
}
