import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroPositions } from "./hero-positions";
import { buildSuggestions } from "./mix";
import type { MetaHeroInfo, MetaSnapshot } from "./types";

// TSK-253: escenario controlado contra `buildSuggestions` COMPLETO (no sólo el scorer): mismo criterio que Fase 3 §10.9-7 y TSK-252. La
// señal aislada podría dar el número correcto y el ranking seguir igual si el peso no alcanza; aquí se prueba que el orden se mueve.
// Fixtures inline (S9/S10): nunca capabilities.json ni hero-positions.json reales.

function draftState(radiant: number[]): DraftState {
  return {
    sessionId: "s1", schema: "draft-state/v1", format: "all_pick", patch: "7.41e", localSide: "radiant", phase: "active", banned: [],
    picks: { radiant, dire: [] }, lastSeq: 7, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-10-23T00:00:00Z", firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null,
  };
}

function hero(id: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities {
  return { hero: id, damageType: "physical", hasInitiation: false, hasCatch: true, hasWaveclear: true, structuralDamage: "medium", teamfight: "medium", scaling: "medium", ...overrides };
}

// Pos 1, seis creíbles con el MISMO volumen: position_fit empata y la diferencia la pone team_synergy, no la popularidad.
const CANDIDATES = [41, 42, 43, 44, 45, 46];
const OWN = [1, 2, 3];
const POS: HeroPositions = Object.fromEntries(CANDIDATES.map((id) => [id, [{ position: 1, matches: 3000 }]])) as HeroPositions;
const heroes: Record<number, MetaHeroInfo> = Object.fromEntries([...CANDIDATES, ...OWN].map((id) => [id, { id, localizedName: `Hero ${id}` }]));
const meta: MetaSnapshot = { heroes, matchups: {} };

// El equipo (1, 2, 3) lo tiene todo MENOS iniciación y tiene bajos estructuras y scaling.
const TEAM = OWN.map((id) => hero(id, { damageType: id === 2 ? "magical" : "physical", structuralDamage: "low", scaling: "low" }));
const INITIATOR = hero(41, { hasInitiation: true, structuralDamage: "low", scaling: "low" }); // llena sólo el hueco crítico
const RICH = hero(42, { structuralDamage: "high", scaling: "high" }); //                         llena dos huecos blandos, no inicia
const NEUTRAL = [43, 44, 45, 46].map((id) => hero(id, { structuralDamage: "low", scaling: "low" }));
const CAPS = [...TEAM, INITIATOR, RICH, ...NEUTRAL];

const base = { teamOpening: false, targetPosition: 1 as const, heroPositions: POS, heroCounters: new Map(), heroCapabilities: CAPS, positionFitSaturation: "credible-median" as const };
const rank = (suggestions: { hero: number }[], id: number): number => suggestions.findIndex((s) => s.hero === id) + 1;
const shape = (set: ReturnType<typeof buildSuggestions>) => set.suggestions.map((s) => ({ hero: s.hero, score: s.score, signals: s.signals }));

describe("buildSuggestions -- lo crítico que le falta al equipo pesa en la ventana de cierre", () => {
  const state = draftState(OWN);

  test("regla vieja: el héroe 'rico' (dos huecos blandos) le gana al único que inicia, aunque al equipo le falte iniciar", () => {
    const legacy = buildSuggestions(state, meta, base).suggestions;
    expect(rank(legacy, 42)).toBe(1);
    expect(rank(legacy, 41)).toBeGreaterThan(rank(legacy, 42));
  });

  test("regla por etapa con 2 picks por delante: el iniciador pasa a ser #1 y el 'rico' queda detrás", () => {
    const aware = buildSuggestions(state, meta, { ...base, teamNeedsOwnPicksRemaining: 2 }).suggestions;
    expect(rank(aware, 41)).toBe(1);
    expect(rank(aware, 42)).toBeGreaterThan(rank(aware, 41));
  });

  test("con 3 picks por delante (fuera de la ventana) el orden es el de siempre, byte a byte", () => {
    const legacy = buildSuggestions(state, meta, base);
    const early = buildSuggestions(state, meta, { ...base, teamNeedsOwnPicksRemaining: 3 });
    expect(shape(early)).toEqual(shape(legacy));
  });

  test("regresión cero: sin la opción, buildSuggestions es byte-idéntico al de antes de TSK-253", () => {
    const absent = buildSuggestions(state, meta, base);
    const explicit = buildSuggestions(state, meta, { ...base, teamNeedsOwnPicksRemaining: undefined });
    expect(shape(explicit)).toEqual(shape(absent));
  });

  test("si el equipo YA tiene iniciador no hay nada crítico: la regla por etapa no mueve el orden", () => {
    const withInitiator = draftState([1, 2, 41]);
    const legacy = buildSuggestions(withInitiator, meta, base);
    const aware = buildSuggestions(withInitiator, meta, { ...base, teamNeedsOwnPicksRemaining: 2 });
    expect(shape(aware)).toEqual(shape(legacy));
  });

  test("team_synergy sigue diciendo la verdad sobre su dato: el desglose del iniciador no inventa un raw ni lo pone en null", () => {
    const aware = buildSuggestions(state, meta, { ...base, teamNeedsOwnPicksRemaining: 2 }).suggestions;
    const signal = aware.find((s) => s.hero === 41)!.signals.find((x) => x.signal === "team_synergy")!;
    expect(signal.raw).not.toBeNull();
    expect(signal.raw!).toBeGreaterThan(0);
    expect(signal.raw!).toBeLessThanOrEqual(1);
  });
});
