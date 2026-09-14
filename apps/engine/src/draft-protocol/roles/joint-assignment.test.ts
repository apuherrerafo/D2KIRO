import { describe, expect, test } from "bun:test";
import type { HeroPositions } from "../../signals/hero-positions";
import { computeRoleBelief } from "./role-belief";
import type { RoleBeliefInput } from "./role-belief";
import { computeJointRoleAssignment } from "./joint-assignment";
import type { JointAssignmentHeroInput } from "./joint-assignment";

function hero(heroId: number, input: Omit<RoleBeliefInput, "heroId">): JointAssignmentHeroInput {
  return { heroId, belief: computeRoleBelief({ ...input, heroId }) };
}

describe("computeJointRoleAssignment -- S4.3", () => {
  test("sin héroes -> resultado vacío, sin rechazo", () => {
    const result = computeJointRoleAssignment([]);
    expect(result.candidates).toHaveLength(0);
    expect(result.rejected).toBeUndefined();
    expect(result.openPositions).toEqual([1, 2, 3, 4, 5]);
  });

  test("más de 5 héroes se rechaza explícitamente (asignación imposible)", () => {
    const heroes = [1, 2, 3, 4, 5, 6].map((id) => hero(id, {}));
    const result = computeJointRoleAssignment(heroes);
    expect(result.rejected).toBe("TOO_MANY_HEROES");
    expect(result.candidates).toHaveLength(0);
  });

  test("cada asignación candidata es inyectiva -- ninguna posición repetida", () => {
    const heroes = [hero(1, {}), hero(2, {}), hero(3, {})];
    const result = computeJointRoleAssignment(heroes);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      const positions = [...candidate.assignment.values()];
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  test("las probabilidades de los candidatos suman 1", () => {
    const heroes = [hero(1, { confirmedPosition: 1 }), hero(2, {}), hero(3, {})];
    const result = computeJointRoleAssignment(heroes);
    const total = result.candidates.reduce((sum, c) => sum + c.probability, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  test("una posición confirmada excluye a los demás héroes de esa posición en TODO candidato", () => {
    const heroes = [hero(1, { confirmedPosition: 2 }), hero(2, {}), hero(3, {})];
    const result = computeJointRoleAssignment(heroes);
    for (const candidate of result.candidates) {
      expect(candidate.assignment.get(1)).toBe(2);
      expect(candidate.assignment.get(2)).not.toBe(2);
      expect(candidate.assignment.get(3)).not.toBe(2);
    }
    expect(result.heroPositionMarginals.get(1)![2]).toBeCloseTo(1, 9);
  });

  test("dos héroes confirmados a la MISMA posición (input contradictorio) no produce NaN ni lanza", () => {
    const heroes = [hero(1, { confirmedPosition: 3 }), hero(2, { confirmedPosition: 3 })];
    const result = computeJointRoleAssignment(heroes);
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const candidate of result.candidates) {
      expect(Number.isFinite(candidate.probability)).toBe(true);
    }
    const total = result.candidates.reduce((sum, c) => sum + c.probability, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  test("resuelve el caso 'un héroe flex cubre tres huecos a la vez' que rompe a los marginales independientes", () => {
    // Dos héroes, cada uno con una distribución histórica dominante (pero no exclusiva) sobre la
    // posición 3 -- pero solo hay UNA posición 3 real. Sus marginales INDEPENDIENTES ya suman más
    // de 1 en esa posición (imposible), exactamente el bug que S4.3 existe para resolver. La
    // asignación conjunta debe redistribuir esa masa: la cobertura de la posición 3 nunca puede
    // superar 1, y el heroPositionMarginals de cada héroe ahí debe ser estrictamente menor que su
    // probabilidad marginal independiente.
    const heroPositionsA: HeroPositions = { 10: [{ position: 3, matches: 800 }, { position: 2, matches: 200 }] };
    const heroPositionsB: HeroPositions = { 11: [{ position: 3, matches: 800 }, { position: 4, matches: 200 }] };
    const flexBeliefA = computeRoleBelief({ heroId: 10, heroPositions: heroPositionsA });
    const flexBeliefB = computeRoleBelief({ heroId: 11, heroPositions: heroPositionsB });
    const independentP3Sum = flexBeliefA.probabilities[3] + flexBeliefB.probabilities[3];
    expect(independentP3Sum).toBeGreaterThan(1); // el problema que S4.3 existe para resolver

    const result = computeJointRoleAssignment([
      { heroId: 10, belief: flexBeliefA },
      { heroId: 11, belief: flexBeliefB },
    ]);
    expect(result.positionCoverage[3]).toBeLessThanOrEqual(1 + 1e-9);
    expect(result.heroPositionMarginals.get(10)![3]).toBeLessThan(flexBeliefA.probabilities[3]);
    expect(result.heroPositionMarginals.get(11)![3]).toBeLessThan(flexBeliefB.probabilities[3]);
  });

  test("openPositions y expectedPositionNeed son coherentes con positionCoverage", () => {
    const heroes = [hero(1, { confirmedPosition: 1 }), hero(2, { confirmedPosition: 2 })];
    const result = computeJointRoleAssignment(heroes);
    expect(result.positionCoverage[1]).toBeCloseTo(1, 9);
    expect(result.positionCoverage[2]).toBeCloseTo(1, 9);
    expect(result.expectedPositionNeed[1]).toBeCloseTo(0, 9);
    expect([...result.openPositions].sort()).toEqual([3, 4, 5]);
    for (const position of [3, 4, 5] as const) {
      expect(result.expectedPositionNeed[position]).toBeCloseTo(1, 9);
    }
  });

  test("determinismo: mismo input (mismo orden) -> mismos candidatos en el mismo orden", () => {
    const heroes = [hero(1, { partyPreferredPositions: [2] }), hero(2, { partyPreferredPositions: [4] })];
    const a = computeJointRoleAssignment(heroes);
    const b = computeJointRoleAssignment(heroes);
    expect(a.candidates.map((c) => [...c.assignment.entries()])).toEqual(b.candidates.map((c) => [...c.assignment.entries()]));
    expect(a.candidates.map((c) => c.probability)).toEqual(b.candidates.map((c) => c.probability));
  });

  test("5 héroes produce hasta 5! = 120 candidatos", () => {
    const heroes = [1, 2, 3, 4, 5].map((id) => hero(id, {}));
    const result = computeJointRoleAssignment(heroes);
    expect(result.candidates).toHaveLength(120);
  });
});
