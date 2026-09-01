// Feature: random-draft-simulator
// Property 8: Picks pendientes del usuario no emiten eventos al Draft_Reducer
// Validates: Requirements 6.4

import { test, expect } from "bun:test";
import { useRandomDraftStore } from "../store";
import type { DraftConfig, HeroId } from "../types";
import type { OrchestratorResult } from "../orchestrator";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetStore(): void {
  useRandomDraftStore.getState().resetSession();
}

function startBlindRound(round: 1 | 2 | 3 = 1): void {
  const config: DraftConfig = {
    draftSeed: "ABCDEFGH",
    userSide: "radiant",
    personalBanList: [],
    patch: "7.37d",
  };
  const orchestratorResult: OrchestratorResult = {
    resolvedBans: [1, 2, 3, 4],
    rounds: [
      { round: 1, botPicks: [10, 11] },
      { round: 2, botPicks: [12, 13] },
      { round: 3, botPicks: [14] },
    ],
  };
  useRandomDraftStore.getState().startSession(config, "session-1", orchestratorResult);

  // Forzar la fase a blind_round de la ronda pedida sin pasar por confirmRound,
  // para poder probar confirmPick/deselectPick de forma aislada.
  useRandomDraftStore.setState({
    phase: {
      type: "blind_round",
      round,
      timerRemainingMs: 25000,
      pendingUserPicks: [],
      conflictBans: [],
      conflictCount: 0,
    },
  });
}

// ---------------------------------------------------------------------------
// Property 8: picks pendientes no emiten eventos al Draft_Reducer
// Validates: Requirements 6.4
// ---------------------------------------------------------------------------

test("Property 8: confirmPick/deselectPick nunca mutan draftState/suggestions/sessionId (100 casos)", () => {
  // Feature: random-draft-simulator, Property 8: Picks pendientes del usuario no emiten eventos al Draft_Reducer
  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    resetStore();
    startBlindRound();

    const before = useRandomDraftStore.getState();
    const heroId: HeroId = 100 + caseIndex;

    useRandomDraftStore.getState().confirmPick(heroId);
    const afterPick = useRandomDraftStore.getState();

    expect(afterPick.draftState).toBe(before.draftState);
    expect(afterPick.suggestions).toBe(before.suggestions);
    expect(afterPick.sessionId).toBe(before.sessionId);
    expect(afterPick.phase.type === "blind_round" && afterPick.phase.pendingUserPicks).toEqual([heroId]);

    useRandomDraftStore.getState().deselectPick(heroId);
    const afterDeselect = useRandomDraftStore.getState();

    expect(afterDeselect.draftState).toBe(before.draftState);
    expect(afterDeselect.suggestions).toBe(before.suggestions);
    expect(afterDeselect.sessionId).toBe(before.sessionId);
    expect(afterDeselect.phase.type === "blind_round" && afterDeselect.phase.pendingUserPicks).toEqual([]);
  }
});

test("confirmPick es idempotente: agregar el mismo héroe dos veces no lo duplica", () => {
  resetStore();
  startBlindRound();

  useRandomDraftStore.getState().confirmPick(42);
  useRandomDraftStore.getState().confirmPick(42);

  const { phase } = useRandomDraftStore.getState();
  expect(phase.type === "blind_round" && phase.pendingUserPicks).toEqual([42]);
});

test("los picks ocultos del bot se pueden reemplazar antes de revelar la ronda", () => {
  resetStore();
  startBlindRound();
  useRandomDraftStore.getState().confirmPick(20);
  useRandomDraftStore.getState().confirmPick(21);

  useRandomDraftStore.getState().setBotPicksForRound(1, [30, 31]);
  useRandomDraftStore.getState().confirmRound();

  const phase = useRandomDraftStore.getState().phase;
  expect(phase.type).toBe("round_revealed");
  if (phase.type === "round_revealed") {
    expect(phase.userPicks).toEqual([20, 21]);
    expect(phase.botPicks).toEqual([30, 31]);
  }
});

test("resetSession descarta un draft parcial para poder empezar otro desde cero", () => {
  resetStore();
  startBlindRound();
  useRandomDraftStore.getState().confirmPick(42);

  useRandomDraftStore.getState().resetSession();

  expect(useRandomDraftStore.getState()).toMatchObject({
    config: null,
    draftState: null,
    sessionId: null,
    suggestions: null,
    phase: { type: "idle" },
  });
});

// ---------------------------------------------------------------------------
// confirmRound: revelación y avance de ronda
// ---------------------------------------------------------------------------

test("confirmRound revela la ronda y luego avanza a la siguiente blind_round", () => {
  resetStore();
  startBlindRound(1);

  useRandomDraftStore.getState().confirmPick(20);
  useRandomDraftStore.getState().confirmPick(21);
  useRandomDraftStore.getState().confirmRound();

  const revealed = useRandomDraftStore.getState().phase;
  expect(revealed.type).toBe("round_revealed");
  if (revealed.type === "round_revealed") {
    expect(revealed.round).toBe(1);
    expect(revealed.userPicks).toEqual([20, 21]);
    expect(revealed.botPicks).toEqual([10, 11]);
    expect(revealed.conflictBans).toEqual([]);
  }

  useRandomDraftStore.getState().confirmRound();
  const next = useRandomDraftStore.getState().phase;
  expect(next.type).toBe("blind_round");
  if (next.type === "blind_round") {
    expect(next.round).toBe(2);
    expect(next.pendingUserPicks).toEqual([]);
  }
});

test("confirmRound detecta Conflict_Ban cuando el usuario elige el mismo héroe que el bot", () => {
  resetStore();
  startBlindRound(1);

  useRandomDraftStore.getState().confirmPick(10); // mismo héroe que botPicks[0] de la ronda 1
  useRandomDraftStore.getState().confirmRound();

  const revealed = useRandomDraftStore.getState().phase;
  expect(revealed.type === "round_revealed" && revealed.conflictBans).toEqual([10]);
});

test("confirmRound tras la ronda 3 revelada produce la fase complete con el DraftSummary", () => {
  resetStore();
  startBlindRound(3);

  useRandomDraftStore.getState().confirmPick(30);
  useRandomDraftStore.getState().confirmRound(); // revela ronda 3
  useRandomDraftStore.getState().confirmRound(); // avanza a complete

  const finalPhase = useRandomDraftStore.getState().phase;
  expect(finalPhase.type).toBe("complete");
  if (finalPhase.type === "complete") {
    expect(finalPhase.summary.draftSeed).toBe("ABCDEFGH");
    expect(finalPhase.summary.picksByRound).toEqual([{ userPicks: [30], botPicks: [14] }]);
  }
});

// TSK-215: el fallo de transporte tiene que ser un estado observable, no un console.error.
// El bug de TSK-214 sobrevivió semanas justamente porque no lo era.
test("engineStatus arranca en 'ok', se puede marcar 'unreachable' y vuelve solo al recuperarse", () => {
  resetStore();
  expect(useRandomDraftStore.getState().engineStatus).toBe("ok");

  useRandomDraftStore.getState().setEngineStatus("unreachable");
  expect(useRandomDraftStore.getState().engineStatus).toBe("unreachable");

  useRandomDraftStore.getState().setEngineStatus("ok");
  expect(useRandomDraftStore.getState().engineStatus).toBe("ok");
});

test("un draft nuevo nunca hereda el 'unreachable' del anterior", () => {
  resetStore();
  useRandomDraftStore.getState().setEngineStatus("unreachable");

  startBlindRound(1);

  expect(useRandomDraftStore.getState().engineStatus).toBe("ok");
});
