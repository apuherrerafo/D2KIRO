import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCardBasis, deriveCardRisks, type CardEvidenceContext } from "./card-evidence";
import { deriveCandidateResult } from "./current-human-decision";
import { extractHeroCandidates } from "./hero-card";
import { hidden, known, neutralImpact, recSet, resolvedImpact, revealed, signal, view, type HeroFixture } from "./test.fixtures";

// TSK-254 -- the card says where its reason comes from and which risks apply. Inline fixtures only: no curated
// dataset, no SQLite, no network (S9/S10 family). The hero ids are arbitrary labels.

const CANDIDATE = 7;
const curated = (vs: number, level: CuratedCounter["level"] = "hard"): CuratedCounter => ({ vs, level, why: `fixture ${vs}` });
const countersOf = (candidateCounters: CuratedCounter[], extra: [number, CuratedCounter[]][] = []) =>
  new Map<number, CuratedCounter[]>([[CANDIDATE, candidateCounters], ...extra]);

function candidateOf(fixture: HeroFixture) {
  const [candidate] = extractHeroCandidates(recSet([fixture]));
  return candidate!;
}

const context = (overrides: Partial<CardEvidenceContext> = {}): CardEvidenceContext => ({ revealedEnemies: [], bannedHeroes: [], ...overrides });

describe("deriveCardBasis -- la base sale de la señal que cita la razón", () => {
  test("position_fit -> estadístico con su muestra; patch_meta igual", () => {
    const hero: HeroFixture = { heroId: CANDIDATE, signals: [signal("position_fit", 0.7, 20, { sampleSize: 4200 })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(hero), false, context())).toEqual({ kind: "statistical", sources: [{ kind: "statistical", sampleSize: 4200 }] });
    const meta: HeroFixture = { heroId: CANDIDATE, signals: [signal("patch_meta", 0.6, 20, { sampleSize: 900 })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(meta), false, context()).sources).toEqual([{ kind: "statistical", sampleSize: 900 }]);
  });

  test("una estadística sin muestra conocida no inventa un número: sampleSize null", () => {
    const hero: HeroFixture = { heroId: CANDIDATE, signals: [signal("position_fit", 0.7, 20, { sampleSize: 0 })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(hero), false, context()).sources).toEqual([{ kind: "statistical", sampleSize: null }]);
  });

  test("team_synergy es criterio curado, nunca estadístico, aunque la señal traiga un sampleSize", () => {
    const hero: HeroFixture = { heroId: CANDIDATE, signals: [signal("team_synergy", 0.8, 20, { sampleSize: 500 })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(hero), false, context())).toEqual({ kind: "curated", sources: [{ kind: "curated", sampleSize: null }] });
  });

  test("sin señal con dato propio la tarjeta sólo está por la posición: inferido", () => {
    const hero: HeroFixture = { heroId: CANDIDATE, signals: [signal("counter", null, 0)], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(hero), false, context())).toEqual({ kind: "inferred", sources: [{ kind: "inferred", sampleSize: null }] });
  });

  test("hero_pool_fit: con partidas propias es estadístico; sólo 'en tu pool' es una lista declarada (curado)", () => {
    const record: HeroFixture = { heroId: CANDIDATE, signals: [signal("hero_pool_fit", 0.7, 20, { sampleSize: 31, explanation: "En tu pool: 61% en 31 partidas" })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(record), false, context()).sources).toEqual([{ kind: "statistical", sampleSize: 31 }]);
    const listed: HeroFixture = { heroId: CANDIDATE, signals: [signal("hero_pool_fit", 0.7, 20, { sampleSize: 0, explanation: "En tu pool de héroes" })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(listed), false, context()).kind).toBe("curated");
  });
});

