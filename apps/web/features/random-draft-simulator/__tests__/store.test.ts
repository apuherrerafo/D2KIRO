import { afterEach, describe, expect, test } from "bun:test";
import { useRandomDraftStore } from "../store";

const config = {
  draftSeed: "ABCDEFGH",
  userSide: "radiant" as const,
  personalBanList: [],
  patch: "7.41e",
};

afterEach(() => useRandomDraftStore.getState().resetSession());

describe("RandomDraftStore — sólo estado visual/transitorio", () => {
  test("startSession conserva la configuración y muestra los bans generados por el adapter", () => {
    useRandomDraftStore.getState().startSession(config, "protocol-session", { resolvedBans: [1, 2], rounds: [] });
    expect(useRandomDraftStore.getState()).toMatchObject({
      sessionId: "protocol-session",
      config,
      phase: { type: "ban_phase_complete", resolvedBans: [1, 2] },
    });
  });

  test("confirmPick/deselectPick sólo editan la selección aún no enviada", () => {
    useRandomDraftStore.getState().setVisualPhase({
      type: "blind_round",
      round: 1,
      timerRemainingMs: 10_000,
      pendingUserPicks: [],
      conflictBans: [],
      conflictCount: 0,
    });
    useRandomDraftStore.getState().confirmPick(10);
    useRandomDraftStore.getState().confirmPick(10);
    expect(useRandomDraftStore.getState().phase).toMatchObject({ pendingUserPicks: [10] });
    useRandomDraftStore.getState().deselectPick(10);
    expect(useRandomDraftStore.getState().phase).toMatchObject({ pendingUserPicks: [] });
  });

  test("el timer es visual y nunca avanza fase ni resuelve protocolo", () => {
    useRandomDraftStore.getState().setVisualPhase({
      type: "blind_round",
      round: 2,
      timerRemainingMs: 100,
      pendingUserPicks: [],
      conflictBans: [],
      conflictCount: 0,
    });
    useRandomDraftStore.getState().tickTimer(500);
    expect(useRandomDraftStore.getState().phase).toEqual({
      type: "blind_round",
      round: 2,
      timerRemainingMs: 0,
      pendingUserPicks: [],
      conflictBans: [],
      conflictCount: 0,
    });
  });

  test("no expone acciones locales de reveal, colisión o completion", () => {
    const state = useRandomDraftStore.getState() as unknown as Record<string, unknown>;
    expect(state.confirmRound).toBeUndefined();
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
