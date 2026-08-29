import { describe, expect, test } from "bun:test";
import type { DraftState, HeroId } from "../draft/reducer";
import {
  COUNTER_MIN_GAMES,
  COUNTER_SHRINK_PRIOR_STRENGTH,
  counterScorer,
  createCounterScorer,
} from "./counter";
import type { CuratedCounter } from "./hero-counters";
import type { MetaSnapshot } from "./types";

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
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

function meta(overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return { heroes: {}, matchups: {}, ...overrides };
}

const NO_CURATED = new Map<HeroId, CuratedCounter[]>();
// Config que reproduce el comportamiento previo a Fase 8 número por número (§14.7).
const LEGACY = { minGames: 200, shrinkPriorStrength: null } as const;

describe("counterScorer (singleton de módulo -- comportamiento previo)", () => {
  test("0 enemigos conocidos -> raw: null", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ matchups: { 1: [{ vsHero: 10, games: 500, wins: 300 }] } });

    const result = counterScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.signal).toBe("counter");
  });

  test("al menos un enfrentamiento valido -> raw numerico, sampleSize y explanation correctos", () => {
    const state = draftState({ picks: { radiant: [], dire: [10, 11] } });
    const snapshot = meta({
      heroes: { 10: { id: 10, localizedName: "Lina" }, 11: { id: 11, localizedName: "Zeus" } },
      matchups: {
        1: [
          { vsHero: 10, games: 300, wins: 200 }, // valido, winrate 0.6667
          { vsHero: 11, games: 100, wins: 40 }, // bajo umbral 200, descartado del promedio
          { vsHero: 12, games: 500, wins: 250 }, // no es enemigo conocido, solo aporta a la base
        ],
      },
    });

    const result = counterScorer.score(state, 1, snapshot);

    const baseline = (200 + 40 + 250) / (300 + 100 + 500);
    expect(result.raw).toBeCloseTo(200 / 300 - baseline, 5);
    expect(result.sampleSize).toBe(300);
    expect(result.explanation).toContain("Lina");
    expect(result.explanation).not.toContain("Zeus");
  });

  test("localSide 'unknown' no tiene lado enemigo conocible -> raw: null, nunca lanza", () => {
    const state = draftState({ localSide: "unknown", picks: { radiant: [10], dire: [11] } });
    const snapshot = meta({ matchups: { 1: [{ vsHero: 10, games: 500, wins: 300 }] } });

    expect(counterScorer.score(state, 1, snapshot).raw).toBeNull();
  });

  test("candidato ausente del snapshot no lanza y es pura (misma entrada, misma salida)", () => {
    const state = draftState({ picks: { radiant: [], dire: [999] } });

    expect(() => counterScorer.score(state, 42, meta())).not.toThrow();
    expect(counterScorer.score(state, 42, meta())).toEqual(counterScorer.score(state, 42, meta()));
  });
});

