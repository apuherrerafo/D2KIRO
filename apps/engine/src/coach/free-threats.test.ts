import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { freeThreatsOf, type FreeThreatsInput } from "./free-threats";

// ADVERTIR (PO 2026-11-05): una amenaza libre es un counter FUERTE con porqué contra un pick tuyo que nadie baneó ni eligió. Fixtures inline:
// ninguna prueba lee hero-counters.json ni hero-positions.json reales (se regeneran por parche).

const ALLY = 1; //      tu pick (carry)
const SECOND_ALLY = 2; // tu segundo pick
const OFFLANER = 10; //  counter fuerte, juega pos 3
const SUPPORT = 11; //   counter fuerte, juega pos 4 y 5
const MEDIUM_ONLY = 12; // counter medium: nunca se avisa
const ATTRIBUTION = 13; // counter fuerte pero "Lo dicen: …": no es un porqué de Dota

const BIG = 5000;
const POSITIONS: HeroPositions = {
  [OFFLANER]: [{ position: 3, matches: BIG }],
  [SUPPORT]: [{ position: 4, matches: BIG / 2 }, { position: 5, matches: BIG / 2 }],
  [MEDIUM_ONLY]: [{ position: 4, matches: BIG }],
  [ATTRIBUTION]: [{ position: 3, matches: BIG }],
};

const COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([
  [ALLY, [
    { vs: OFFLANER, level: "hard", why: "Silencia y mata al carry antes de que escale." },
    { vs: SUPPORT, level: "hard", why: "Su stun atraviesa el escudo." },
    { vs: MEDIUM_ONLY, level: "medium", why: "Aguanta su daño." },
    { vs: ATTRIBUTION, level: "hard", why: "Lo dicen: DotaCoach (7.41f)" },
  ]],
]);

function input(over: Partial<FreeThreatsInput> = {}): FreeThreatsInput {
  return {
    banned: new Set(),
    ownPicks: new Set([ALLY]),
    revealedEnemies: new Set(),
    heroCounters: COUNTERS,
    heroPositions: POSITIONS,
    unfilledPositions: [2, 3, 4, 5],
    ...over,
  };
}

describe("freeThreatsOf -- qué cuenta como amenaza libre", () => {
  test("solo relaciones FUERTES con porqué: ni medium ni 'Lo dicen: …'", () => {
    const threats = freeThreatsOf(input());
    expect(threats.map((threat) => threat.threatHeroId).sort((a, b) => a - b)).toEqual([OFFLANER, SUPPORT]);
    expect(threats.every((threat) => threat.ownHeroId === ALLY)).toBe(true);
  });

  test("trae el porqué curado sin punto final, para poder mostrar el mecanismo", () => {
    const threat = freeThreatsOf(input()).find((entry) => entry.threatHeroId === OFFLANER)!;
    expect(threat.why).toBe("Silencia y mata al carry antes de que escale");
  });

  test("un counter baneado ya no es amenaza", () => {
    expect(freeThreatsOf(input({ banned: new Set([OFFLANER]) })).map((threat) => threat.threatHeroId)).toEqual([SUPPORT]);
  });

  test("un counter que ya elegiste tú ya no es amenaza", () => {
    expect(freeThreatsOf(input({ ownPicks: new Set([ALLY, OFFLANER]) })).map((threat) => threat.threatHeroId)).toEqual([SUPPORT]);
  });

  test("un counter que el rival ya reveló ya no es 'libre' (es otro aviso, el de rivales ya revelados)", () => {
    expect(freeThreatsOf(input({ revealedEnemies: new Set([SUPPORT]) })).map((threat) => threat.threatHeroId)).toEqual([OFFLANER]);
  });

  test("sin picks propios, sin counters o con todos baneados: lista vacía, nunca una excepción", () => {
    expect(freeThreatsOf(input({ ownPicks: new Set() }))).toEqual([]);
    expect(freeThreatsOf(input({ heroCounters: undefined }))).toEqual([]);
    expect(freeThreatsOf(input({ banned: new Set([OFFLANER, SUPPORT]) }))).toEqual([]);
  });

  test("dos picks tuyos amenazados por el mismo counter: una entrada por pick, cada una con su porqué", () => {
    const counters = new Map<number, readonly CuratedCounter[]>([
      ...COUNTERS,
      [SECOND_ALLY, [{ vs: OFFLANER, level: "hard", why: "Su ulti rompe la invisibilidad." }]],
    ]);
    const threats = freeThreatsOf(input({ ownPicks: new Set([ALLY, SECOND_ALLY]), heroCounters: counters })).filter((threat) => threat.threatHeroId === OFFLANER);
    expect(threats.map((threat) => [threat.ownHeroId, threat.why])).toEqual([
      [ALLY, "Silencia y mata al carry antes de que escale"],
      [SECOND_ALLY, "Su ulti rompe la invisibilidad"],
    ]);
  });
});

