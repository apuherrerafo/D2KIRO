import { describe, expect, test } from "bun:test";
import type { HeroPositions } from "../signals/hero-positions";
import { buildCoachObservableState } from "./observable-state";
import { deriveRevealStrategy } from "./reveal-strategy";
import { translateToRecommendationOutputV3 } from "./recommendation-output-v3";
import { computeRoleImpact } from "../recommendation/role-impact";
import { hidden, known, recSet, revealed, roleOnlyHero, view } from "./test.fixtures";

const POSITIONS_DATASET: HeroPositions = {
  // Hero 101 and 102 are Pos2-only
  101: [{ position: 2, matches: 1000 }],
  102: [{ position: 2, matches: 1000 }],
  // Hero 103 is flex (Pos 4 / Pos 5)
  103: [
    { position: 4, matches: 500 },
    { position: 5, matches: 500 },
  ],
  // Hero 104 is Pos 5-only
  104: [{ position: 5, matches: 1000 }],
  // Hero 105 is Pos 1, 106 is Pos 3, 107 is Pos 5
  105: [{ position: 1, matches: 1000 }],
  106: [{ position: 3, matches: 1000 }],
  107: [{ position: 5, matches: 1000 }],
  // Candidate heroes
  1: [{ position: 1, matches: 2000 }], // Carry
  2: [{ position: 5, matches: 2000 }], // Hard support
};

