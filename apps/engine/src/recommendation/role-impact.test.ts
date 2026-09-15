import { describe, expect, test } from "bun:test";
import type { HeroPositions } from "../signals/hero-positions";
import { computeRoleImpact } from "./role-impact";

// Fixture heroes: 1 = pure carry (pos 1), 2 = pure hard support (pos 5), 3 = flexible support
// (pos 4/5 evenly), 4 = pure mid (pos 2). Never the real hero-positions.json (S9/S10 discipline).
const HERO_POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 5, matches: 1000 }],
  3: [
    { position: 4, matches: 500 },
    { position: 5, matches: 500 },
  ],
  4: [{ position: 2, matches: 1000 }],
  // 5 = leans carry but not exclusively -- a genuine LIKELY case (marginal < 1 at the top position).
  5: [
    { position: 1, matches: 700 },
    { position: 2, matches: 300 },
  ],
};

describe("computeRoleImpact -- reads S4's joint-assignment, never reinfers", () => {
  test("héroe sin evidencia (posición uniforme) -> UNRESOLVED, nunca una posición inventada", () => {
    const result = computeRoleImpact({ ownPicks: [], candidates: [999], heroPositions: HERO_POSITIONS });
    const impact = result.impactByHero.get(999)!;
    expect(impact.status).toBe("UNRESOLVED");
    expect(impact.position).toBeNull();
  });

  test("héroe con distribución inclinada (no exclusiva) hacia una posición -> LIKELY con esa posición", () => {
    const result = computeRoleImpact({ ownPicks: [], candidates: [5], heroPositions: HERO_POSITIONS });
    const impact = result.impactByHero.get(5)!;
    expect(impact.status).toBe("LIKELY");
    expect(impact.position).toBe(1);
  });

  test("héroe con distribución exclusiva a una sola posición (solo) -> CONFIRMED_FORCED por los propios datos, sin confirmación explícita", () => {
    const result = computeRoleImpact({ ownPicks: [], candidates: [1], heroPositions: HERO_POSITIONS });
    const impact = result.impactByHero.get(1)!;
    expect(impact.status).toBe("CONFIRMED_FORCED");
    expect(impact.position).toBe(1);
  });

  test("posición matemáticamente forzada por eliminación (4 de 5 ya certeros) -> CONFIRMED_FORCED sin confirmación explícita", () => {
    // 4 héroes ya propios, cada uno con una posición fuerte y distinta (1, 5, 2, y un cuarto pos 3
    // fuerte) -- el 5to candidato queda forzado a la única posición libre (4) por la enumeración
    // inyectiva, sin que nadie haya "confirmado" nada.
    const positions: HeroPositions = {
      ...HERO_POSITIONS,
      10: [{ position: 3, matches: 1000 }],
    };
    const result = computeRoleImpact({ ownPicks: [1, 2, 4, 10], candidates: [3], heroPositions: positions });
    const impact = result.impactByHero.get(3)!;
    expect(impact.status).toBe("CONFIRMED_FORCED");
    expect(impact.position).toBe(4);
  });

  test("preferencia de party influye pero no fuerza -- un héroe flexible se inclina hacia la preferencia sin llegar a 1.0", () => {
    const withoutPreference = computeRoleImpact({ ownPicks: [], candidates: [3], heroPositions: HERO_POSITIONS });
    const withPreference = computeRoleImpact({
      ownPicks: [],
      candidates: [3],
      heroPositions: HERO_POSITIONS,
      partyPreferredPositions: [5],
    });
    const before = withoutPreference.impactByHero.get(3)!.marginals[5];
    const after = withPreference.impactByHero.get(3)!.marginals[5];
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(1);
  });

  test("asignación imposible (dos héroes propios confirmados a la misma posición) degrada explícitamente, sin reparo silencioso", () => {
    const result = computeRoleImpact({
      ownPicks: [1, 4],
      candidates: [2],
      heroPositions: HERO_POSITIONS,
      ownConfirmedPositions: new Map([
        [1, 1],
        [4, 1], // contradictorio: hero 4 también confirmado a posición 1, igual que hero 1
      ]),
    });
    expect(result.degradation?.reason).toBe("ROLE_ASSIGNMENT_IMPOSSIBLE");
    expect(result.impactByHero.get(2)?.status).toBe("UNRESOLVED");
  });

  test("más de 5 héroes propios simultáneos degrada explícitamente en vez de lanzar", () => {
    const result = computeRoleImpact({ ownPicks: [1, 2, 3, 4, 10], candidates: [11], heroPositions: HERO_POSITIONS });
    expect(result.degradation?.reason).toBe("ROLE_ASSIGNMENT_IMPOSSIBLE");
    expect(result.impactByHero.get(11)?.status).toBe("UNRESOLVED");
  });

  test("evidenceByHero expone el RoleBeliefEvidence crudo detrás de cada candidato -- trazabilidad, no una caja negra", () => {
    const result = computeRoleImpact({ ownPicks: [], candidates: [1], heroPositions: HERO_POSITIONS });
    const evidence = result.evidenceByHero.get(1)!;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.kind).toBe("HERO_PATCH_DISTRIBUTION");
  });
});
