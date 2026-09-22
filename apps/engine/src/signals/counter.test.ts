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

// AP Solo Mid data/signal repair (Dota Judge root cause 3.1, P0 confirmado): `contribs` se
// promediaba en vez de sumarse -- cubrir a DOS rivales revelados con la misma intensidad daba el
// MISMO raw que cubrir a uno solo, y en el caso medido (mobility: Storm Spirit + Puck), un
// candidato que contrarrestaba a AMBOS rivales rankeó #6 con el mismo raw que otro que sólo
// contrarrestaba a UNO. La fórmula correcta es la suma de la evidencia disponible, no su promedio
// -- estos casos no usan ningún nombre de héroe como regla de negocio, son puramente estructurales.
describe("createCounterScorer -- agregación multi-rival (§ root cause 3.1, no promediar cobertura)", () => {
  const HERO = 1;
  const RIVAL_A = 10;
  const RIVAL_B = 11;

  test("dos positivos (medium c/u contra dos rivales distintos) -> raw es la SUMA, no el promedio", () => {
    const curated = new Map([
      [RIVAL_A, [{ vs: HERO, level: "medium" as const, why: "gana a A" }]],
      [RIVAL_B, [{ vs: HERO, level: "medium" as const, why: "gana a B" }]],
    ]);
    const oneRival = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A] } }),
      HERO,
      meta(),
    );
    const twoRivals = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A, RIVAL_B] } }),
      HERO,
      meta(),
    );

    expect(oneRival.raw).toBeCloseTo(0.06, 10); // M.medium, un solo rival
    expect(twoRivals.raw).toBeCloseTo(0.12, 10); // suma de dos medium -- NO 0.06 (lo que daría un promedio)
    // El requisito literal del hallazgo: cubrir más rivales comparables nunca vale menos.
    expect(twoRivals.raw as number).toBeGreaterThan(oneRival.raw as number);
  });

  test("dos negativos (medium c/u, el candidato es countereado por ambos) -> raw es la suma negativa", () => {
    const curated = new Map([[HERO, [
      { vs: RIVAL_A, level: "medium" as const, why: "A le gana" },
      { vs: RIVAL_B, level: "medium" as const, why: "B le gana" },
    ]]]);
    const result = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A, RIVAL_B] } }),
      HERO,
      meta(),
    );

    expect(result.raw).toBeCloseTo(-0.12, 10);
  });

  test("positivo + negativo (uno a favor, uno en contra, ambos medium) -> se cancelan, no se promedian a -0.03/+0.03", () => {
    const curated = new Map([
      [RIVAL_A, [{ vs: HERO, level: "medium" as const, why: "gana a A" }]], // a favor de HERO
      [HERO, [{ vs: RIVAL_B, level: "medium" as const, why: "B le gana a HERO" }]], // en contra de HERO
    ]);
    const result = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A, RIVAL_B] } }),
      HERO,
      meta(),
    );

    expect(result.raw).toBeCloseTo(0, 10); // +0.06 + (-0.06) -- ni 0.03 ni -0.03 (eso sería promedio)
  });

  test("positivo + neutral (el segundo rival no tiene NINGÚN dato, curado ni estadístico) -> no diluye al primero", () => {
    const curated = new Map([[RIVAL_A, [{ vs: HERO, level: "medium" as const, why: "gana a A" }]]]);
    // RIVAL_B no aparece en `curated` ni en `meta().matchups` -- capa curada Y estadística vacías
    // para ese rival, así que no aporta ningún elemento a `contribs` (se salta, no cuenta como 0).
    const withUnknown = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A, RIVAL_B] } }),
      HERO,
      meta(),
    );
    const withoutUnknown = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A] } }),
      HERO,
      meta(),
    );

    expect(withUnknown.raw).toBeCloseTo(0.06, 10);
    expect(withUnknown.raw).toBeCloseTo(withoutUnknown.raw as number, 10); // el rival "unknown" no mueve la aguja
  });

  test("dos hard (0.12 c/u) -> la suma excede M.hard sin clamp cuando no hay alivio por bans, igual que hoy con un solo rival", () => {
    const curated = new Map([
      [RIVAL_A, [{ vs: HERO, level: "hard" as const, why: "gana duro a A" }]],
      [RIVAL_B, [{ vs: HERO, level: "hard" as const, why: "gana duro a B" }]],
    ]);
    const result = createCounterScorer(curated).score(
      draftState({ picks: { radiant: [], dire: [RIVAL_A, RIVAL_B] } }),
      HERO,
      meta(),
    );

    expect(result.raw).toBeCloseTo(0.24, 10); // 2 x M.hard, sin clamp (banRelief === 0)
  });

  test("reproduce el caso medido: cubrir a dos rivales con medium nunca vale menos que cubrir a uno solo con medium", () => {
    // Estructuralmente idéntico al hallazgo P0 (mobility: dos enemigos móviles). Riki-equivalente
    // (A) contrarresta a AMBOS rivales con medium y no pierde contra ninguno; Huskar-equivalente
    // (B) sólo contrarresta a uno de los dos, también medium. Ningún nombre de héroe real se usa
    // como regla de negocio -- son IDs sintéticos.
    const COVERS_BOTH = 20;
    const COVERS_ONE = 21;
    const curated = new Map([
      [RIVAL_A, [
        { vs: COVERS_BOTH, level: "medium" as const, why: "A cubre a ambos, parte 1" },
        { vs: COVERS_ONE, level: "medium" as const, why: "B cubre a uno, parte 1" },
      ]],
      [RIVAL_B, [{ vs: COVERS_BOTH, level: "medium" as const, why: "A cubre a ambos, parte 2" }]],
    ]);
    const state = draftState({ picks: { radiant: [], dire: [RIVAL_A, RIVAL_B] } });

    const coversBoth = createCounterScorer(curated).score(state, COVERS_BOTH, meta());
    const coversOne = createCounterScorer(curated).score(state, COVERS_ONE, meta());

    expect(coversBoth.raw as number).toBeGreaterThanOrEqual(coversOne.raw as number);
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

describe("Wave 5 Hardening (H1/RH-R3) -- hasRevealedEnemyCounterEvidence producer logic", () => {
  const CANDIDATE = 1;
  const REVEALED_ENEMY = 10;
  const BANNED_COUNTER = 99;

  test("Case A: revealed enemy, negative statistical delta, positive ban relief, no curated relation -> false", () => {
    // Candidate 1 has a banned counter (99) that gives positive ban relief (+0.04).
    // Candidate 1 faces revealed enemy (10) where statistical delta is negative.
    // Candidate 1 has NO curated relation against enemy 10.
    const curated = new Map<HeroId, CuratedCounter[]>([
      [CANDIDATE, [{ vs: BANNED_COUNTER, level: "hard", why: "Banned counter" }]],
    ]);
    const state = draftState({
      banned: [BANNED_COUNTER],
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    // Matchup: 10 vs 10: 10 wins out of 50 (winrate 0.20), vs 88: 40 wins out of 50 (winrate 0.80).
    // Overall baseline is (10 + 40) / 100 = 0.50.
    // Observed winrate vs 10 is 0.20, delta is 0.20 - 0.50 = -0.30 (negative!).
    const snapshot = meta({
      matchups: {
        [CANDIDATE]: [
          { vsHero: REVEALED_ENEMY, games: 50, wins: 10 },
          { vsHero: 88, games: 50, wins: 40 },
        ],
      },
    });

    const scorer = createCounterScorer(curated);
    const result = scorer.score(state, CANDIDATE, snapshot);

    expect(result.raw).not.toBeNull();
    expect(result.hasRevealedEnemyCounterEvidence).toBe(false);
  });

  test("Case B: revealed enemy, positive statistical delta -> true", () => {
    // Candidate 1 faces revealed enemy (10) with positive statistical delta and no curated relations.
    const state = draftState({
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    // Matchup: 40 wins out of 50 vs 10 (winrate 0.80), baseline 0.50 -> positive delta (+0.30)
    const snapshot = meta({
      matchups: {
        [CANDIDATE]: [
          { vsHero: REVEALED_ENEMY, games: 50, wins: 40 },
          { vsHero: 88, games: 50, wins: 10 },
        ],
      },
    });

    const scorer = createCounterScorer(NO_CURATED);
    const result = scorer.score(state, CANDIDATE, snapshot);

    expect(result.raw).toBeGreaterThan(0);
    expect(result.hasRevealedEnemyCounterEvidence).toBe(true);
  });

  test("Case C: revealed enemy, curated counter relation -> true", () => {
    // Revealed enemy (10) is counter-picked by candidate 1 via curated relationship.
    const curated = new Map<HeroId, CuratedCounter[]>([
      [REVEALED_ENEMY, [{ vs: CANDIDATE, level: "hard", why: "Candidate counters revealed enemy" }]],
    ]);
    const state = draftState({
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    const scorer = createCounterScorer(curated);
    const result = scorer.score(state, CANDIDATE, meta());

    expect(result.raw).toBeCloseTo(0.12, 10);
    expect(result.hasRevealedEnemyCounterEvidence).toBe(true);
  });

  test("Case D: ban relief only with no revealed-enemy advantage -> false", () => {
    const curated = new Map<HeroId, CuratedCounter[]>([
      [CANDIDATE, [{ vs: BANNED_COUNTER, level: "hard", why: "Banned counter" }]],
    ]);

    // D1: No revealed enemies at all, only ban relief
    const stateNoEnemies = draftState({
      banned: [BANNED_COUNTER],
      picks: { radiant: [], dire: [] },
    });
    const resNoEnemies = createCounterScorer(curated).score(stateNoEnemies, CANDIDATE, meta());
    expect(resNoEnemies.raw).toBeCloseTo(0.04, 10);
    expect(resNoEnemies.hasRevealedEnemyCounterEvidence).toBe(false);

    // D2: Revealed enemy present, but candidate has zero or negative matchup advantage
    const stateWithEnemy = draftState({
      banned: [BANNED_COUNTER],
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    const snapshotEven = meta({
      matchups: {
        [CANDIDATE]: [
          { vsHero: REVEALED_ENEMY, games: 50, wins: 25 },
          { vsHero: 88, games: 50, wins: 25 },
        ],
      },
    });
    const resWithEnemy = createCounterScorer(curated).score(stateWithEnemy, CANDIDATE, snapshotEven);
    expect(resWithEnemy.hasRevealedEnemyCounterEvidence).toBe(false);
  });

  test("Case E: curated medium contributes to score (+0.06) but hasRevealedEnemyCounterEvidence is false", () => {
    const curated = new Map<HeroId, CuratedCounter[]>([
      [REVEALED_ENEMY, [{ vs: CANDIDATE, level: "medium", why: "Candidate medium counters revealed enemy" }]],
    ]);
    const state = draftState({
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    const scorer = createCounterScorer(curated);
    const result = scorer.score(state, CANDIDATE, meta());

    expect(result.raw).toBeCloseTo(0.06, 10);
    // Medium contributes to score, but does NOT qualify alone for the visible COUNTER claim
    expect(result.hasRevealedEnemyCounterEvidence).toBe(false);
  });

  test("Case F: statistical counter below sample size floor (N < 40) does not qualify", () => {
    // games: 25 (below floor 40), wins: 20 -> raw delta is high (+0.30), but sample is under floor
    const snapshot = meta({
      matchups: {
        [CANDIDATE]: [
          { vsHero: REVEALED_ENEMY, games: 25, wins: 20 },
          { vsHero: 88, games: 25, wins: 5 },
        ],
      },
    });
    const state = draftState({
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    const scorer = createCounterScorer(NO_CURATED);
    const result = scorer.score(state, CANDIDATE, snapshot);

    expect(result.raw).toBeGreaterThan(0);
    expect(result.hasRevealedEnemyCounterEvidence).toBe(false);
  });

  test("Case G: statistical counter with shrunk delta below +0.04 does not qualify", () => {
    // games: 50, wins: 26 -> winrate 0.52 vs baseline 0.50 -> delta +0.02 (below +0.04)
    const snapshot = meta({
      matchups: {
        [CANDIDATE]: [
          { vsHero: REVEALED_ENEMY, games: 50, wins: 26 },
          { vsHero: 88, games: 50, wins: 24 },
        ],
      },
    });
    const state = draftState({
      picks: { radiant: [], dire: [REVEALED_ENEMY] },
    });
    const scorer = createCounterScorer(NO_CURATED);
    const result = scorer.score(state, CANDIDATE, snapshot);

    expect(result.raw).toBeGreaterThan(0);
    expect(result.hasRevealedEnemyCounterEvidence).toBe(false);
  });
});
