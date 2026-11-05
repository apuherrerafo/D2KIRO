import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { ComputeSuggestionsForRecommendation, PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { deriveCandidateResult } from "./current-human-decision";
import { buildTeamCoachBoard } from "./team-coach-board";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";

// CONTRATO DE ELEGIBILIDAD de punta a punta (dueño del producto, 2026-11-03): el tablero del equipo, la acción principal ("ELIGE AHORA") y la
// decisión V4 comparten UNA regla (recommendation-eligibility.ts). Sin fundamento no hay héroe, ni relleno, ni "exploración", ni mensaje.
// Caso real de la captura del dueño: Terrorblade (carry), Invoker (mid) y Crystal Maiden (hard support), "Por su posición: muy jugado como … en
// alto MMR". Las reglas una por una están en recommendation-eligibility.test.ts. Fixtures inline: ningún dato curado real (S9/S10).

const ALL: Position[] = [1, 2, 3, 4, 5];
const BANNED = 8;
const WHY = "Orchid lo silencia y no puede hacer nada";

/** El mismo stand-in de V6, pero a todos se les quita lo que no sea posición: solo queda el rol (Terrorblade/Invoker/CM de la captura). */
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

interface BoardOptions {
  bans?: number[];
  heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>;
  heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]>;
  controlled?: Position[];
  compute?: ComputeSuggestionsForRecommendation;
}

async function board(options: BoardOptions = {}) {
  const h = harness({ adapterKind: "simulator", controlledPositions: options.controlled ?? ALL, bans: options.bans });
  const context: PerspectiveRecommendationContext = { ...h.store.perspectiveRecommendationContext(h.id)!, playerPoolsByPosition: null };
  const buildTargetRanking = (ctx: PerspectiveRecommendationContext, targetPosition: Position) =>
    buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: options.compute ?? positionOnlyCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true });
  const built = await buildTeamCoachBoard({ context, playerPersonalPosition: 4, heroPositions: HERO_POSITIONS, heroCounters: options.heroCounters, heroSynergies: options.heroSynergies, buildTargetRanking });
  return { board: built!, context, buildTargetRanking };
}

/** Todo lo que el usuario podría leer en el tablero: ni una frase de posición, ni "exploración", ni un mensaje de que falta información. */
const FORBIDDEN_TEXT = ["Por su posición", "xploración", "Sin recomendación", "Sin ranking", "Alternativas", "falta información", "sin orden de preferencia"];

