import type { DraftProtocolState, TeamSide } from "../draft-protocol/types";
import { evidenceFromEligibility, evidenceFromRuleset, evidenceFromSignals } from "./evidence";
import { topPlausibleAction, type OpponentModelResult } from "./opponent-model";
import type { CounterfactualIdentity, EvidenceItem, OpponentResponse } from "./types";

// R1 S6 -- PLAUSIBLE RESPONSE construction. Called ONLY from the branch where the counterfactual
// observation point was READY and the opponent's V6 call did not throw -- this function still
// independently falls back to SIMULATION_UNAVAILABLE if the bounded shortlist turns out empty or
// its top entry fails the independent LEGAL UNIVERSE re-check (`topPlausibleAction`), so a caller
// never has to keep that invariant in sync by hand. `score`/`confidence` are V6's own canonical
// Suggestion fields for the chosen action's hero, read verbatim -- never converted into, rounded
// into, or described as a probability anywhere here.

export function buildOpponentResponse(
  opponentSide: TeamSide,
  after: OpponentModelResult,
  counterfactualState: DraftProtocolState,
  identity: CounterfactualIdentity,
): OpponentResponse {
  const action = topPlausibleAction(after, counterfactualState);
  const entry = action ? after.shortlist.find((candidate) => candidate.hero === action.hero) : undefined;
  if (!action || !entry) {
    return { status: "SIMULATION_UNAVAILABLE", actor: null, action: null, score: null, confidence: null, evidence: [], basedOnCounterfactualState: identity };
  }

  const evidence: EvidenceItem[] = [...evidenceFromSignals(action.hero, entry.suggestion.signals), evidenceFromRuleset(counterfactualState.ruleset)];
  const eligibilitySnapshot = counterfactualState.captainsMode?.eligibilitySnapshot;
  if (eligibilitySnapshot) evidence.push(evidenceFromEligibility(eligibilitySnapshot.contentHash, eligibilitySnapshot.heroIds.length));

  return {
    status: "PLAUSIBLE_RESPONSE",
    actor: opponentSide,
    action,
    score: entry.suggestion.score,
    confidence: entry.suggestion.confidence,
    evidence,
    basedOnCounterfactualState: identity,
  };
}
