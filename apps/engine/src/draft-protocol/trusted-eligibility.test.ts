import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash } from "./eligibility";
import {
  isTrustedServerOnlyCommand,
  loadTrustedEligibilityArtifact,
  parseTrustedEligibilityArtifact,
} from "./trusted-eligibility";
import type { CmHeroEligibilitySnapshot } from "./types";

// R1 S3 (final trust-boundary repair). Fixtures inline, nunca el artefacto real de disco: ese
// archivo lo pone un operador y se regenera por parche -- un test atado a su contenido no fallaría
// al romperse el código, fallaría al actualizarse el juego (mismo criterio literal que S9/S10/S18).

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
    heroIds: [1, 2, 3, 5, 8],
    ...overrides,
  };
}

/** Sella el snapshot con su propio hash canónico -- lo que cualquiera puede hacer sobre cualquier contenido. */
function sealed(base: Base): CmHeroEligibilitySnapshot {
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

describe("trusted-eligibility -- artefacto del lado servidor", () => {
  test("artefacto OFFICIAL_DEPOT válido se acepta y conserva sus heroIds", () => {
    const snapshot = parseTrustedEligibilityArtifact(sealed(officialBase()));
    expect(snapshot).not.toBeNull();
    expect(snapshot!.heroIds).toEqual([1, 2, 3, 5, 8]);
    expect(snapshot!.provenance.kind).toBe("OFFICIAL_DEPOT");
  });

  // Cada caso está sellado con un contentHash correcto a propósito: lo que se prueba es que la
  // consistencia interna NO alcanza, no que un hash roto se detecte (eso ya lo cubre eligibility).
  test.each([
    [
      "sourceHash de la provenance no coincide con sourceHashes",
      sealed(officialBase({
        provenance: { ...officialBase().provenance, sourceHash: "sha256:otro" } as Base["provenance"],
      })),
    ],
    [
      "manifestId de la provenance no coincide con depotManifests",
      sealed(officialBase({
        provenance: { ...officialBase().provenance, manifestId: "manifest-otro" } as Base["provenance"],
      })),
    ],
    [
      "buildId de la provenance no coincide con el del snapshot",
      sealed(officialBase({
        provenance: { ...officialBase().provenance, buildId: "otro-build" } as Base["provenance"],
      })),
    ],
    [
      "sourcePath no es el npc_heroes.txt oficial",
      sealed(officialBase({
        provenance: { ...officialBase().provenance, sourcePath: "scripts/npc/otra_cosa.txt" } as Base["provenance"],
      })),
    ],
    ["provenance DEMO_FIXTURE", sealed(officialBase({ provenance: { kind: "DEMO_FIXTURE", label: "demo" } }))],
    ["provenance SYNTHETIC_TEST", sealed(officialBase({ provenance: { kind: "SYNTHETIC_TEST", label: "test" } }))],
    ["heroIds desordenados", sealed(officialBase({ heroIds: [3, 1, 2] }))],
    ["heroIds con duplicados", sealed(officialBase({ heroIds: [1, 1, 2] }))],
    ["heroId no positivo", sealed(officialBase({ heroIds: [0, 1, 2] }))],
    ["depotManifests sin la clave 570", sealed(officialBase({ depotManifests: { "999": "manifest-123" } }))],
    ["artefacto vacío", {}],
    ["no es un objeto", "npc_heroes.txt"],
    ["null", null],
  ])("rechaza: %s", (_label, artifact) => {
    expect(parseTrustedEligibilityArtifact(artifact)).toBeNull();
  });

  test("un snapshot manipulado después de sellado se rechaza", () => {
    const snapshot = sealed(officialBase());
    const tampered = { ...snapshot, heroIds: [...snapshot.heroIds, 777] };
    expect(parseTrustedEligibilityArtifact(tampered)).toBeNull();
  });

  test("archivo ausente degrada a null, nunca lanza", () => {
    expect(loadTrustedEligibilityArtifact("/no/existe/cm-hero-eligibility.json")).toBeNull();
  });

  test("archivo con JSON corrupto degrada a null, nunca lanza", () => {
    const path = `${import.meta.dir}/trusted-eligibility.test.ts`; // no es JSON
    expect(loadTrustedEligibilityArtifact(path)).toBeNull();
  });

  test("LOAD_CM_ELIGIBILITY es el único comando marcado TRUSTED_SERVER_ONLY", () => {
    expect(isTrustedServerOnlyCommand("LOAD_CM_ELIGIBILITY")).toBe(true);
    // Los otros ProtocolAdminCommand son hechos legítimos de adapter: el kernel los valida contra
    // el estado canónico y ninguno amplía lo que el motor certifica como legal.
    expect(isTrustedServerOnlyCommand("RECORD_RESOLVED_BANS")).toBe(false);
    expect(isTrustedServerOnlyCommand("BAN_RESOLUTION_COMPLETE")).toBe(false);
    expect(isTrustedServerOnlyCommand("CONFIRM_FIRST_PICK_SIDE")).toBe(false);
    expect(isTrustedServerOnlyCommand("SUBMIT_SEALED_SELECTION")).toBe(false);
    expect(isTrustedServerOnlyCommand("CM_ACTION")).toBe(false);
  });
});
