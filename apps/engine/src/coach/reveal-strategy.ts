import type { DraftDecisionContext } from "../drafter/decision-context";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position, RoleBelief } from "../draft-protocol/roles/role-belief";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { HeroPositions } from "../signals/hero-positions";
import { extractHeroCandidates } from "./hero-card";

// AP Ranked Roles V1 / Wave 2 (task 16) -- Level 1 of the Coach: "given everything legally known
// right now, what is the best REVEAL decision?" -- which is NOT "which hero has the highest V6
// score". V6 (RecommendationSetV2) is Level 2 and stays untouched; this file reads its output.
//
// EVIDENCE-SCALED SPECIFICITY: when uncertain, be LESS specific. In Wave 2 the Coach therefore only
// ever answers at ROLE level (REVEAL_POSITION or REVEAL_FLEX). It uses no numeric threshold of its own:
// every condition below is either structural (which seats our picks already cover, which support
// position is free) or a semantic the repo already established before this wave (see each branch).
//
//   REVEAL_HERO       -- part of the domain model, NOT emitted in Wave 2. No pre-existing,
//                        deterministic criterion establishes that ONE hero deserves hero-level
//                        certainty (V6 confidence "alta" measures evidence coverage, not that a hero is
//                        decisive; curated hard counters are a magnitude inside `counter`, not a
//                        verdict on the pick). Inventing a "dominance" cut-off was rejected in review.
//   DEFER_POSITION    -- part of the domain model, NOT emitted in Wave 2 (would need a calibrated
//                        heuristic). Rendered/handled everywhere; simply never produced yet.
//   OPPORTUNITY       -- Wave 4 (Safe Core).
//
// SUPPORT-FIRST IS A PRIOR, NOT A SCRIPT: with no stronger role evidence at an opening decision, the
// prior nudges toward a support seat our picks do not cover yet. It is one branch, never keyed to the
// round number, and the same code can answer any of Pos1..Pos5 or Flex.
//
// The Player's personal position and Hero Pool are ACCEPTED (design signature) but do not influence
// this decision: personal position never constrains pick timing (PD-001/PD-020), and pool scoping is
// Wave 3. Pure: same inputs -> same output. Reads only a PerspectiveDraftView, the V6 set built from
// it and public beliefs -- never Simulator Truth.

export type RevealStrategy =
  | { kind: "REVEAL_POSITION"; position: Position; rationale: string }
  // Domain model only in Wave 2 -- see the header: no criterion justifies emitting it yet.
  | { kind: "REVEAL_HERO"; heroId: HeroId; position: Position; rationale: string }
  // Domain model only in Wave 2 -- see the header.
  | { kind: "DEFER_POSITION"; position: Position; rationale: string }
  | { kind: "REVEAL_FLEX"; possiblePositions: Position[]; rationale: string }
  // Wave 4 (Safe Core) owns the producers of this kind; Wave 2 never emits it.
  | { kind: "OPPORTUNITY"; subtype: "SAFE_CORE" | "COUNTER" | "STEAL"; heroId?: HeroId; rationale: string };

/** Support-first prior, in preference order. A prior on WHICH support to reveal, never a round rule. */
const SUPPORT_PRIOR_POSITIONS: readonly Position[] = [5, 4];
const ALL_POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

export const POSITION_NAMES: Readonly<Record<Position, string>> = {
  1: "Carry",
  2: "Midlane",
  3: "Offlane",
  4: "Support",
  5: "Hard support",
};

export function positionPhrase(position: Position): string {
  return `${POSITION_NAMES[position]} (Pos ${position})`;
}

export interface DeriveRevealStrategyOptions {
  /** Our own picks' role beliefs (CoachObservableState.ownRoleBeliefs) -- tells which seats are covered. */
  ownRoleBeliefs?: ReadonlyMap<HeroId, RoleBelief>;
  /** Curated position evidence: defines Flex the way the repo already does (a hero registered in 2+ positions). */
  heroPositions?: HeroPositions;
}

