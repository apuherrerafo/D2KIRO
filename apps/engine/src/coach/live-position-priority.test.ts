import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import { selectLivePositionPriority, type LivePositionPriorityInput } from "./live-position-priority";

// P0-3 -- LivePositionPriorityV1 (pure). Columns, counters and pools are inline fixtures.

const ALL: Position[] = [1, 2, 3, 4, 5];
const COLUMNS = ALL.map((position) => ({ position, heroIds: [position * 10, position * 10 + 1, position * 10 + 2] }));
const ENEMY = 90;
/** Keyed by the VICTIM: hero 41 (on the Pos 4 shortlist) hard-counters the revealed enemy 90. */
const COUNTERS = new Map<number, CuratedCounter[]>([[ENEMY, [{ vs: 41, level: "hard", why: "fixture" }]]]);

function input(partial: Partial<LivePositionPriorityInput> = {}): LivePositionPriorityInput {
  return { actionablePositions: ALL, phase: "PICK_ROUND_1", columns: COLUMNS, revealedEnemies: [], heroCounters: new Map(), playerPoolsByPosition: null, unavailable: new Set(), occupancy: null, ...partial };
}

describe("LivePositionPriorityV1", () => {
  test("EMPTY DRAFT: not Pos 1 because 1 is the smallest number -- an honest PHASE_FALLBACK", () => {
    const priority = selectLivePositionPriority(input());
    expect(priority.targetPosition).not.toBe(1);
    expect(priority.targetPosition).toBe(5);
    expect(priority.targetBasis).toBe("PHASE_FALLBACK");
    expect(priority.signal).toBe("PHASE");
    expect(priority.targetRationale).toContain("no una ventaja");
  });

  test("the phase fallback walks the commitment order over what is left (cores last, mid last of all)", () => {
    expect(selectLivePositionPriority(input({ actionablePositions: [1, 2, 3], phase: "PICK_ROUND_2" })).targetPosition).toBe(3);
    expect(selectLivePositionPriority(input({ actionablePositions: [1, 2], phase: "PICK_ROUND_2" })).targetPosition).toBe(1);
  });

  test("COUNTER WINDOW: a hard counter on the Pos 4 shortlist (none on Pos 1) makes Pos 4 the STRATEGIC target", () => {
    const priority = selectLivePositionPriority(input({ revealedEnemies: [ENEMY], heroCounters: COUNTERS }));
    expect(priority).toMatchObject({ targetPosition: 4, targetBasis: "STRATEGIC", signal: "COUNTER_WINDOW", signalHeroId: 41 });
  });

  test("the counter window overrides the phase preference only when it exists", () => {
    // Same counters, but the enemy has not been revealed: no window, back to the phase order.
    expect(selectLivePositionPriority(input({ heroCounters: COUNTERS })).targetBasis).toBe("PHASE_FALLBACK");
  });

  test("a counter that is itself hard-countered by a revealed enemy is not a window", () => {
    const counters = new Map<number, CuratedCounter[]>([[ENEMY, [{ vs: 41, level: "hard", why: "f" }]], [41, [{ vs: 91, level: "hard", why: "f" }]]]);
    expect(selectLivePositionPriority(input({ revealedEnemies: [ENEMY, 91], heroCounters: counters })).signal).toBe("PHASE");
  });

  test("equally strong windows on two positions narrow the field; the phase order decides, never called STRATEGIC", () => {
    const counters = new Map<number, CuratedCounter[]>([[ENEMY, [{ vs: 41, level: "hard", why: "f" }, { vs: 11, level: "hard", why: "f" }]]]);
    const priority = selectLivePositionPriority(input({ revealedEnemies: [ENEMY], heroCounters: counters }));
    expect(priority).toMatchObject({ targetPosition: 4, targetBasis: "PHASE_FALLBACK" });
  });

  test("medium counters are evidence only, never a window", () => {
    const counters = new Map<number, CuratedCounter[]>([[ENEMY, [{ vs: 11, level: "medium", why: "f" }]]]);
    expect(selectLivePositionPriority(input({ revealedEnemies: [ENEMY], heroCounters: counters })).signal).toBe("PHASE");
  });

  test("POOL SCARCITY: one legal pool hero left (on the shortlist) -> secure that position", () => {
    const pools = { 1: [10, 11], 2: [20, 21], 3: [30, 31], 4: [40, 41], 5: [50, 51] };
    const priority = selectLivePositionPriority(input({ playerPoolsByPosition: pools, unavailable: new Set([21]) }));
    expect(priority).toMatchObject({ targetPosition: 2, targetBasis: "STRATEGIC", signal: "POOL_SCARCITY", signalHeroId: 20 });
  });

  test("a FILLED position is never a candidate: only actionable positions can be returned", () => {
    for (const actionable of [[2, 3], [1, 4], [3]] as Position[][]) {
      expect(actionable).toContain(selectLivePositionPriority(input({ actionablePositions: actionable, revealedEnemies: [ENEMY], heroCounters: COUNTERS })).targetPosition);
    }
  });

  test("AMBIGUOUS OWN ROLE: a window on a position an own flex hero may occupy is not a strategic certainty", () => {
    const occupancy = { necessarilyOccupied: [], possiblyOccupied: [3, 4] as Position[], unresolvedHeroes: [{ heroId: 32, possiblePositions: [3, 4] as Position[] }] };
    const priority = selectLivePositionPriority(input({ revealedEnemies: [ENEMY], heroCounters: COUNTERS, occupancy }));
    expect(priority.targetPosition).toBe(5);
    expect(priority.targetBasis).toBe("PHASE_FALLBACK");
    expect(priority.targetRationale).toContain("sin rol confirmado");
  });

  test("every open position in doubt -> never STRATEGIC, even with a counter window", () => {
    const occupancy = { necessarilyOccupied: [], possiblyOccupied: [3, 4] as Position[], unresolvedHeroes: [{ heroId: 32, possiblePositions: [3, 4] as Position[] }] };
    const priority = selectLivePositionPriority(input({ actionablePositions: [3, 4], revealedEnemies: [ENEMY], heroCounters: COUNTERS, occupancy }));
    expect(priority.targetBasis).toBe("PHASE_FALLBACK");
  });

  test("a single open position is not a priority decision", () => {
    expect(selectLivePositionPriority(input({ actionablePositions: [2] }))).toMatchObject({ targetPosition: 2, targetBasis: "DETERMINISTIC_DEFAULT", signal: "SINGLE_POSITION" });
  });
});

