import { ROUND_TIMER_MS } from "../draft-protocol/rulesets/ranked-all-pick";
import { rosterSlotForRoundSlot } from "./ap-simulator-policy";

// AP Ranked Roles V1 -- round timers and the late-pick gold penalty.
//
// Entirely OUTSIDE the kernel: the kernel does not manage time and never receives a timeout. When a
// round's base timer runs out, NOTHING is assigned to the Player -- each Own Team seat that is
// still pending simply loses gold, individually, at PENALTY_GOLD_PER_SECOND, and the Player keeps
// full ability to pick. There is no random fallback hero.
//
// Pure functions over an explicit `now` (ms) -- no clock is read in this file, so the tests never
// depend on wall time (same discipline as applyDraftEvent, testing-seams S4).

export const PENALTY_GOLD_PER_SECOND = 2;
export const SEAT_COUNT = 5;

export interface RoundTimerState {
  round: 1 | 2 | 3;
  startedAt: number;
  durationMs: number;
  /** null until the base timer has run out AND at least one own seat is (or was) late. */
  penaltyStartedAt: number | null;
}

export interface GoldPenaltyState {
  /** Indexed by roster seat 0..4. */
  bySlot: number[];
  penaltyRatePerSecond: number;
}

/** One timing attempt of a round. A collision that reopens seats starts a new attempt of the same round. */
export interface SimulatorTimerRuntime {
  /** `${round}:${collisionsResolved}` -- changes exactly when the kernel reopens seats or advances the round. */
  attemptKey: string;
  timer: RoundTimerState;
  /** Own seats that had to pick in this attempt. */
  seats: number[];
  /** rosterSlot -> when that seat was confirmed (sealed). Absent = still pending. */
  confirmedAt: Record<number, number>;
  /** Penalty already incurred in earlier attempts, per seat. */
  carried: number[];
}

export function roundTimerDurationMs(round: 1 | 2 | 3): number {
  return ROUND_TIMER_MS[round];
}

export function emptyCarried(): number[] {
  return Array.from({ length: SEAT_COUNT }, () => 0);
}

export function attemptKeyFor(round: 1 | 2 | 3, collisionsResolved: number): string {
  return `${round}:${collisionsResolved}`;
}

/** Seats of `round` that are open for the Player, as stable roster seats. */
export function seatsForOpenSlots(round: 1 | 2 | 3, openSlotIndexes: readonly number[]): number[] {
  return openSlotIndexes
    .map((slotIndex) => rosterSlotForRoundSlot(round, slotIndex))
    .filter((seat): seat is number => seat !== null)
    .sort((a, b) => a - b);
}

export function startRoundTimer(
  round: 1 | 2 | 3,
  collisionsResolved: number,
  seats: readonly number[],
  carried: readonly number[],
  now: number,
): SimulatorTimerRuntime {
  return {
    attemptKey: attemptKeyFor(round, collisionsResolved),
    timer: { round, startedAt: now, durationMs: roundTimerDurationMs(round), penaltyStartedAt: null },
    seats: [...seats],
    confirmedAt: {},
    carried: [...carried],
  };
}

/** A confirmed seat stops accruing; every other pending seat is unaffected. Idempotent per seat. */
export function confirmSeat(runtime: SimulatorTimerRuntime, rosterSlot: number, now: number): SimulatorTimerRuntime {
  if (!runtime.seats.includes(rosterSlot) || runtime.confirmedAt[rosterSlot] !== undefined) return runtime;
  return { ...runtime, confirmedAt: { ...runtime.confirmedAt, [rosterSlot]: now } };
}

function deadlineOf(runtime: SimulatorTimerRuntime): number {
  return runtime.timer.startedAt + runtime.timer.durationMs;
}

/** Whole gold lost, per seat, at `now`: carried + 2 gold per second spent pending after the deadline. */
export function goldPenaltyAt(runtime: SimulatorTimerRuntime, now: number): GoldPenaltyState {
  const deadline = deadlineOf(runtime);
  const bySlot = [...runtime.carried];
  for (const seat of runtime.seats) {
    const end = runtime.confirmedAt[seat] ?? now;
    const overdueMs = Math.max(0, end - deadline);
    bySlot[seat] = (bySlot[seat] ?? 0) + Math.floor((overdueMs * PENALTY_GOLD_PER_SECOND) / 1000);
  }
  return { bySlot, penaltyRatePerSecond: PENALTY_GOLD_PER_SECOND };
}

export function pendingSeats(runtime: SimulatorTimerRuntime): number[] {
  return runtime.seats.filter((seat) => runtime.confirmedAt[seat] === undefined);
}

/** `penaltyStartedAt` = the deadline, once it has passed with a seat pending or confirmed late. */
export function timerStateAt(runtime: SimulatorTimerRuntime, now: number): RoundTimerState {
  const deadline = deadlineOf(runtime);
  const someoneLate = runtime.seats.some((seat) => (runtime.confirmedAt[seat] ?? now) > deadline);
  return { ...runtime.timer, penaltyStartedAt: now >= deadline && someoneLate ? deadline : null };
}

/** Wire shape for the web client: everything relative to `now`, no absolute timestamps to trust. */
export interface SimulatorTimerView {
  round: 1 | 2 | 3;
  durationMs: number;
  remainingMs: number;
  penaltyActive: boolean;
  pendingSeats: number[];
  goldPenaltyBySlot: number[];
  penaltyRatePerSecond: number;
}

export function timerViewAt(runtime: SimulatorTimerRuntime, now: number): SimulatorTimerView {
  const timer = timerStateAt(runtime, now);
  const pending = pendingSeats(runtime);
  return {
    round: timer.round,
    durationMs: timer.durationMs,
    remainingMs: Math.max(0, deadlineOf(runtime) - now),
    penaltyActive: now >= deadlineOf(runtime) && pending.length > 0,
    pendingSeats: pending,
    goldPenaltyBySlot: goldPenaltyAt(runtime, now).bySlot,
    penaltyRatePerSecond: PENALTY_GOLD_PER_SECOND,
  };
}
