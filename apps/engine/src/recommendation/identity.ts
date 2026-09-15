import { perspectiveStateHash, rulesHash } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, PartyContext, PerspectiveDraftView } from "../draft-protocol/types";
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

// v2 (final evidence-identity repair): evidenceIdentityHash gained `sequence` (per-hero
// {hero, score} in V6's own returned order) alongside `candidates` -- team-opening's
// HeroCapabilities-driven strategy/ban-relief evidence only ever surfaces as order/score, never as
// a SignalContribution, so v1 (candidates alone) could miss it. See evidence.ts's own header doc.
export const EVIDENCE_VERSION_BASE = "recommendation-evidence/v2+v6-signals/v6+role-belief/v1";

export interface BasedOnInput {
  view: PerspectiveDraftView;
  eligibilitySnapshot: CmHeroEligibilitySnapshot | null;
  /** Whether buildSuggestions ran with empirical calibration or the V6 fallback range -- folded
   * into evidenceVersion so a calibration change is a detectable identity change, per contract. */
  calibrationMode: "fallback" | "empirical";
  seed: string | null;
  /** Current game patch, verbatim -- see RecommendationBasedOn.patch's own doc for why this is
   * not already covered by stateIdentity/rulesHash. */
  patch: string;
  /** The actor's kernel-level PartyContext (Ranked All Pick only -- Captain's Mode carries no
   * party slot in CmState, and CM decisions are always single-action regardless of party, so no
   * caller threads one there). Null = no PartyContext at all (legacy/no-party session). */
  partyContext: PartyContext | null;
  /** Functional hash of the evidence V6 actually produced for this decision (evidence.ts's
   * evidenceIdentityHash over the computed SuggestionSet), or null when no evidence was computed
   * at all (no legal action / computeSuggestions failed) -- see RecommendationBasedOn.evidenceVersion. */
  evidenceHash: string | null;
}

function perspectiveIdentity(view: PerspectiveDraftView): string {
  // Deliberately narrow and separate from stateIdentity: names WHICH perspective this is (ruleset +
  // viewer side), not what the draft currently looks like. rulesHash() is the same sanctioned
  // canonical-hash primitive draft-protocol uses for its own manifest hashing.
  return rulesHash({ ruleset: view.ruleset.id, viewerSide: view.viewerSide ?? "spectator" });
}

/** Blocker 6 (independent architecture review) -- PerspectiveDraftView carries no party/control
 * information at all, so two structurally identical states with different PartyContexts (e.g. a
 * party controlling 1 of 2 open round slots vs. all of them) would otherwise hash identically
 * despite `decision.controlledSlots`/`actionCount` genuinely differing. Only `partySize`/`side`
 * and the SET of controlled roster-slot indexes are functional -- `controllerId` is opaque
 * display metadata that never reaches kernel legality or role-impact computation, so it is
 * deliberately excluded (same discipline as identity-hash.ts excluding computedInMs/timestamps).
 * Sorted so insertion order of `controlledSlots` (never itself meaningful) can't move the hash. */
function partyIdentity(partyContext: PartyContext | null): string | null {
  if (!partyContext) return null;
  return rulesHash({
    partySize: partyContext.partySize,
    side: partyContext.side,
    controlledSlotIndexes: [...partyContext.controlledSlots.map((slot) => slot.slotIndex)].sort((a, b) => a - b),
  });
}

export function buildBasedOn(input: BasedOnInput): RecommendationBasedOn {
  const { view, eligibilitySnapshot, calibrationMode, seed, patch, partyContext, evidenceHash } = input;
  return {
    protocolId: view.ruleset.id,
    protocolVersion: view.ruleset.version,
    rulesHash: view.ruleset.rulesHash,
    heroEligibilityHash: eligibilitySnapshot ? eligibilitySnapshot.contentHash : null,
    stateIdentity: perspectiveStateHash(view),
    perspectiveIdentity: perspectiveIdentity(view),
    patch,
    partyIdentity: partyIdentity(partyContext),
    evidenceVersion: `${EVIDENCE_VERSION_BASE}+calibration:${calibrationMode}+evidence:${evidenceHash ?? "none"}`,
    seed: seed ?? null,
  };
}
