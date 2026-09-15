import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash, type CmHeroEligibilitySnapshot } from "../draft-protocol";
import { ProtocolSessionStore } from "./protocol-session";

describe("ProtocolSessionStore -- S2.1/S2.5/S3 session layer", () => {
  test("create + get -- estado inicial ACTIVE para Ranked All Pick", () => {
    const store = new ProtocolSessionStore();
    const created = store.create({ sessionId: "s1", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    expect(created.ok).toBe(true);
    expect(store.get("s1")?.status).toBe("ACTIVE");
    expect(store.metadata("s1")?.patch).toBe("7.41e");
  });

  test("sesión inexistente -> get/view/legalActions/apply devuelven null, nunca lanzan", () => {
    const store = new ProtocolSessionStore();
    expect(store.get("ghost")).toBeNull();
    expect(store.view("ghost")).toBeNull();
    expect(store.legalActions("ghost")).toBeNull();
    expect(store.apply("ghost", { type: "BAN_RESOLUTION_COMPLETE" })).toBeNull();
  });

  test("crear dos veces el mismo sessionId se rechaza", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "dup", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const second = store.create({ sessionId: "dup", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("SESSION_ALREADY_EXISTS");
  });

  test("party size 4 se rechaza en la creación (delegando a createPartyContext de S1)", () => {
    const store = new ProtocolSessionStore();
    const result = store.create({
      sessionId: "party4",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      partyContext: { partySize: 4, side: "radiant", controlledSlots: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_PARTY_CONTEXT");
  });

  test("Captain's Mode exige partySize 5 -- 2/3 se rechazan, 5 se acepta", () => {
    const store = new ProtocolSessionStore();
    const rejected = store.create({
      sessionId: "cm-party3",
      rulesetId: "dota2/captains-mode",
      patch: "7.40",
      partyContext: { partySize: 3, side: "radiant", controlledSlots: [] },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("CM_REQUIRES_PARTY_SIZE_5");

    const accepted = store.create({
      sessionId: "cm-party5",
      rulesetId: "dota2/captains-mode",
      patch: "7.40",
      partyContext: {
        partySize: 5,
        side: "radiant",
        controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant" as const, slotIndex, controllerId: `p${slotIndex}` })),
      },
    });
    expect(accepted.ok).toBe(true);
    expect(store.partyContext("cm-party5")?.partySize).toBe(5);
  });

  test("Captain's Mode sin partyContext se rechaza", () => {
    const store = new ProtocolSessionStore();
    const result = store.create({ sessionId: "cm-no-party", rulesetId: "dota2/captains-mode", patch: "7.40" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("CM_REQUIRES_PARTY_SIZE_5");
    expect(store.partyContext("cm-no-party")).toBeNull();
  });

  test("apply actualiza el estado de la sesión y view() proyecta desde el estado nuevo", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "flow", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const result = store.apply("flow", { type: "BAN_RESOLUTION_COMPLETE" });
    expect(result?.rejected).toBeUndefined();
    expect(store.get("flow")?.rankedAp?.phase).toBe("PICK_ROUND_1");

    store.apply("flow", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 55 });
    const radiantView = store.view("flow");
    expect(radiantView?.ownPicks[0]).toEqual({ visibility: "KNOWN", heroId: 55 });
  });

  test("un comando rechazado no rompe la sesión -- el estado sigue siendo el anterior", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "reject", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const before = store.get("reject");
    const result = store.apply("reject", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    expect(result?.rejected).toBe("WRONG_PHASE"); // still BAN_RESOLUTION
    expect(store.get("reject")).toBe(before);
  });

  test("legalActions refleja el estado actual de la sesión", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "legal", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const banPhaseActions = store.legalActions("legal");
    expect(banPhaseActions).toEqual([{ type: "RECORD_RESOLVED_BANS" }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    store.apply("legal", { type: "BAN_RESOLUTION_COMPLETE" });
    const pickPhaseActions = store.legalActions("legal");
    expect(pickPhaseActions?.length).toBeGreaterThan(0);
  });

  test("evictStale elimina sesiones inactivas más allá del TTL, respeta las recientes", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "old", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" }, 0);
    store.create({ sessionId: "fresh", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" }, 1_000_000);
    store.evictStale(2_000_000, 1_500_000);
    expect(store.get("old")).toBeNull();
    expect(store.get("fresh")).not.toBeNull();
  });
});

// R1 S3 (final trust-boundary repair) -- loadTrustedEligibility es la ÚNICA puerta de entrada de
// un snapshot de elegibilidad, y estar del lado servidor no exime de ninguna validación.
describe("ProtocolSessionStore.loadTrustedEligibility -- puerta server-only", () => {
  type Base = Omit<CmHeroEligibilitySnapshot, "contentHash">;

  function officialBase(overrides: Partial<Base> = {}): Base {
    return {
      schema: "cm-hero-eligibility/v1",
      appId: 570,
      patch: "7.41e",
      buildId: "build-123",
      depotManifests: { "570": "manifest-123" },
      sourceHashes: { npc_heroes: "sha256:abc" },
      provenance: {
        kind: "OFFICIAL_DEPOT",
        appId: 570,
        buildId: "build-123",
        depotId: "381451",
        manifestId: "manifest-123",
        sourcePath: "scripts/npc/npc_heroes.txt",
        sourceHash: "sha256:abc",
      },
      heroIds: [1, 2, 3],
      ...overrides,
    };
  }

  function sealed(base: Base): CmHeroEligibilitySnapshot {
    return { ...base, contentHash: computeEligibilityContentHash(base) };
  }

  const FULL_PARTY = {
    partySize: 5 as const,
    side: "radiant" as const,
    controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant" as const, slotIndex, controllerId: `p${slotIndex}` })),
  };

  function cmStore(sessionId = "cm-trusted"): ProtocolSessionStore {
    const store = new ProtocolSessionStore();
    const created = store.create({ sessionId, rulesetId: "dota2/captains-mode", patch: "7.41e", partyContext: FULL_PARTY });
    expect(created.ok).toBe(true);
    return store;
  }

  test("artefacto oficial válido -> certifica y el estado queda con el snapshot", () => {
    const store = cmStore();
    const result = store.loadTrustedEligibility("cm-trusted", sealed(officialBase()));
    expect(result.ok).toBe(true);
    expect(store.get("cm-trusted")!.captainsMode!.eligibilitySnapshot!.heroIds).toEqual([1, 2, 3]);
  });

  test.each([
    ["sourceHash mismatch", sealed(officialBase({ provenance: { ...officialBase().provenance, sourceHash: "sha256:otro" } as Base["provenance"] }))],
    ["manifest mismatch", sealed(officialBase({ provenance: { ...officialBase().provenance, manifestId: "otro" } as Base["provenance"] }))],
    ["DEMO_FIXTURE", sealed(officialBase({ provenance: { kind: "DEMO_FIXTURE", label: "demo" } }))],
    ["SYNTHETIC_TEST", sealed(officialBase({ provenance: { kind: "SYNTHETIC_TEST", label: "test" } }))],
  ])("%s -> ELIGIBILITY_UNVERIFIED, el estado no cambia", (_label, artifact) => {
    const store = cmStore();
    const result = store.loadTrustedEligibility("cm-trusted", artifact);
    expect(result).toEqual({ ok: false, reason: "ELIGIBILITY_UNVERIFIED" });
    expect(store.get("cm-trusted")!.captainsMode!.eligibilitySnapshot).toBeNull();
  });

  test("patch incompatible -> lo rechaza el kernel, no el parser, y no certifica nada", () => {
    const store = cmStore();
    // Estructuralmente impecable: el problema es que 7.39 queda fuera del rango verificado de CM.
    const result = store.loadTrustedEligibility("cm-trusted", sealed(officialBase({ patch: "7.39" })));
    expect(result.ok).toBe(false);
    expect(store.get("cm-trusted")!.captainsMode!.eligibilitySnapshot).toBeNull();
  });

  test("sesión inexistente -> SESSION_NOT_FOUND, nunca lanza", () => {
    const store = new ProtocolSessionStore();
    expect(store.loadTrustedEligibility("ghost", sealed(officialBase()))).toEqual({ ok: false, reason: "SESSION_NOT_FOUND" });
  });

  test("el mismo snapshot por isCommandAuthorized queda prohibido -- la puerta pública no es equivalente", () => {
    const store = cmStore();
    expect(store.isCommandAuthorized("cm-trusted", { type: "LOAD_CM_ELIGIBILITY", snapshot: sealed(officialBase()) })).toBe(false);
    // ...y tampoco se anuncia como acción disponible en la superficie autorizada.
    expect((store.authorizedLegalActions("cm-trusted") ?? []).some((action) => action.type === "LOAD_CM_ELIGIBILITY")).toBe(false);
  });
});