describe("deriveCardBasis -- counter se resuelve con la evidencia concreta", () => {
  const counterSignal = (extra: Partial<Parameters<typeof signal>[3]> = {}) =>
    signal("counter", 0.1, 20, { hasRevealedEnemyCounterEvidence: true, explanation: "Le ganás a X", ...extra });
  const hero = (extra: Partial<Parameters<typeof signal>[3]> = {}): HeroFixture => ({ heroId: CANDIDATE, signals: [counterSignal(extra)], impact: resolvedImpact(1) });

  test("par curado duro contra un rival revelado -> curado, aunque la señal también traiga partidas estadísticas", () => {
    const ctx = context({ revealedEnemies: [50], heroCounters: new Map([[50, [curated(CANDIDATE)]]]) });
    expect(deriveCardBasis(candidateOf(hero({ sampleSize: 300 })), true, ctx)).toEqual({ kind: "curated", sources: [{ kind: "curated", sampleSize: null }] });
  });

  test("sin par curado y con evidencia contra un revelado -> estadístico con su n", () => {
    const ctx = context({ revealedEnemies: [50], heroCounters: new Map() });
    expect(deriveCardBasis(candidateOf(hero({ sampleSize: 240 })), true, ctx)).toEqual({ kind: "statistical", sources: [{ kind: "statistical", sampleSize: 240 }] });
  });

  test("estadística + alivio de baneo curado en la misma razón -> mixed, y nombra las dos fuentes", () => {
    const ctx = context({ revealedEnemies: [50], bannedHeroes: [60], heroCounters: countersOf([curated(60)]) });
    const basis = deriveCardBasis(candidateOf(hero({ sampleSize: 240 })), true, ctx);
    expect(basis.kind).toBe("mixed");
    expect(basis.sources).toEqual([{ kind: "statistical", sampleSize: 240 }, { kind: "curated", sampleSize: null }]);
  });

  test("un scorer sin capa estadística (sampleSize 0) nunca se presenta como estadístico", () => {
    expect(deriveCardBasis(candidateOf(hero({ sampleSize: 0 })), true, context()).kind).toBe("curated");
  });

  test("sólo alivio de baneo (sin rival revelado) -> curado", () => {
    const ctx = context({ bannedHeroes: [60], heroCounters: countersOf([curated(60)]) });
    const onlyRelief: HeroFixture = { heroId: CANDIDATE, signals: [signal("counter", 0.04, 20, { hasRevealedEnemyCounterEvidence: false, sampleSize: 0, explanation: "1 de sus counters está baneado: X" })], impact: resolvedImpact(1) };
    expect(deriveCardBasis(candidateOf(onlyRelief), false, ctx).kind).toBe("curated");
  });
});

describe("deriveCardRisks", () => {
  const solid: HeroFixture = { heroId: CANDIDATE, signals: [signal("position_fit", 0.7, 20)], impact: resolvedImpact(1) };
  const round1 = (enemy = [hidden()], bans: number[] = [], own = [known(1)]) => view("PICK_ROUND_1", own, enemy, bans);

  test("sin counters duros curados ni señales débiles -> sin riesgos (y nunca ausente)", () => {
    expect(deriveCardRisks(candidateOf(solid), round1(), new Map())).toEqual([]);
    expect(deriveCardRisks(candidateOf(solid), round1(), undefined)).toEqual([]);
  });

  test("COUNTERED_BY_REVEALED: un counter duro curado ya revelado se nombra; el medio no cuenta", () => {
    const counters = countersOf([curated(50), curated(51, "medium")]);
    const risks = deriveCardRisks(candidateOf(solid), round1([revealed(50), revealed(51)]), counters);
    const countered = risks.find((risk) => risk.kind === "countered_by_revealed");
    expect(countered?.heroIds).toEqual([50]);
  });

  test("EXPOSED_TO_COUNTER en ronda 1 y 2 si un counter duro sigue disponible, con los héroes nombrados", () => {
    const counters = countersOf([curated(50), curated(51)]);
    for (const phase of ["PICK_ROUND_1", "PICK_ROUND_2"] as const) {
      const risks = deriveCardRisks(candidateOf(solid), view(phase, [known(1)], [hidden()]), counters);
      expect(risks.map((risk) => risk.kind)).toEqual(["exposed_to_counter"]);
      expect(risks[0]?.heroIds).toEqual([50, 51]);
    }
  });

  test("ronda 3: el rival ya no puede reaccionar a tu reveal -> sin EXPOSED_TO_COUNTER", () => {
    const risks = deriveCardRisks(candidateOf(solid), view("PICK_ROUND_3", [known(1)], [hidden()]), countersOf([curated(50)]));
    expect(risks.map((risk) => risk.kind)).not.toContain("exposed_to_counter");
  });

  test("un counter baneado, uno propio y uno revelado NO están disponibles: la exposición los descuenta", () => {
    const counters = countersOf([curated(50), curated(51), curated(52), curated(53)]);
    const risks = deriveCardRisks(candidateOf(solid), view("PICK_ROUND_1", [known(51)], [revealed(52)], [50]), counters);
    expect(risks.find((risk) => risk.kind === "exposed_to_counter")?.heroIds).toEqual([53]);
    expect(risks.find((risk) => risk.kind === "countered_by_revealed")?.heroIds).toEqual([52]);
  });

  test("todos los counters duros fuera de la mesa -> sin exposición", () => {
    const risks = deriveCardRisks(candidateOf(solid), view("PICK_ROUND_1", [known(51)], [hidden()], [50]), countersOf([curated(50), curated(51)]));
    expect(risks).toEqual([]);
  });

  test("un enemigo HIDDEN nunca cuenta como revelado (no se filtra información oculta)", () => {
    const risks = deriveCardRisks(candidateOf(solid), view("PICK_ROUND_1", [known(1)], [hidden(), hidden()]), countersOf([curated(50)]));
    expect(risks.map((risk) => risk.kind)).toEqual(["exposed_to_counter"]);
  });

  test("los riesgos por héroe que V6 ya derivaba llegan a la tarjeta: rol sin resolver y confianza baja", () => {
    const weak: HeroFixture = { heroId: CANDIDATE, signals: [signal("position_fit", 0.7, 20)], impact: neutralImpact(), confidence: "baja" };
    expect(deriveCardRisks(candidateOf(weak), round1(), undefined).map((risk) => risk.kind)).toEqual(["unresolved_role", "low_evidence"]);
  });

  test("meta vieja NO es un riesgo por tarjeta: es un hecho de todo el ranking y la sección ya lo dice una vez", () => {
    const [candidate] = extractHeroCandidates(recSet([solid]));
    const stale = { ...candidate!, recommendation: { ...candidate!.recommendation, risks: [{ kind: "degraded_meta" as const, detail: "stale" }] } };
    expect(deriveCardRisks(stale, round1(), undefined)).toEqual([]);
  });
});

