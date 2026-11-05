import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { ComputeSuggestionsForRecommendation, PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { eligibilityInputOf } from "./eligibility-input";
import { buildCoachObservableState } from "./observable-state";
import { CoachOrchestrator } from "./orchestrator";
import { buildPersonalPositionRecommendation } from "./personal-hero-view";
import { translateToRecommendationOutputV3 } from "./recommendation-output-v3";
import { evaluateEligibility } from "./recommendation-eligibility";
import type { RevealStrategy } from "./reveal-strategy";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";
import { hidden, known, recSet, roleOnlyHero, signal, view, type HeroFixture } from "./test.fixtures";

// CONTRATO DE ELEGIBILIDAD en el Coach v3 / Live Companion (dueño del producto, 2026-11-03/04). El modo en vivo (`adapterKind "manual"`) pinta el
// Coach v3: lista de héroes, acción principal y vista personal. Debe pasar por la MISMA regla que la decisión V4 y el tablero
// (`recommendation-eligibility.ts`): sin un fundamento verificable no sale ningún héroe, ni acción principal, ni vista personal; la frase y las
// etiquetas de cada tarjeta salen de los fundamentos reales (nombrando héroes y mecanismos, no frases genéricas); y ELEGIBILIDAD != FUERZA: un héroe
// con solo evidencia débil (el meta) aparece, pero solo un fundamento FUERTE sostiene la acción principal. Fixtures inline (familia S9/S10).

const OWN_ALLY = 50;
const BANNED = 99;
const VIEW = view("PICK_ROUND_1", [known(OWN_ALLY)], [hidden(), hidden()], [BANNED]);
const STATE = buildCoachObservableState(VIEW);
const POSITION_5: RevealStrategy = { kind: "REVEAL_POSITION", position: 5, rationale: "prior" };

const positionOnly = (heroId: number, weighted = 20): HeroFixture => roleOnlyHero(heroId, 5, weighted);
// Reemplaza la señal del mismo id (V6 emite una por id; `roleOnlyHero` ya trae `counter` y `patch_meta` en null).
const withSignal = (hero: HeroFixture, extra: HeroFixture["signals"][number]): HeroFixture => ({ ...hero, signals: [...hero.signals.filter((entry) => entry.signal !== extra.signal), extra] });
/** `vs` baneado con un porqué de Dota abre a `heroId` (un counter suyo se baneó). */
const openedByBan = (heroId: number, why = "Su stun interrumpe la cadena de habilidades"): ReadonlyMap<number, readonly CuratedCounter[]> => new Map([[heroId, [{ vs: BANNED, level: "hard", why }]]]);
const pairWithAlly = (heroId: number, why: string): ReadonlyMap<number, readonly CuratedSynergy[]> => new Map([[heroId, [{ with: OWN_ALLY, why }]]]);

function translate(heroes: HeroFixture[], strategy: RevealStrategy, config: Parameters<typeof translateToRecommendationOutputV3>[4] = {}) {
  return translateToRecommendationOutputV3(recSet(heroes), strategy, STATE, "blind_second_pick", config);
}

describe("Coach v3 -- solo héroes con fundamento (a)", () => {
  test("(a) héroes con solo la posición: ni shortlist, ni acción principal (el Coach v3 no devuelve salida)", () => {
    expect(translate([1, 2, 3, 4, 5].map((id) => positionOnly(id)), POSITION_5)).toBeNull();
  });

  test("(a) entre héroes solo-posición y uno abierto por los bans, la shortlist es SOLO el abierto y la acción principal lo sirve", () => {
    const output = translate([positionOnly(1, 30), positionOnly(2, 25), positionOnly(3, 20)], POSITION_5, { heroCounters: openedByBan(3) });
    expect(output).not.toBeNull();
    expect(output!.shortlist.map((card) => card.heroId)).toEqual([3]); // 1 y 2 pesan más en V6, pero solo tienen posición
    expect(output!.primaryAction.strategy.kind).toBe("REVEAL_POSITION");
  });

  test("(a) la popularidad por posición sigue sin ser fundamento aunque el pool tenga al héroe", () => {
    expect(translate([positionOnly(2), positionOnly(3)], POSITION_5, { heroPool: [2, 3] })).toBeNull();
  });
});

describe("Coach v3 -- fundamentos verificables sí cuentan, y la tarjeta los dice (b)", () => {
  test("(b) un ban que abre al héroe es fundamento: la frase y las etiquetas salen de ese fundamento, nunca de 'Por su posición'", () => {
    const card = translate([positionOnly(3)], POSITION_5, { heroCounters: openedByBan(3) })!.shortlist[0]!;
    // La tarjeta trae la amenaza que desapareció, con su porqué; no una frase genérica que oculte el detalle.
    expect(card.context.opening.openedBy).toEqual([{ heroId: BANNED, level: "hard", why: "Su stun interrumpe la cadena de habilidades" }]);
    expect(card.evidenceStrength).toBe("STRONG");
    expect(card.hideRationale).toBe(true);
    expect(card.rationale).not.toMatch(/posición/i);
    expect(card.badges).not.toContain("COUNTER");
  });

  test("(b) una pareja curada con porqué con un aliado YA elegido: etiqueta SYNERGY y frase de pareja", () => {
    const card = translate([positionOnly(3)], POSITION_5, { heroSynergies: pairWithAlly(3, "Shallow Grave le da tiempo para usar Blink") })!.shortlist[0]!;
    expect(card.badges).toContain("SYNERGY");
    expect(card.context.synergies).toEqual([{ withHeroId: OWN_ALLY, why: "Shallow Grave le da tiempo para usar Blink" }]); // el aliado y el mecanismo, no una frase genérica
    expect(card.evidenceStrength).toBe("STRONG");
    expect(card.hideRationale).toBe(true);
  });

  test("(b) un counter ESTADÍSTICO contra un rival ya revelado NO es fundamento (no nombra un mecanismo): sin tarjeta", () => {
    const revealedView = view("PICK_ROUND_2", [known(OWN_ALLY)], [{ visibility: "REVEALED", heroId: 94 }]);
    const hero = withSignal(positionOnly(3), signal("counter", 0.08, 18, { hasRevealedEnemyCounterEvidence: true, explanation: "Fuerte contra Medusa" }));
    const output = translateToRecommendationOutputV3(recSet([hero, positionOnly(2)]), POSITION_5, buildCoachObservableState(revealedView), "closing_pick", {});
    expect(output).toBeNull(); // ninguno de los dos tiene un fundamento verificable: ni tarjeta ni acción principal
  });

  test("(b) el meta vigente cuenta SOLO con evidencia suficiente y es DÉBIL: aparece en la lista junto a un héroe fuerte, con su cifra, pero nunca sostiene la acción", () => {
    const metaHero = withSignal(positionOnly(3), signal("patch_meta", 0.6, 4, { explanation: "Winrate de 60.0% este parche en bracket bajo/medio", sampleSize: 5000 }));
    const notEnough = withSignal(positionOnly(2), signal("patch_meta", 0.51, 4, { explanation: "Winrate de 51.0% este parche en bracket bajo/medio", sampleSize: 500 }));
    const opened = positionOnly(4);
    const output = translate([metaHero, notEnough, opened], POSITION_5, { heroCounters: openedByBan(4) })!;
    const byHero = new Map(output.shortlist.map((card) => [card.heroId, card]));
    expect([...byHero.keys()].sort()).toEqual([3, 4]); // el 2 no tiene evidencia suficiente: no aparece
    expect(byHero.get(3)!.evidenceStrength).toBe("WEAK");
    expect(byHero.get(3)!.badges).toContain("META");
    expect(byHero.get(3)!.rationale).toContain("Winrate de 60.0%");
    expect(byHero.get(4)!.evidenceStrength).toBe("STRONG"); // el fuerte es el que sostiene la acción principal
  });
});

describe("Coach v3 -- elegibilidad != fuerza (f)", () => {
  const META = signal("patch_meta", 0.6, 4, { explanation: "Winrate de 60.0% este parche en bracket bajo/medio", sampleSize: 5000 });

  test("(f) solo-meta (evidencia débil): hay elegibles pero NINGUNO es fuerte -> no hay acción principal y el Coach v3 no devuelve salida", () => {
    const heroes = [3, 2, 1].map((id) => withSignal(positionOnly(id), META));
    expect(translate(heroes, POSITION_5)).toBeNull();
    expect(translate(heroes, { kind: "DEFER_POSITION", position: 1, rationale: "r" })).toBeNull();
  });

  test("(f) un fuerte SÍ da acción principal, y los débiles que sirven a la acción acompañan en la lista, marcados WEAK", () => {
    const output = translate([withSignal(positionOnly(3), META), positionOnly(4), withSignal(positionOnly(2), META)], POSITION_5, { heroCounters: openedByBan(4) });
    expect(output).not.toBeNull();
    expect(output!.primaryAction.strategy.kind).toBe("REVEAL_POSITION");
    expect(output!.shortlist.map((card) => [card.heroId, card.evidenceStrength]).sort()).toEqual([[2, "WEAK"], [3, "WEAK"], [4, "STRONG"]]);
  });

  test("(f) REVEAL_HERO de un héroe DÉBIL no se nombra aunque haya otro héroe fuerte; el fuerte sí", () => {
    const weakHero = withSignal(positionOnly(3), META);
    const strongHero = positionOnly(4);
    const config = { heroCounters: openedByBan(4) };
    expect(translate([weakHero, strongHero], { kind: "REVEAL_HERO", heroId: 3, position: 5, rationale: "r" }, config)).toBeNull();
    const named = translate([weakHero, strongHero], { kind: "REVEAL_HERO", heroId: 4, position: 5, rationale: "r" }, config);
    expect(named!.shortlist[0]!.heroId).toBe(4);
    expect(named!.shortlist[0]!.evidenceStrength).toBe("STRONG");
  });

  test("(c) la intención elegida y el counter estadístico SOLOS no habilitan (son preferencia / complemento); con un fundamento real la intención se suma a la frase", () => {
    const intent = signal("archetype_fit", 0.7, 5, { explanation: "Encaja con tu draft de Push" });
    expect(translate([withSignal(positionOnly(3), intent)], POSITION_5)).toBeNull();
    const output = translate([withSignal(positionOnly(3), intent)], POSITION_5, { heroSynergies: pairWithAlly(3, "Shallow Grave le da tiempo para usar Blink") })!;
    expect(output.shortlist[0]!.rationale).toBe("Encaja con tu draft de Push");
    expect(output.shortlist[0]!.hideRationale).toBe(false);
    expect(output.shortlist[0]!.context.synergies).toHaveLength(1);
  });
});

describe("Coach v3 -- lo que NO es fundamento (c)", () => {
  test("(c) una relación curada cuyo único contenido es 'Lo dicen: …' no abre ni hace pareja", () => {
    expect(translate([positionOnly(3)], POSITION_5, { heroCounters: openedByBan(3, "Lo dicen: DotaCoach (7.41f)") })).toBeNull();
    expect(translate([positionOnly(3)], POSITION_5, { heroSynergies: pairWithAlly(3, "Lo dicen: wiki Fandom (antes de 7.41)") })).toBeNull();
  });

  test("(c) team_synergy por 'cubrir algún hueco' sin composición crítica demostrable no es fundamento, ni da etiqueta SYNERGY", () => {
    const filler = withSignal(positionOnly(3), signal("team_synergy", 0.3, 5, { explanation: "Aporta waveclear que a tu equipo le falta" }));
    expect(translate([filler], POSITION_5)).toBeNull();
  });
});

describe("Coach v3 -- sin elegibles no hay acción principal (d) y nunca nombra a un no elegible (e)", () => {
  test("(d) REVEAL_POSITION sin ningún elegible que sirva a esa posición -> null aunque haya elegibles de otra posición", () => {
    const grounded = roleOnlyHero(1, 1, 30); // elegible y fuerte (pareja curada), pero juega Pos 1: no sirve a "revela Pos 5"
    expect(translate([grounded, positionOnly(2)], POSITION_5, { heroSynergies: pairWithAlly(1, "Shallow Grave le da tiempo para usar Blink") })).toBeNull();
  });

  test("(d) DEFER / FLEX sin elegibles -> null", () => {
    expect(translate([positionOnly(1), positionOnly(2)], { kind: "DEFER_POSITION", position: 1, rationale: "r" })).toBeNull();
    expect(translate([positionOnly(1), positionOnly(2)], { kind: "REVEAL_FLEX", possiblePositions: [4, 5], rationale: "r" })).toBeNull();
  });

  test("(e) REVEAL_HERO de un héroe SIN fundamento nunca se presenta, aunque otros héroes sí lo tengan", () => {
    const grounded = positionOnly(3);
    const config = { heroSynergies: pairWithAlly(3, "Shallow Grave le da tiempo para usar Blink") };
    const ungrounded: RevealStrategy = { kind: "REVEAL_HERO", heroId: 2, position: 5, rationale: "r" };
    expect(translate([positionOnly(2, 30), grounded], ungrounded, config)).toBeNull();
    const named: RevealStrategy = { kind: "REVEAL_HERO", heroId: 3, position: 5, rationale: "r" };
    const output = translate([positionOnly(2, 30), grounded], named, config);
    expect(output!.shortlist[0]!.heroId).toBe(3);
    expect(output!.shortlist.map((card) => card.heroId)).not.toContain(2);
  });
});

describe("Vista personal y orquestador del modo en vivo", () => {
  const PERSONAL: Position = 2;
  const context = { view: VIEW } as unknown as PerspectiveRecommendationContext;
  const data = { heroCounters: openedByBan(4) };

  test("(a) la vista personal solo lista héroes elegibles y vuelve a numerar el ranking", async () => {
    const heroes = [roleOnlyHero(6, PERSONAL, 30), roleOnlyHero(4, PERSONAL, 20), roleOnlyHero(7, PERSONAL, 10)];
    const { view: personal } = await buildPersonalPositionRecommendation(context, PERSONAL, [], {
      buildRecommendationSet: async () => recSet(heroes),
      eligibility: (candidate) => evaluateEligibility(candidate, eligibilityInputOf(VIEW, data, candidate.position)),
    });
    expect(personal.heroes.map((hero) => ({ heroId: hero.heroId, rank: hero.rank }))).toEqual([{ heroId: 4, rank: 1 }]); // 6 y 7 pesan más, pero solo tienen posición
    expect(personal.heroes[0]!.evidenceStrength).toBe("STRONG");
    expect(personal.heroes[0]!.context.opening.openedBy).toHaveLength(1); // la amenaza baneada y su porqué viajan con el héroe
  });

  test("(d) por el orquestador real: con todos los héroes solo-posición el Coach v3 no devuelve salida (la web pinta nada) y el V2 crudo sigue existiendo solo como dato", async () => {
    const h = harness({ adapterKind: "manual" });
    const stripMeta = <T extends { signal: string }>(signals: readonly T[]): T[] => signals.filter((entry) => entry.signal !== "patch_meta");
    const base = fakeCompute();
    const computeSuggestions: ComputeSuggestionsForRecommendation = async (...args) => {
      const set = await base(...args);
      return {
        ...set,
        suggestions: set.suggestions.map((suggestion) => ({ ...suggestion, signals: stripMeta(suggestion.signals) })),
        functionalEvidence: set.functionalEvidence ? { ...set.functionalEvidence, signalEvidence: set.functionalEvidence.signalEvidence.map((entry) => ({ ...entry, signals: stripMeta(entry.signals) })) } : set.functionalEvidence,
      };
    };
    const coach = new CoachOrchestrator({
      heroPositions: HERO_POSITIONS,
      buildRecommendationSet: (ctx) => buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions, heroPositions: HERO_POSITIONS }),
      buildPersonalRecommendation: (ctx, position) => buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions, heroPositions: HERO_POSITIONS, targetPosition: position, teamOpening: false, singleSlotEvaluation: true }),
    });
    const result = await coach.recompute({ context: h.store.perspectiveRecommendationContext(h.id)!, playerPersonalPosition: 2 });
    expect(result.output).toBeNull();
    expect(result.recommendationSet.recommendations.length).toBeGreaterThan(0); // el dato crudo existe; la web no lo pinta (CopilotPanel contractOnly)
  });
});