describe("LivePositionPriorityV1 -- necesidad de composición (Live, picks sin posición declarada)", () => {
  // Lion + Crystal Maiden + Rubick: carry y offlane sin cubrir, los dos asientos de support cubiertos.
  const THREE_SUPPORTS = { 1: 1, 2: 0, 3: 1, 4: 0, 5: 0 } as const;
  const IN_DOUBT = { necessarilyOccupied: [] as Position[], possiblyOccupied: [1, 2, 3, 4, 5] as Position[], unresolvedHeroes: [] };

  test("Lion + CM + Rubick (todo en duda): ya no manda a un cuarto support; va al offlane (el primero del orden de fase entre los que faltan)", () => {
    const priority = selectLivePositionPriority(input({ phase: "PICK_ROUND_2", occupancy: IN_DOUBT, compositionNeed: THREE_SUPPORTS }));
    expect(priority.targetPosition).toBe(3);
    expect(priority.targetBasis).toBe("PHASE_FALLBACK");
    expect(priority.signal).toBe("COMPOSITION_NEED");
    expect(priority.signalHeroId).toBeNull();
  });

  test("sin compositionNeed el resultado es el de siempre (orden fijo por fase): candado de regresión", () => {
    const priority = selectLivePositionPriority(input({ phase: "PICK_ROUND_2", occupancy: IN_DOUBT }));
    expect(priority).toMatchObject({ targetPosition: 5, targetBasis: "PHASE_FALLBACK", signal: "PHASE" });
    expect(selectLivePositionPriority(input({ phase: "PICK_ROUND_2", occupancy: IN_DOUBT, compositionNeed: null }))).toEqual(priority);
  });

  test("necesidad pareja en todas las posiciones (primer pick, nada cubierto): el orden por fase decide igual que hoy, con señal PHASE", () => {
    const flat = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 } as const;
    const withNeed = selectLivePositionPriority(input({ compositionNeed: flat }));
    expect(withNeed).toEqual(selectLivePositionPriority(input()));
    expect(withNeed.signal).toBe("PHASE");
  });

  test("el orden por fase sigue mandando entre posiciones igual de faltantes (offlane antes que carry), sin obligar al carry", () => {
    expect(selectLivePositionPriority(input({ compositionNeed: THREE_SUPPORTS })).targetPosition).toBe(3);
    expect(selectLivePositionPriority(input({ actionablePositions: [1, 2, 4, 5], compositionNeed: THREE_SUPPORTS })).targetPosition).toBe(1);
  });

  test("regla de mayoría: una posición cubierta más probable que no se salta; una cubierta a medias (flex) NO se descarta", () => {
    const halfCovered = { 1: 1, 2: 1, 3: 1, 4: 0.6, 5: 0.6 } as const; // un support flex todavía puede no ocupar ni el 4 ni el 5
    expect(selectLivePositionPriority(input({ compositionNeed: halfCovered }))).toMatchObject({ targetPosition: 5, signal: "PHASE" });
    const mostlyCovered = { 1: 1, 2: 1, 3: 1, 4: 0.4, 5: 0.4 } as const;
    expect(selectLivePositionPriority(input({ compositionNeed: mostlyCovered }))).toMatchObject({ targetPosition: 3, signal: "COMPOSITION_NEED" });
  });

  test("si todas las posiciones accionables ya están cubiertas no hay nada que preferir: el orden por fase de siempre", () => {
    const allCovered = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as const;
    expect(selectLivePositionPriority(input({ compositionNeed: allCovered }))).toMatchObject({ targetPosition: 5, signal: "PHASE" });
  });

  test("sólo ordena lo accionable: una posición cubierta/llena que no está en la lista nunca aparece, aunque su necesidad sea la mayor", () => {
    const priority = selectLivePositionPriority(input({ actionablePositions: [2, 4, 5], compositionNeed: THREE_SUPPORTS }));
    expect([2, 4, 5]).toContain(priority.targetPosition);
  });

  test("una ventana de counter STRATEGIC le gana a la necesidad de composición (el contexto estratégico real manda)", () => {
    const priority = selectLivePositionPriority(input({ revealedEnemies: [ENEMY], heroCounters: COUNTERS, compositionNeed: THREE_SUPPORTS }));
    expect(priority).toMatchObject({ targetPosition: 4, targetBasis: "STRATEGIC", signal: "COUNTER_WINDOW" });
  });

  test("una sola posición pendiente sigue siendo DETERMINISTIC_DEFAULT: la necesidad no se consulta", () => {
    expect(selectLivePositionPriority(input({ actionablePositions: [5], compositionNeed: THREE_SUPPORTS }))).toMatchObject({ targetPosition: 5, signal: "SINGLE_POSITION" });
  });

  test("honestidad: la razón dice que es una estimación, nunca una ventaja ni una posición confirmada", () => {
    const rationale = selectLivePositionPriority(input({ compositionNeed: THREE_SUPPORTS })).targetRationale;
    expect(rationale).toContain("estimación");
    expect(rationale).toContain("no una posición confirmada");
    expect(rationale).not.toContain("Ventana de counter");
  });
});