describe("freeThreatsOf -- se puede robar o no", () => {
  test("stealPositions = posiciones por llenar donde ese héroe se juega de verdad (≥1/4 de sus partidas y partidas suficientes)", () => {
    const threats = freeThreatsOf(input());
    expect(threats.find((threat) => threat.threatHeroId === OFFLANER)?.stealPositions).toEqual([3]);
    expect(threats.find((threat) => threat.threatHeroId === SUPPORT)?.stealPositions).toEqual([4, 5]);
  });

  test("si la posición donde juega ya la llenaste, deja de ser robable (se avisa igual, marcada como no robable)", () => {
    const threats = freeThreatsOf(input({ unfilledPositions: [2, 4, 5] }));
    const offlaner = threats.find((threat) => threat.threatHeroId === OFFLANER)!;
    expect(offlaner.stealPositions).toEqual([]);
    expect(threats.find((threat) => threat.threatHeroId === SUPPORT)?.stealPositions).toEqual([4, 5]);
  });

  test("un héroe con pocas partidas no cuenta como robable (mismo criterio que el Robo)", () => {
    const rare: HeroPositions = { ...POSITIONS, [OFFLANER]: [{ position: 3, matches: 100 }] };
    expect(freeThreatsOf(input({ heroPositions: rare })).find((threat) => threat.threatHeroId === OFFLANER)?.stealPositions).toEqual([]);
  });

  test("sin datos de posiciones no se inventa una posición: no robable", () => {
    expect(freeThreatsOf(input({ heroPositions: undefined })).every((threat) => threat.stealPositions.length === 0)).toBe(true);
  });

  test("las robables van primero (lo que todavía puedes resolver) y el orden es determinista", () => {
    const threats = freeThreatsOf(input({ unfilledPositions: [4, 5] }));
    expect(threats.map((threat) => [threat.threatHeroId, threat.stealPositions.length > 0])).toEqual([[SUPPORT, true], [OFFLANER, false]]);
    expect(JSON.stringify(freeThreatsOf(input({ unfilledPositions: [5, 4] })))).toBe(JSON.stringify(threats));
  });
});

describe("freeThreatsOf -- se actualiza cuando cambia el draft", () => {
  test("al banear un counter, esa amenaza desaparece; al llenar una posición, deja de ser robable; al elegir otro pick, aparecen sus amenazas", () => {
    const before = freeThreatsOf(input());
    const afterBan = freeThreatsOf(input({ banned: new Set([OFFLANER]) }));
    const afterFill = freeThreatsOf(input({ unfilledPositions: [2, 4, 5] }));
    const counters = new Map<number, readonly CuratedCounter[]>([...COUNTERS, [SECOND_ALLY, [{ vs: 14, level: "hard", why: "Lo desarma con su hex." }]]]);
    const afterPick = freeThreatsOf(input({ ownPicks: new Set([ALLY, SECOND_ALLY]), heroCounters: counters }));
    expect(before.length).toBe(2);
    expect(afterBan.length).toBe(1);
    expect(afterFill.find((threat) => threat.threatHeroId === OFFLANER)?.stealPositions).toEqual([]);
    expect(afterPick.map((threat) => threat.ownHeroId)).toContain(SECOND_ALLY);
  });
});
