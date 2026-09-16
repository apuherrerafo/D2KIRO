import type { DraftProtocolState, HeroId } from "../draft-protocol/types";
import { opponentValueFor, topPlausibleAction, type OpponentModelResult } from "./opponent-model";
import type { EvidenceItem, StealEvaluation, StealStatus } from "./types";

// R1 S6 -- STEAL semantics. Reuses two already-computed OpponentModelResult objects (`baseline`
// against the CURRENT, unmodified state; `after` against the counterfactual state reached by our
// candidate action) rather than a third V6 call -- both are already needed by lookahead.ts for
// `opponentResponse` anyway.
//
// Case A (still contestable): a hero remains in `after`'s own ranked universe -- whether because
// our action left it untouched, or because it is still sealed-but-hidden to the opponent (a
// hidden sealed selection never removes a hero from V6's candidatePool for the OTHER side; see
// signals/mix.ts's own `candidatePool`, which only excludes banned/picked heroes it can actually
// see through `perspectiveToLegacyDraftState`). Either way: no completed steal is ever claimed
// while the hero is still legally nameable by the opponent.
//
// Case B (materialized): the hero is genuinely gone from `after`'s universe (banned, or
// confirmed-picked AND revealed) -- V6 never scores an already-excluded hero, so its absence from
// `after.suggestionSet` IS the signal, never a fabricated 0/null-substitute.
//
// NO NEW BUSINESS THRESHOLD: "was this hero worth stealing" is answered by presence in the
// opponent's OWN baseline ranking (whatever V6 itself already decided was worth returning) --
// never an invented score cutoff.

const EVIDENCE_VERSION_STEAL = "s6-steal/v1";

function evidenceItem(heroId: HeroId, reason: string, value: number | null): EvidenceItem {
  return { source: "opponent-model", version: EVIDENCE_VERSION_STEAL, subject: heroId, signal: "opponent_model", value, contribution: null, reason };
}

/** Evaluates steal for the strongest of `ourHeroes` (by opponent baseline value, heroId as a
 * deterministic tie-break) -- a compound recommendation has up to 2 candidate heroes; this
 * reports the ONE most notable, never an array (matches the singular `heroId?` shape). */
export function evaluateSteal(
  baseline: OpponentModelResult,
  after: OpponentModelResult,
  counterfactualState: DraftProtocolState,
  ourHeroes: readonly HeroId[],
): StealEvaluation {
  if (baseline.failed || after.failed) {
    return { status: "SIMULATION_UNAVAILABLE", heroId: null, opponentBaselineValue: null, afterOurActionValue: null, displacedResponse: null, evidence: [] };
  }

  const candidates = ourHeroes
    .map((heroId) => ({ heroId, before: opponentValueFor(baseline, heroId), after: opponentValueFor(after, heroId) }))
    .filter((candidate) => candidate.before !== null)
    .sort((a, b) => (b.before! - a.before!) || (a.heroId - b.heroId));

  const top = candidates[0];
  if (!top) {
    return { status: "NOT_APPLICABLE", heroId: null, opponentBaselineValue: null, afterOurActionValue: null, displacedResponse: null, evidence: [] };
  }

  const stillAvailable = top.after !== null;
  const status: StealStatus = stillAvailable ? "STILL_CONTESTABLE" : "MATERIALIZED";
  const displacedResponse = stillAvailable ? null : topPlausibleAction(after, counterfactualState);

  const evidence: EvidenceItem[] = [
    evidenceItem(top.heroId, `valor del rival por héroe ${top.heroId} antes de nuestra acción: ${top.before}`, top.before),
    evidenceItem(
      top.heroId,
      stillAvailable
        ? `héroe ${top.heroId} sigue disponible para el rival tras nuestra acción (sellado-oculto o sin tocar)`
        : `héroe ${top.heroId} ya no aparece en el universo del rival tras nuestra acción (baneado o confirmado y revelado)`,
      top.after,
    ),
  ];

  return { status, heroId: top.heroId, opponentBaselineValue: top.before, afterOurActionValue: top.after, displacedResponse, evidence };
}
