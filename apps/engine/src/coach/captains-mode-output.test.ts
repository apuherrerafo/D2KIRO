import { describe, expect, test } from "bun:test";
import type { PerspectiveDraftView } from "../draft-protocol/types";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { buildCaptainsModeOutput } from "./captains-mode-output";
import { recSet, resolvedImpact, revealed, signal, view as apView, type HeroFixture } from "./test.fixtures";

// CONTRATO DE ELEGIBILIDAD en Captains Mode (dueño del producto, 2026-11-04). Captains Mode no pasaba por el Coach: su pantalla pintaba el V2 crudo
// (la frase "posición y momento del pick", confianza alta, el top de V6 sin pedir fundamento). Ahora `buildCaptainsModeOutput` le aplica la misma regla
// que a las demás superficies: sin fundamento verificable no sale el héroe; la razón sale de los fundamentos; solo evidencia FUERTE se recomienda.
// Fixtures inline: ningún dato curado real, ninguna red, ninguna SQLite (familia S9/S10).

const ENEMY = 900; // pick rival ya revelado
const MINE = 901; // pick mío ya elegido
const A = 11;
const B = 12;
const WHY = "Orchid lo silencia y no puede hacer nada";
const WHY_PAIR = "Su stun encadena con el ult del aliado";
const UNREASONED = "Lo dicen: DotaCoach (7.41f), wiki Fandom (antes de 7.41)";

const POSITIONS: HeroPositions = {
  [A]: [{ position: 1, matches: 3000 }],
  [B]: [{ position: 1, matches: 3000 }],
};

/** Un héroe cuya ÚNICA evidencia es posición/popularidad (lo que el V2 crudo mostraba como razón). */
const onlyPosition = (heroId: number, weighted: number): HeroFixture => ({
  heroId,
  signals: [signal("position_fit", 0.9, weighted, { sampleSize: 50_000, explanation: "Evidencia sólida de que funciona como carry (50.000 partidas de alto MMR)" })],
  impact: resolvedImpact(1),
});

/** La vista de Captains Mode: todo se ve (picks y bans se revelan al instante). */
function cmView(own: number[], enemy: number[], bans: number[] = []): PerspectiveDraftView {
  const base = apView("PICK_ROUND_1", own.map((heroId) => revealed(heroId)), enemy.map((heroId) => revealed(heroId)), bans);
  return { ...base, ruleset: { id: "dota2/captains-mode" } as PerspectiveDraftView["ruleset"], rankedAp: null, captainsMode: { firstPickSide: "radiant", currentStep: 8 } };
}

function cmSet(heroes: HeroFixture[], actionKind: "PICK" | "BAN" = "PICK"): RecommendationSetV2 {
  const set = recSet(heroes);
  return { ...set, decision: { ...set.decision, actionKind, round: null, phase: null, step: 8 } };
}

const counters = (...entries: [victim: number, vs: number, level: "hard" | "medium", why: string][]): ReadonlyMap<number, readonly CuratedCounter[]> => {
  const map = new Map<number, CuratedCounter[]>();
  for (const [victim, vs, level, why] of entries) map.set(victim, [...(map.get(victim) ?? []), { vs, level, why }]);
  return map;
};
const pairs = (...entries: [hero: number, ally: number, why: string][]): ReadonlyMap<number, readonly CuratedSynergy[]> => {
  const map = new Map<number, CuratedSynergy[]>();
  for (const [hero, ally, why] of entries) map.set(hero, [...(map.get(hero) ?? []), { with: ally, why }]);
  return map;
};

interface Data {
  heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>;
  heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]>;
}
const run = (set: RecommendationSetV2, view: PerspectiveDraftView, data: Data = {}) => buildCaptainsModeOutput({ set, view, data: { ...data, heroPositions: POSITIONS } });