describe("Role Collision Remediation (Generic & Soundness)", () => {
  test("two Pos2-only allies: Coach flags infeasible collision, names conflict, and offers recovery advice", () => {
    const collidingView = view("PICK_ROUND_2", [known(101), known(102)], [hidden(), hidden()]);
    const coachState = buildCoachObservableState(collidingView, { heroPositions: POSITIONS_DATASET });

    // 1. Observable state captures infeasibility and specific conflict
    expect(coachState.roleCollision.infeasible).toBe(true);
    expect(coachState.roleCollision.conflicts).toEqual([
      { position: 2, heroIds: [101, 102] },
    ]);

    // 2. Derive reveal strategy with candidate set
    const candidatesSet = recSet([
      roleOnlyHero(1, 1, 15), // Juggernaut (Carry, Pos 1)
      roleOnlyHero(2, 5, 12), // Support (Pos 5)
    ]);
    const strategy = deriveRevealStrategy(
      collidingView,
      candidatesSet,
      null,
      [],
      "response_pick",
      {
        ownRoleBeliefs: coachState.ownRoleBeliefs,
        heroPositions: POSITIONS_DATASET,
        roleCollision: coachState.roleCollision,
      },
    )!;

    // 3. Rationale explains the role collision and provides recovery advice without claiming an uncovered seat
    expect(strategy.rationale).toContain("Colisión de roles en tu equipo (conflicto en Midlane (Pos 2)): no existe asignación legal completa.");
    expect(strategy.rationale).toContain("Como recuperación");
    expect(strategy.rationale).not.toContain("es la posición que tu equipo aún no cubre");

    // 4. RecommendationOutputV3 surfaces collision and labels primary action as recovery
    const output = translateToRecommendationOutputV3(
      candidatesSet,
      strategy,
      coachState,
      "response_pick",
      { heroPositions: POSITIONS_DATASET },
    );

    expect(output.roleCollision?.infeasible).toBe(true);
    expect(output.primaryAction.label).toMatch(/^Recuperación \(colisión de roles\):/);
    expect(output.meta.confidence).toBe("baja");
  });

  test("feasible flex resolution: two allies (one flex 4/5, one dedicated 5) resolve without collision", () => {
    const flexView = view("PICK_ROUND_2", [known(103), known(104)], [hidden(), hidden()]);
    const coachState = buildCoachObservableState(flexView, { heroPositions: POSITIONS_DATASET });

    expect(coachState.roleCollision.infeasible).toBe(false);
    expect(coachState.roleCollision.conflicts).toHaveLength(0);

    const candidatesSet = recSet([
      roleOnlyHero(1, 1, 15),
      roleOnlyHero(106, 3, 12),
    ]);
    const strategy = deriveRevealStrategy(
      flexView,
      candidatesSet,
      null,
      [],
      "response_pick",
      {
        ownRoleBeliefs: coachState.ownRoleBeliefs,
        heroPositions: POSITIONS_DATASET,
        roleCollision: coachState.roleCollision,
      },
    )!;

    expect(strategy.rationale).not.toContain("Colisión de roles");

    const output = translateToRecommendationOutputV3(
      candidatesSet,
      strategy,
      coachState,
      "response_pick",
      { heroPositions: POSITIONS_DATASET },
    );

    expect(output.roleCollision?.infeasible).toBe(false);
    expect(output.primaryAction.label).toMatch(/^Sugerencia:/);
    expect(output.primaryAction.label).not.toContain("Recuperación");
  });

  test("normal legal draft unchanged: standard picks with distinct roles produce normal advice", () => {
    const normalView = view("PICK_ROUND_2", [known(105), known(106), known(107)], [revealed(70), revealed(71), hidden()]);
    const coachState = buildCoachObservableState(normalView, { heroPositions: POSITIONS_DATASET });

    expect(coachState.roleCollision.infeasible).toBe(false);
    expect(coachState.roleCollision.conflicts).toHaveLength(0);

    const candidatesSet = recSet([
      roleOnlyHero(101, 2, 18),
      roleOnlyHero(103, 4, 14),
    ]);
    const strategy = deriveRevealStrategy(
      normalView,
      candidatesSet,
      null,
      [],
      "response_pick",
      {
        ownRoleBeliefs: coachState.ownRoleBeliefs,
        heroPositions: POSITIONS_DATASET,
        roleCollision: coachState.roleCollision,
      },
    )!;

    const output = translateToRecommendationOutputV3(
      candidatesSet,
      strategy,
      coachState,
      "response_pick",
      { heroPositions: POSITIONS_DATASET },
    );

    expect(output.roleCollision?.infeasible).toBe(false);
    expect(output.primaryAction.label).toMatch(/^Sugerencia: revela/);
    expect(output.primaryAction.label).not.toContain("Recuperación");
    expect(output.meta.confidence).not.toBe("baja");
  });

  test("candidate role labels remain meaningful when TEAM seating is infeasible", () => {
    // When own team has two Pos 2 heroes (101 and 102), evaluating candidates must NOT collapse
    // candidates' roles to "UNRESOLVED" ("Rol por definir"). Candidate identities remain intact.
    const result = computeRoleImpact({
      ownPicks: [101, 102],
      candidates: [1, 2], // Hero 1 is Pos 1, Hero 2 is Pos 5
      heroPositions: POSITIONS_DATASET,
    });

    // Degradation is raised to flag the team-level collision
    expect(result.degradation?.reason).toBe("ROLE_ASSIGNMENT_IMPOSSIBLE");

    // Candidate 1 retains intrinsic Pos 1 role
    const impact1 = result.impactByHero.get(1);
    expect(impact1).toBeDefined();
    expect(impact1?.status).toBe("CONFIRMED_FORCED");
    expect(impact1?.position).toBe(1);

    // Candidate 2 retains intrinsic Pos 5 role
    const impact2 = result.impactByHero.get(2);
    expect(impact2).toBeDefined();
    expect(impact2?.status).toBe("CONFIRMED_FORCED");
    expect(impact2?.position).toBe(5);

    // Neither collapsed to UNRESOLVED (which would render as "Rol por definir")
    expect(impact1?.status).not.toBe("UNRESOLVED");
    expect(impact2?.status).not.toBe("UNRESOLVED");
  });

  test("no hidden enemy information enters the collision diagnosis", () => {
    // Twin draft views: identical own picks (101 and 102), but enemy slots have different hidden states
    const twinA = view("PICK_ROUND_2", [known(101), known(102)], [hidden(), hidden()], [10], "radiant");
    const twinB = view("PICK_ROUND_2", [known(101), known(102)], [hidden(), hidden()], [10], "radiant");

    // Even if enemy has different revealed heroes in a later state:
    const enemyRevealedMid = view("PICK_ROUND_2", [known(101), known(102)], [revealed(101), hidden()]);
    const enemyRevealedCarry = view("PICK_ROUND_2", [known(101), known(102)], [revealed(105), hidden()]);

    const stateA = buildCoachObservableState(twinA, { heroPositions: POSITIONS_DATASET });
    const stateB = buildCoachObservableState(twinB, { heroPositions: POSITIONS_DATASET });
    const stateEnemyMid = buildCoachObservableState(enemyRevealedMid, { heroPositions: POSITIONS_DATASET });
    const stateEnemyCarry = buildCoachObservableState(enemyRevealedCarry, { heroPositions: POSITIONS_DATASET });

    // Own team collision diagnosis is 100% invariant to enemy draft state or reveals
    expect(stateA.roleCollision).toEqual(stateB.roleCollision);
    expect(stateA.roleCollision).toEqual(stateEnemyMid.roleCollision);
    expect(stateA.roleCollision).toEqual(stateEnemyCarry.roleCollision);
  });

  test("explicit reproduction of S07: infeasible collision, conflicts detected, recovery framing, baja confidence, candidate role preserved", () => {
    // S07: 4 support-only allies (Jakiro, Oracle, Pugna, Dark Willow) competing for Pos 4 and Pos 5
    const s07Positions: HeroPositions = {
      64: [{ position: 4, matches: 303 }, { position: 5, matches: 1304 }],
      111: [{ position: 4, matches: 233 }, { position: 5, matches: 1946 }],
      45: [{ position: 4, matches: 330 }, { position: 5, matches: 429 }],
      119: [{ position: 4, matches: 3111 }, { position: 5, matches: 1100 }],
      // Candidate hero: Juggernaut (Carry, Pos 1)
      8: [{ position: 1, matches: 2000 }],
    };

    const s07View = view("PICK_ROUND_3", [known(64), known(111), known(45), known(119)], [revealed(5), revealed(81), revealed(86), revealed(97), hidden()]);
    const coachState = buildCoachObservableState(s07View, { heroPositions: s07Positions });

    // 1. roleCollision.infeasible = true
    expect(coachState.roleCollision.infeasible).toBe(true);

    // 2. conflict remains detected (Hall condition on {4, 5})
    expect(coachState.roleCollision.conflicts.length).toBeGreaterThan(0);
    const conflictPositions = coachState.roleCollision.conflicts.map((c) => c.position);
    expect(conflictPositions).toContain(4);
    expect(conflictPositions).toContain(5);

    // 3. primary action still uses recovery framing
    const candidatesSet = recSet([roleOnlyHero(8, 1, 15)]);
    const strategy = deriveRevealStrategy(
      s07View,
      candidatesSet,
      null,
      [],
      "closing_pick",
      {
        ownRoleBeliefs: coachState.ownRoleBeliefs,
        heroPositions: s07Positions,
        roleCollision: coachState.roleCollision,
      },
    )!;
    expect(strategy.rationale).toContain("Colisión de roles en tu equipo");
    expect(strategy.rationale).toContain("Como recuperación");

    const output = translateToRecommendationOutputV3(
      candidatesSet,
      strategy,
      coachState,
      "closing_pick",
      { heroPositions: s07Positions },
    );

    expect(output.roleCollision?.infeasible).toBe(true);
    expect(output.primaryAction.label).toMatch(/^Recuperación \(colisión de roles\):/);

    // 4. confidence = baja
    expect(output.meta.confidence).toBe("baja");

    // 5. candidate role labels remain meaningful
    const juggernautCard = output.shortlist.find((c) => c.heroId === 8);
    expect(juggernautCard).toBeDefined();
    expect(juggernautCard?.position).toBe(1);
    expect(["LIKELY", "CONFIRMED_FORCED"]).toContain(juggernautCard?.roleStatus ?? "");
    expect(juggernautCard?.roleStatus).not.toBe("UNRESOLVED");
  });
});
