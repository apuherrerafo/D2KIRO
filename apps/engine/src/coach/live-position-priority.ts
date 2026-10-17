import type { HeroId, RankedApPhase } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { OwnPositionOccupancy } from "../recommendation/perspective-context";
import type { CuratedCounter } from "../signals/hero-counters";
import { positionPhrase } from "./reveal-strategy";

// LivePositionPriorityV1 -- WHICH of our open positions to pick for now, in a live Party5 draft.
//
// It compares POSITIONS, never heroes: hero scoring stays V6's. And it never compares V6 scores across positions --
// each column is ranked against its own target and its own pool, so those numbers are not calibrated against one
// another. Only categorical, cross-position-comparable evidence the engine actually has is used, in this order:
//
//   0. FILLED / necessarily occupied positions are never candidates (the caller passes only actionable ones).
//   1. Own-role ambiguity: a position one of our heroes of unconfirmed role may already occupy is set aside while a
//      certainly-open position exists -- and if none exists, no strategic claim is made at all.
//   2. COUNTER_WINDOW (STRATEGIC): a position whose own shortlist holds a curated HARD counter of a revealed enemy
//      (and is not itself hard-countered by one). The strongest window -- most revealed enemies countered by one
//      hero -- wins when it is unique.
//   3. POOL_SCARCITY (STRATEGIC): a position whose saved Party5 pool has exactly ONE legal hero left, and that hero
//      is on its shortlist -- securing it now, before it is taken.
//   4. PHASE_FALLBACK: no tactical distinction. Commitment order -- reveal first what tells the rival least (hard
//      support, support, offlane) and keep the counterable cores (carry, then mid) for later. Named for what it is:
//      an ordering by draft phase, NOT a strategic advantage.
//
// A tie inside a strategic signal narrows the field to the tied positions and the next step decides among them;
// only a signal that singles out ONE position is called STRATEGIC. Pure; never reads what the Player is viewing.

export const LIVE_POSITION_PRIORITY_VERSION = "live-position-priority/v1" as const;

export type LivePriorityBasis = "STRATEGIC" | "PHASE_FALLBACK" | "DETERMINISTIC_DEFAULT";
export type LivePrioritySignal = "SINGLE_POSITION" | "COUNTER_WINDOW" | "POOL_SCARCITY" | "PHASE";

/** Commitment order of the phase fallback: least revealing first. Mid is the most counterable lane, so it goes last. */
export const PHASE_COMMITMENT_ORDER: readonly Position[] = [5, 4, 3, 1, 2];

export interface LivePriorityColumn {
  position: Position;
  /** The position's own shortlist, legal and credible at it, in its own rank order. */
  heroIds: readonly HeroId[];
}

export interface LivePositionPriorityInput {
  /** Positions a human may pick for right now (never a FILLED or necessarily occupied one). */
  actionablePositions: readonly Position[];
  phase: RankedApPhase | null;
  columns: readonly LivePriorityColumn[];
  revealedEnemies: readonly HeroId[];
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  playerPoolsByPosition?: Partial<Record<Position, readonly HeroId[]>> | null;
  /** Heroes no longer pickable (bans + every visible pick). */
  unavailable: ReadonlySet<HeroId>;
  occupancy?: OwnPositionOccupancy | null;
}

export interface LivePositionPriority {
  targetPosition: Position;
  targetBasis: LivePriorityBasis;
  signal: LivePrioritySignal;
  /** The hero the deciding signal is about (the counter, the last pool hero); null for PHASE / SINGLE_POSITION. */
  signalHeroId: HeroId | null;
  targetRationale: string;
}

interface CounterWindow {
  position: Position;
  heroId: HeroId;
  strength: number;
}

function hardCountersOf(victim: HeroId, heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]>): Set<HeroId> {
  return new Set((heroCounters.get(victim) ?? []).filter((entry) => entry.level === "hard").map((entry) => entry.vs));
}

/** The best clean counter on one position's shortlist: most revealed enemies hard-countered, then shortlist rank. */
function counterWindowOf(column: LivePriorityColumn, revealed: readonly HeroId[], heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]>): CounterWindow | null {
  const countersByEnemy = revealed.map((enemy) => hardCountersOf(enemy, heroCounters));
  let best: CounterWindow | null = null;
  for (const heroId of column.heroIds) {
    const countered = (heroCounters.get(heroId) ?? []).some((entry) => entry.level === "hard" && revealed.includes(entry.vs));
    if (countered) continue;
    const strength = countersByEnemy.filter((counters) => counters.has(heroId)).length;
    if (strength > 0 && (best === null || strength > best.strength)) best = { position: column.position, heroId, strength };
  }
  return best;
}

function roundLabel(phase: RankedApPhase | null): string {
  if (phase === "PICK_ROUND_1") return "Ronda 1";
  if (phase === "PICK_ROUND_2") return "Ronda 2";
  if (phase === "PICK_ROUND_3") return "Ronda 3";
  return "En esta fase";
}

