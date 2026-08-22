import { describe, expect, test } from "bun:test";
import { DraftViewBody } from "./DraftView";
import type { DraftState, ScreenState, SuggestionSet } from "./types";

// TSK-061: DraftViewBody (el switch que mapea cada uno de los 6 ScreenState a su componente,
// DraftView.tsx) no tenía prueba propia -- se prueba llamándola directo como función pura, sin
// renderizar React: el elemento devuelto (`{ type, props }`) alcanza para verificar qué
// componente le corresponde a cada estado, comparando `result.type.name` (los componentes de
// pantalla son declaraciones con nombre, no exportadas -- comparar por nombre evita tener que
// exportar cada uno solo para esta prueba).

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.36",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function suggestionSet(overrides: Partial<SuggestionSet> = {}): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "s1",
    basedOnSeq: 0,
    suggestions: [],
    comparison: null,
    degraded: [],
    computedInMs: 1,
    ...overrides,
  };
}

const noop = () => {};

function baseProps(screenState: ScreenState, overrides: Partial<Parameters<typeof DraftViewBody>[0]> = {}) {
  return {
    sessionId: "s1",
    screenState,
    draftState: null,
    suggestions: null,
    partyContext: null,
    errorMessage: null,
    heroCatalog: new Map(),
    onReconnect: noop,
    onOpenManualEntry: noop,
    onOpenSimulator: noop,
    ...overrides,
  };
}

describe("DraftViewBody -- mapeo de los 6 ScreenState al componente correcto", () => {
  test("desconectado -> DisconnectedState", () => {
    const result = DraftViewBody(baseProps("desconectado"));
    expect((result.type as { name: string }).name).toBe("DisconnectedState");
  });

  test("esperando_draft -> WaitingForDraftState", () => {
    const result = DraftViewBody(baseProps("esperando_draft"));
    expect((result.type as { name: string }).name).toBe("WaitingForDraftState");
  });

  test("activo -> ActiveDraftState", () => {
    const result = DraftViewBody(baseProps("activo", { draftState: draftState() }));
    expect((result.type as { name: string }).name).toBe("ActiveDraftState");
  });

  test("degradado -> DegradedDraftState", () => {
    const result = DraftViewBody(
      baseProps("degradado", { draftState: draftState(), suggestions: suggestionSet({ degraded: ["stale_meta"] }) }),
    );
    expect((result.type as { name: string }).name).toBe("DegradedDraftState");
  });

  test("completo -> CompletedDraftState", () => {
    const result = DraftViewBody(baseProps("completo", { draftState: draftState({ phase: "complete" }) }));
    expect((result.type as { name: string }).name).toBe("CompletedDraftState");
  });

  test("error -> ErrorState", () => {
    const result = DraftViewBody(baseProps("error", { errorMessage: "algo salió mal" }));
    expect((result.type as { name: string }).name).toBe("ErrorState");
  });
});