describe("createCounterScorer -- candado de regresion cero (§14.7-1)", () => {
  test("curated vacio + { minGames: 200, shrinkPriorStrength: null } reproduce el singleton numero por numero", () => {
    const state = draftState({ picks: { radiant: [], dire: [10, 11] } });
    const snapshot = meta({
      heroes: { 10: { id: 10, localizedName: "Lina" }, 11: { id: 11, localizedName: "Zeus" } },
      matchups: {
        1: [
          { vsHero: 10, games: 300, wins: 200 },
          { vsHero: 11, games: 100, wins: 40 },
          { vsHero: 12, games: 500, wins: 250 },
        ],
      },
    });

    const legacy = createCounterScorer(NO_CURATED, LEGACY).score(state, 1, snapshot);
    const singleton = counterScorer.score(state, 1, snapshot);

    expect(legacy).toEqual(singleton);
    const baseline = (200 + 40 + 250) / (300 + 100 + 500);
    expect(legacy.raw).toBeCloseTo(200 / 300 - baseline, 10);
    expect(legacy.sampleSize).toBe(300);
    expect(legacy.explanation).toBe("Fuerte contra Lina");
  });

  test("enemigos conocidos todos bajo 200 partidas: null con params legacy, raw shrunk real con params de produccion", () => {
    const state = draftState({ picks: { radiant: [], dire: [10, 11] } });
    const snapshot = meta({
      matchups: {
        1: [
          { vsHero: 10, games: 150, wins: 80 },
          { vsHero: 11, games: 199, wins: 100 },
        ],
      },
    });

    // Params legacy: 150 y 199 < 200 -> ninguno aporta -> raw null (comportamiento previo).
    const legacy = createCounterScorer(NO_CURATED, LEGACY).score(state, 1, snapshot);
    expect(legacy.raw).toBeNull();
    expect(legacy.sampleSize).toBe(0);

    // Params de produccion (minGames 10 + shrinkage): ambos aportan, raw real.
    const prod = createCounterScorer(NO_CURATED).score(state, 1, snapshot);
    expect(prod.raw).not.toBeNull();
    expect(Number.isFinite(prod.raw as number)).toBe(true);
    expect(prod.sampleSize).toBe(150 + 199);
  });

  test("el caso raw: null se prueba con muestras < COUNTER_MIN_GAMES", () => {
    const state = draftState({ picks: { radiant: [], dire: [10] } });
    const snapshot = meta({
      matchups: { 1: [{ vsHero: 10, games: COUNTER_MIN_GAMES - 1, wins: 6 }] },
    });

    const result = createCounterScorer(NO_CURATED).score(state, 1, snapshot);
    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
  });
});

describe("createCounterScorer -- capa curada (§14.10-3)", () => {
  const huskarCounteredByAA = new Map<HeroId, CuratedCounter[]>([
    [59, [{ vs: 68, level: "hard", why: "Ice Blast de Ancient Apparition bloquea toda tu curacion" }]],
  ]);

  test("hard counter en tu contra -> raw fuertemente negativo con el why en la explanation", () => {
    const state = draftState({ picks: { radiant: [], dire: [68] } });
    const snapshot = meta({ heroes: { 68: { id: 68, localizedName: "Ancient Apparition" } } });

    const result = createCounterScorer(huskarCounteredByAA).score(state, 59, snapshot);

    expect(result.raw).toBeCloseTo(-0.12, 10); // -M.hard
    expect(result.explanation).toContain("Ice Blast");
    expect(result.sampleSize).toBe(0); // la capa curada no tiene muestra
  });

  test("direccion inversa: le haces counter a un rival revelado -> raw positivo", () => {
    const state = draftState({ picks: { radiant: [], dire: [59] } });
    const snapshot = meta({ heroes: { 59: { id: 59, localizedName: "Huskar" } } });

    const result = createCounterScorer(huskarCounteredByAA).score(state, 68, snapshot);

    expect(result.raw).toBeCloseTo(0.12, 10); // +M.hard
    expect(result.explanation).toContain("Le ganás a Huskar");
    expect(result.sampleSize).toBe(0);
  });

  test("la capa curada tiene prioridad sobre la estadistica para ese rival", () => {
    const state = draftState({ picks: { radiant: [], dire: [68] } });
    const snapshot = meta({
      heroes: { 68: { id: 68, localizedName: "Ancient Apparition" } },
      // Un matchup estadistico que, de usarse, daria un numero distinto de -0.12.
      matchups: { 59: [{ vsHero: 68, games: 300, wins: 250 }, { vsHero: 99, games: 100, wins: 20 }] },
    });

    const result = createCounterScorer(huskarCounteredByAA).score(state, 59, snapshot);
    expect(result.raw).toBeCloseTo(-0.12, 10);
  });
});

