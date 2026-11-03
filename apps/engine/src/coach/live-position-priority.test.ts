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
