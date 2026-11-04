import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { ComputeSuggestionsForRecommendation, PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { deriveCandidateResult } from "./current-human-decision";
import { POSITION_ONLY_PREFIX } from "./hero-card";
import { buildTeamCoachBoard } from "./team-coach-board";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";
import { hidden, known, recSet, resolvedImpact, revealed, roleOnlyHero, signal, view, type HeroFixture } from "./test.fixtures";

// CONTRATO DE EVIDENCIA (P1, 2026-11-03). Regla del dueño del producto: la compatibilidad de posición es un FILTRO DE ELEGIBILIDAD, nunca el
// único motivo para recomendar un héroe -- tampoco en el primer pick, y tampoco la popularidad en alto MMR. Un héroe recomendado tiene al menos
// un fundamento verificable del estado actual del draft (counter por ban o por rival visible, sinergia con un aliado, necesidad de la composición,
// intención elegida, pool propio). Sin fundamento: la columna dice que no hay recomendación y lista héroes legales como EXPLORACIÓN, sin orden de
// preferencia y sin nombrar a nadie como "el recomendado".
// Caso real de la captura del dueño: Terrorblade (carry), Invoker (mid) y Crystal Maiden (hard support), los tres con "Por su posición: muy
// jugado como … en alto MMR". Fixtures inline: ningún dato curado real (familia S9/S10).

const TERRORBLADE = 109;
const INVOKER = 74;
const CRYSTAL_MAIDEN = 5;
const WARD_BANNED = 902; // un héroe baneado que counterea fuerte a uno de los candidatos
const ENEMY = 900;
const ALLY = 901;

const POSITIONS: HeroPositions = {
  [TERRORBLADE]: [{ position: 1, matches: 3000 }],
  [INVOKER]: [{ position: 2, matches: 3000 }],
  [CRYSTAL_MAIDEN]: [{ position: 5, matches: 3000 }],
};

const onlyPosition = (heroId: number, position: Position, weighted: number): HeroFixture => roleOnlyHero(heroId, position, weighted);
const withPair = (heroId: number, position: Position, weighted: number): HeroFixture => ({
  heroId,
  signals: [signal("position_fit", 0.7, weighted - 5), signal("team_synergy", 0.7, 5)],
  impact: resolvedImpact(position),
});

const firstPick = (bans: number[] = []) => view("PICK_ROUND_1", [], [], bans);
const secondRoundWithAlly = () => view("PICK_ROUND_2", [known(ALLY)], [hidden()]);
const secondRoundWithEnemy = () => view("PICK_ROUND_2", [], [revealed(ENEMY)]);

function derive(position: Position, heroes: HeroFixture[], options: { view: ReturnType<typeof view>; heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>; heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]> }) {
  return deriveCandidateResult({
    targetPosition: position,
    targetRanking: recSet(heroes),
    view: options.view,
    heroPositions: POSITIONS,
    heroCounters: options.heroCounters,
    heroSynergies: options.heroSynergies,
    personalPoolApplied: false,
  });
}