describe("createCounterScorer -- capa estadistica: zona gris y shrinkage (§14.10-4, §14.10-5)", () => {
  test("zona gris: dos candidatos con winrate real distinto sobre ~60 partidas -> counter los diferencia (hoy ambos null)", () => {
    const state = draftState({ picks: { radiant: [], dire: [10] } });
    const snapshot = meta({
      matchups: {
        1: [
          { vsHero: 10, games: 60, wins: 39 }, // 0.65 vs el rival
          { vsHero: 99, games: 100, wins: 50 }, // filler para la base
        ],
        2: [
          { vsHero: 10, games: 60, wins: 27 }, // 0.45 vs el rival
          { vsHero: 99, games: 100, wins: 50 },
        ],
      },
    });

    // Hoy (umbral 200) ambos son null.
    expect(createCounterScorer(NO_CURATED, LEGACY).score(state, 1, snapshot).raw).toBeNull();
    expect(createCounterScorer(NO_CURATED, LEGACY).score(state, 2, snapshot).raw).toBeNull();

    // Con Fase 8 los diferencia: el que gana el matchup queda por encima.
    const scorer = createCounterScorer(NO_CURATED);
    const a = scorer.score(state, 1, snapshot).raw;
    const b = scorer.score(state, 2, snapshot).raw;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a as number).toBeGreaterThan(0);
    expect(b as number).toBeLessThan(0);
    expect(a as number).toBeGreaterThan(b as number);
  });

  test("shrinkage: 15 vs 180 partidas con el mismo winrate observado -> el chico conserva mucha menos senal", () => {
    const state = draftState({ picks: { radiant: [], dire: [10] } });
    const big = meta({
      matchups: {
        1: [
          { vsHero: 10, games: 180, wins: 108 }, // 0.60
          { vsHero: 99, games: 100, wins: 50 },
        ],
      },
    });
    const small = meta({
      matchups: {
        1: [
          { vsHero: 10, games: 15, wins: 9 }, // 0.60, mismo winrate observado
          { vsHero: 99, games: 100, wins: 50 },
        ],
      },
    });

    const scorer = createCounterScorer(NO_CURATED); // shrinkPriorStrength = COUNTER_SHRINK_PRIOR_STRENGTH
    const rawBig = scorer.score(state, 1, big).raw as number;
    const rawSmall = scorer.score(state, 1, small).raw as number;

    const deltaBig = 0.6 - (108 + 50) / (180 + 100);
    const deltaSmall = 0.6 - (9 + 50) / (15 + 100);

    // Fraccion del delta que sobrevive al shrinkage = games / (games + P).
    expect(rawBig / deltaBig).toBeCloseTo(180 / (180 + COUNTER_SHRINK_PRIOR_STRENGTH), 6);
    expect(rawSmall / deltaSmall).toBeCloseTo(15 / (15 + COUNTER_SHRINK_PRIOR_STRENGTH), 6);
    expect(rawSmall / deltaSmall).toBeLessThan(rawBig / deltaBig);
  });
});

describe("createCounterScorer -- degradacion (§14.10-6)", () => {
  test("curated vacio -> cae a la capa estadistica sola, cero excepcion", () => {
    const state = draftState({ picks: { radiant: [], dire: [10] } });
    const snapshot = meta({
      matchups: { 1: [{ vsHero: 10, games: 300, wins: 200 }, { vsHero: 99, games: 100, wins: 40 }] },
    });

    expect(() => createCounterScorer(NO_CURATED).score(state, 1, snapshot)).not.toThrow();
    const result = createCounterScorer(NO_CURATED).score(state, 1, snapshot);
    expect(result.raw).not.toBeNull();
    expect(result.sampleSize).toBe(300);
  });
});

