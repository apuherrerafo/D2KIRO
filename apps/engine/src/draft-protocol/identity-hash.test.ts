import { describe, expect, test } from "bun:test";
import { authoritativeStateHash, eligibilityHash, perspectiveStateHash, rulesHash } from "./identity-hash";
import { computeEligibilityContentHash } from "./eligibility";
import { createProtocolState } from "./kernel";
import { project } from "./perspective";

describe("identity-hash — Blocker 5: named, purpose-specific hash APIs", () => {
  test("authoritativeStateHash es determinista sobre el mismo estado canónico", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    expect(authoritativeStateHash(created.state)).toBe(authoritativeStateHash(created.state));
  });

  test("perspectiveStateHash es determinista sobre la misma vista", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const view = project(created.state, "radiant");
    expect(perspectiveStateHash(view)).toBe(perspectiveStateHash(view));
  });

  test("authoritativeStateHash y perspectiveStateHash difieren para el mismo contenido lógico (namespaces distintos)", () => {
    const created = createProtocolState("s1", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const view = project(created.state, "radiant");
    // No es la misma función ni el mismo dominio de entrada -- no deben producir el mismo hash
    // por accidente de construcción para valores que casualmente coinciden en forma.
    expect(authoritativeStateHash(created.state)).not.toBe(perspectiveStateHash(view as never));
  });

  test("rulesHash sobre el mismo manifiesto lógico es estable frente al orden de claves", () => {
    const a = rulesHash({ id: "dota2/ranked-all-pick", capacities: [2, 2, 1] });
    const b = rulesHash({ capacities: [2, 2, 1], id: "dota2/ranked-all-pick" });
    expect(a).toBe(b);
  });

  test("eligibilityHash reproduce exactamente computeEligibilityContentHash", () => {
    const base = {
      schema: "cm-hero-eligibility/v1" as const,
      appId: 570 as const,
      patch: "7.41e",
      buildId: "b",
      depotManifests: { "570": "1" },
      sourceHashes: { npc_heroes: "abc" },
      provenance: { kind: "SYNTHETIC_TEST" as const, label: "identity hash fixture" },
      heroIds: [1, 2, 3],
    };
    expect(eligibilityHash(base)).toBe(computeEligibilityContentHash(base));
  });
});
