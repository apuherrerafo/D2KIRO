// R1 S7 (Blocker 1) -- test/dev-only Captain's Mode hero eligibility fixture.
//
// apps/engine/src/draft-protocol/trusted-eligibility.ts is fail-closed by design: without a
// server-side artifact certifying OFFICIAL_DEPOT provenance, no CM_ACTION is ever legal (there is
// no Dota 2 depot available in this environment, and building the real extraction pipeline --
// scripts/cm-eligibility/build-snapshot.ts against an actual VPK -- is out of scope for this
// repair). That loader can only ever verify a snapshot's SHAPE and internal self-consistency, not
// whether its depot claims are literally true -- the real trust boundary is WHERE the file was
// placed (server/operator side, never a request body), which is exactly the mechanism this fixture
// uses: same acceptCmHeroEligibilitySnapshot gate as production, same contentHash discipline as
// apps/engine/src/server/protocol-session.cm-acceptance.test.ts's own fixtureEligibility() helper,
// pointed at by CM_ELIGIBILITY_ARTIFACT_PATH -- an env var only apps/engine/src/index.e2e.ts ever
// reads (R1 S7 final blocker repair, Blocker 1); index.ts, the real production/Railway entrypoint,
// never looks at it, so loadTrustedEligibilityArtifact() keeps its real, absent-by-default
// fail-closed path in prod regardless of what's in the process environment.
// Imports the specific modules, never the draft-protocol barrel (`index.ts`): that barrel
// re-exports trusted-eligibility.ts, which resolves its default artifact path with
// `import.meta.dir` (a Bun-only extension) -- fine under `bun run src/index.ts`, but this file is
// also pulled into playwright.config.ts, which Playwright loads under plain Node.js. Importing the
// barrel there crashes config loading before a single browser opens ("Cannot use 'import.meta'
// outside a module"). eligibility.ts itself has no such dependency (identity-hash/hero-id/
// immutable/types only), so importing it directly keeps this fixture Node-safe.
import { computeEligibilityContentHash } from "../../apps/engine/src/draft-protocol/eligibility";
import type { CmHeroEligibilitySnapshot } from "../../apps/engine/src/draft-protocol/types";

export function buildFixtureCmEligibilitySnapshot(heroIds: readonly number[]): CmHeroEligibilitySnapshot {
  const withoutHash: Omit<CmHeroEligibilitySnapshot, "contentHash"> = {
    schema: "cm-hero-eligibility/v1",
    appId: 570,
    patch: "7.41e",
    buildId: "e2e-fixture-build",
    depotManifests: { "570": "e2e-fixture-manifest" },
    sourceHashes: { npc_heroes: "e2e-fixture" },
    provenance: {
      kind: "OFFICIAL_DEPOT",
      appId: 570,
      buildId: "e2e-fixture-build",
      depotId: "e2e-fixture-depot",
      manifestId: "e2e-fixture-manifest",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "e2e-fixture",
    },
    heroIds: [...heroIds].sort((a, b) => a - b),
  };
  return { ...withoutHash, contentHash: computeEligibilityContentHash(withoutHash) };
}