// TSK-188 (SPEC.md §14.13): alivio positivo "tus counters estan baneados = pick mas libre".
describe("createCounterScorer -- alivio por counters baneados (§14.13)", () => {
  const MORPHLING = 10;
  const SILENCER = 75;
  const ANCIENT_APPARITION = 68;
  const NECROPHOS = 36;

  // Morphling countereado por Silencer (hard) + AA (medium) -- caso del usuario.
  const morphCounters = new Map<HeroId, CuratedCounter[]>([
    [MORPHLING, [
      { vs: SILENCER, level: "hard", why: "Global Silence de Silencer te apaga el Morph" },
      { vs: ANCIENT_APPARITION, level: "medium", why: "Ice Blast te niega el Morph a vida" },
    ]],
  ]);
  const heroNames = {
    [SILENCER]: { id: SILENCER, localizedName: "Silencer" },
    [ANCIENT_APPARITION]: { id: ANCIENT_APPARITION, localizedName: "Ancient Apparition" },
    [NECROPHOS]: { id: NECROPHOS, localizedName: "Necrophos" },
  };

  test("pick 1, sin enemigos revelados: un counter tuyo baneado -> raw positivo con el nombre en la explanation", () => {
    const state = draftState({ banned: [SILENCER], picks: { radiant: [], dire: [] } });
    const result = createCounterScorer(morphCounters).score(state, MORPHLING, meta({ heroes: heroNames }));

    expect(result.raw).toBeCloseTo(0.04, 10); // BAN_RELIEF.hard
    expect(result.explanation).toBe("1 de sus counters está baneado: Silencer");
    expect(result.sampleSize).toBe(0);
  });

  test("dos counters baneados topan el cap BAN_RELIEF_CAP", () => {
    const twoHard = new Map<HeroId, CuratedCounter[]>([
      [MORPHLING, [
        { vs: SILENCER, level: "hard", why: "a" },
        { vs: ANCIENT_APPARITION, level: "hard", why: "b" },
      ]],
    ]);
    const state = draftState({ banned: [SILENCER, ANCIENT_APPARITION], picks: { radiant: [], dire: [] } });
    const result = createCounterScorer(twoHard).score(state, MORPHLING, meta({ heroes: heroNames }));

    expect(result.raw).toBeCloseTo(0.06, 10); // 0.04 + 0.04 -> cap 0.06
    expect(result.explanation).toBe("2 de sus counters están baneados: Silencer y Ancient Apparition");
  });

  test("ningun counter del candidato baneado -> raw: null, no lanza", () => {
    const state = draftState({ banned: [999], picks: { radiant: [], dire: [] } });
    expect(() => createCounterScorer(morphCounters).score(state, MORPHLING, meta())).not.toThrow();
    expect(createCounterScorer(morphCounters).score(state, MORPHLING, meta()).raw).toBeNull();
  });

  test("rival revelado que te counterea + un counter tuyo baneado -> el alivio se anexa al why de 8A", () => {
    const huskarCounters = new Map<HeroId, CuratedCounter[]>([
      [59, [
        { vs: ANCIENT_APPARITION, level: "hard", why: "Ice Blast de Ancient Apparition bloquea tu curacion" },
        { vs: NECROPHOS, level: "hard", why: "Heartstopper Aura te desgasta" },
      ]],
    ]);
    const state = draftState({ banned: [NECROPHOS], picks: { radiant: [], dire: [ANCIENT_APPARITION] } });
    const result = createCounterScorer(huskarCounters).score(state, 59, meta({ heroes: heroNames }));

    expect(result.raw).toBeCloseTo(-0.12 + 0.04, 10); // -M.hard (AA revelado) + BAN_RELIEF.hard (Necro baneado)
    expect(result.explanation).toContain("Ice Blast");
    expect(result.explanation).toContain("1 de sus counters está baneado: Necrophos");
  });

  test("candado de regresion §14.7 intacto: con params legacy y curated vacio, los bans no cambian nada", () => {
    const withBans = draftState({ banned: [SILENCER, ANCIENT_APPARITION, NECROPHOS], picks: { radiant: [], dire: [10, 11] } });
    const noBans = draftState({ banned: [], picks: { radiant: [], dire: [10, 11] } });
    const snapshot = meta({
      matchups: { 1: [{ vsHero: 10, games: 300, wins: 200 }, { vsHero: 12, games: 500, wins: 250 }] },
    });

    const scorer = createCounterScorer(NO_CURATED, LEGACY);
    expect(scorer.score(withBans, 1, snapshot)).toEqual(scorer.score(noBans, 1, snapshot));
  });
});
