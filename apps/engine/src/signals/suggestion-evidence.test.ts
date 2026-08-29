import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { buildSuggestions } from "./mix";

test("expone contrapick, sinergia y flex como evidencia separada", () => {
  const state = {
    ...createIdleDraftState("evidence"), phase: "active" as const, format: "all_pick" as const, patch: "7.41e", localSide: "radiant" as const,
    picks: { radiant: [1, 2], dire: [10, 11] },
  };
  const result = buildSuggestions(state, {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Earthshaker" }, 10: { id: 10, localizedName: "Lina" }, 11: { id: 11, localizedName: "Zeus" } },
    matchups: { 3: [{ vsHero: 10, games: 400, wins: 280 }, { vsHero: 11, games: 400, wins: 220 }, { vsHero: 12, games: 400, wins: 160 }] },
  }, {
    heroPositions: { 1: [{ position: 5, matches: 400 }], 2: [{ position: 1, matches: 400 }], 3: [{ position: 4, matches: 400 }, { position: 2, matches: 300 }] },
    heroCapabilities: [
      { hero: 1, damageType: "magical", hasInitiation: false, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "low" },
      { hero: 2, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "high", teamfight: "low", scaling: "high" },
      { hero: 3, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "high", scaling: "low" },
    ],
    // S9 (testing-seams.md, Fase 8): esta suite prueba el render de evidencia, no la capa
    // curada -- se inyecta un Map vacío para no depender del contenido de hero-counters.json.
    heroCounters: new Map(),
  });

  const earthshaker = result.suggestions.find((suggestion) => suggestion.hero === 3)!;
  expect(earthshaker.evidence?.map((item) => item.kind)).toEqual(expect.arrayContaining(["counter", "synergy", "flex"]));
  // El momento (Pick 3/4) lo declara `decisionContext` una sola vez -- `reason` no lo repite
  // (TSK-124: el encabezado de fase clonado en cada tarjeta era el bug real, no una prueba).
  expect(result.decisionContext).toBe("response_pick");
});

test("una respuesta sin ventaja verificable contra los dos rivales revelados declara el riesgo", () => {
  const state = {
    ...createIdleDraftState("response-risk"), phase: "active" as const, format: "all_pick" as const, localSide: "radiant" as const,
    picks: { radiant: [1, 2], dire: [10, 11] },
  };
  const result = buildSuggestions(state, {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Tres" }, 10: { id: 10, localizedName: "Diez" }, 11: { id: 11, localizedName: "Once" } },
    matchups: { 3: [{ vsHero: 10, games: 300, wins: 150 }, { vsHero: 11, games: 300, wins: 150 }] },
  }, { heroPositions: {}, heroCapabilities: [], heroCounters: new Map() });

  expect(result.decisionContext).toBe("response_pick");
  expect(result.suggestions[0]?.evidence).toEqual(expect.arrayContaining([
    expect.objectContaining({ kind: "risk", text: expect.stringContaining("contrapick verificable") }),
  ]));
});

test("sin rivales revelados, matchups favorables hipotéticos no generan evidencia de contrapick", () => {
  const state = {
    ...createIdleDraftState("blind-counter"), phase: "active" as const, format: "all_pick" as const, localSide: "radiant" as const,
    picks: { radiant: [1], dire: [] },
  };
  const result = buildSuggestions(state, {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 3: { id: 3, localizedName: "Tres" }, 10: { id: 10, localizedName: "Hipotético" } },
    matchups: { 3: [{ vsHero: 10, games: 400, wins: 320 }] },
  }, { heroPositions: {}, heroCapabilities: [], heroCounters: new Map() });

  const candidate = result.suggestions.find((suggestion) => suggestion.hero === 3)!;
  expect(candidate.signals.find((signal) => signal.signal === "counter")?.raw).toBeNull();
  expect(candidate.evidence?.filter((item) => item.kind === "counter")).toHaveLength(0);
});

test("el cierre declara composición y riesgo cuando faltan datos de contrapick", () => {
  const state = {
    ...createIdleDraftState("closing-risk"), phase: "active" as const, format: "all_pick" as const, localSide: "radiant" as const,
    picks: { radiant: [1, 2, 3, 4], dire: [10, 11, 12, 13] },
  };
  const result = buildSuggestions(state, {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Tres" }, 4: { id: 4, localizedName: "Cuatro" }, 5: { id: 5, localizedName: "Cinco" }, 10: { id: 10, localizedName: "Diez" }, 11: { id: 11, localizedName: "Once" }, 12: { id: 12, localizedName: "Doce" }, 13: { id: 13, localizedName: "Trece" } },
    matchups: {},
  }, { heroPositions: {}, heroCapabilities: [], heroCounters: new Map() });

  expect(result.decisionContext).toBe("closing_pick");
  expect(result.suggestions[0]?.evidence?.filter((item) => item.kind === "risk").length).toBeGreaterThan(0);
});
