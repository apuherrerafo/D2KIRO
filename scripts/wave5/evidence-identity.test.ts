import { expect, test } from "bun:test";
import { compareIdentities, type EvidenceIdentity } from "./evidence-identity";

// Stubs carry only the facets compareIdentities reads.
const identity = (over: { state?: string; head?: string; fingerprint?: string; fileSha?: string; positions?: string; mode?: string } = {}): EvidenceIdentity =>
  ({
    code: { head: over.head ?? "h1", contentStateHash: over.state ?? "s1" },
    data: {
      empiricalSnapshot: { logicalFingerprint: over.fingerprint ?? "meta1:a", fileSha256: over.fileSha ?? "f1" },
      positionalDataset: { sha256: over.positions ?? "p1", mode: over.mode ?? "as-loaded" },
      curatedData: [{ path: "c", sha256: "1" }],
      generatedData: [{ path: "g", sha256: "2" }],
      rulesetTarget: "7.41f",
    },
  }) as unknown as EvidenceIdentity;

test("identidades iguales -> ninguna diferencia (mismo código, mismos datos)", () => {
  expect(compareIdentities(identity(), identity())).toEqual([]);
});

test("cada faceta que cambia se nombra por separado: un cambio de datos nunca se atribuye al código ni al revés", () => {
  expect(compareIdentities(identity(), identity({ positions: "p2" }))).toEqual(["positional dataset"]);
  expect(compareIdentities(identity(), identity({ fingerprint: "meta1:b", fileSha: "f2" }))).toEqual(["empirical snapshot (logical fingerprint)", "empirical snapshot (file sha256)"]);
  expect(compareIdentities(identity(), identity({ mode: "synthetic-envelope:widest-denominator" }))).toEqual(["positional dataset mode (as-loaded vs synthetic envelope)"]);
  expect(compareIdentities(identity(), identity({ state: "s2" }))).toEqual(["certified code state (contentStateHash)"]);
  expect(compareIdentities(identity(), identity({ head: "h2", state: "s2" }))).toEqual(["git HEAD", "certified code state (contentStateHash)"]);
});