function listPhrase(positions: readonly Position[]): string {
  return positions.map(positionPhrase).join(", ");
}

export function selectLivePositionPriority(input: LivePositionPriorityInput): LivePositionPriority {
  const eligible = [...new Set(input.actionablePositions)].sort((a, b) => a - b);
  if (eligible.length === 0) throw new Error("selectLivePositionPriority requires at least one actionable position");
  if (eligible.length === 1) {
    const only = eligible[0]!;
    return { targetPosition: only, targetBasis: "DETERMINISTIC_DEFAULT", signal: "SINGLE_POSITION", signalHeroId: null, targetRationale: `${positionPhrase(only)} es la única posición pendiente: no hay prioridad que elegir.` };
  }

  // 1. Own-role ambiguity: never build a strategic claim on a position one of our heroes may already be in.
  const possiblyOccupied = new Set(input.occupancy?.possiblyOccupied ?? []);
  const contested = eligible.filter((position) => possiblyOccupied.has(position));
  const clear = eligible.filter((position) => !possiblyOccupied.has(position));
  const notes: string[] = [];
  if (contested.length > 0 && clear.length > 0) notes.push(`${listPhrase(contested)} queda en duda: un héroe tuyo sin rol confirmado podría estar ahí.`);
  if (clear.length === 0) {
    notes.push("Todas tus posiciones pendientes están en duda: un héroe tuyo sin rol confirmado podría ocupar cualquiera, así que no hay prioridad táctica que afirmar.");
    return phaseFallback(eligible, input.phase, notes);
  }

  let field = clear;
  const columnOf = (position: Position) => input.columns.find((column) => column.position === position);

  // 2. COUNTER_WINDOW.
  if (input.heroCounters && input.revealedEnemies.length > 0) {
    const windows = field.flatMap((position) => {
      const column = columnOf(position);
      const window = column ? counterWindowOf(column, input.revealedEnemies, input.heroCounters!) : null;
      return window ? [window] : [];
    });
    const strongest = Math.max(0, ...windows.map((window) => window.strength));
    const top = windows.filter((window) => window.strength === strongest);
    if (top.length === 1) {
      const window = top[0]!;
      const enemies = window.strength === 1 ? "un héroe rival ya revelado" : `${window.strength} héroes rivales ya revelados`;
      return {
        targetPosition: window.position,
        targetBasis: "STRATEGIC",
        signal: "COUNTER_WINDOW",
        signalHeroId: window.heroId,
        targetRationale: [`Ventana de counter: ${positionPhrase(window.position)} tiene en su lista un counter directo de ${enemies}, y ninguna otra posición pendiente tiene uno igual de fuerte.`, ...notes].join(" "),
      };
    }
    if (top.length > 1) {
      field = top.map((window) => window.position).sort((a, b) => a - b);
      notes.push(`${listPhrase(field)} tienen counters igual de fuertes contra lo revelado.`);
    }
  }

  // 3. POOL_SCARCITY.
  const pools = input.playerPoolsByPosition;
  if (pools) {
    const scarce = field.flatMap((position) => {
      const pool = pools[position] ?? [];
      const viable = pool.filter((heroId) => !input.unavailable.has(heroId));
      if (pool.length === 0 || viable.length !== 1) return [];
      const heroId = viable[0]!;
      return columnOf(position)?.heroIds.includes(heroId) ? [{ position, heroId }] : [];
    });
    if (scarce.length === 1) {
      const last = scarce[0]!;
      return {
        targetPosition: last.position,
        targetBasis: "STRATEGIC",
        signal: "POOL_SCARCITY",
        signalHeroId: last.heroId,
        targetRationale: [`Asegurar el pool: a ${positionPhrase(last.position)} le queda un solo héroe disponible de su pool; conviene tomarlo antes de que lo elijan o se pierda.`, ...notes].join(" "),
      };
    }
    if (scarce.length > 1) field = scarce.map((entry) => entry.position).sort((a, b) => a - b);
  }

  // 4. PHASE_FALLBACK.
  return phaseFallback(field, input.phase, notes);
}

function phaseFallback(field: readonly Position[], phase: RankedApPhase | null, notes: readonly string[]): LivePositionPriority {
  const target = PHASE_COMMITMENT_ORDER.find((position) => field.includes(position)) ?? field[0]!;
  return {
    targetPosition: target,
    targetBasis: "PHASE_FALLBACK",
    signal: "PHASE",
    signalHeroId: null,
    targetRationale: [
      `${roundLabel(phase)}, sin una ventaja táctica que distinga tus posiciones: conviene revelar primero lo que menos información le da al rival (soportes antes que cores). Vista sugerida: ${positionPhrase(target)}. Es un orden por fase del draft, no una ventaja.`,
      ...notes,
    ].join(" "),
  };
}
