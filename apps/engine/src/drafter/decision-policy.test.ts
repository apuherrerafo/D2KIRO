import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { deriveDecisionPolicy } from "./decision-context";

function allPickState(own: number[], enemy: number[]) {
  return {
    ...createIdleDraftState("decision-policy"),
    phase: "active" as const,
    format: "all_pick" as const,
    localSide: "radiant" as const,
    picks: { radiant: own, dire: enemy },
  };
}

test("Pick 2 ciego usa solo el primer pick propio y no habilita evidencia de contrapick", () => {
  const policy = deriveDecisionPolicy(allPickState([1], []), false);

  expect(policy.context).toBe("blind_second_pick");
  expect(policy.ownPickCount).toBe(1);
  expect(policy.visibleEnemyCount).toBe(0);
  expect(policy.usesRevealedCounterEvidence).toBe(false);
  expect(policy.headline).toContain("Pick 2 ciego");
});

test("Picks 3 y 4 usan exactamente los dos rivales revelados para contrapick y composición", () => {
  const policy = deriveDecisionPolicy(allPickState([1, 2], [11, 12]), false);

  expect(policy.context).toBe("response_pick");
  expect(policy.ownPickCount).toBe(2);
  expect(policy.visibleEnemyCount).toBe(2);
  expect(policy.usesRevealedCounterEvidence).toBe(true);
  expect(policy.headline).toContain("Pick 3/4");
});

test("dos rivales revelados no adelantan la política de respuesta antes de dos picks propios", () => {
  const policy = deriveDecisionPolicy(allPickState([1], [11, 12]), false);

  expect(policy.context).toBe("blind_second_pick");
  expect(policy.usesRevealedCounterEvidence).toBe(false);
});

test("el cierre exige cuatro picks por lado y declara la composición como prioridad", () => {
  const policy = deriveDecisionPolicy(allPickState([1, 2, 3, 4], [11, 12, 13, 14]), false);

  expect(policy.context).toBe("closing_pick");
  expect(policy.ownPickCount).toBe(4);
  expect(policy.visibleEnemyCount).toBe(4);
  expect(policy.closesComposition).toBe(true);
  expect(policy.headline).toContain("Cierre");
});
