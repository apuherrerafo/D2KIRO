import { describe, expect, test } from "bun:test";
import { computeRoleBelief, type Position } from "../draft-protocol/roles/role-belief";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveRevealStrategy, type RevealStrategy } from "./reveal-strategy";
import { hidden, known, neutralImpact, recSet, resolvedImpact, revealed, roleOnlyHero, signal, view, type HeroFixture } from "./test.fixtures";

// AP Ranked Roles V1 / Wave 2 (task 16) -- RevealStrategy. Every fixture is inline (no curated data).
// Evidence-scaled specificity: when uncertain, be LESS specific. Wave 2 answers at ROLE level only.

const OPENING_VIEW = view("PICK_ROUND_1", [], [hidden(), hidden()]);
const SECOND_PICK_VIEW = view("PICK_ROUND_1", [known(50)], [hidden(), hidden()]);
const RESPONSE_VIEW = view("PICK_ROUND_2", [known(50), known(51)], [revealed(70), revealed(71), hidden(), hidden()]);

/** A core hero whose counter signal carries almost the whole lead over the field -- the case a threshold would have promoted to a named hero. */
function counterDominantHero(heroId: number, position: Position): HeroFixture {
  return { heroId, signals: [signal("counter", 0.6, 30), signal("position_fit", 0.6, 10), signal("patch_meta", null, 0)], impact: resolvedImpact(position) };
}

function metaDominantHero(heroId: number, position: Position): HeroFixture {
  return { heroId, signals: [signal("patch_meta", 0.6, 30), signal("position_fit", 0.6, 10), signal("counter", null, 0)], impact: resolvedImpact(position) };
}

const kindOf = (strategy: RevealStrategy) => strategy.kind;

describe("REVEAL_POSITION -- el prior support-first es un prior, no un guion", () => {
  test("team_opening + el líder es un core sin evidencia que obligue a abrir con él -> REVEAL_POSITION de un soporte (4 o 5), sin heroId", () => {
    const set = recSet([roleOnlyHero(1, 1, 12), roleOnlyHero(2, 2, 11), roleOnlyHero(3, 3, 10), roleOnlyHero(4, 5, 9)]);
    const strategy = deriveRevealStrategy(OPENING_VIEW, set, null, [], "team_opening");
    expect(strategy.kind).toBe("REVEAL_POSITION");
    expect([4, 5]).toContain((strategy as { position: number }).position);
    expect(strategy).not.toHaveProperty("heroId");
  });

  test("RB-2: el prior NO puede nombrar un soporte que ningún héroe del ranking sirve -> cede a la posición que la evidencia sí sirve", () => {
    // Only cores in the ranking: a "reveal Support" claim would come with a shortlist that cannot execute it.
    const set = recSet([roleOnlyHero(1, 1, 12), roleOnlyHero(2, 2, 11), roleOnlyHero(3, 3, 10)]);
    expect(deriveRevealStrategy(OPENING_VIEW, set, null, [], "team_opening")).toMatchObject({ kind: "REVEAL_POSITION", position: 1 });
  });

  test("RB-2: el prior elige el soporte que SÍ tiene héroes que lo sirven, aunque no sea el primero de su orden de preferencia", () => {
    const set = recSet([roleOnlyHero(1, 1, 12), roleOnlyHero(2, 4, 11)]); // a Pos 4 exists, no Pos 5
    expect(deriveRevealStrategy(OPENING_VIEW, set, null, [], "team_opening")).toMatchObject({ kind: "REVEAL_POSITION", position: 4 });
  });

  test("blind_second_pick con el soporte 5 ya cubierto por un pick propio -> el prior elige el 4 (no repite el 5)", () => {
    const set = recSet([roleOnlyHero(1, 1, 12), roleOnlyHero(2, 2, 11), roleOnlyHero(3, 4, 10)]);
    const ownBeliefs = new Map([[50, computeRoleBelief({ heroId: 50, confirmedPosition: 5 })]]);
    const strategy = deriveRevealStrategy(SECOND_PICK_VIEW, set, null, [], "blind_second_pick", { ownRoleBeliefs: ownBeliefs });
    expect(strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 4 });
  });

  test("con 4 y 5 ya cubiertos el prior no dispara: sigue la evidencia (la posición del líder)", () => {
    const set = recSet([roleOnlyHero(1, 3, 12), roleOnlyHero(2, 2, 11)]);
    const ownBeliefs = new Map([
      [50, computeRoleBelief({ heroId: 50, confirmedPosition: 5 })],
      [51, computeRoleBelief({ heroId: 51, confirmedPosition: 4 })],
    ]);
    const strategy = deriveRevealStrategy(view("PICK_ROUND_1", [known(50), known(51)], [hidden(), hidden()]), set, null, [], "blind_second_pick", { ownRoleBeliefs: ownBeliefs });
    expect(strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 3 });
  });

  test("SUPPORT-FIRST != ORDEN FIJO: si el ranking ya apunta a un soporte 4, se revela el 4 (no un 5 por defecto)", () => {
    const set = recSet([roleOnlyHero(1, 4, 12), roleOnlyHero(2, 1, 11)]);
    expect(deriveRevealStrategy(OPENING_VIEW, set, null, [], "team_opening")).toMatchObject({ kind: "REVEAL_POSITION", position: 4 });
  });

  test("las cinco posiciones son alcanzables como respuesta de una decisión no-apertura (la evidencia manda, no la ronda)", () => {
    for (const position of [1, 2, 3, 4, 5] as Position[]) {
      const set = recSet([roleOnlyHero(1, position, 12), roleOnlyHero(2, position, 11)]);
      expect(deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick")).toMatchObject({ kind: "REVEAL_POSITION", position });
    }
  });

  test("las mismas entradas dan la misma salida sin importar el número de ronda de la vista", () => {
    const set = recSet([roleOnlyHero(1, 2, 12), roleOnlyHero(2, 2, 11)]);
    const inRound2 = deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick");
    const inRound3 = deriveRevealStrategy(view("PICK_ROUND_3", [known(50), known(51), known(52), known(53)], [revealed(70), revealed(71), revealed(72), revealed(73)]), set, null, [], "response_pick");
    expect(inRound2).toEqual(inRound3);
  });
});

