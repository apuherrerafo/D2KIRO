// Pruebas de las funciones puras exportadas por use-random-draft-session.ts. El resto del hook
// (refs, setInterval, WebSocket) depende de renderizar un componente React -- no hay
// `renderHook`/testing-library en este proyecto (ver testing-seams.md), así que esa parte se
// verifica en un navegador real contra apps/engine (tarea 16.2), no aquí.

import { test, expect } from "bun:test";
import { buildBotPickPreview, buildPendingPickPreview, isPreviewReadyForRound, otherSide, randomPickForSlots, rebasePreviewSuggestions, specForRound } from "../use-random-draft-session";
import { createSeededRng } from "../seeded-rng";
import type { HeroId } from "../types";
import type { DraftState } from "@/features/draft/types";

function draftState(): DraftState {
  return {
    sessionId: "simulator-session",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [1],
    picks: { radiant: [2], dire: [3] },
    lastSeq: 12,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-08-24T00:00:00.000Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
  };
}

test("otherSide devuelve el lado contrario", () => {
  expect(otherSide("radiant")).toBe("dire");
  expect(otherSide("dire")).toBe("radiant");
});

test("specForRound devuelve la spec exacta para cada ronda (2-2-1, 25s/25s/20s)", () => {
  expect(specForRound(1)).toEqual({ round: 1, picksPerTeam: 2, timerMs: 25000 });
  expect(specForRound(2)).toEqual({ round: 2, picksPerTeam: 2, timerMs: 25000 });
  expect(specForRound(3)).toEqual({ round: 3, picksPerTeam: 1, timerMs: 20000 });
});

test("buildPendingPickPreview incorpora los picks pendientes sin duplicar los ya previsualizados", () => {
  const state = draftState();
  const firstPreview = buildPendingPickPreview(state, "radiant", [], [4]);
  const secondPreview = buildPendingPickPreview(firstPreview, "radiant", [4], [4, 5]);

  expect(firstPreview.picks).toEqual({ radiant: [2, 4], dire: [3] });
  expect(secondPreview.picks).toEqual({ radiant: [2, 4, 5], dire: [3] });
  expect(secondPreview.lastSeq).toBe(12);
});

test("buildBotPickPreview conserva los picks previos y excluye los picks recién cerrados del usuario", () => {
  const preview = buildBotPickPreview(draftState(), "radiant", [4, 5], [6, 7]);

  expect(preview.localSide).toBe("dire");
  expect(preview.picks).toEqual({ radiant: [2, 4, 5], dire: [3, 6, 7] });
});

test("una ronda nueva solo pide preview cuando el estado ya contiene los picks revelados previos", () => {
  expect(isPreviewReadyForRound(draftState(), "radiant", 1)).toBe(true);
  expect(isPreviewReadyForRound(draftState(), "radiant", 2)).toBe(false);
  expect(isPreviewReadyForRound({ ...draftState(), picks: { radiant: [2, 4], dire: [3, 5] } }, "radiant", 2)).toBe(true);
  expect(isPreviewReadyForRound({ ...draftState(), picks: { radiant: [2, 4, 6], dire: [3, 5, 7] } }, "radiant", 3)).toBe(false);
  expect(isPreviewReadyForRound({ ...draftState(), picks: { radiant: [2, 4, 6, 8], dire: [3, 5, 7, 9] } }, "radiant", 3)).toBe(true);
});

test("rebasePreviewSuggestions conserva el preview cuando el WS solo adelanta la secuencia del mismo tablero", () => {
  const preview = draftState();
  const websocketState = { ...preview, lastSeq: 18 };
  const suggestions = {
    schema: "suggestions/v1" as const,
    sessionId: preview.sessionId,
    basedOnSeq: preview.lastSeq,
    suggestions: [],
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };

  expect(rebasePreviewSuggestions(preview, websocketState, suggestions)?.basedOnSeq).toBe(18);
});

test("rebasePreviewSuggestions no marca fresca una recomendación para otro tablero", () => {
  const preview = draftState();
  const websocketState = { ...preview, picks: { radiant: [2, 4], dire: [3] } };
  const suggestions = {
    schema: "suggestions/v1" as const,
    sessionId: preview.sessionId,
    basedOnSeq: preview.lastSeq,
    suggestions: [],
    comparison: null,
    degraded: [],
    computedInMs: 1,
  };

  expect(rebasePreviewSuggestions(preview, websocketState, suggestions)).toBeNull();
});

test("randomPickForSlots nunca elige un héroe baneado, ya tomado, o repetido (100 casos)", () => {
  const allHeroIds: HeroId[] = Array.from({ length: 20 }, (_, i) => i + 1);

  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const rng = createSeededRng("ABCDEFGH");
    const resolvedBans = allHeroIds.slice(0, 5);
    const alreadyTaken = allHeroIds.slice(5, 8);
    const count = caseIndex % 3; // 0, 1, 2

    const picks = randomPickForSlots(count, rng, resolvedBans, alreadyTaken, allHeroIds);

    expect(picks).toHaveLength(count);
    expect(new Set(picks).size).toBe(picks.length);
    for (const heroId of picks) {
      expect(resolvedBans.includes(heroId)).toBe(false);
      expect(alreadyTaken.includes(heroId)).toBe(false);
    }
  }
});

test("randomPickForSlots retorna menos picks que los pedidos si el pool se agota", () => {
  const allHeroIds: HeroId[] = [1, 2, 3];
  const rng = createSeededRng("ABCDEFGH");

  const picks = randomPickForSlots(5, rng, [1], [2], allHeroIds);

  expect(picks).toEqual([3]);
});
