import { describe, expect, test } from "bun:test";
import type { DraftState } from "@/features/draft/types";
import { botPickHero, botPickHeroFromEngine, type HeroPositions, type MetaSnapshot } from "./bot-drafter";
import { createSeededRng } from "./seeded-rng";

// TSK-083: fetchImpl falso -- nunca red real en las pruebas (costura S6/S7, testing-seams.md).
function fakeFetch(handler: (url: string, init: RequestInit) => Promise<Response>): typeof fetch {
  return handler as unknown as typeof fetch;
}

// TSK-063 (hallazgo 2.4 de "Radiografía de dota2coach"): el bot usaba roles[] de OpenDota para su
// bono de "complementa lo que ya pickeé" -- esas etiquetas mal representan la posición real (57%
// de los héroes marcados "Carry"), dejando pasar composiciones inválidas como doble carry. Este
// archivo prueba el reemplazo (posición real vía heroPositions), incluyendo el caso reproducible
// del bug original.

const SPECTRE = 67;
const WRAITH_KING = 42;
const CRYSTAL_MAIDEN = 5;

const HERO_POSITIONS: HeroPositions = {
  [SPECTRE]: [{ position: 1, matches: 4476 }],
  [WRAITH_KING]: [
    { position: 3, matches: 593 },
    { position: 1, matches: 415 },
  ],
  [CRYSTAL_MAIDEN]: [{ position: 5, matches: 2507 }],
};

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "sim-1",
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
    updatedAt: "2026-08-21T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
    ...overrides,
  };
}

function meta(overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return {
    heroes: {
      [SPECTRE]: { id: SPECTRE, localizedName: "Spectre" },
      [WRAITH_KING]: { id: WRAITH_KING, localizedName: "Wraith King" },
      [CRYSTAL_MAIDEN]: { id: CRYSTAL_MAIDEN, localizedName: "Crystal Maiden" },
    },
    heroPositions: HERO_POSITIONS,
    ...overrides,
  };
}

describe("botPickHero -- complemento por posición real (TSK-063)", () => {
  // Candado de regresión del bug original: con Spectre ya pickeado (posición 1 dominante), el
  // bono de "complementa lo que falta" nunca debería favorecer a otro héroe cuya posición
  // dominante también sea 1 -- antes, roles[] podía no distinguir esto si ambos compartían
  // etiquetas ambiguas.
  test("con Spectre ya pickeado, Wraith King (pos 1 dominante) no recibe el bono de complemento", () => {
    const state = draftState({ picks: { radiant: [SPECTRE], dire: [] } });
    const snapshot = meta({
      patchStats: {
        [WRAITH_KING]: [{ patch: "7.36", bracket: "all", picks: 100, wins: 50 }],
        [CRYSTAL_MAIDEN]: [{ patch: "7.36", bracket: "all", picks: 100, wins: 50 }],
      },
    });

    // Mismo pick rate base para los dos candidatos -- la única diferencia posible en el score es
    // el bono de complemento de posición.
    const result = botPickHero({
      draftState: state,
      botSide: "radiant",
      meta: snapshot,
      rng: createSeededRng("AAAAAAAA"),
      conflictCount: 0,
    });

    // Crystal Maiden (posición 5, hueco real) gana por el bono; Wraith King (posición 1,
    // duplicado real) no lo recibe.
    expect(result?.heroId).toBe(CRYSTAL_MAIDEN);
  });

  test("candidato sin dato de posición nunca recibe el bono (degrada a false, no rompe)", () => {
    const state = draftState({ picks: { radiant: [SPECTRE], dire: [] } });
    const heroSinPosicion = 999;
    const snapshot = meta({
      heroes: { ...meta().heroes, [heroSinPosicion]: { id: heroSinPosicion, localizedName: "Sin dato" } },
      patchStats: { [heroSinPosicion]: [{ patch: "7.36", bracket: "all", picks: 100, wins: 50 }] },
    });

    const result = botPickHero({
      draftState: state,
      botSide: "radiant",
      meta: snapshot,
      rng: createSeededRng("AAAAAAAA"),
      conflictCount: 0,
    });

    expect(result).not.toBeNull();
  });

  test("heroPositions ausente en el meta no rompe el bot -- degrada a sin bono para nadie", () => {
    const state = draftState({ picks: { radiant: [SPECTRE], dire: [] } });
    const snapshot = meta({
      heroPositions: undefined,
      patchStats: { [CRYSTAL_MAIDEN]: [{ patch: "7.36", bracket: "all", picks: 100, wins: 50 }] },
    });

    expect(() =>
      botPickHero({ draftState: state, botSide: "radiant", meta: snapshot, rng: createSeededRng("AAAAAAAA"), conflictCount: 0 }),
    ).not.toThrow();
  });
});