describe("evidence-scaled specificity: sin criterio justificado, Wave 2 NO nombra un héroe", () => {
  test("un counter dominante NO produce REVEAL_HERO (no hay un umbral establecido que lo justifique): se queda a nivel de posición", () => {
    const set = recSet([counterDominantHero(1, 2), roleOnlyHero(2, 2, 12), roleOnlyHero(3, 3, 11)]);
    const strategy = deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick");
    expect(strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 2 });
    expect(strategy).not.toHaveProperty("heroId");
  });

  test("un meta dominante tampoco: en la apertura, con un core al frente, manda el prior de soporte y no se nombra al héroe", () => {
    const set = recSet([metaDominantHero(1, 1), roleOnlyHero(2, 5, 12), roleOnlyHero(3, 4, 11)]);
    const strategy = deriveRevealStrategy(OPENING_VIEW, set, null, [], "team_opening");
    expect(strategy.kind).toBe("REVEAL_POSITION");
    expect(strategy).not.toHaveProperty("heroId");
  });

  test("Wave 2 sólo produce REVEAL_POSITION o REVEAL_FLEX: barrido de contextos y conjuntos, nunca HERO / DEFER / OPPORTUNITY", () => {
    const sets = [
      recSet([]),
      recSet([roleOnlyHero(1, 1, 20), roleOnlyHero(2, 2, 15), roleOnlyHero(3, 3, 10)]),
      recSet([counterDominantHero(1, 2), roleOnlyHero(2, 2, 12)]),
      recSet([metaDominantHero(1, 1), roleOnlyHero(2, 5, 12)]),
      recSet([{ heroId: 1, signals: [signal("position_fit", null, 12)], impact: neutralImpact() }, roleOnlyHero(2, 1, 10)]),
      recSet([roleOnlyHero(1, 3, 50), { heroId: 2, signals: [signal("position_fit", 0.7, 10), signal("counter", 0.5, 10)], impact: resolvedImpact(1) }]),
    ];
    const heroPositions: HeroPositions = { 1: [{ position: 2, matches: 500 }, { position: 3, matches: 400 }] };
    const seen = new Set<string>();
    for (const set of sets) {
      for (const context of ["team_opening", "blind_second_pick", "response_pick", "closing_pick"] as const) {
        for (const positions of [undefined, heroPositions]) seen.add(kindOf(deriveRevealStrategy(RESPONSE_VIEW, set, null, [], context, { heroPositions: positions })));
      }
    }
    expect([...seen].every((kind) => kind === "REVEAL_POSITION" || kind === "REVEAL_FLEX")).toBe(true);
  });

  test("sin candidatos V6 (p. ej. sin meta) sigue habiendo una acción a nivel de posición, nunca un héroe ni un vacío", () => {
    const empty = recSet([]);
    const opening = deriveRevealStrategy(OPENING_VIEW, empty, null, [], "team_opening");
    expect(opening.kind).toBe("REVEAL_POSITION");
    expect(opening).not.toHaveProperty("heroId");
    expect(opening.rationale.length).toBeGreaterThan(0);
    expect(deriveRevealStrategy(RESPONSE_VIEW, empty, null, [], "response_pick").kind).toBe("REVEAL_POSITION");
  });
});

