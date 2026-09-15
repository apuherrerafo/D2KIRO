import { describe, expect, test } from "bun:test";
import { createProtocolState, project, type DraftProtocolState } from "../draft-protocol";
import { buildBasedOn } from "./identity";

function apState(sessionId: string): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  return created.state;
}

describe("buildBasedOn -- R1 S5 identity", () => {
  test("dos sesiones distintas en el mismo estado estructural producen el mismo stateIdentity (hidden twins)", () => {
    const viewA = project(apState("session-a"), "radiant");
    const viewB = project(apState("session-b"), "radiant");
    const basedOnA = buildBasedOn({ view: viewA, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    const basedOnB = buildBasedOn({ view: viewB, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    expect(basedOnA.stateIdentity).toBe(basedOnB.stateIdentity);
  });

  test("basedOn cambia cuando la calibración declarada cambia (metadata irrelevante NO debe moverlo, pero esto SÍ es relevante)", () => {
    const view = project(apState("session-c"), "radiant");
    const fallback = buildBasedOn({ view, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    const empirical = buildBasedOn({ view, eligibilitySnapshot: null, calibrationMode: "empirical", seed: null });
    expect(fallback.evidenceVersion).not.toBe(empirical.evidenceVersion);
  });

  test("seed nulo vs seed explícito no altera rulesHash/stateIdentity, sólo el campo seed", () => {
    const view = project(apState("session-d"), "radiant");
    const noSeed = buildBasedOn({ view, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    const withSeed = buildBasedOn({ view, eligibilitySnapshot: null, calibrationMode: "fallback", seed: "abc" });
    expect(noSeed.stateIdentity).toBe(withSeed.stateIdentity);
    expect(noSeed.rulesHash).toBe(withSeed.rulesHash);
    expect(noSeed.seed).toBeNull();
    expect(withSeed.seed).toBe("abc");
  });

  test("heroEligibilityHash es null para Ranked All Pick (sin mecanismo de elegibilidad)", () => {
    const view = project(apState("session-e"), "radiant");
    const basedOn = buildBasedOn({ view, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    expect(basedOn.heroEligibilityHash).toBeNull();
  });

  test("perspectiveIdentity distingue radiant de dire aunque el estado estructural sea idéntico", () => {
    const state = apState("session-f");
    const radiantView = project(state, "radiant");
    const direView = project(state, "dire");
    const radiant = buildBasedOn({ view: radiantView, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    const dire = buildBasedOn({ view: direView, eligibilitySnapshot: null, calibrationMode: "fallback", seed: null });
    expect(radiant.perspectiveIdentity).not.toBe(dire.perspectiveIdentity);
  });
});