// TSK-083: el bot le pide la sugerencia real al motor (POST /api/suggestions/preview, TSK-082)
// en vez del scoring simplificado -- con fallback a botPickHero ante cualquier fallo, para que
// una caída del motor nunca trabe la sesión (mismo principio de degradación de todo el proyecto).
describe("botPickHeroFromEngine (TSK-083)", () => {
  function baseInput() {
    return { draftState: draftState(), botSide: "dire" as const, meta: meta(), rng: createSeededRng("AAAAAAAA"), conflictCount: 0 };
  }

  test("con una respuesta real del motor, usa el rank 1 devuelto -- no el scoring simplificado", async () => {
    const fetchImpl = fakeFetch(async () =>
      Response.json({ schema: "suggestions/v1", suggestions: [{ hero: CRYSTAL_MAIDEN, rank: 1 }] }),
    );

    const result = await botPickHeroFromEngine(baseInput(), { fetchImpl, baseUrl: "http://fake-engine" });

    expect(result).toEqual({ heroId: CRYSTAL_MAIDEN });
  });

  test("manda el body angosto correcto -- format/patch/localSide/banned/picks, localSide es el lado del bot", async () => {
    let capturedBody: Record<string, unknown> = {};
    const fetchImpl = fakeFetch(async (_url, init) => {
      capturedBody = JSON.parse(String(init.body));
      return Response.json({ schema: "suggestions/v1", suggestions: [{ hero: SPECTRE, rank: 1 }] });
    });

    await botPickHeroFromEngine(baseInput(), { fetchImpl, baseUrl: "http://fake-engine" });

    expect(capturedBody).toMatchObject({ format: "all_pick", patch: "7.36", localSide: "dire", banned: [], picks: { radiant: [], dire: [] } });
  });

  test("respuesta no-ok (4xx/5xx) cae al scoring simplificado, nunca lanza", async () => {
    const fetchImpl = fakeFetch(async () => new Response(null, { status: 503 }));

    const result = await botPickHeroFromEngine(baseInput(), { fetchImpl, baseUrl: "http://fake-engine" });

    expect(result).not.toBeNull();
  });

  test("fetch que lanza (motor inalcanzable) cae al scoring simplificado, nunca lanza", async () => {
    const fetchImpl = fakeFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await botPickHeroFromEngine(baseInput(), { fetchImpl, baseUrl: "http://fake-engine" });

    expect(result).not.toBeNull();
  });

  test("suggestions vacío cae al scoring simplificado, nunca lanza", async () => {
    const fetchImpl = fakeFetch(async () => Response.json({ schema: "suggestions/v1", suggestions: [] }));

    const result = await botPickHeroFromEngine(baseInput(), { fetchImpl, baseUrl: "http://fake-engine" });

    expect(result).not.toBeNull();
  });
});

