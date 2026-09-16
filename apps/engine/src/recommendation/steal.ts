import type { DraftProtocolState, HeroId } from "../draft-protocol/types";
import { opponentValueFor, topPlausibleAction, type OpponentModelResult, type OpponentValueBaselineResult } from "./opponent-model";
import { isHeroProtocolAvailable } from "./protocol-availability";
import type { EvidenceItem, StealEvaluation, StealStatus } from "./types";

// R1 S6 -- STEAL semantics (Blocker 2 repair). Reuses two already-computed model results
// (`baseline` against the CURRENT, unmodified state; `after` against the counterfactual state
// reached by our candidate action) rather than a third V6 call -- both are already needed by
// lookahead.ts for `opponentResponse` anyway.
//
// MATERIALIZATION IS A PROTOCOL-AVAILABILITY FACT, NEVER A RANKING FACT. A hero can drop out of
// `after`'s bounded, ranked shortlist (top-8 truncation, a score reshuffle) while remaining fully
// legal/nameable -- that is NOT a steal, it is the shortlist being bounded. The ONLY thing that can
// make a steal real is the protocol itself certifying the hero gone (banned, or confirmed-picked
// AND revealed) -- `isHeroProtocolAvailable` reads that fact directly from `beforeState`/
// `counterfactualState` (the SAME authoritative facts `mutualVisibilityLegacyState` already reads
// for V6), never from whether V6 happened to rank or truncate the hero.
//
// `opponentBaselineValue`/`afterOurActionValue` stay exactly what they always were -- V6's own
// canonical score, purely informational -- but they no longer DRIVE the MATERIALIZED/
// STILL_CONTESTABLE distinction. NO NEW BUSINESS THRESHOLD: "was this hero worth stealing" is still
// answered by presence in the opponent's OWN baseline ranking (whatever V6 itself already decided
// was worth returning) -- never an invented score cutoff.

const EVIDENCE_VERSION_STEAL = "s6-steal/v2";

function evidenceItem(heroId: HeroId, reason: string, value: number | null): EvidenceItem {
  return { source: "opponent-model", version: EVIDENCE_VERSION_STEAL, subject: heroId, signal: "opponent_model", value, contribution: null, reason };
}

/** Evaluates steal for the strongest of `ourHeroes` (by opponent baseline value, heroId as a
 * deterministic tie-break) -- a compound recommendation has up to 2 candidate heroes; this
 * reports the ONE most notable, never an array (matches the singular `heroId?` shape).
 *
 * `beforeState` MUST be the authoritative state BEFORE our candidate action (the same `state`
 * lookahead.ts's `computeOnePlyLookahead` received as input) -- used only to confirm a candidate
 * hero was genuinely protocol-available before we acted; a hero already gone at this point can
 * never be reported as something OUR action stole (see the "ALREADY UNAVAILABLE" test). */
export function evaluateSteal(
  beforeState: DraftProtocolState,
  baseline: OpponentValueBaselineResult,
  after: OpponentModelResult,
  counterfactualState: DraftProtocolState,
  ourHeroes: readonly HeroId[],
): StealEvaluation {
  if (baseline.failed || after.failed) {
    return { status: "SIMULATION_UNAVAILABLE", heroId: null, opponentBaselineValue: null, afterOurActionValue: null, displacedResponse: null, evidence: [] };
  }

  const candidates = ourHeroes
    .map((heroId) => ({ heroId, before: opponentValueFor(baseline.suggestionSet, heroId) }))
    .filter((candidate) => candidate.before !== null && isHeroProtocolAvailable(beforeState, candidate.heroId))
    .sort((a, b) => (b.before! - a.before!) || (a.heroId - b.heroId));

  const top = candidates[0];
  if (!top) {
    return { status: "NOT_APPLICABLE", heroId: null, opponentBaselineValue: null, afterOurActionValue: null, displacedResponse: null, evidence: [] };
  }

  const stillAvailable = isHeroProtocolAvailable(counterfactualState, top.heroId);
  const afterValue = opponentValueFor(after.suggestionSet, top.heroId);
  const status: StealStatus = stillAvailable ? "STILL_CONTESTABLE" : "MATERIALIZED";
  const displacedResponse = stillAvailable ? null : topPlausibleAction(after, counterfactualState);

  const evidence: EvidenceItem[] = [
    evidenceItem(top.heroId, `valor del rival por héroe ${top.heroId} antes de nuestra acción: ${top.before}`, top.before),
    evidenceItem(
      top.heroId,
      stillAvailable
        ? `héroe ${top.heroId} sigue siendo protocolarmente disponible tras nuestra acción (sellado-oculto, sin tocar, o no confirmado)`
        : `héroe ${top.heroId} ya no es protocolarmente disponible tras nuestra acción (baneado o confirmado y revelado) -- verificado contra el estado real, no contra su presencia en un ranking acotado`,
      afterValue,
    ),
  ];

  return { status, heroId: top.heroId, opponentBaselineValue: top.before, afterOurActionValue: afterValue, displacedResponse, evidence };
}
