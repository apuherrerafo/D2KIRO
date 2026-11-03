import { describe, expect, test } from "bun:test";
import { RANKED_ALL_PICK_IDENTITY } from "../draft-protocol";
import {
  PENALTY_GOLD_PER_SECOND,
  confirmSeat,
  emptyCarried,
  goldPenaltyAt,
  pendingSeats,
  roundTimerDurationMs,
  seatsForOpenSlots,
  startRoundTimer,
  timerStateAt,
  timerViewAt,
} from "./timer";

const T0 = 1_000_000;

describe("round timers", () => {
  test("duraciones 25 / 25 / 20 s, tomadas del propio ruleset", () => {
    expect([1, 2, 3].map((round) => roundTimerDurationMs(round as 1 | 2 | 3))).toEqual([25000, 25000, 20000]);
    expect(startRoundTimer(3, 0, [4], emptyCarried(), T0).timer.durationMs).toBe(20000);
    expect(RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch).toBe("7.41f");
  });

  test("antes de vencer no hay penalizacion ni penaltyStartedAt", () => {
    const runtime = startRoundTimer(1, 0, [0, 1], emptyCarried(), T0);
    expect(goldPenaltyAt(runtime, T0 + 24_999).bySlot).toEqual([0, 0, 0, 0, 0]);
    expect(timerStateAt(runtime, T0 + 24_999).penaltyStartedAt).toBeNull();
    expect(timerViewAt(runtime, T0 + 10_000).remainingMs).toBe(15_000);
  });
});

describe("gold penalty (2 oro/s por jugador pendiente)", () => {
  test("1 segundo despues del vencimiento, el asiento sin confirmar tiene 2 de oro perdido", () => {
    const runtime = startRoundTimer(1, 0, [0, 1], emptyCarried(), T0);
    const at = T0 + 25_000 + 1_000;
    expect(goldPenaltyAt(runtime, at).bySlot[0]).toBe(2);
    expect(goldPenaltyAt(runtime, at).penaltyRatePerSecond).toBe(PENALTY_GOLD_PER_SECOND);
    expect(timerStateAt(runtime, at).penaltyStartedAt).toBe(T0 + 25_000);
  });

  test("confirmar un asiento detiene SU penalizacion; el otro pendiente sigue acumulando", () => {
    let runtime = startRoundTimer(1, 0, [0, 1], emptyCarried(), T0);
    runtime = confirmSeat(runtime, 0, T0 + 25_000 + 3_000); // seat 0 confirms 3s late
    const later = T0 + 25_000 + 10_000;
    const penalty = goldPenaltyAt(runtime, later).bySlot;
    expect(penalty[0]).toBe(6); // frozen at the confirmation instant: 3s * 2
    expect(penalty[1]).toBe(20); // still pending: 10s * 2
    expect(goldPenaltyAt(runtime, later + 5_000).bySlot[0]).toBe(6); // seat 0 never changes again
    expect(goldPenaltyAt(runtime, later + 5_000).bySlot[1]).toBe(30);
    expect(pendingSeats(runtime)).toEqual([1]);
  });

  test("dos asientos pendientes acumulan de forma independiente (confirmaciones distintas, montos distintos)", () => {
    let runtime = startRoundTimer(2, 0, [2, 3], emptyCarried(), T0);
    runtime = confirmSeat(runtime, 2, T0 + 25_000 + 1_000);
    runtime = confirmSeat(runtime, 3, T0 + 25_000 + 4_000);
    const penalty = goldPenaltyAt(runtime, T0 + 60_000).bySlot;
    expect([penalty[2], penalty[3]]).toEqual([2, 8]);
    expect(penalty[0]).toBe(0);
  });

  test("confirmar antes del vencimiento => 0 de penalizacion y sin penaltyStartedAt", () => {
    let runtime = startRoundTimer(1, 0, [0, 1], emptyCarried(), T0);
    runtime = confirmSeat(runtime, 0, T0 + 5_000);
    runtime = confirmSeat(runtime, 1, T0 + 24_000);
    expect(goldPenaltyAt(runtime, T0 + 90_000).bySlot).toEqual([0, 0, 0, 0, 0]);
    expect(timerStateAt(runtime, T0 + 90_000).penaltyStartedAt).toBeNull();
  });

  test("el Player conserva la capacidad de elegir con la penalizacion activa (confirmar tarde sigue siendo valido)", () => {
    let runtime = startRoundTimer(3, 0, [4], emptyCarried(), T0);
    expect(timerViewAt(runtime, T0 + 30_000).penaltyActive).toBe(true);
    runtime = confirmSeat(runtime, 4, T0 + 30_000);
    expect(timerViewAt(runtime, T0 + 60_000).penaltyActive).toBe(false);
    expect(timerViewAt(runtime, T0 + 60_000).goldPenaltyBySlot[4]).toBe(20);
  });

  test("nada del timer asigna un heroe: la vista no tiene ningun campo de heroe", () => {
    const view = timerViewAt(startRoundTimer(1, 0, [0, 1], emptyCarried(), T0), T0 + 99_000);
    expect(Object.keys(view).sort()).toEqual(["durationMs", "goldPenaltyBySlot", "penaltyActive", "penaltyRatePerSecond", "pendingSeats", "remainingMs", "round"]);
  });

  test("un nuevo intento (colision) arrastra la penalizacion previa del asiento", () => {
    const first = confirmSeat(startRoundTimer(1, 0, [0, 1], emptyCarried(), T0), 0, T0 + 25_000 + 2_000);
    const carried = goldPenaltyAt(first, T0 + 25_000 + 2_000).bySlot;
    const second = startRoundTimer(1, 1, [0], carried, T0 + 40_000);
    expect(goldPenaltyAt(second, T0 + 40_000).bySlot[0]).toBe(4);
    expect(seatsForOpenSlots(1, [0])).toEqual([0]);
    expect(seatsForOpenSlots(3, [0])).toEqual([4]);
  });
});
