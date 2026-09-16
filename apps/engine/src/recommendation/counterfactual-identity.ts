import { perspectiveStateHash, project, rulesHash } from "../draft-protocol";
import type { DraftProtocolState, TeamSide } from "../draft-protocol/types";
import type { SuggestionSet } from "../signals/mix";
import { evidenceIdentityHash } from "./evidence";
import type { CounterfactualIdentity } from "./types";

// R1 S6 -- BASED-ON IDENTITY for the counterfactual leg. Deliberately separate from
// `RecommendationBasedOn` (S5, identity.ts) -- S6 never touches that struct, so S1-S5 identity
// stays byte-identical whether or not S6 ran (gate requirement: R0/S1-S5 protected semantics
// UNCHANGED). Every field is either read verbatim from an already-certified value or produced by
// the SAME sanctioned hashing primitives identity.ts already uses (perspectiveStateHash/rulesHash/
// evidenceIdentityHash) -- never a bespoke hash, never the opponent's authoritative (possibly
// hidden) state.
//
// CRITICAL: `stateIdentity`/`perspectiveIdentity` are computed from `actor`'s OWN perspective
// (`project(counterfactualState, actor)`), NEVER the opponent's -- this value is attached to
// OUR OWN RecommendationSetV2, so it must never vary with anything the opponent's own self-aware
// view alone would reveal (their currently-sealed-but-unrevealed pick). Same reasoning as
// opponent-model.ts's `mutualVisibilityLegacyState`; `evidenceIdentity` is already safe by
// construction because `opponentSuggestionSet.functionalEvidence` is itself built from that same
// mutual-visibility state, never from the opponent's private self-aware one.

export function buildCounterfactualIdentity(
  counterfactualState: DraftProtocolState,
  actor: TeamSide,
  seed: string | undefined,
  opponentSuggestionSet: SuggestionSet | null,
): CounterfactualIdentity {
  const ownView = project(counterfactualState, actor);
  const evidence = opponentSuggestionSet?.functionalEvidence ?? null;
  return {
    stateIdentity: perspectiveStateHash(ownView),
    perspectiveIdentity: rulesHash({ ruleset: counterfactualState.ruleset.id, viewerSide: actor }),
    rulesHash: counterfactualState.ruleset.rulesHash,
    eligibilityHash: counterfactualState.captainsMode?.eligibilitySnapshot?.contentHash ?? null,
    evidenceIdentity: evidence ? evidenceIdentityHash(evidence) : null,
    seed: seed ?? null,
  };
}
