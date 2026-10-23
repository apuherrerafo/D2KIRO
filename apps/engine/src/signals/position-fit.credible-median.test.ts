import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { HeroPositions } from "./hero-positions";
import { buildSuggestions } from "./mix";
import { createPositionFitScorer, credibleMedianMatches } from "./position-fit";
import type { MetaHeroInfo, MetaSnapshot } from "./types";

// TSK-252 (F1 / T3): `position_fit` for a TARGET position stops being a volume count. Fixtures inline (S10): never hero-positions.json.
//
// The median is always read from `credibleMedianMatches` -- the very function the scorer uses -- so no test pins a median that the
// fixture could contradict. The one test that pins a literal (the function's own) derives it by hand from the fixture.

const MATCHES_POS1 = [400, 900, 1500, 2600, 7000]; // odd count: the median is the middle value of the credible heroes
const HERO_IDS = [11, 12, 13, 14, 15];
const POSITIONS: HeroPositions = {
  ...Object.fromEntries(HERO_IDS.map((hero, i) => [hero, [{ position: 1, matches: MATCHES_POS1[i]! }]])),
  // Listed at Pos 1 above the 200 floor but NOT credible there (dominant elsewhere, share ~5%): it must not move the median.
  16: [{ position: 4, matches: 5000 }, { position: 1, matches: 250 }],
} as HeroPositions;

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 7,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-10-23T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

const rawAt = (hero: number, saturation: "volume" | "credible-median" | undefined, positions: HeroPositions = POSITIONS): number | null =>
  createPositionFitScorer(positions, 1, saturation).score(draftState(), hero, { heroes: {}, matchups: {} }).raw;

describe("credibleMedianMatches", () => {
  test("odd count of credible heroes: the middle value; a non-credible listed hero does not count", () => {
    // credible at Pos 1: 11..15 (hero 16 is not) -> sorted [400, 900, 1500, 2600, 7000] -> 1500
    expect(credibleMedianMatches(1, POSITIONS)).toBe(1500);
  });

  test("even count: the mean of the two middle values", () => {
    const positions: HeroPositions = { 1: [{ position: 3, matches: 1000 }], 2: [{ position: 3, matches: 3000 }], 3: [{ position: 3, matches: 5000 }], 4: [{ position: 3, matches: 9000 }] };
    expect(credibleMedianMatches(3, positions)).toBe(4000);
  });

  test("a position nobody is credible at has no median (null), never 0 or NaN", () => {
    expect(credibleMedianMatches(5, POSITIONS)).toBeNull();
  });

  test("it is a pure function of the data: asking twice, or per position, never mixes answers", () => {
    expect(credibleMedianMatches(1, POSITIONS)).toBe(credibleMedianMatches(1, POSITIONS));
    expect(credibleMedianMatches(4, POSITIONS)).toBe(5000); // only hero 16 is credible at Pos 4
  });
});

describe("position_fit con targetPosition -- credible-median", () => {
  const median = credibleMedianMatches(1, POSITIONS)!;

  test("matches >= mediana -> raw 1 (saturado); dos héroes por encima de la mediana empatan", () => {
    const atMedian = rawAt(13, "credible-median"); // exactly the median
    const above = rawAt(14, "credible-median");
    const farAbove = rawAt(15, "credible-median");
    expect(MATCHES_POS1[2]).toBeGreaterThanOrEqual(median);
    expect(atMedian).toBe(1);
    expect(above).toBe(1);
    expect(farAbove).toBe(above);
  });

  test("matches < mediana -> raw = matches / mediana (la cola con poca evidencia sigue penalizada)", () => {
    expect(rawAt(12, "credible-median")).toBeCloseTo(MATCHES_POS1[1]! / median, 12);
    expect(rawAt(11, "credible-median")).toBeCloseTo(MATCHES_POS1[0]! / median, 12);
    expect(rawAt(11, "credible-median")!).toBeLessThan(rawAt(12, "credible-median")!);
    expect(rawAt(12, "credible-median")!).toBeLessThan(1);
  });

  test("sampleSize sigue siendo el volumen real (la confianza de evidencia no cambia)", () => {
    const contribution = createPositionFitScorer(POSITIONS, 1, "credible-median").score(draftState(), 15, { heroes: {}, matchups: {} });
    expect(contribution.sampleSize).toBe(7000);
  });

  test("sin héroes creíbles en la posición, degrada a la regla de volumen (nunca NaN ni 0)", () => {
    // Hero 16 has Pos 1 evidence (250) but is not credible there; at Pos 1 the median exists (fixture), so use a position with none:
    const positions: HeroPositions = { 21: [{ position: 4, matches: 5000 }, { position: 1, matches: 250 }] };
    expect(credibleMedianMatches(1, positions)).toBeNull();
    expect(rawAt(21, "credible-median", positions)).toBeCloseTo(250 / 3000, 12);
  });

  test("candado: sin el tercer argumento, y con 'volume', la regla es la de siempre (matches / 3000), byte a byte", () => {
    for (const hero of HERO_IDS) {
      const expected = Math.min(1, MATCHES_POS1[HERO_IDS.indexOf(hero)]! / 3000);
      expect(rawAt(hero, undefined)).toBe(expected);
      expect(rawAt(hero, "volume")).toBe(expected);
    }
  });

  test("sin targetPosition ('credible-median' no hace nada): sigue la fórmula legada de relleno/seguridad", () => {
    const withMode = createPositionFitScorer(POSITIONS, undefined, "credible-median").score(draftState(), 15, { heroes: {}, matchups: {} });
    const without = createPositionFitScorer(POSITIONS).score(draftState(), 15, { heroes: {}, matchups: {} });
    expect(withMode).toEqual(without);
  });
});