describe("contrato de evidencia -- la posición sola no es una recomendación", () => {
  test("1. PRIMER PICK: un héroe cuya única razón es la posición NO se presenta como recomendación (caso Terrorblade de la captura)", () => {
    const result = derive(1, [onlyPosition(TERRORBLADE, 1, 90)], { view: firstPick() });
    expect(result.state).toBe("UNRANKED_POSITIONAL");
    if (result.state !== "UNRANKED_POSITIONAL") return;
    // Comunica que no hay recomendación y que lo que se lista es exploración, sin puntaje ni ranking.
    expect(result.reason.startsWith("Sin recomendación con motivo")).toBe(true);
    expect(result.reason).toContain("exploración");
    expect(result.alternatives.every((alternative) => !("score" in alternative) && !("rank" in alternative))).toBe(true);
  });

  test("1b. caso de la captura completa: Terrorblade, Invoker y Crystal Maiden con solo posición -> ninguna de las tres columnas recomienda a nadie", () => {
    const cases: [Position, number][] = [[1, TERRORBLADE], [2, INVOKER], [5, CRYSTAL_MAIDEN]];
    for (const [position, heroId] of cases) {
      const result = derive(position, [onlyPosition(heroId, position, 90)], { view: firstPick() });
      expect(result.state).toBe("UNRANKED_POSITIONAL");
    }
  });

  test("1c. con un pick propio a la vista tampoco alcanza (la regla no depende del momento del draft)", () => {
    expect(derive(1, [onlyPosition(TERRORBLADE, 1, 90)], { view: secondRoundWithAlly() }).state).toBe("UNRANKED_POSITIONAL");
  });

  test("2. un héroe con counter verificable SÍ se recomienda: los bans abren a Terrorblade (se baneó lo que lo counterea) y solo él pasa", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[TERRORBLADE, [{ vs: WARD_BANNED, level: "hard", why: "x" }]]]);
    const result = derive(1, [onlyPosition(TERRORBLADE, 1, 80), onlyPosition(INVOKER, 1, 90)], { view: firstPick([WARD_BANNED]), heroCounters: counters });
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([TERRORBLADE]); // Invoker tiene MÁS puntaje de V6 pero solo posición: queda fuera
    expect(result.cards[0]?.context?.opening.openedBy.length).toBeGreaterThan(0);
  });

  test("2b. counter contra un rival YA revelado también vale; si ese rival no se ve, no", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[ENEMY, [{ vs: TERRORBLADE, level: "hard", why: "x" }]]]);
    const seen = derive(1, [onlyPosition(TERRORBLADE, 1, 80)], { view: secondRoundWithEnemy(), heroCounters: counters });
    expect(seen.state).toBe("RANKED");
    const unseen = derive(1, [onlyPosition(TERRORBLADE, 1, 80)], { view: secondRoundWithAlly(), heroCounters: counters });
    expect(unseen.state).toBe("UNRANKED_POSITIONAL");
  });

  test("3. un héroe con sinergia verificable SÍ se recomienda (pareja curada con un aliado ya elegido); sin ese aliado, no", () => {
    const pairs: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map([[CRYSTAL_MAIDEN, [{ with: ALLY, why: "combo" }]]]);
    const withAlly = derive(5, [onlyPosition(CRYSTAL_MAIDEN, 5, 70)], { view: secondRoundWithAlly(), heroSynergies: pairs });
    if (withAlly.state !== "RANKED") throw new Error(withAlly.state);
    expect(withAlly.cards.map((card) => card.heroId)).toEqual([CRYSTAL_MAIDEN]);
    expect(withAlly.cards[0]?.context?.synergies.length).toBeGreaterThan(0);
    expect(derive(5, [onlyPosition(CRYSTAL_MAIDEN, 5, 70)], { view: secondRoundWithEnemy(), heroSynergies: pairs }).state).toBe("UNRANKED_POSITIONAL");
  });

  test("3b. necesidad de composición demostrada por el motor (team_synergy con dato) también es fundamento", () => {
    const result = derive(2, [withPair(INVOKER, 2, 60), onlyPosition(TERRORBLADE, 2, 90)], { view: secondRoundWithAlly() });
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([INVOKER]);
  });

  test("4. BLIND PICK justificado sin inventar enemigos: la tarjeta nombra lo que los bans abrieron y no trae ningún counter ni sinergia", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[TERRORBLADE, [{ vs: WARD_BANNED, level: "hard", why: "x" }]]]);
    const result = derive(1, [onlyPosition(TERRORBLADE, 1, 80)], { view: firstPick([WARD_BANNED]), heroCounters: counters });
    if (result.state !== "RANKED") throw new Error(result.state);
    const context = result.cards[0]?.context;
    expect(context?.opening.openedBy).toEqual([expect.objectContaining({ heroId: WARD_BANNED })]);
    expect(context?.strengths).toEqual([]); // no hay rivales visibles: no se supone ninguno
    expect(context?.synergies).toEqual([]);
    expect(context?.steals).toEqual([]);
  });

  test("5. no recibe explicaciones que no participaron: un counter curado contra un rival que NO se ve no genera fortalezas ni abre la puerta", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[TERRORBLADE, [{ vs: WARD_BANNED, level: "hard", why: "x" }]], [INVOKER, [{ vs: ENEMY, level: "hard", why: "y" }]]]);
    // ENEMY no está revelado (slot oculto) ni baneado: el counter de Invoker contra él no existe todavía en este draft.
    const result = derive(1, [onlyPosition(TERRORBLADE, 1, 80), onlyPosition(INVOKER, 1, 70)], { view: view("PICK_ROUND_1", [], [hidden()], [WARD_BANNED]), heroCounters: counters });
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([TERRORBLADE]);
    expect(result.cards[0]?.context?.strengths).toEqual([]);
  });

  test("5b. la frase de posición no se hace pasar por el motivo: en una tarjeta abierta por bans queda oculta (hideRationale) y sigue diciendo 'Por su posición'", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[TERRORBLADE, [{ vs: WARD_BANNED, level: "hard", why: "x" }]]]);
    const result = derive(1, [onlyPosition(TERRORBLADE, 1, 80)], { view: firstPick([WARD_BANNED]), heroCounters: counters });
    if (result.state !== "RANKED") throw new Error(result.state);
    const card = result.cards[0]!;
    expect(card.rationale.startsWith(POSITION_ONLY_PREFIX)).toBe(true);
    expect(card.hideRationale).toBe(true);
  });

  test("5c. un héroe habilitado SOLO por el pool lo dice ('Está en tu pool…'), nunca 'Por su posición': esa no fue la razón que decidió la tarjeta", () => {
    const result = deriveCandidateResult({ targetPosition: 1, targetRanking: recSet([onlyPosition(TERRORBLADE, 1, 90), onlyPosition(INVOKER, 1, 80)]), view: firstPick(), heroPositions: POSITIONS, personalPoolApplied: false, activePool: [TERRORBLADE] });
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([TERRORBLADE]);
    expect(result.cards[0]?.rationale.startsWith(POSITION_ONLY_PREFIX)).toBe(false);
    expect(result.cards[0]?.rationale).toContain("pool");
    expect(result.cards[0]?.isFromPool).toBe(true);
  });

  test("7. los fallbacks no eluden la regla: un ranking inválido lista exploración sin puntaje ni ranking, aunque el héroe tenga motivo en V6", () => {
    const degraded = deriveCandidateResult({
      targetPosition: 1,
      targetRanking: recSet([withPair(TERRORBLADE, 1, 90)], { degradations: [{ reason: "NO_LEGAL_HERO_UNIVERSE", detail: "fixture" }] }),
      view: firstPick(),
      heroPositions: POSITIONS,
      personalPoolApplied: false,
    });
    expect(degraded.state).toBe("UNRANKED_POSITIONAL");
    if (degraded.state !== "UNRANKED_POSITIONAL") return;
    expect(degraded.alternatives.every((alternative) => !("score" in alternative) && !("rank" in alternative))).toBe(true);
    expect(derive(1, [], { view: firstPick() }).state).not.toBe("RANKED");
  });
});

