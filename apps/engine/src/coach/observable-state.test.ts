import { describe, expect, test } from "bun:test";
import { buildCoachObservableState } from "./observable-state";
import { hidden, known, revealed, view } from "./test.fixtures";

// AP Ranked Roles V1 / Wave 2 (task 14) -- CoachObservableState comes only from a PerspectiveDraftView.

const HERO_POSITIONS = {
  70: [{ position: 2 as const, matches: 900 }, { position: 3 as const, matches: 100 }],
  50: [{ position: 1 as const, matches: 500 }],
};

describe("buildCoachObservableState", () => {
  test("confirmedBans es exactamente view.bannedHeroes (una copia, no el mismo arreglo)", () => {
    const v = view("PICK_ROUND_1", [], [hidden(), hidden()], [11, 12, 13]);
    const state = buildCoachObservableState(v);
    expect(state.confirmedBans).toEqual(v.bannedHeroes);
    expect(state.confirmedBans).not.toBe(v.bannedHeroes);
  });

  test("enemyRoleBeliefs contiene sólo los héroes rivales REVEALED; un slot HIDDEN no aporta nada", () => {
    const v = view("PICK_ROUND_2", [known(50), known(51)], [revealed(70), revealed(71), hidden(), hidden()]);
    const state = buildCoachObservableState(v, { heroPositions: HERO_POSITIONS });
    expect([...state.enemyRoleBeliefs.keys()].sort()).toEqual([70, 71]);
    expect(state.enemyRoleBeliefs.size).toBe(2);
  });

  test("ownRoleBeliefs cubre los picks propios (KNOWN) aunque la ronda aún no se haya revelado", () => {
    const v = view("PICK_ROUND_1", [known(50)], [hidden(), hidden()]);
    const state = buildCoachObservableState(v, { heroPositions: HERO_POSITIONS });
    expect([...state.ownRoleBeliefs.keys()]).toEqual([50]);
    expect(state.enemyRoleBeliefs.size).toBe(0);
  });

  test("una asignación explícita del Player pisa la inferencia: la creencia pasa a CONFIRMED", () => {
    const v = view("PICK_ROUND_2", [known(50), known(51)], [revealed(70), revealed(71), hidden(), hidden()]);
    const state = buildCoachObservableState(v, { heroPositions: HERO_POSITIONS, playerPositionAssignments: new Map([[70, 3 as const]]) });
    const belief = state.enemyRoleBeliefs.get(70)!;
    expect(belief.status).toBe("CONFIRMED");
    expect(belief.probabilities[3]).toBe(1);
    expect(state.enemyRoleBeliefs.get(71)!.status).not.toBe("CONFIRMED");
  });

  test("una asignación para un héroe que NO es legalmente visible se descarta (no sirve para sondear un pick oculto)", () => {
    const v = view("PICK_ROUND_1", [known(50)], [hidden(), hidden()]);
    const state = buildCoachObservableState(v, { playerPositionAssignments: new Map([[99, 5 as const]]) });
    expect(state.playerPositionAssignments.size).toBe(0);
    expect(state.enemyRoleBeliefs.has(99)).toBe(false);
  });

  test("es pura: mismas entradas -> mismo estado; la vista no se muta", () => {
    const v = view("PICK_ROUND_2", [known(50)], [revealed(70), hidden()], [1]);
    const before = JSON.stringify(v);
    const a = buildCoachObservableState(v, { heroPositions: HERO_POSITIONS });
    const b = buildCoachObservableState(v, { heroPositions: HERO_POSITIONS });
    expect(JSON.stringify([...a.enemyRoleBeliefs])).toBe(JSON.stringify([...b.enemyRoleBeliefs]));
    expect(JSON.stringify(v)).toBe(before);
  });

  test("Wave 2 no llena personalContext (posición personal y pool son de Wave 3)", () => {
    expect(buildCoachObservableState(view("PICK_ROUND_1", [], [hidden(), hidden()])).personalContext).toBeNull();
  });
});
