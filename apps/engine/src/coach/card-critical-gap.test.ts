import { describe, expect, test } from "bun:test";
import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCardRisks, deriveCompositionContext } from "./card-evidence";
import { deriveCandidateResult } from "./current-human-decision";
import { extractHeroCandidates } from "./hero-card";
import { hidden, known, recSet, resolvedImpact, signal, view, type HeroFixture } from "./test.fixtures";

// TSK-254 / CRITICAL_GAP -- the producer is TSK-253's contract (assessCompositionNeeds / unfilledCriticalGaps); nothing here
// re-derives composition. Inline capability fixtures (S9): never capabilities.json. Hero ids are arbitrary labels.

const CANDIDATE = 7;
const hero = (id: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities =>
  ({ hero: id, damageType: "physical", hasInitiation: false, hasCatch: true, hasWaveclear: true, structuralDamage: "medium", teamfight: "medium", scaling: "medium", ...overrides });

// Own team 1, 2, 3: has catch/waveclear and two damage types, but NO initiator.
const TEAM = [hero(1), hero(2, { damageType: "magical" }), hero(3)];
const NON_INITIATOR = hero(CANDIDATE);
const INITIATOR = hero(CANDIDATE, { hasInitiation: true });

const solid: HeroFixture = { heroId: CANDIDATE, signals: [signal("position_fit", 0.7, 20)], impact: resolvedImpact(1) };
const candidateOf = () => extractHeroCandidates(recSet([solid]))[0]!;
const closing = (own = [known(1), known(2), known(3)]) => view("PICK_ROUND_2", own, [hidden(), hidden()]);
const risksOf = (capabilities: HeroCapabilities[], viewArg = closing()) =>
  deriveCardRisks(candidateOf(), viewArg, undefined, deriveCompositionContext(viewArg, capabilities));
const kinds = (risks: { kind: string }[]) => risks.map((risk) => risk.kind);

describe("CRITICAL_GAP -- solo con una carencia crítica demostrable", () => {
  test("equipo sin iniciador, 2 picks por delante, héroe sin iniciación -> riesgo, con el hueco y los picks nombrados", () => {
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

  test("un héroe que SÍ llena el hueco no lleva el riesgo", () => {
    expect(risksOf([...TEAM, INITIATOR])).toEqual([]);
  });

  test("fuera de la ventana de cierre (3 picks por delante) el hueco está abierto pero no es crítico: sin riesgo", () => {
    const early = view("PICK_ROUND_2", [known(1), known(2)], [hidden(), hidden()]);
    expect(risksOf([...TEAM, NON_INITIATOR], early)).toEqual([]);
  });

  test("el equipo ya tiene iniciador -> no hay carencia, sin riesgo", () => {
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
  test("un pick propio sin capacidades curadas: no se puede decir que 'falta' algo -> sin riesgo", () => {
    // El héroe 99 no tiene capacidades curadas: podría ser el iniciador que "falta".
    const viewArg = closing([known(1), known(2), known(99)]);
    expect(risksOf([hero(1), hero(2, { damageType: "magical" }), NON_INITIATOR], viewArg)).toEqual([]);
  });

  test("un candidato sin capacidades curadas nunca se declara como 'no lo cubre'", () => {
    expect(risksOf(TEAM)).toEqual([]); // CANDIDATE no está en las capacidades
  });

  test("sin capacidades inyectadas el riesgo no se puede derivar (y no se adivina)", () => {
    const viewArg = closing();
    expect(deriveCompositionContext(viewArg, undefined)).toBeUndefined();
    expect(deriveCompositionContext(viewArg, [])).toBeUndefined();
    expect(deriveCardRisks(candidateOf(), viewArg, undefined, undefined)).toEqual([]);
  });

  test("sin lado de jugador conocido (vista sin viewerSide) no hay equipo propio: sin riesgo", () => {
    const blind = { ...closing(), viewerSide: null };
    expect(risksOf([...TEAM, NON_INITIATOR], blind)).toEqual([]);
  });
});

describe("CRITICAL_GAP -- no toca el ranking ni el resto de la tarjeta", () => {
  const POSITIONS: HeroPositions = { 7: [{ position: 1, matches: 3000 }], 8: [{ position: 1, matches: 3000 }] };
  const heroes: HeroFixture[] = [
    { heroId: 7, signals: [signal("position_fit", 0.9, 30, { sampleSize: 3000 })], impact: resolvedImpact(1) },
    { heroId: 8, signals: [signal("position_fit", 0.8, 20, { sampleSize: 3000 })], impact: resolvedImpact(1) },
  ];
  const derive = (heroCapabilities: HeroCapabilities[] | undefined) =>
    deriveCandidateResult({ targetPosition: 1, targetRanking: recSet(heroes), view: closing(), heroPositions: POSITIONS, heroCapabilities, personalPoolApplied: false });

  test("con y sin capacidades: orden, puntajes, insignias, razón y base idénticos; sólo cambian los riesgos", () => {
    const without = derive(undefined);
    // 7 no inicia (el hueco queda abierto para él); 8 sí inicia.
    const withCaps = derive([...TEAM, hero(7), hero(8, { hasInitiation: true })]);
    if (without.state !== "RANKED" || withCaps.state !== "RANKED") throw new Error("expected RANKED");
    const shape = (cards: typeof without.cards) => cards.map((card) => [card.heroId, card.rank, card.score, card.badges, card.rationale, card.basis, card.confidence]);
    expect(shape(withCaps.cards)).toEqual(shape(without.cards));
    expect(without.cards.map((card) => card.risks)).toEqual([[], []]);
    expect(withCaps.cards[0]?.risks.map((risk) => risk.kind)).toEqual(["CRITICAL_GAP"]);
    expect(withCaps.cards[1]?.risks).toEqual([]);
  });
});