// ---- Tablero del equipo + acción principal (punto 6) -----------------------------------------------------------------------------------------

const ALL: Position[] = [1, 2, 3, 4, 5];

/** El mismo stand-in de V6, pero a todos se les quita lo que no sea posición: solo queda el rol. */
function positionOnlyCompute(): ComputeSuggestionsForRecommendation {
  const base = fakeCompute();
  const strip = <T extends { signal: string }>(signals: readonly T[]): T[] => signals.filter((entry) => entry.signal === "position_fit");
  return async (...args) => {
    const set = await base(...args);
    return {
      ...set,
      suggestions: set.suggestions.map((suggestion) => ({ ...suggestion, signals: strip(suggestion.signals) })),
      functionalEvidence: set.functionalEvidence
        ? { ...set.functionalEvidence, signalEvidence: set.functionalEvidence.signalEvidence.map((entry) => ({ ...entry, signals: strip(entry.signals) })) }
        : set.functionalEvidence,
    };
  };
}

async function firstPickBoard(options: { bans?: number[]; heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>; controlled?: Position[] } = {}) {
  const h = harness({ adapterKind: "simulator", controlledPositions: options.controlled ?? ALL, bans: options.bans });
  const context: PerspectiveRecommendationContext = { ...h.store.perspectiveRecommendationContext(h.id)!, playerPoolsByPosition: null };
  const buildTargetRanking = (ctx: PerspectiveRecommendationContext, targetPosition: Position) =>
    buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: positionOnlyCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true });
  const board = await buildTeamCoachBoard({ context, playerPersonalPosition: 4, heroPositions: HERO_POSITIONS, heroCounters: options.heroCounters, buildTargetRanking });
  return { board: board!, context, buildTargetRanking };
}

