import type { DraftDecisionContext } from "../drafter/decision-context";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position, RoleBelief } from "../draft-protocol/roles/role-belief";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { RoleCollisionObservation } from "./observable-state";
import { candidateServesPosition, demoteRevealedHardCountered, extractHeroCandidates, revealedEnemyHeroes, type HeroCandidate } from "./hero-card";

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
// A POSITION CLAIM MUST BE EXECUTABLE (Dota-Judge RB-2): the strategy never names a position that no hero of
// the ranking it was derived from can serve (`candidateServesPosition`). The prior is a preference among
// positions the ranking CAN serve, not an override of the ranking -- if the prior's support seat has no
// serving candidate, the prior yields to the next honest branch. No numeric threshold: it is set membership.
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
  /** Curated counters (RB-4): the ranking's leader is judged AFTER the categorical revealed-hard-counter demotion. */
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  roleCollision?: RoleCollisionObservation;
  /**
   * P0-1 (INV-OWN-001, PD-026/PD-027) -- the ONLY positions this decision may name as the human's
   * action, straight from ProtocolSessionStore.humanOpenPositions (session-layer truth, never
   * re-derived here). `null`/omitted for a non-AP-Simulator or legacy session -- the ALL_POSITIONS
   * domain then applies, unconstrained, exactly as before this option existed. Non-null (including
   * `[]`) for an AP Simulator session: every REVEAL_POSITION/REVEAL_FLEX target below is drawn
   * from this set, never manufactured outside it.
   */
  humanOpenPositions?: readonly Position[] | null;
}

function isOpeningContext(context: DraftDecisionContext): boolean {
  return context === "team_opening" || context === "blind_second_pick";
}

type PositionServes = (position: Position) => boolean;

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

/** P0-1: the domain a human-facing position claim may be drawn from. `null` (non-AP-Simulator/legacy) keeps the old, unconstrained ALL_POSITIONS domain. */
function positionDomain(humanOpenPositions: readonly Position[] | null | undefined): readonly Position[] {
  return humanOpenPositions ?? ALL_POSITIONS;
}

/** The last-resort default when every domain-restricted search comes up empty. `null` when the domain itself is empty -- P0-1: never manufacture a target outside it. */
function domainDefault(domain: readonly Position[]): Position | null {
  return domain.includes(5) ? 5 : (domain[0] ?? null);
}

/** The opening prior: with weak evidence, reveal a support seat our picks do not cover yet, among the positions the human may still act on. Null when none is free. */
function supportPrior(occupied: ReadonlySet<Position>, reason: string, serves: PositionServes, domain: readonly Position[]): RevealStrategy | null {
  const support = SUPPORT_PRIOR_POSITIONS.find((position) => domain.includes(position) && !occupied.has(position) && serves(position));
  if (support === undefined) return null;
  return {
    kind: "REVEAL_POSITION",
    position: support,
    rationale: `${reason} Prior de apertura (no una regla): con evidencia débil conviene abrir mostrando ${positionPhrase(support)}.`,
  };
}

function formatCollisionRationale(conflicts: readonly { position: Position; heroIds: readonly HeroId[] }[]): string {
  if (conflicts.length === 0) {
    return "Colisión de roles en tu equipo: no existe asignación legal completa.";
  }
  const conflictPositions = conflicts.map((c) => positionPhrase(c.position)).join(", ");
  return `Colisión de roles en tu equipo (conflicto en ${conflictPositions}): no existe asignación legal completa.`;
}

/**
 * No usable position evidence in the ranking: an honest, labelled fallback -- never a hero.
 * P0-1: every search below is restricted to `domain` (humanOpenPositions when the session is an AP
 * Simulator one; ALL_POSITIONS otherwise). `null` only when `domain` itself is empty -- P0-1's
 * "do not manufacture a target": the caller (deriveRevealStrategy) then reports no action, the
 * same existing representation already used when there is nothing to decide.
 */
