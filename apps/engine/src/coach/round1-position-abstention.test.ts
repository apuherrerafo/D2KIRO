import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { deriveCandidateResult } from "./current-human-decision";
import { fakeCompute, harness } from "./session-harness.fixtures";

// R4.1 -- Ronda 1, Pos2 / Pos4 abiertas, sin ningún pick visible. Candado del contrato de elegibilidad (recommendation-eligibility.ts) en la
// frontera que el oráculo de R4 confundió: "existe algún counter curado contra un baneado" NO es un fundamento. Un ban solo abre a un héroe si
// (a) el counter baneado trae porqué, (b) pesa (es fuerte, o ≥ 1/4 de la lista del héroe) y (c) no queda libre un counter FUERTE probable.
// Cada caso fija una de esas tres compuertas y su contrario, para que "cards: []" y "cards: [X]" sean ambos aserciones reales, no una impresión.
// Fixtures inline (S9/S10): ningún dato curado real.

const WHY = "Orchid lo silencia y no puede hacer nada";
const BAN = 90; // héroe baneado que counterea a los candidatos
const FREE_HARD = 91; // counter fuerte que sigue libre
const POOL = [10, 11, 12, 13, 14];
const POSITIONS: HeroPositions = {
  10: [{ position: 2, matches: 1000 }],
  11: [{ position: 2, matches: 1000 }],
  12: [{ position: 2, matches: 600 }, { position: 4, matches: 600 }], // flex Pos2/Pos4
  13: [{ position: 4, matches: 1000 }],
  14: [{ position: 4, matches: 1000 }],
};

type Counters = ReadonlyMap<number, readonly CuratedCounter[]>;
const hard = (vs: number, why = WHY): CuratedCounter => ({ vs, level: "hard", why });
const medium = (vs: number, why = WHY): CuratedCounter => ({ vs, level: "medium", why });
/** Doce counters medium libres (ids 200..211): una lista larga en la que un solo ban pesa < 1/4. */
const longFreeList = (): CuratedCounter[] => Array.from({ length: 12 }, (_, i) => medium(200 + i));

async function cardsAt(position: Position, bans: number[], heroCounters: Counters): Promise<number[]> {
  const h = harness({ adapterKind: "simulator", controlledPositions: [position], humanPosition: position, bans, heroCounters, heroPositions: POSITIONS, pool: POOL });
  const context: PerspectiveRecommendationContext = { ...h.store.perspectiveRecommendationContext(h.id)!, playerPoolsByPosition: null };
  const ranking = await buildRecommendationSetFromPerspective({
    context,
    computeSuggestions: fakeCompute(POOL, POSITIONS),
    heroPositions: POSITIONS,
    targetPosition: position,
    teamOpening: false,
    singleSlotEvaluation: true,
    candidateHeroIds: POOL.filter((hero) => POSITIONS[hero]!.some((entry) => entry.position === position)),
    candidateLimit: 30,
    outputLimit: 30,
  });
  const result = deriveCandidateResult({ targetPosition: position, targetRanking: ranking, view: context.view, heroPositions: POSITIONS, heroCounters, personalPoolApplied: false, shortlistSize: 5 });
  return result.cards.map((card) => card.heroId);
}

describe("R4.1 -- Ronda 1 con Pos2/Pos4 abiertas: tarjetas solo con fundamento", () => {
  test("Pos2: un ban FUERTE con porqué, sin counter fuerte libre, abre a ese héroe y a nadie más", async () => {
    const counters: Counters = new Map([[10, [hard(BAN)]]]);
    expect(await cardsAt(2, [BAN], counters)).toEqual([10]);
  });

  test("Pos4: el mismo fundamento, en la otra columna", async () => {
    const counters: Counters = new Map([[13, [hard(BAN)]]]);
    expect(await cardsAt(4, [BAN], counters)).toEqual([13]);
  });

  test("falso positivo de R4: un counter MEDIO baneado dentro de una lista larga (< 1/4) NO abre al héroe -> cards: []", async () => {
    const counters: Counters = new Map([[10, [medium(BAN), ...longFreeList()]], [13, [medium(BAN), ...longFreeList()]]]);
    expect(await cardsAt(2, [BAN], counters)).toEqual([]);
    expect(await cardsAt(4, [BAN], counters)).toEqual([]);
  });

  test("falso positivo de R4: un counter FUERTE sigue libre y probable -> el ban no abre al héroe -> cards: []", async () => {
    const counters: Counters = new Map([[10, [hard(BAN), hard(FREE_HARD)]], [13, [hard(BAN), hard(FREE_HARD)]]]);
    expect(await cardsAt(2, [BAN], counters)).toEqual([]);
    expect(await cardsAt(4, [BAN], counters)).toEqual([]);
  });

  test("el mismo héroe, con el counter fuerte libre también baneado: vuelve a abrirse (la abstención no es permanente, depende del estado)", async () => {
    const counters: Counters = new Map([[10, [hard(BAN), hard(FREE_HARD)]]]);
    expect(await cardsAt(2, [BAN, FREE_HARD], counters)).toEqual([10]);
  });

  test("una atribución sin porqué ('Lo dicen: …') no es fundamento, aunque sea fuerte y esté baneada -> cards: []", async () => {
    const counters: Counters = new Map([[10, [hard(BAN, "Lo dicen: DotaCoach (7.41f)")]], [13, [hard(BAN, "Lo dicen: DotaCoach (7.41f)")]]]);
    expect(await cardsAt(2, [BAN], counters)).toEqual([]);
    expect(await cardsAt(4, [BAN], counters)).toEqual([]);
  });

  test("sin ningún ban relevante: ni Pos2 ni Pos4 muestran un héroe por su posición, su winrate ni su popularidad", async () => {
    const counters: Counters = new Map([[10, [hard(BAN)]], [13, [hard(BAN)]]]);
    expect(await cardsAt(2, [], counters)).toEqual([]);
    expect(await cardsAt(4, [], counters)).toEqual([]);
  });

  test("héroe flex Pos2/Pos4: con fundamento aparece en la columna de su rol resuelto; sin fundamento, en ninguna", async () => {
    // Solo se fija la columna del rol resuelto. Que un flex con fundamento TAMBIÉN deba verse en la otra columna es una decisión de producto
    // abierta (COHERENCE-006 lo descarta hoy a propósito) y no se ancla aquí.
    const withGround: Counters = new Map([[12, [hard(BAN)]]]);
    expect(await cardsAt(2, [BAN], withGround)).toEqual([12]);
    const withoutGround: Counters = new Map([[12, [medium(BAN), ...longFreeList()]]]);
    expect(await cardsAt(2, [BAN], withoutGround)).toEqual([]);
    expect(await cardsAt(4, [BAN], withoutGround)).toEqual([]);
  });

  test("un héroe baneado jamás es tarjeta, aunque tenga el mejor fundamento del estado", async () => {
    const counters: Counters = new Map([[10, [hard(BAN)]], [11, [hard(BAN)]]]);
    const cards = await cardsAt(2, [BAN, 10], counters);
    expect(cards).not.toContain(10);
    expect(cards).toEqual([11]);
  });
});