describe("Captains Mode -- PICK: sin fundamento no hay héroe", () => {
  test("solo posición/popularidad (el caso que se veía): ningún héroe, ningún héroe recomendado, ningún texto de posición ni de falta de información", () => {
    for (const view of [cmView([], []), cmView([], [ENEMY]), cmView([MINE], [ENEMY])]) {
      const output = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)]), view);
      expect(output.actionKind).toBe("PICK");
      expect(output.picks).toEqual([]);
      expect(output.bans).toEqual([]);
      expect(output.primaryHeroId).toBeNull();
      const text = JSON.stringify(output);
      for (const forbidden of ["position_fit", "Por su posición", "momento del pick", "Sin candidatos", "xploración", "falta información"]) expect(text).not.toContain(forbidden);
    }
  });

  test("un counter curado CON porqué contra un rival ya revelado habilita al héroe: fundamento fuerte, etiqueta Counter, y se recomienda", () => {
    const output = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)]), cmView([], [ENEMY]), { heroCounters: counters([ENEMY, A, "hard", WHY]) });
    expect(output.picks.map((card) => card.heroId)).toEqual([A]); // B sigue sin fundamento: no sale
    const [card] = output.picks;
    expect(card?.evidenceStrength).toBe("STRONG");
    expect(card?.badges).toContain("COUNTER");
    expect(card?.context.strengths.map((strength) => ({ vs: strength.vsHeroId, why: strength.why }))).toEqual([{ vs: ENEMY, why: WHY }]);
    expect(output.primaryHeroId).toBe(A);
    expect(card?.rationale).not.toContain("posición");
  });

  test("una pareja curada con porqué con un aliado ya elegido habilita al héroe (fuerte)", () => {
    const output = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)]), cmView([MINE], []), { heroSynergies: pairs([A, MINE, WHY_PAIR]) });
    expect(output.picks.map((card) => card.heroId)).toEqual([A]);
    expect(output.picks[0]?.badges).toContain("SYNERGY");
    expect(output.picks[0]?.evidenceStrength).toBe("STRONG");
    expect(output.primaryHeroId).toBe(A);
  });

  test('"Lo dicen: …" sin porqué NO cuenta como fundamento', () => {
    const output = run(cmSet([onlyPosition(A, 90)]), cmView([MINE], [ENEMY]), {
      heroCounters: counters([ENEMY, A, "hard", UNREASONED]),
      heroSynergies: pairs([A, MINE, UNREASONED]),
    });
    expect(output.picks).toEqual([]);
    expect(output.primaryHeroId).toBeNull();
  });

  test("ELEGIBILIDAD != FUERZA: un counter medio aparece, pero solo (WEAK) no se recomienda; con uno duro delante sí", () => {
    const weakOnly = run(cmSet([onlyPosition(A, 90)]), cmView([], [ENEMY]), { heroCounters: counters([ENEMY, A, "medium", WHY]) });
    expect(weakOnly.picks.map((card) => card.heroId)).toEqual([A]);
    expect(weakOnly.picks[0]?.evidenceStrength).toBe("WEAK");
    expect(weakOnly.primaryHeroId).toBeNull(); // aparece, pero no es "el recomendado"

    const strongFirst = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)]), cmView([], [ENEMY]), { heroCounters: counters([ENEMY, A, "hard", WHY], [ENEMY, B, "medium", WHY]) });
    expect(strongFirst.picks.map((card) => card.evidenceStrength)).toEqual(["STRONG", "WEAK"]);
    expect(strongFirst.primaryHeroId).toBe(A);
  });

  test("un héroe débil que va PRIMERO en el orden nunca se destaca, aunque otro con evidencia fuerte vaya detrás", () => {
    // B puntúa muchísimo más en V6 (queda primero) pero solo tiene un counter medio; A, mucho más abajo, tiene el duro.
    const output = run(cmSet([onlyPosition(B, 95), onlyPosition(A, 10)]), cmView([], [ENEMY]), { heroCounters: counters([ENEMY, B, "medium", WHY], [ENEMY, A, "hard", WHY]) });
    expect(output.picks.map((card) => [card.heroId, card.evidenceStrength])).toEqual([[B, "WEAK"], [A, "STRONG"]]);
    expect(output.primaryHeroId).toBeNull();
  });

  test("un ranking sin base confiable (SNAPSHOT_UNAVAILABLE) nunca se rescata con héroes", () => {
    const set = { ...cmSet([onlyPosition(A, 90)]), degradations: [{ reason: "SNAPSHOT_UNAVAILABLE" as const, detail: "sin meta" }] };
    const output = run(set, cmView([], [ENEMY]), { heroCounters: counters([ENEMY, A, "hard", WHY]) });
    expect(output.picks).toEqual([]);
    expect(output.primaryHeroId).toBeNull();
  });

  test("no es el turno del jugador (sin acción) -> no hay nada que recomendar", () => {
    const set = cmSet([onlyPosition(A, 90)]);
    const output = run({ ...set, decision: { ...set.decision, actionKind: null } }, cmView([], [ENEMY]), { heroCounters: counters([ENEMY, A, "hard", WHY]) });
    expect(output.actionKind).toBeNull();
    expect(output.picks).toEqual([]);
    expect(output.bans).toEqual([]);
  });
});

