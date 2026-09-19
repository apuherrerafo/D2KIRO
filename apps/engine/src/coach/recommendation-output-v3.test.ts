import { describe, expect, test } from "bun:test";
import { buildCoachObservableState } from "./observable-state";
import { COACH_SHORTLIST_SIZE, labelForStrategy, translateToRecommendationOutputV3 } from "./recommendation-output-v3";
import type { RevealStrategy } from "./reveal-strategy";
import { hidden, known, neutralImpact, recSet, revealed, roleOnlyHero, signal, view, type HeroFixture } from "./test.fixtures";

// AP Ranked Roles V1 / Wave 2 (task 18) -- RecommendationOutputV3 on top of RecommendationSetV2.

const VIEW = view("PICK_ROUND_1", [known(50)], [hidden(), hidden()]);
const STATE = buildCoachObservableState(VIEW);
const MANY = Array.from({ length: 8 }, (_, index) => roleOnlyHero(index + 1, ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5, 20 - index));
const POSITION: RevealStrategy = { kind: "REVEAL_POSITION", position: 5, rationale: "prior" };

describe("translateToRecommendationOutputV3", () => {
  test("Wave 2: opportunity ausente (Safe Core es de Wave 4)", () => {
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick")).not.toHaveProperty("opportunity");
  });

  test("Wave 2: personalHeroView ausente aunque haya posición personal declarada (Wave 3)", () => {
    const output = translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick", { playerPersonalPosition: 2 });
    expect(output).not.toHaveProperty("personalHeroView");
  });

  test("Wave 2: outsidePoolRecommendation ausente con pool vacío y sin pool", () => {
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick", { heroPool: [] })).not.toHaveProperty("outsidePoolRecommendation");
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick")).not.toHaveProperty("outsidePoolRecommendation");
  });

  test("shortlist <= 5 por defecto y configurable", () => {
    expect(COACH_SHORTLIST_SIZE).toBe(5);
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick").shortlist.length).toBeLessThanOrEqual(5);
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick", { shortlistSize: 3 }).shortlist).toHaveLength(3);
  });

  test("meta.basedOn es el basedOn del RecommendationSetV2 de origen (mismo objeto)", () => {
    const set = recSet(MANY, { stateIdentity: "identity-XYZ" });
    const output = translateToRecommendationOutputV3(set, POSITION, STATE, "blind_second_pick");
    expect(output.meta.basedOn).toBe(set.basedOn);
    expect(output.meta.basedOn.stateIdentity).toBe("identity-XYZ");
  });

  test("label no vacío para todos los tipos, compuesto desde la estrategia, y nunca una obligación", () => {
    const strategies: RevealStrategy[] = [
      POSITION,
      { kind: "REVEAL_HERO", heroId: 3, position: 2, rationale: "r" },
      { kind: "DEFER_POSITION", position: 1, rationale: "r" },
      { kind: "REVEAL_FLEX", possiblePositions: [2, 3], rationale: "r" },
      { kind: "OPPORTUNITY", subtype: "SAFE_CORE", rationale: "ventana de core" },
    ];
    for (const strategy of strategies) {
      const label = labelForStrategy(strategy);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/debes|tienes que|obligatorio/i);
    }
    expect(labelForStrategy(POSITION)).toContain("Pos 5");
    expect(labelForStrategy({ kind: "REVEAL_FLEX", possiblePositions: [2, 3], rationale: "r" })).toMatch(/Pos 2.*Pos 3/);
  });

  test("acción a nivel de rol + shortlist de héroes concretos: la shortlist no convierte la acción en héroe", () => {
    const output = translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick");
    expect(output.primaryAction.strategy.kind).toBe("REVEAL_POSITION");
    expect(output.primaryAction.strategy).not.toHaveProperty("heroId");
    expect(output.shortlist.length).toBeGreaterThan(1);
  });

  test("la shortlist pone primero los héroes que encajan con la acción (Pos 5) y conserva el orden V6 dentro de cada grupo", () => {
    const output = translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick");
    const fitting = output.shortlist.filter((card) => card.position === 5).map((card) => card.heroId);
    expect(fitting.length).toBeGreaterThan(0);
    expect(output.shortlist.slice(0, fitting.length).map((card) => card.heroId)).toEqual(fitting);
  });

  test("DEFER_POSITION: la shortlist no encabeza con héroes de la posición diferida", () => {
    const output = translateToRecommendationOutputV3(recSet(MANY), { kind: "DEFER_POSITION", position: 1, rationale: "r" }, STATE, "blind_second_pick");
    expect(output.shortlist[0]!.position).not.toBe(1);
  });

  test("REVEAL_HERO: el héroe nombrado encabeza la shortlist", () => {
    const output = translateToRecommendationOutputV3(recSet(MANY), { kind: "REVEAL_HERO", heroId: 4, position: 4, rationale: "r" }, STATE, "response_pick");
    expect(output.shortlist[0]!.heroId).toBe(4);
  });

  test("confianza: un rol no supera 'media'; un héroe concreto conserva la 'alta' de V6; sin candidatos es 'baja'", () => {
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick").meta.confidence).toBe("media");
    expect(translateToRecommendationOutputV3(recSet(MANY), { kind: "REVEAL_HERO", heroId: 1, position: 1, rationale: "r" }, STATE, "response_pick").meta.confidence).toBe("alta");
    expect(translateToRecommendationOutputV3(recSet([]), POSITION, STATE, "blind_second_pick").meta.confidence).toBe("baja");
  });

  test("un empate exacto entre los dos primeros baja un nivel la confianza", () => {
    const tie: HeroFixture[] = [roleOnlyHero(1, 1, 10), roleOnlyHero(2, 2, 10)];
    const hero: RevealStrategy = { kind: "REVEAL_HERO", heroId: 1, position: 1, rationale: "r" };
    expect(translateToRecommendationOutputV3(recSet(tie), hero, STATE, "response_pick").meta.confidence).toBe("media");
  });

  test("meta: ronda, fase y picks propios restantes salen de la vista", () => {
    const meta = translateToRecommendationOutputV3(recSet(MANY), POSITION, STATE, "blind_second_pick").meta;
    expect(meta).toMatchObject({ round: 1, phase: "PICK_ROUND_1", ownPicksRemaining: 4, decisionContext: "blind_second_pick" });
    const later = buildCoachObservableState(view("PICK_ROUND_3", [known(1), known(2), known(3), known(4)], [revealed(7), revealed(8), revealed(9), revealed(10)]));
    expect(translateToRecommendationOutputV3(recSet(MANY), POSITION, later, "closing_pick").meta).toMatchObject({ round: 3, ownPicksRemaining: 1 });
  });

  test("tarjetas: un héroe Flex (catálogo curado en 2+ posiciones) se marca FLEX; su roleStatus sigue el de V6", () => {
    const flex: HeroFixture = { heroId: 9, signals: [signal("position_fit", 0.6, 30)], impact: neutralImpact() };
    const output = translateToRecommendationOutputV3(recSet([flex, roleOnlyHero(10, 1, 5)]), POSITION, STATE, "blind_second_pick", {
      heroPositions: { 9: [{ position: 2, matches: 500 }, { position: 3, matches: 300 }] },
    });
    const card = output.shortlist.find((entry) => entry.heroId === 9)!;
    expect(card.badges).toContain("FLEX");
    expect(card.roleStatus).toBe("UNRESOLVED");
  });
});
