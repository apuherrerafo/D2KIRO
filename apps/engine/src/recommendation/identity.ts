import { perspectiveStateHash, rulesHash } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, PerspectiveDraftView } from "../draft-protocol/types";
import type { RecommendationBasedOn } from "./types";

// R1 S5 -- basedOn identity assembly. Every field here is either read verbatim from an already-
// certified value (ruleset identity, eligibility snapshot contentHash) or computed via the ONE
// sanctioned hashing primitive for that purpose (perspectiveStateHash) -- never a bespoke hash.
//
// `perspectiveStateHash(view)` is deliberately the state-identity mechanism, not
// `authoritativeStateHash`: the latter would fold in currently-hidden information (an opponent's
// sealed-but-unrevealed pick), which must never reach a client-facing identity value at all (see
// draft-protocol/identity-hash.ts's own module doc on exactly this leak). Because
// perspectiveStateHash already strips `sessionId` (identity-hash.ts's
// FUNCTIONAL_IDENTITY_EXCLUDED_KEYS), two sessions in a structurally identical hidden state hash
// identically -- this is what makes "hidden twins identical pre-reveal" true by construction,
// not a separate property this module has to maintain by hand.

export const EVIDENCE_VERSION_BASE = "recommendation-evidence/v1+v6-signals/v6+role-belief/v1";

export interface BasedOnInput {
  view: PerspectiveDraftView;
  eligibilitySnapshot: CmHeroEligibilitySnapshot | null;
  /** Whether buildSuggestions ran with empirical calibration or the V6 fallback range -- folded
   * into evidenceVersion so a calibration change is a detectable identity change, per contract. */
  calibrationMode: "fallback" | "empirical";
  seed: string | null;
}

function perspectiveIdentity(view: PerspectiveDraftView): string {
  // Deliberately narrow and separate from stateIdentity: names WHICH perspective this is (ruleset +
  // viewer side), not what the draft currently looks like. rulesHash() is the same sanctioned
  // canonical-hash primitive draft-protocol uses for its own manifest hashing.
  return rulesHash({ ruleset: view.ruleset.id, viewerSide: view.viewerSide ?? "spectator" });
}

export function buildBasedOn(input: BasedOnInput): RecommendationBasedOn {
  const { view, eligibilitySnapshot, calibrationMode, seed } = input;
  return {
    protocolId: view.ruleset.id,
    protocolVersion: view.ruleset.version,
    rulesHash: view.ruleset.rulesHash,
    heroEligibilityHash: eligibilitySnapshot ? eligibilitySnapshot.contentHash : null,
    stateIdentity: perspectiveStateHash(view),
    perspectiveIdentity: perspectiveIdentity(view),
    evidenceVersion: `${EVIDENCE_VERSION_BASE}+calibration:${calibrationMode}`,
    seed: seed ?? null,
  };
}
