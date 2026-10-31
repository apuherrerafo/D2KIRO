import { describe, expect, test } from "bun:test";
import { assessCompositionNeedsOf, ownPicksRemainingFor } from "../draft-paths/gaps";
import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCardRisks, deriveCompositionContext } from "./card-critical-gap";
import { deriveCandidateResult } from "./current-human-decision";
import { extractHeroCandidates } from "./hero-card";
import { hidden, known, recSet, resolvedImpact, signal, view, type HeroFixture } from "./test.fixtures";

// Aviso CRITICAL_GAP (rescatado de TSK-254, cadena F1). Fixtures inline (costura S9): jamás capabilities.json real.
// Los ids de héroe son etiquetas arbitrarias.

const CANDIDATE = 7;
const hero = (id: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities =>
  ({ hero: id, damageType: "physical", hasInitiation: false, hasCatch: true, hasWaveclear: true, structuralDamage: "medium", teamfight: "medium", scaling: "medium", ...overrides });

// Equipo propio 1, 2, 3: tiene catch/waveclear y dos tipos de daño, pero NO tiene iniciador.
const TEAM = [hero(1), hero(2, { damageType: "magical" }), hero(3)];
const NON_INITIATOR = hero(CANDIDATE);
const INITIATOR = hero(CANDIDATE, { hasInitiation: true });

const solid: HeroFixture = { heroId: CANDIDATE, signals: [signal("position_fit", 0.7, 20)], impact: resolvedImpact(1) };
const candidateOf = () => extractHeroCandidates(recSet([solid]))[0]!;
const closing = (own = [known(1), known(2), known(3)]) => view("PICK_ROUND_2", own, [hidden(), hidden()]);
const risksOf = (capabilities: HeroCapabilities[], viewArg = closing()) =>
  deriveCardRisks(candidateOf(), deriveCompositionContext(viewArg, capabilities));
const kinds = (risks: { kind: string }[]) => risks.map((risk) => risk.kind);

describe("CRITICAL_GAP -- sólo con una carencia crítica demostrable", () => {
  test("equipo sin iniciador, 2 picks por delante, héroe sin iniciación -> aviso, con el hueco y los picks nombrados", () => {
    const risks = risksOf([...TEAM, NON_INITIATOR]);
    expect(kinds(risks)).toEqual(["CRITICAL_GAP"]);
    expect(risks[0]!.detail).toContain("iniciación");
    expect(risks[0]!.detail).toContain("te quedan 2 picks");
    expect(risks[0]!.detail).toContain("según las capacidades curadas");
    expect(risks[0]!.heroIds).toEqual([]); // el hueco es del equipo, no de héroes rivales
  });

  test("con 1 pick por delante el texto concuerda en singular", () => {
    const viewArg = view("PICK_ROUND_3", [known(1), known(2), known(3), known(4)], [hidden()]);
    const risks = risksOf([...TEAM, hero(4), NON_INITIATOR], viewArg);
    expect(risks[0]?.detail).toContain("te queda 1 pick");
  });

  test("un héroe que SÍ llena el hueco no lleva el aviso", () => {
    expect(risksOf([...TEAM, INITIATOR])).toEqual([]);
  });

  test("fuera de la ventana de cierre (3 picks por delante) el hueco está abierto pero no es crítico: sin aviso", () => {
    const early = view("PICK_ROUND_2", [known(1), known(2)], [hidden(), hidden()]);
    expect(risksOf([...TEAM, NON_INITIATOR], early)).toEqual([]);
  });

  test("el equipo ya tiene iniciador -> no hay carencia, sin aviso", () => {
    const team = [hero(1, { hasInitiation: true }), hero(2, { damageType: "magical" }), hero(3)];
    expect(risksOf([...team, NON_INITIATOR])).toEqual([]);
  });

  test("monodaño crítico: un héroe del mismo tipo lo lleva ('un segundo tipo de daño'); uno de otro tipo no", () => {
    const mono = [hero(1, { hasInitiation: true }), hero(2, { hasInitiation: true }), hero(3, { hasInitiation: true })];
    const same = risksOf([...mono, hero(CANDIDATE, { hasInitiation: true })]);
    expect(kinds(same)).toEqual(["CRITICAL_GAP"]);
    expect(same[0]!.detail).toContain("un segundo tipo de daño");
    expect(risksOf([...mono, hero(CANDIDATE, { hasInitiation: true, damageType: "magical" })])).toEqual([]);
  });
});

describe("CRITICAL_GAP -- lo desconocido nunca se presenta como certeza", () => {
  test("un pick propio sin capacidades curadas: no se puede decir que 'falta' algo -> sin aviso", () => {
    // El héroe 99 no tiene capacidades curadas: podría ser el iniciador que "falta".
    const viewArg = closing([known(1), known(2), known(99)]);
    expect(risksOf([hero(1), hero(2, { damageType: "magical" }), NON_INITIATOR], viewArg)).toEqual([]);
  });

  test("un candidato sin capacidades curadas nunca se declara como 'no lo cubre'", () => {
    expect(risksOf(TEAM)).toEqual([]); // CANDIDATE no está en las capacidades
  });

  test("sin capacidades inyectadas el aviso no se puede derivar (y no se adivina)", () => {
    const viewArg = closing();
    expect(deriveCompositionContext(viewArg, undefined)).toBeUndefined();
    expect(deriveCompositionContext(viewArg, [])).toBeUndefined();
    expect(deriveCardRisks(candidateOf(), undefined)).toEqual([]);
  });

  test("sin lado de jugador conocido (vista sin viewerSide) no hay equipo propio: sin aviso", () => {
    const blind = { ...closing(), viewerSide: null };
    expect(risksOf([...TEAM, NON_INITIATOR], blind)).toEqual([]);
  });
});

describe("CRITICAL_GAP -- candado de regresión cero: no toca el ranking ni el resto de la tarjeta", () => {
  const POSITIONS: HeroPositions = { 7: [{ position: 1, matches: 3000 }], 8: [{ position: 1, matches: 3000 }] };
  const heroes: HeroFixture[] = [
    { heroId: 7, signals: [signal("position_fit", 0.9, 30, { sampleSize: 3000 })], impact: resolvedImpact(1) },
    { heroId: 8, signals: [signal("position_fit", 0.8, 20, { sampleSize: 3000 })], impact: resolvedImpact(1) },
  ];
  const derive = (heroCapabilities: HeroCapabilities[] | undefined) =>
    deriveCandidateResult({ targetPosition: 1, targetRanking: recSet(heroes), view: closing(), heroPositions: POSITIONS, heroCapabilities, personalPoolApplied: false });

  test("con y sin capacidades: orden, puntajes, insignias y razón idénticos; sólo cambian los avisos", () => {
    const without = derive(undefined);
    // 7 no inicia (el hueco queda abierto para él); 8 sí inicia.
    const withCaps = derive([...TEAM, hero(7), hero(8, { hasInitiation: true })]);
    if (without.state !== "RANKED" || withCaps.state !== "RANKED") throw new Error("expected RANKED");
    const shape = (cards: typeof without.cards) => cards.map((card) => [card.heroId, card.rank, card.score, card.badges, card.rationale, card.confidence]);
    expect(shape(withCaps.cards)).toEqual(shape(without.cards));
    expect(without.cards.map((card) => card.risks)).toEqual([[], []]);
    expect(withCaps.cards[0]?.risks.map((risk) => risk.kind)).toEqual(["CRITICAL_GAP"]);
    expect(withCaps.cards[1]?.risks).toEqual([]);
  });

  test("el hero 7 (primero del ranking) conserva el primer lugar aunque lleve el aviso: el aviso no baja a nadie", () => {
    const withCaps = derive([...TEAM, hero(7), hero(8, { hasInitiation: true })]);
    if (withCaps.state !== "RANKED") throw new Error("expected RANKED");
    expect(withCaps.cards.map((card) => card.heroId)).toEqual([7, 8]);
  });
});

describe("evaluación de huecos -- reglas del equipo", () => {
  test("ownPicksRemainingFor cuenta lo que falta de 5 y nunca baja de 0", () => {
    expect(ownPicksRemainingFor([])).toBe(5);
    expect(ownPicksRemainingFor([1, 2, 3])).toBe(2);
    expect(ownPicksRemainingFor([1, 2, 3, 4, 5, 6])).toBe(0);
  });

  test("con 0 picks por delante nada es crítico (ya no hay qué decidir)", () => {
    expect(assessCompositionNeedsOf([1, 2, 3, 4, 5], [...TEAM, hero(4), hero(5)], 0).critical).toEqual([]);
  });

  test("`open` es exactamente lo que falta; `critical` sólo lo crítico y sólo en la ventana de cierre", () => {
    const needs = assessCompositionNeedsOf([1, 2, 3], TEAM, 2);
    expect(needs.open).toContain("initiation");
    expect(needs.critical).toEqual(["initiation"]);
    expect(assessCompositionNeedsOf([1, 2], TEAM, 3).critical).toEqual([]);
  });
});