describe("contrato de elegibilidad -- tablero y acción principal", () => {
  test("PRIMER PICK sin ningún fundamento (la captura): ninguna columna muestra un héroe, no hay ELIGE AHORA ni héroe recomendado y ningún texto explica la falta", async () => {
    const { board: built } = await board();
    const open = built.positions.filter((column) => column.eligibleNow);
    expect(open.length).toBeGreaterThan(0);
    for (const column of open) {
      expect(column.top).toEqual([]);
      expect(column.poolTop).toEqual([]);
      expect(column.primaryHeroId).toBeNull();
      expect(column.note).toBeNull();
    }
    expect(built.currentDecision.recommendedPosition).toBeNull();
    expect(built.currentDecision.recommendedHeroId).toBeNull();
    expect(built.currentDecision.targetBasis).toBeNull();
    expect(built.currentDecision.reason).toBe("");
    const text = JSON.stringify(built);
    for (const forbidden of FORBIDDEN_TEXT) expect(text).not.toContain(forbidden);
  });

  test("con un ban que abre a UN héroe, solo ese héroe se muestra y la acción principal sale de su columna (nunca de una vacía)", async () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: WHY }]]]);
    const { board: built } = await board({ bans: [BANNED], heroCounters: counters });
    const withHeroes = built.positions.filter((column) => column.top.length > 0);
    expect(withHeroes.map((column) => column.position)).toEqual([4]); // el héroe 3 juega Pos 4 en el harness
    expect(withHeroes[0]?.top.map((candidate) => candidate.heroId)).toEqual([3]);
    expect(built.currentDecision.recommendedPosition).toBe(4);
    expect(built.currentDecision.recommendedHeroId).toBe(3);
    // Las demás columnas abiertas no recomiendan a nadie y no las destaca ningún texto.
    for (const column of built.positions.filter((entry) => entry.eligibleNow && entry.position !== 4)) {
      expect(column.top).toEqual([]);
      expect(column.primaryHeroId).toBeNull();
    }
    const text = JSON.stringify(built);
    for (const forbidden of FORBIDDEN_TEXT) expect(text).not.toContain(forbidden);
  });

  test("una relación 'Lo dicen: …' no abre a nadie: el tablero queda vacío igual que sin ban", async () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: "Lo dicen: DotaCoach (7.41f)" }]]]);
    const { board: built } = await board({ bans: [BANNED], heroCounters: counters });
    expect(built.positions.every((column) => column.top.length === 0)).toBe(true);
    expect(built.currentDecision.recommendedPosition).toBeNull();
  });

  test("con una sola posición abierta y un fundamento, la acción principal ES ese héroe y la columna lo recomienda", async () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: WHY }]]]);
    const { board: built } = await board({ bans: [BANNED], heroCounters: counters, controlled: [4] });
    const column = built.positions.find((entry) => entry.position === 4)!;
    expect(column.top.map((candidate) => candidate.heroId)).toEqual([3]);
    expect(column.primaryHeroId).toBe(3);
    expect(built.currentDecision.recommendedHeroId).toBe(3);
  });

  test("ELEGIBILIDAD != FUERZA: solo meta (débil) -> los héroes aparecen con su cifra y marca WEAK, pero NADIE es primario, ni héroe recomendado, ni posición destacada", async () => {
    const { board: built } = await board({ compute: fakeCompute() });
    const heroes = built.positions.flatMap((column) => column.top);
    expect(heroes.length).toBeGreaterThan(0);
    for (const candidate of heroes) {
      expect(candidate.evidenceStrength).toBe("WEAK");
      expect(candidate.isPrimary).toBe(false);
      expect(candidate.reasons[0]).toContain("Winrate de 60.0%");
      expect(candidate.reasons[0]?.startsWith("Por su posición")).toBe(false);
    }
    for (const column of built.positions) expect(column.primaryHeroId).toBeNull();
    expect(built.currentDecision.recommendedHeroId).toBeNull(); // sin "ELIGE AHORA"
    expect(built.currentDecision.recommendedPosition).toBeNull();
    expect(built.currentDecision.reason).toBe("");
  });

  test("un héroe FUERTE entre débiles es el único que puede ser primario/recomendado, aunque los débiles tengan más puntaje de V6", async () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: WHY }]]]);
    const { board: built } = await board({ bans: [BANNED], heroCounters: counters, compute: fakeCompute() });
    const strong = built.positions.flatMap((column) => column.top).filter((candidate) => candidate.evidenceStrength === "STRONG");
    expect(strong.map((candidate) => candidate.heroId)).toEqual([3]);
    expect(built.currentDecision.recommendedHeroId).toBe(3);
    expect(built.currentDecision.recommendedPosition).toBe(4);
    // Los débiles siguen visibles en sus columnas, sin ser primarios.
    const weak = built.positions.flatMap((column) => column.top).filter((candidate) => candidate.evidenceStrength === "WEAK");
    expect(weak.length).toBeGreaterThan(0);
    expect(weak.every((candidate) => !candidate.isPrimary)).toBe(true);
  });
});

describe("contrato de elegibilidad -- columnas y decisión V4 salen del mismo punto", () => {
  test("para cada posición abierta, la columna del tablero y las tarjetas de deriveCandidateResult son exactamente los mismos héroes", async () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[3, [{ vs: BANNED, level: "hard", why: WHY }]], [2, [{ vs: BANNED, level: "medium", why: WHY }]]]);
    const { board: built, context, buildTargetRanking } = await board({ bans: [BANNED], heroCounters: counters });
    for (const column of built.positions.filter((entry) => entry.eligibleNow)) {
      const ranking = await buildTargetRanking(context, column.position);
      const result = deriveCandidateResult({ targetPosition: column.position, targetRanking: ranking, view: context.view, heroPositions: HERO_POSITIONS, heroCounters: counters, personalPoolApplied: false, shortlistSize: 5 });
      expect(result.cards.map((card) => card.heroId)).toEqual(column.top.map((candidate) => candidate.heroId));
    }
  });

  test("regresión de la captura: Terrorblade, Invoker y Crystal Maiden con solo posición no producen ni una tarjeta en el panel de decisión", async () => {
    const { context, buildTargetRanking } = await board();
    for (const position of ALL) {
      const ranking = await buildTargetRanking(context, position);
      const result = deriveCandidateResult({ targetPosition: position, targetRanking: ranking, view: context.view, heroPositions: HERO_POSITIONS, personalPoolApplied: false, shortlistSize: 5 });
      expect(result.cards).toEqual([]);
      expect(result.poolCards).toEqual([]);
    }
  });
});