// TSK-216: candado del bug reportado por el usuario en Railway (2026-08-30) — el bot pickeó Wraith
// King en las 3 rondas y Spectre en 2. La causa real era de transporte (TSK-214: el tablero nunca
// avanzaba, así que cada ronda el bot decidía sobre `dire: []`), pero nada en el camino del bot
// comprobaba disponibilidad. Estas pruebas fijan el candado de forma INDEPENDIENTE del arreglo de
// transporte: aunque el `draftState` vuelva a quedar congelado, repetir un héroe es imposible.
describe("el bot nunca repite un héroe ya tomado (TSK-216)", () => {
  const snapshot = meta({
    patchStats: {
      [WRAITH_KING]: [{ patch: "7.36", bracket: "all", picks: 900, wins: 500 }],
      [SPECTRE]: [{ patch: "7.36", bracket: "all", picks: 800, wins: 440 }],
      [CRYSTAL_MAIDEN]: [{ patch: "7.36", bracket: "all", picks: 700, wins: 380 }],
    },
  });

  test("con el tablero CONGELADO, `excluded` impide repetir el pick de la ronda anterior", () => {
    // El escenario exacto del bug: el tablero dice que nadie pickeó nada, aunque el bot ya se
    // llevó a Wraith King en la ronda 1.
    const frozenBoard = draftState({ picks: { radiant: [], dire: [] } });

    const result = botPickHero({
      draftState: frozenBoard,
      botSide: "dire",
      meta: snapshot,
      rng: createSeededRng("AAAAAAAA"),
      conflictCount: 0,
      excluded: [WRAITH_KING],
    });

    expect(result?.heroId).not.toBe(WRAITH_KING);
    expect(result?.heroId).toBe(SPECTRE);
  });

  test("si el motor recomienda un héroe ya tomado, se baja al siguiente disponible", async () => {
    const frozenBoard = draftState({ picks: { radiant: [], dire: [] } });
    // El motor puntúa contra el estado que le mandamos: si ese estado está viejo, su rank 1 puede
    // ser un héroe que en la realidad ya no está. Antes se aceptaba tal cual.
    const engineSaysTakenHeroFirst = fakeFetch(async () =>
      new Response(JSON.stringify({ suggestions: [{ hero: WRAITH_KING }, { hero: SPECTRE }] }), { status: 200 }),
    );

    const result = await botPickHeroFromEngine(
      {
        draftState: frozenBoard,
        botSide: "dire",
        meta: snapshot,
        rng: createSeededRng("AAAAAAAA"),
        conflictCount: 0,
        excluded: [WRAITH_KING],
      },
      { fetchImpl: engineSaysTakenHeroFirst },
    );

    expect(result?.heroId).toBe(SPECTRE);
  });

  test("si TODA la lista del motor está tomada, decide el heurístico local, que filtra por construcción", async () => {
    const frozenBoard = draftState({ picks: { radiant: [], dire: [] } });
    const engineSaysEverythingTaken = fakeFetch(async () =>
      new Response(JSON.stringify({ suggestions: [{ hero: WRAITH_KING }, { hero: SPECTRE }] }), { status: 200 }),
    );

    const result = await botPickHeroFromEngine(
      {
        draftState: frozenBoard,
        botSide: "dire",
        meta: snapshot,
        rng: createSeededRng("AAAAAAAA"),
        conflictCount: 0,
        excluded: [WRAITH_KING, SPECTRE],
      },
      { fetchImpl: engineSaysEverythingTaken },
    );

    expect(result?.heroId).toBe(CRYSTAL_MAIDEN);
  });

  test("tres rondas encadenadas sobre un tablero congelado dan tres héroes DISTINTOS", () => {
    const frozenBoard = draftState({ picks: { radiant: [], dire: [] } });
    const picked: number[] = [];

    for (let round = 0; round < 3; round++) {
      const result = botPickHero({
        draftState: frozenBoard,
        botSide: "dire",
        meta: snapshot,
        rng: createSeededRng("AAAAAAAA"),
        conflictCount: 0,
        excluded: [...picked],
      });
      expect(result).not.toBeNull();
      picked.push(result!.heroId);
    }

    // El bug daba [42, 42, 42] (Wraith King tres veces). El candado exige 3 distintos.
    expect(new Set(picked).size).toBe(3);
  });
});
