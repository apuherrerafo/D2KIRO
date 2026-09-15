import { describe, expect, test } from "bun:test";
import { createProtocolState, project, type DraftProtocolState } from "../draft-protocol";
import type { PartyContext } from "../draft-protocol/types";
import { buildBasedOn, type BasedOnInput } from "./identity";

function apState(sessionId: string): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  return created.state;
}

// Baseline shared by every test below -- patch/partyContext/evidenceHash are the 3 fields this
// module gained (blockers 6/7). Individual tests override only what they're testing.
const BASE: Omit<BasedOnInput, "view"> = {
  eligibilitySnapshot: null,
  calibrationMode: "fallback",
  seed: null,
  patch: "7.41e",
  partyContext: null,
  evidenceHash: null,
};

describe("buildBasedOn -- R1 S5 identity", () => {
  test("dos sesiones distintas en el mismo estado estructural producen el mismo stateIdentity (hidden twins)", () => {
    const viewA = project(apState("session-a"), "radiant");
    const viewB = project(apState("session-b"), "radiant");
    const basedOnA = buildBasedOn({ ...BASE, view: viewA });
    const basedOnB = buildBasedOn({ ...BASE, view: viewB });
    expect(basedOnA.stateIdentity).toBe(basedOnB.stateIdentity);
  });

  test("basedOn cambia cuando la calibración declarada cambia (metadata irrelevante NO debe moverlo, pero esto SÍ es relevante)", () => {
    const view = project(apState("session-c"), "radiant");
    const fallback = buildBasedOn({ ...BASE, view, calibrationMode: "fallback" });
    const empirical = buildBasedOn({ ...BASE, view, calibrationMode: "empirical" });
    expect(fallback.evidenceVersion).not.toBe(empirical.evidenceVersion);
  });

  test("seed nulo vs seed explícito no altera rulesHash/stateIdentity, sólo el campo seed", () => {
    const view = project(apState("session-d"), "radiant");
    const noSeed = buildBasedOn({ ...BASE, view, seed: null });
    const withSeed = buildBasedOn({ ...BASE, view, seed: "abc" });
    expect(noSeed.stateIdentity).toBe(withSeed.stateIdentity);
    expect(noSeed.rulesHash).toBe(withSeed.rulesHash);
    expect(noSeed.seed).toBeNull();
    expect(withSeed.seed).toBe("abc");
  });

  test("heroEligibilityHash es null para Ranked All Pick (sin mecanismo de elegibilidad)", () => {
    const view = project(apState("session-e"), "radiant");
    const basedOn = buildBasedOn({ ...BASE, view });
    expect(basedOn.heroEligibilityHash).toBeNull();
  });

  test("perspectiveIdentity distingue radiant de dire aunque el estado estructural sea idéntico", () => {
    const state = apState("session-f");
    const radiantView = project(state, "radiant");
    const direView = project(state, "dire");
    const radiant = buildBasedOn({ ...BASE, view: radiantView });
    const dire = buildBasedOn({ ...BASE, view: direView });
    expect(radiant.perspectiveIdentity).not.toBe(dire.perspectiveIdentity);
  });

  // Blocker 6 -- functional identity must cover patch and party/control structure, neither of
  // which PerspectiveDraftView carries at all (so stateIdentity alone can never detect them).
  test("basedOn.patch cambia con el patch aunque el arreglo de héroes sea idéntico", () => {
    const view = project(apState("session-patch"), "radiant");
    const before = buildBasedOn({ ...BASE, view, patch: "7.40" });
    const after = buildBasedOn({ ...BASE, view, patch: "7.41e" });
    expect(before.patch).not.toBe(after.patch);
    expect(before.stateIdentity).toBe(after.stateIdentity); // the state itself didn't move
  });

  test("basedOn.partyIdentity cambia cuando la estructura de control del party cambia (mismo estado)", () => {
    const view = project(apState("session-party"), "radiant");
    const soloControl: PartyContext = {
      partySize: 5,
      side: "radiant",
      controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant" as const, slotIndex, controllerId: `p${slotIndex}` })),
    };
    const partialControl: PartyContext = {
      partySize: 5,
      side: "radiant",
      controlledSlots: [{ side: "radiant" as const, slotIndex: 0, controllerId: "p0" }],
    };
    const full = buildBasedOn({ ...BASE, view, partyContext: soloControl });
    const partial = buildBasedOn({ ...BASE, view, partyContext: partialControl });
    const noParty = buildBasedOn({ ...BASE, view, partyContext: null });
    expect(full.partyIdentity).not.toBe(partial.partyIdentity);
    expect(full.partyIdentity).not.toBeNull();
    expect(noParty.partyIdentity).toBeNull();
  });

  test("basedOn.partyIdentity ignora controllerId (metadata de display, no funcional) -- sólo el conjunto de slots controlados importa", () => {
    const view = project(apState("session-party-controller"), "radiant");
    const a = buildBasedOn({
      ...BASE,
      view,
      partyContext: { partySize: 5, side: "radiant", controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "alice" }] },
    });
    const b = buildBasedOn({
      ...BASE,
      view,
      partyContext: { partySize: 5, side: "radiant", controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "bob" }] },
    });
    expect(a.partyIdentity).toBe(b.partyIdentity);
  });

  // Blocker 7 -- evidenceVersion must fold in the actual evidence hash, and must ignore it being
  // absent (no evidence computed) vs. present but different.
  test("basedOn.evidenceVersion cambia cuando el hash de evidencia cambia; se mantiene igual cuando es idéntico", () => {
    const view = project(apState("session-evidence"), "radiant");
    const none = buildBasedOn({ ...BASE, view, evidenceHash: null });
    const hashA = buildBasedOn({ ...BASE, view, evidenceHash: "hash-a" });
    const hashARepeat = buildBasedOn({ ...BASE, view, evidenceHash: "hash-a" });
    const hashB = buildBasedOn({ ...BASE, view, evidenceHash: "hash-b" });
    expect(none.evidenceVersion).not.toBe(hashA.evidenceVersion);
    expect(hashA.evidenceVersion).toBe(hashARepeat.evidenceVersion);
    expect(hashA.evidenceVersion).not.toBe(hashB.evidenceVersion);
  });
});