describe("REVEAL_FLEX -- la definición de Flex es la que el repo ya tenía", () => {
  // signals/mix.ts flexibilityReason: "el catálogo curado registra al héroe en dos o más posiciones".
  const TWO_POSITIONS: HeroPositions = { 1: [{ position: 2, matches: 600 }, { position: 3, matches: 300 }] };
  const unresolvedTop: HeroFixture = { heroId: 1, signals: [signal("position_fit", 0.7, 12)], impact: neutralImpact() };

  test("el mejor candidato tiene rol sin resolver en V6 y el catálogo curado lo registra en 2 posiciones -> REVEAL_FLEX (ordenadas por partidas)", () => {
    const strategy = deriveRevealStrategy(RESPONSE_VIEW, recSet([unresolvedTop, roleOnlyHero(2, 1, 10)]), null, [], "response_pick", { heroPositions: TWO_POSITIONS });
    expect(strategy).toEqual(expect.objectContaining({ kind: "REVEAL_FLEX", possiblePositions: [2, 3] }));
  });

  test("con el rol ya resuelto en V6 NO es Flex aunque el catálogo lo registre en 2 posiciones: manda el rol resuelto", () => {
    const resolvedTop: HeroFixture = { heroId: 1, signals: [signal("position_fit", 0.7, 12)], impact: resolvedImpact(2) };
    const strategy = deriveRevealStrategy(RESPONSE_VIEW, recSet([resolvedTop, roleOnlyHero(2, 1, 10)]), null, [], "response_pick", { heroPositions: TWO_POSITIONS });
    expect(strategy).toMatchObject({ kind: "REVEAL_POSITION", position: 2 });
  });

  test("sin evidencia curada (o con una sola posición) no se inventa Flex", () => {
    const set = recSet([unresolvedTop, roleOnlyHero(2, 1, 10)]);
    expect(kindOf(deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick"))).toBe("REVEAL_POSITION");
    expect(kindOf(deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick", { heroPositions: { 1: [{ position: 2, matches: 900 }] } }))).toBe("REVEAL_POSITION");
  });
});

describe("autoridad del Player y pureza", () => {
  test("POSICIÓN PERSONAL != TIMING: la estrategia es idéntica para cualquier posición personal y cualquier pool", () => {
    const set = recSet([roleOnlyHero(1, 1, 12), roleOnlyHero(2, 2, 11)]);
    const baseline = deriveRevealStrategy(OPENING_VIEW, set, null, [], "team_opening");
    for (const personal of [1, 2, 3, 4, 5] as Position[]) {
      expect(deriveRevealStrategy(OPENING_VIEW, set, personal, [1, 2, 3], "team_opening")).toEqual(baseline);
    }
  });

  test("es pura: mismas entradas -> misma salida, sin mutar el conjunto de recomendaciones", () => {
    const set = recSet([counterDominantHero(1, 2), roleOnlyHero(2, 2, 12)]);
    const snapshot = JSON.stringify(set);
    const a = deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick");
    const b = deriveRevealStrategy(RESPONSE_VIEW, set, null, [], "response_pick");
    expect(a).toEqual(b);
    expect(JSON.stringify(set)).toBe(snapshot);
  });
});
