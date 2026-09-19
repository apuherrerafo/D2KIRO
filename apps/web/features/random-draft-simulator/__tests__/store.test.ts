import { afterEach, describe, expect, test } from "bun:test";
import { useRandomDraftStore } from "../store";
import type { DraftPhase } from "../types";

const config = {
  draftSeed: "ABCDEFGH",
  userSide: "radiant" as const,
  playerPosition: 2 as const,
  personalBanList: [],
  patch: "7.41e",
  partySize: 5 as const,
};

type BlindRound = Extract<DraftPhase, { type: "blind_round" }>;

function blindRound(overrides: Partial<BlindRound> = {}): BlindRound {
  return {
    type: "blind_round",
    round: 1,
    timerRemainingMs: 10_000,
    timerDurationMs: 25_000,
    pendingUserPicks: [],
    attemptSeats: [0, 1],
    pendingSeats: [0, 1],
    goldPenaltyBySlot: [0, 0, 0, 0, 0],
    penaltyRatePerSecond: 2,
    penaltyElapsedMs: 0,
    conflictBans: [],
    conflictCount: 0,
    attemptId: 1,
    notice: null,
    ...overrides,
  };
}

afterEach(() => useRandomDraftStore.getState().resetSession());

describe("RandomDraftStore — sólo estado visual/transitorio", () => {
  test("startSession conserva la configuración (lado y posición personal incluidos)", () => {
    useRandomDraftStore.getState().startSession(config, "protocol-session", { resolvedBans: [1, 2], rounds: [] });
    expect(useRandomDraftStore.getState()).toMatchObject({
      sessionId: "protocol-session",
      config: { userSide: "radiant", playerPosition: 2 },
      phase: { type: "ban_phase_complete", resolvedBans: [1, 2] },
    });
  });

  test("confirmPick registra los héroes ya sellados, sin duplicarlos", () => {
    useRandomDraftStore.getState().setVisualPhase(blindRound());
    useRandomDraftStore.getState().confirmPick(10);
    useRandomDraftStore.getState().confirmPick(10);
    useRandomDraftStore.getState().confirmPick(11);
    expect(useRandomDraftStore.getState().phase).toMatchObject({ pendingUserPicks: [10, 11] });
  });

  test("el timer es visual y nunca avanza fase, resuelve protocolo ni elige un héroe", () => {
    useRandomDraftStore.getState().setVisualPhase(blindRound({ round: 2, timerRemainingMs: 100, attemptSeats: [2, 3], pendingSeats: [2, 3] }));
    useRandomDraftStore.getState().tickTimer(500);
    const phase = useRandomDraftStore.getState().phase as BlindRound;
    expect(phase.type).toBe("blind_round");
    expect(phase.timerRemainingMs).toBe(0);
    expect(phase.pendingUserPicks).toEqual([]); // nothing is picked for the Player on expiry
    expect(phase.penaltyElapsedMs).toBe(400); // only the overflow past the base time
  });

  test("tras vencer, cada tick suma penalización visual sólo si quedan asientos pendientes", () => {
    useRandomDraftStore.getState().setVisualPhase(blindRound({ timerRemainingMs: 0 }));
    useRandomDraftStore.getState().tickTimer(1000);
    expect((useRandomDraftStore.getState().phase as BlindRound).penaltyElapsedMs).toBe(1000);
    useRandomDraftStore.getState().setVisualPhase(blindRound({ timerRemainingMs: 0, pendingSeats: [] }));
    useRandomDraftStore.getState().tickTimer(1000);
    expect((useRandomDraftStore.getState().phase as BlindRound).penaltyElapsedMs).toBe(0);
  });

  test("syncRoundTimer adopta la cifra del motor y reinicia el acumulado visual", () => {
    useRandomDraftStore.getState().setVisualPhase(blindRound({ penaltyElapsedMs: 3000, timerRemainingMs: 0 }));
    useRandomDraftStore.getState().syncRoundTimer({ remainingMs: 0, pendingSeats: [1], goldPenaltyBySlot: [6, 0, 0, 0, 0], penaltyRatePerSecond: 2 });
    expect(useRandomDraftStore.getState().phase).toMatchObject({ pendingSeats: [1], goldPenaltyBySlot: [6, 0, 0, 0, 0], penaltyElapsedMs: 0 });
  });

  test("no expone acciones locales de reveal, colisión, completion ni de descartar un pick sellado", () => {
    const state = useRandomDraftStore.getState() as unknown as Record<string, unknown>;
    expect(state.confirmRound).toBeUndefined();
    expect(state.deselectPick).toBeUndefined();
    expect(state.retryRoundAfterConflict).toBeUndefined();
    expect(state.patchRevealedRound).toBeUndefined();
    expect(state.setBotPicksForRound).toBeUndefined();
  });

  test("reset limpia también estados de error visibles", () => {
    useRandomDraftStore.getState().setEngineStatus("unreachable");
    useRandomDraftStore.getState().setStaleInfo(true, "now");
    useRandomDraftStore.getState().resetSession();
    expect(useRandomDraftStore.getState()).toMatchObject({
      phase: { type: "idle" },
      engineStatus: "ok",
      staleWarning: false,
      lastSyncedAt: null,
    });
  });
});