describe("Captains Mode -- BAN: la pregunta es qué le sirve al rival CONTRA TI", () => {
  test("solo posición/popularidad (V6 lo puntúa alto PARA TI): no es un ban con fundamento", () => {
    const output = run(cmSet([onlyPosition(A, 95), onlyPosition(B, 90)], "BAN"), cmView([MINE], [ENEMY]));
    expect(output.actionKind).toBe("BAN");
    expect(output.bans).toEqual([]);
    expect(output.picks).toEqual([]);
    expect(output.primaryHeroId).toBeNull();
  });

  test("un héroe que le gana (con porqué) a un pick TUYO es un ban fuerte, con el pick y el porqué", () => {
    const output = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)], "BAN"), cmView([MINE], [ENEMY]), { heroCounters: counters([MINE, A, "hard", WHY]) });
    expect(output.bans.map((card) => card.heroId)).toEqual([A]);
    expect(output.bans[0]?.evidenceStrength).toBe("STRONG");
    expect(output.bans[0]?.beatsYourPicks.map((entry) => ({ vs: entry.vsHeroId, why: entry.why }))).toEqual([{ vs: MINE, why: WHY }]);
    expect(output.primaryHeroId).toBe(A);
  });

  test("un héroe que hace pareja (con porqué) con un pick del RIVAL es un ban fuerte", () => {
    const output = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)], "BAN"), cmView([MINE], [ENEMY]), { heroSynergies: pairs([A, ENEMY, WHY_PAIR]) });
    expect(output.bans.map((card) => card.heroId)).toEqual([A]);
    expect(output.bans[0]?.pairsWithTheirPicks.map((entry) => entry.withHeroId)).toEqual([ENEMY]);
  });

  test("lo que sirve PARA PICKEAR (le gana a un rival ya revelado) NO es razón para banearlo; el espejo no se invierte", () => {
    const heroCounters = counters([ENEMY, A, "hard", WHY]);
    const ban = run(cmSet([onlyPosition(A, 90)], "BAN"), cmView([MINE], [ENEMY]), { heroCounters });
    expect(ban.bans).toEqual([]);
    // el mismo héroe, mismo estado, en un PICK sí es elegible
    const pick = run(cmSet([onlyPosition(A, 90)], "PICK"), cmView([MINE], [ENEMY]), { heroCounters });
    expect(pick.picks.map((card) => card.heroId)).toEqual([A]);
  });

  test("un counter medio contra un pick tuyo es un ban débil: aparece, pero no se recomienda; el duro va primero y sí", () => {
    const weak = run(cmSet([onlyPosition(A, 90)], "BAN"), cmView([MINE], []), { heroCounters: counters([MINE, A, "medium", WHY]) });
    expect(weak.bans[0]?.evidenceStrength).toBe("WEAK");
    expect(weak.primaryHeroId).toBeNull();
    const mixed = run(cmSet([onlyPosition(A, 90), onlyPosition(B, 80)], "BAN"), cmView([MINE], []), { heroCounters: counters([MINE, A, "medium", WHY], [MINE, B, "hard", WHY]) });
    expect(mixed.bans.map((card) => card.heroId)).toEqual([B, A]);
    expect(mixed.primaryHeroId).toBe(B);
  });
});