describe("deriveCandidateResult -- las tarjetas V4 llevan base y riesgos, y el ranking no se mueve", () => {
  const POSITIONS: HeroPositions = { 7: [{ position: 1, matches: 3000 }], 8: [{ position: 1, matches: 3000 }] };
  const heroes: HeroFixture[] = [
    { heroId: 7, signals: [signal("position_fit", 0.9, 30, { sampleSize: 3000 })], impact: resolvedImpact(1) },
    { heroId: 8, signals: [signal("position_fit", 0.8, 20, { sampleSize: 3000 })], impact: resolvedImpact(1) },
  ];
  const derive = (heroCounters: ReadonlyMap<number, readonly CuratedCounter[]> | undefined, viewArg = view("PICK_ROUND_1", [], [hidden()])) =>
    deriveCandidateResult({ targetPosition: 1, targetRanking: recSet(heroes), view: viewArg, heroPositions: POSITIONS, heroCounters, personalPoolApplied: false });

  test("con y sin counters curados el orden, los puntajes y las insignias son idénticos; sólo cambian los riesgos", () => {
    const without = derive(undefined);
    const withCounters = derive(new Map([[7, [curated(50)]]]));
    if (without.state !== "RANKED" || withCounters.state !== "RANKED") throw new Error("expected RANKED");
    const shape = (cards: typeof without.cards) => cards.map((card) => [card.heroId, card.rank, card.score, card.badges, card.rationale, card.basis]);
    expect(shape(withCounters.cards)).toEqual(shape(without.cards));
    expect(without.cards.map((card) => card.risks)).toEqual([[], []]);
    expect(withCounters.cards[0]?.risks.map((risk) => risk.kind)).toEqual(["exposed_to_counter"]);
    expect(withCounters.cards[1]?.risks).toEqual([]);
  });

  test("cada tarjeta trae basis (estadístico con n) aunque no haya ningún riesgo", () => {
    const result = derive(undefined);
    if (result.state !== "RANKED") throw new Error("expected RANKED");
    expect(result.cards[0]?.basis).toEqual({ kind: "statistical", sources: [{ kind: "statistical", sampleSize: 3000 }] });
  });
});