describe("contrato de evidencia -- la acción principal y las columnas comparten el mismo contrato", () => {
  test("6. PRIMER PICK sin ningún fundamento: ninguna columna abierta recomienda a nadie y la acción principal no nombra a ningún héroe", async () => {
    const { board } = await firstPickBoard();
    const open = board.positions.filter((column) => column.eligibleNow);
    expect(open.length).toBeGreaterThan(0);
    for (const column of open) {
      expect(column.state).toBe("UNRANKED_POSITIONAL");
      expect(column.primaryHeroId).toBeNull();
      expect(column.top.some((candidate) => candidate.isPrimary)).toBe(false);
      expect(column.note?.startsWith("Sin recomendación con motivo")).toBe(true);
    }
    expect(board.currentDecision.recommendedHeroId).toBeNull();
  });

  test("6b. con una sola posición abierta y un ban que abre a un héroe, la acción principal ES ese héroe y la columna lo recomienda", async () => {
    const BANNED = 8;
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: "x" }]]]);
    const { board } = await firstPickBoard({ bans: [BANNED], heroCounters: counters, controlled: [4] });
    const column = board.positions.find((entry) => entry.position === 4)!;
    expect(column.state).toBe("RANKED");
    expect(column.top.map((candidate) => candidate.heroId)).toEqual([3]); // el resto de los pos 4 solo tiene posición: no se recomienda
    expect(board.currentDecision.recommendedHeroId).toBe(3);
    expect(column.primaryHeroId).toBe(3);
    expect(column.top[0]?.opening.openedBy.length).toBeGreaterThan(0);
  });

  test("6b'. con 5 posiciones abiertas, la acción principal nunca nombra a un héroe de una columna sin ranking y toda tarjeta visible con ranking tiene fundamento", async () => {
    const BANNED = 8;
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: "x" }]]]);
    const { board } = await firstPickBoard({ bans: [BANNED], heroCounters: counters });
    const recommended = board.currentDecision.recommendedHeroId;
    const targetColumn = board.positions.find((column) => column.position === board.currentDecision.recommendedPosition);
    if (recommended !== null) {
      expect(targetColumn?.state).toBe("RANKED");
      expect(targetColumn?.primaryHeroId).toBe(recommended);
    }
    for (const column of board.positions.filter((entry) => entry.eligibleNow)) {
      if (column.state === "RANKED") for (const candidate of column.top) expect(candidate.opening.openedBy.length).toBeGreaterThan(0);
      else expect(column.primaryHeroId).toBeNull();
    }
    // La columna que SÍ tiene fundamento (Pos 4, abierta por el ban) existe y es la única con ranking.
    expect(board.positions.filter((column) => column.state === "RANKED").map((column) => column.position)).toEqual([4]);
  });

  test("6c. columna y panel de decisión salen del mismo punto: para la misma posición dan exactamente los mismos héroes", async () => {
    const BANNED = 8;
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: "x" }]]]);
    const { board, context, buildTargetRanking } = await firstPickBoard({ bans: [BANNED], heroCounters: counters });
    for (const column of board.positions.filter((entry) => entry.eligibleNow)) {
      const ranking = await buildTargetRanking(context, column.position);
      const result = deriveCandidateResult({ targetPosition: column.position, targetRanking: ranking, view: context.view, heroPositions: HERO_POSITIONS, heroCounters: counters, personalPoolApplied: false, shortlistSize: 5 });
      const shown = column.state === "RANKED" ? column.top.map((candidate) => candidate.heroId) : [];
      const panel = result.state === "RANKED" ? result.cards.map((card) => card.heroId) : [];
      expect(panel).toEqual(shown);
    }
  });
});