// Pipeline completo (mismo criterio que Fase 3 §10.9-7 y Fase 8): la señal aislada podría dar el número correcto y el ranking seguir
// igual si el peso no alcanza. Aquí se prueba contra `buildSuggestions`, con un rival revelado y un hard counter curado.
describe("buildSuggestions con un rival revelado -- el que lo counterea supera al más popular", () => {
  // Pos 1, ocho creíbles. Mediana de [300, 700, 1000, 1500, 1500, 2600, 4000, 7000] = (1500 + 1500) / 2 = 1500.
  const MATCHES = [300, 700, 1000, 1500, 1500, 2600, 4000, 7000];
  const IDS = [31, 32, 33, 34, 35, 36, 37, 38];
  const POS: HeroPositions = Object.fromEntries(IDS.map((hero, i) => [hero, [{ position: 1, matches: MATCHES[i]! }]])) as HeroPositions;
  const RIVAL = 90;
  const MOST_PLAYED = 38; // 7000 matches: saturated under both rules
  const COUNTERER = 35; //   1500 matches: on the median -> raw 1 under credible-median, 0.5 under the legacy 3000
  const THIN_TAIL = 31; //    300 matches
  const heroes: Record<number, MetaHeroInfo> = Object.fromEntries([...IDS, RIVAL].map((id) => [id, { id, localizedName: `Hero ${id}` }]));
  const meta: MetaSnapshot = { heroes, matchups: {} };
  const state = draftState({ picks: { radiant: [], dire: [RIVAL] } });
  const curated = new Map([[RIVAL, [{ vs: COUNTERER, level: "hard" as const, why: "fixture" }]]]);
  const base = { teamOpening: false, targetPosition: 1 as const, heroPositions: POS, heroCounters: curated, heroCapabilities: [] };
  const scoreOf = (suggestions: { hero: number; score: number }[], hero: number): number | undefined => suggestions.find((s) => s.hero === hero)?.score;
  const rank = (suggestions: { hero: number }[], hero: number): number => suggestions.findIndex((s) => s.hero === hero) + 1;

  test("la mediana del fixture deja al counterer justo en ella (raw 1) y al más jugado también", () => {
    expect(credibleMedianMatches(1, POS)).toBe(1500);
    expect(rawAt(COUNTERER, "credible-median", POS)).toBe(1);
    expect(rawAt(MOST_PLAYED, "credible-median", POS)).toBe(1);
    expect(rawAt(COUNTERER, "volume", POS)).toBe(0.5);
  });

  test("regla de volumen (legado): el más jugado (80.6) gana al counterer (69.4) aunque éste counteree al rival revelado", () => {
    const legacy = buildSuggestions(state, meta, base).suggestions;
    expect(scoreOf(legacy, MOST_PLAYED)).toBeCloseTo(80.6, 1);
    expect(scoreOf(legacy, COUNTERER)).toBeCloseTo(69.4, 1);
    expect(rank(legacy, MOST_PLAYED)).toBeLessThan(rank(legacy, COUNTERER));
  });

  test("regla credible-median: el counterer (100.0) pasa a ser #1 y deja al más jugado (80.6) detrás", () => {
    const median = buildSuggestions(state, meta, { ...base, positionFitSaturation: "credible-median" }).suggestions;
    expect(rank(median, COUNTERER)).toBe(1);
    expect(scoreOf(median, COUNTERER)).toBeCloseTo(100, 1);
    expect(scoreOf(median, MOST_PLAYED)).toBeCloseTo(80.6, 1);
    // position_fit empata (ambos saturan en 1): la diferencia la pone `counter`, no el volumen.
    const pf = (hero: number) => median.find((s) => s.hero === hero)!.signals.find((x) => x.signal === "position_fit")!.weighted;
    expect(pf(COUNTERER)).toBeCloseTo(pf(MOST_PLAYED), 10);
  });

  test("la cola con poca evidencia sigue penalizada: el de 300 partidas no entra al top mientras el más jugado sí", () => {
    const median = buildSuggestions(state, meta, { ...base, positionFitSaturation: "credible-median" }).suggestions;
    expect(rank(median, MOST_PLAYED)).toBeGreaterThan(0);
    expect(rank(median, THIN_TAIL)).toBe(0);
  });

  test("regresión cero: sin la opción, buildSuggestions es byte-idéntico a pedir 'volume' explícito", () => {
    const absent = buildSuggestions(state, meta, base);
    const explicit = buildSuggestions(state, meta, { ...base, positionFitSaturation: "volume" });
    const shape = (set: typeof absent) => set.suggestions.map((s) => ({ hero: s.hero, score: s.score, signals: s.signals }));
    expect(shape(explicit)).toEqual(shape(absent));
  });
});