function isOpeningContext(context: DraftDecisionContext): boolean {
  return context === "team_opening" || context === "blind_second_pick";
}

/** Positions our own picks already cover with a real belief (a neutral/unresolved belief covers nothing). */
function occupiedPositions(beliefs: ReadonlyMap<HeroId, RoleBelief> | undefined): Set<Position> {
  const occupied = new Set<Position>();
  for (const belief of beliefs?.values() ?? []) {
    if (belief.status === "UNRESOLVED") continue;
    let best: Position = 1;
    for (const position of ALL_POSITIONS) if (belief.probabilities[position] > belief.probabilities[best]) best = position;
    occupied.add(best);
  }
  return occupied;
}

/** The opening prior: with weak evidence, reveal a support seat our picks do not cover yet. Null when none is free. */
function supportPrior(occupied: ReadonlySet<Position>, reason: string): RevealStrategy | null {
  const support = SUPPORT_PRIOR_POSITIONS.find((position) => !occupied.has(position));
  if (support === undefined) return null;
  return {
    kind: "REVEAL_POSITION",
    position: support,
    rationale: `${reason} Prior de apertura (no una regla): con evidencia débil conviene abrir mostrando ${positionPhrase(support)}.`,
  };
}

/** No usable position evidence in the ranking: an honest, labelled fallback -- never a hero. */
function positionFallback(context: DraftDecisionContext, occupied: ReadonlySet<Position>, reason: string): RevealStrategy {
  const prior = isOpeningContext(context) ? supportPrior(occupied, reason) : null;
  if (prior) return prior;
  const free = ALL_POSITIONS.find((position) => !occupied.has(position)) ?? 5;
  return {
    kind: "REVEAL_POSITION",
    position: free,
    rationale: `${reason} ${positionPhrase(free)} es la posición que tu equipo aún no cubre.`,
  };
}

export function deriveRevealStrategy(
  _view: PerspectiveDraftView,
  recommendations: RecommendationSetV2,
  _playerPersonalPosition: Position | null,
  _heroPool: readonly HeroId[],
  decisionContext: DraftDecisionContext,
  options: DeriveRevealStrategyOptions = {},
): RevealStrategy {
  const occupied = occupiedPositions(options.ownRoleBeliefs);
  const top = extractHeroCandidates(recommendations, options.heroPositions)[0];

  if (!top) return positionFallback(decisionContext, occupied, "No hay ranking de héroes disponible para este estado.");

  const resolved = top.roleStatus !== "UNRESOLVED";

  // 1. V6 already points at a support seat: the evidence and any support prior agree.
  if (resolved && (top.position === 4 || top.position === 5)) {
    return { kind: "REVEAL_POSITION", position: top.position, rationale: `El ranking de héroes se concentra en ${positionPhrase(top.position)}.` };
  }

  // 2. The best option's position is unresolved in V6's own role tiers AND the curated catalog registers
  //    it in two or more positions (the repo's own definition of Flex, signals/mix.ts flexibilityReason):
  //    keep the position open instead of naming one.
  if (!resolved && top.flexPositions.length >= 2) {
    return {
      kind: "REVEAL_FLEX",
      possiblePositions: [...top.flexPositions],
      rationale: `El mejor candidato puede jugar ${top.flexPositions.map(positionPhrase).join(" o ")}; no hace falta fijar la posición todavía.`,
    };
  }

  // 3. The leader is a core (or has no position evidence): at an opening decision, the support prior.
  if (isOpeningContext(decisionContext)) {
    const prior = supportPrior(occupied, "El ranking no obliga a abrir con un core.");
    if (prior) return prior;
  }

  // 4. Otherwise the honest role the evidence points at (or the uncovered seat when it points nowhere).
  if (!resolved) return positionFallback(decisionContext, occupied, "El ranking no aporta evidencia de posición.");
  return { kind: "REVEAL_POSITION", position: top.position, rationale: `La composición y el ranking apuntan a ${positionPhrase(top.position)}.` };
}