function positionFallback(
  context: DraftDecisionContext,
  occupied: ReadonlySet<Position>,
  reason: string,
  serves: PositionServes,
  domain: readonly Position[],
  roleCollision?: RoleCollisionObservation,
): RevealStrategy | null {
  if (roleCollision?.infeasible) {
    const collisionReason = formatCollisionRationale(roleCollision.conflicts);
    const conflicted = new Set<Position>(roleCollision.conflicts.map((c) => c.position));
    const target = domain.find((pos) => !conflicted.has(pos) && !occupied.has(pos) && serves(pos))
      ?? domain.find((pos) => !conflicted.has(pos) && serves(pos))
      ?? domain.find((pos) => !conflicted.has(pos))
      ?? domain.find((pos) => serves(pos))
      ?? domainDefault(domain);
    if (target === null) return null;
    return {
      kind: "REVEAL_POSITION",
      position: target,
      rationale: `${collisionReason} Como recuperación, busca asegurar ${positionPhrase(target)} para mitigar la falta de roles viables.`,
    };
  }

  const prior = isOpeningContext(context) ? supportPrior(occupied, reason, serves, domain) : null;
  if (prior) return prior;
  // An uncovered seat the ranking can serve first; then any seat it can serve; only with no ranking at all, the plain uncovered seat.
  const free = domain.find((position) => !occupied.has(position) && serves(position))
    ?? domain.find((position) => serves(position))
    ?? domain.find((position) => !occupied.has(position))
    ?? domainDefault(domain);
  if (free === null) return null;
  return {
    kind: "REVEAL_POSITION",
    position: free,
    rationale: `${reason} ${positionPhrase(free)} es la posición que tu equipo aún no cubre.`,
  };
}

export function deriveRevealStrategy(
  view: PerspectiveDraftView,
  recommendations: RecommendationSetV2,
  _playerPersonalPosition: Position | null,
  _heroPool: readonly HeroId[],
  decisionContext: DraftDecisionContext,
  options: DeriveRevealStrategyOptions = {},
): RevealStrategy | null {
  const occupied = occupiedPositions(options.ownRoleBeliefs);
  const domain = positionDomain(options.humanOpenPositions);
  const candidates: HeroCandidate[] = demoteRevealedHardCountered(extractHeroCandidates(recommendations, options.heroPositions), revealedEnemyHeroes(view), options.heroCounters);
  const top = candidates[0];
  const serves: PositionServes = (position) => candidates.some((candidate) => candidateServesPosition(candidate, position, options.heroPositions));

  if (!top) return positionFallback(decisionContext, occupied, "No hay ranking de héroes disponible para este estado.", serves, domain, options.roleCollision);

  const resolved = top.roleStatus !== "UNRESOLVED";

  // 1. V6 already points at a support seat the human may still act on: the evidence and any support prior agree.
  if (resolved && (top.position === 4 || top.position === 5) && domain.includes(top.position)) {
    const rationale = options.roleCollision?.infeasible
      ? `${formatCollisionRationale(options.roleCollision.conflicts)} Como recuperación, el ranking apunta a ${positionPhrase(top.position)}.`
      : `El ranking de héroes se concentra en ${positionPhrase(top.position)}.`;
    return { kind: "REVEAL_POSITION", position: top.position, rationale };
  }

  // 2. The best option's position is unresolved in V6's own role tiers AND the curated catalog registers
  //    it in two or more positions (the repo's own definition of Flex, signals/mix.ts flexibilityReason)
  //    the human may still act on: keep the position open among only those, instead of naming one.
  if (!resolved && top.flexPositions.length >= 2) {
    const humanFlexPositions = top.flexPositions.filter((position) => domain.includes(position));
    if (humanFlexPositions.length >= 2) {
      const rationale = options.roleCollision?.infeasible
        ? `${formatCollisionRationale(options.roleCollision.conflicts)} Como recuperación, el candidato flexible puede cubrir ${humanFlexPositions.map(positionPhrase).join(" o ")}.`
        : `El mejor candidato puede jugar ${humanFlexPositions.map(positionPhrase).join(" o ")}; no hace falta fijar la posición todavía.`;
      return {
        kind: "REVEAL_FLEX",
        possiblePositions: humanFlexPositions,
        rationale,
      };
    }
  }

  // 3. The leader is a core (or has no position evidence): at an opening decision, the support prior.
  if (isOpeningContext(decisionContext)) {
    const prior = supportPrior(occupied, "El ranking no obliga a abrir con un core.", serves, domain);
    if (prior) return prior;
  }

  // 4. Otherwise the honest role the evidence points at (or the uncovered seat when it points nowhere),
  //    constrained to what the human may still act on (P0-1).
  if (!resolved || !domain.includes(top.position)) {
    const reason = resolved ? "El ranking apunta a una posición que no controlás en esta ronda." : "El ranking no aporta evidencia de posición.";
    return positionFallback(decisionContext, occupied, reason, serves, domain, options.roleCollision);
  }
  const rationale = options.roleCollision?.infeasible
    ? `${formatCollisionRationale(options.roleCollision.conflicts)} Como recuperación, la composición apunta a ${positionPhrase(top.position)}.`
    : `La composición y el ranking apuntan a ${positionPhrase(top.position)}.`;
  return { kind: "REVEAL_POSITION", position: top.position, rationale };
}
