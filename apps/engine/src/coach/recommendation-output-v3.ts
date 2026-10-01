import type { DraftDecisionContext } from "../drafter/decision-context";
import type { HeroId, RankedApPhase } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { RecommendationBasedOn, RecommendationDegradation, RecommendationSetV2 } from "../recommendation/types";
import type { MetaReadiness } from "../meta/readiness";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CoachObservableState, RoleCollisionObservation } from "./observable-state";
import { buildHeroCard, candidateServesPosition, demoteRevealedHardCountered, extractHeroCandidates, revealedEnemyHeroes, type Confidence, type HeroCandidate, type HeroCard } from "./hero-card";
import { positionPhrase, type RevealStrategy } from "./reveal-strategy";
import { detectSafeCoreWindow, type CounterReliefEvidence } from "./safe-core";
import type { RoleBelief, RoleBeliefStatus } from "../draft-protocol/roles/role-belief";

// AP Ranked Roles V1 / Wave 2 (task 18) -- RecommendationOutputV3: the Coach's UI contract, built
// ON TOP of RecommendationSetV2 (never replacing it: V2 keeps serving its existing consumers).
//
//   PRIMARY ACTION  -> what to reveal / preserve / do now   (Level 1, RevealStrategy)
//   SHORTLIST       -> concrete hero options for that action (Level 2, the existing V6 ranking)
//
// The shortlist may hold concrete heroes while the primary action is role-level. It is a list of
// OPTIONS, and it never upgrades the action to hero-level: `primaryAction.strategy` is the only
// statement of how specific the Coach is being.
//
// `opportunity` (Wave 4A) is the separate, informational Safe Core block: it never reorders the shortlist
// and never changes `primaryAction`. It is populated only when curated counter evidence was supplied AND
// the structural Safe Core rule holds (coach/safe-core.ts) -- never by default.

/** How many hero options the shortlist carries (task 18's stated initial default; configurable per call). */
export const COACH_SHORTLIST_SIZE = 5;

/** Why the Coach recomputed: the legal observable-state change that triggered this output. */
export type CoachTrigger =
  | "DRAFT_PICKS_STARTED" // first output of a session (start of the pick phase)
  | "OWN_PICK_CONFIRMED" // one of our own seats was sealed (recomputed immediately, no enemy reveal needed)
  | "ROUND_REVEALED" // new enemy picks became legally visible
  | "PLAYER_POSITION_ASSIGNED" // the Player assigned a position to a visible hero
  | "STATE_CHANGED" // any other legal observable change (e.g. a collision ban reopening a seat)
  | "REFRESH"; // nothing changed; recomputed on request

export interface CoachOutputConfig {
  /** Monotonic per session (orchestrator-assigned): lets a client discard an out-of-order response. */
  revision?: number;
  trigger?: CoachTrigger;
  /** Declared personal position. Wave 2 does not use it: it never constrains pick timing. */
  playerPersonalPosition?: Position | null;
  shortlistSize?: number;
  /** Curated position evidence: the repo's definition of Flex (a hero registered in 2+ positions). */
  heroPositions?: HeroPositions;
  /** Wave 3 (Hero Pool). Wave 2 callers omit it, so no pool badge/flag is ever produced. */
  heroPool?: readonly HeroId[];
  /** Wave 4A: curated counter relationships (hero-counters.json, validated at load). Omitted -> no opportunity. */
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /**
   * V6 set built over a candidate universe restricted BEFORE ranking to the heroes credible for the REVEAL_POSITION target
   * (orchestrator-supplied). Its heroes lead the shortlist of that action; the team set's serving heroes follow. Never used by other kinds.
   */
  actionRecommendationSet?: RecommendationSetV2;
}

/** The Safe Core opportunity block. `counterEvidence.sourceType` is always "CURATED" (the only approved counter evidence in V1). */
export interface CoachOpportunity {
  subtype: "SAFE_CORE";
  label: string;
  heroId: HeroId;
  evidence: string;
  counterEvidence: CounterReliefEvidence;
}

export interface RecommendationOutputV3 {
  schema: "recommendation-output/v3";
  sessionId: string;
  primaryAction: {
    strategy: RevealStrategy;
    /** A suggestion, never an obligation: the Player keeps full authority (PD-003). */
    label: string;
  };
  shortlist: HeroCard[];
  roleCollision?: RoleCollisionObservation;
  /** Wave 4A. Absent (never null) unless real evidence exists. Informational: does not touch shortlist or primaryAction. */
  opportunity?: CoachOpportunity;
  /** Wave 3. Absent unless a personal position is declared AND implemented. */
  personalHeroView?: {
    position: Position;
    positionLabel: string;
    /** True when the own picks already fill this position in every feasible assignment: `heroes` is then empty by design. */
    seatCovered: boolean;
    heroes: { heroId: HeroId; rank: number; score: number; isFromPool: boolean }[];
  };
  /** Wave 3. Absent unless a hero pool is configured. */
  outsidePoolRecommendation?: { heroId: HeroId; label: string; rationale: string };
  /** Observable role uncertainty only. The UI never receives Enemy Bot private assignments. */
  roleBeliefs: {
    own: RoleBeliefDisplay[];
    enemy: RoleBeliefDisplay[];
  };
  meta: {
    round: 1 | 2 | 3 | null;
    phase: RankedApPhase | null;
    ownPicksRemaining: number;
    confidence: Confidence;
    decisionContext: DraftDecisionContext;
    trigger: CoachTrigger;
    revision: number;
    /** Same object as the source RecommendationSetV2.basedOn: stale detection = compare stateIdentity + evidenceVersion. */
    basedOn: RecommendationBasedOn;
    readiness?: MetaReadiness;
    degradations?: readonly RecommendationDegradation[];
  };
}

export interface RoleBeliefDisplay {
  heroId: HeroId;
  status: RoleBeliefStatus;
  positions: Position[];
}

export function displayBeliefs(beliefs: ReadonlyMap<HeroId, RoleBelief>): RoleBeliefDisplay[] {
  return [...beliefs]
    .sort(([a], [b]) => a - b)
    .map(([heroId, belief]) => ({
      heroId,
      status: belief.status,
      // No Wave-3 threshold: show all publicly plausible positions, ordered by the actual belief.
      positions: ([1, 2, 3, 4, 5] as const).filter((position) => belief.probabilities[position] > 0).sort((a, b) => belief.probabilities[b] - belief.probabilities[a] || a - b),
    }));
}

// ---------------------------------------------------------------------------------------------
// primaryAction.label -- composed from the strategy's own fields, not a per-kind canned sentence.
// ---------------------------------------------------------------------------------------------

const LABEL_VERB: Readonly<Record<RevealStrategy["kind"], string>> = {
  REVEAL_POSITION: "Sugerencia: revela",
  REVEAL_HERO: "Sugerencia: asegura",
  DEFER_POSITION: "Sugerencia: guarda para más tarde",
  REVEAL_FLEX: "Sugerencia: revela un pick flexible",
  OPPORTUNITY: "Oportunidad:",
};

function labelTarget(strategy: RevealStrategy): string {
  if (strategy.kind === "REVEAL_HERO") return `este héroe ahora (${positionPhrase(strategy.position)})`;
  if (strategy.kind === "REVEAL_FLEX") return `(${strategy.possiblePositions.map(positionPhrase).join(" / ")})`;
  if (strategy.kind === "OPPORTUNITY") return strategy.rationale;
  return positionPhrase(strategy.position);
}

export function labelForStrategy(strategy: RevealStrategy): string {
  return `${LABEL_VERB[strategy.kind]} ${labelTarget(strategy)}`;
}

// ---------------------------------------------------------------------------------------------
// shortlist -- V6 order, with the options that fit the primary action first.
// ---------------------------------------------------------------------------------------------

function fitsStrategy(candidate: HeroCandidate, strategy: RevealStrategy): boolean {
  if (strategy.kind === "REVEAL_HERO") return candidate.heroId === strategy.heroId;
  if (strategy.kind === "REVEAL_POSITION" || strategy.kind === "DEFER_POSITION") {
    const resolvedHere = candidate.roleStatus !== "UNRESOLVED" && candidate.position === strategy.position;
    return resolvedHere || candidate.flexPositions.includes(strategy.position);
  }
  if (strategy.kind === "REVEAL_FLEX") return candidate.flexPositions.some((position) => strategy.possiblePositions.includes(position));
  return strategy.heroId !== undefined && candidate.heroId === strategy.heroId;
}

function orderForStrategy(candidates: readonly HeroCandidate[], strategy: RevealStrategy, heroPositions: HeroPositions | undefined, actionCandidates: readonly HeroCandidate[] = []): HeroCandidate[] {
  if (strategy.kind === "REVEAL_POSITION") {
    const seen = new Set<HeroId>();
    const pool = [...actionCandidates, ...candidates].filter((candidate) => (seen.has(candidate.heroId) ? false : (seen.add(candidate.heroId), true)));
    candidates = pool;
    // Dota-Judge RB-2: the options shown for "reveal Pos P" are the heroes that can execute it. The strategy is
    // derived so at least one exists; an externally supplied strategy nobody serves degrades to the plain order
    // (never an empty shortlist).
    const serving = candidates.filter((candidate) => candidateServesPosition(candidate, strategy.position, heroPositions));
    return serving.length > 0 ? serving : [...candidates];
  }
  if (strategy.kind === "DEFER_POSITION") {
    // Deferring a position means not spending it now: options for OTHER positions lead.
    const others = candidates.filter((candidate) => !fitsStrategy(candidate, strategy));
    return others.length > 0 ? others : [...candidates];
  }
  const fitting = candidates.filter((candidate) => fitsStrategy(candidate, strategy));
  return [...fitting, ...candidates.filter((candidate) => !fitting.includes(candidate))];
}

// ---------------------------------------------------------------------------------------------
// meta.confidence -- never higher than the evidence behind the action.
// ---------------------------------------------------------------------------------------------

const CONFIDENCE_ORDER: readonly Confidence[] = ["baja", "media", "alta"];

function lower(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

/** Role-level actions rest on a role belief or an opening prior: V6's "alta" is capped at "media". */
const KIND_CONFIDENCE_CAP: Readonly<Record<RevealStrategy["kind"], Confidence>> = {
  REVEAL_HERO: "alta",
  REVEAL_POSITION: "media",
  DEFER_POSITION: "media",
  REVEAL_FLEX: "media",
  OPPORTUNITY: "alta",
};

function stepDown(confidence: Confidence): Confidence {
  return CONFIDENCE_ORDER[Math.max(CONFIDENCE_ORDER.indexOf(confidence) - 1, 0)]!;
}

function deriveConfidence(candidates: readonly HeroCandidate[], strategy: RevealStrategy): Confidence {
  const top = candidates[0];
  if (!top) return "baja";
  const confidence = lower(top.confidence, KIND_CONFIDENCE_CAP[strategy.kind]);
  // No separation between the two best options: one tier less (a tie is not evidence of a leader).
  const second = candidates[1];
  return second && second.score === top.score ? stepDown(confidence) : confidence;
}

/**
 * Safe Core is evaluated for V6's top candidate (design 17: `recommendations[0]`), NOT for whichever hero the
 * primary action moved to the front of the shortlist -- otherwise a support-first opening would hide exactly
 * the case the block exists for (a core that can be revealed earlier than the support prior suggests).
 */
export function deriveOpportunity(candidates: readonly HeroCandidate[], view: CoachObservableState["view"], heroCounters: CoachOutputConfig["heroCounters"]): CoachOpportunity | null {
  const top = candidates[0];
  if (!top || !heroCounters) return null;
  const signal = detectSafeCoreWindow(top.heroId, view, top.signals, heroCounters, { position: top.position, roleStatus: top.roleStatus });
  if (!signal.isSafeWindow || !signal.counterEvidence) return null;
  return { subtype: "SAFE_CORE", label: `Ventana de core: ${signal.evidence}`, heroId: top.heroId, evidence: signal.evidence, counterEvidence: signal.counterEvidence };
}

function roundOf(phase: RankedApPhase | null): 1 | 2 | 3 | null {
  if (phase === "PICK_ROUND_1") return 1;
  if (phase === "PICK_ROUND_2") return 2;
  if (phase === "PICK_ROUND_3") return 3;
  return null;
}

export function translateToRecommendationOutputV3(
  recommendationSet: RecommendationSetV2,
  revealStrategy: RevealStrategy,
  coachState: CoachObservableState,
  decisionContext: DraftDecisionContext,
  config: CoachOutputConfig = {},
): RecommendationOutputV3 {
  const heroPool = config.heroPool ?? [];
  const size = config.shortlistSize ?? COACH_SHORTLIST_SIZE;
  const view = coachState.view;
  // V6 order, except heroes with a REVEALED enemy among their curated hard counters go behind those without (RB-4).
  const revealedEnemies = revealedEnemyHeroes(view);
  const v6Candidates = extractHeroCandidates(recommendationSet, config.heroPositions);
  const candidates = demoteRevealedHardCountered(v6Candidates, revealedEnemies, config.heroCounters);
  const counterContext = { revealedEnemies, heroCounters: config.heroCounters };
  const actionCandidates = config.actionRecommendationSet
    ? demoteRevealedHardCountered(extractHeroCandidates(config.actionRecommendationSet, config.heroPositions), revealedEnemies, config.heroCounters)
    : [];
  const phase = view.rankedAp?.phase ?? null;
  const ownVisible = view.ownPicks.filter((slot) => slot.visibility !== "HIDDEN").length;
  // Safe Core keeps judging V6's own leader (Wave 4A contract): the demotion above never feeds it.
  const opportunity = deriveOpportunity(v6Candidates, view, config.heroCounters);

  const isCollision = coachState.roleCollision?.infeasible ?? false;
  const baseLabel = labelForStrategy(revealStrategy);
  const primaryLabel = isCollision
    ? `Recuperación (colisión de roles): ${baseLabel.replace(/^Sugerencia:\s*/, "")}`
    : baseLabel;

  return {
    schema: "recommendation-output/v3",
    sessionId: view.sessionId,
    primaryAction: { strategy: revealStrategy, label: primaryLabel },
    shortlist: orderForStrategy(candidates, revealStrategy, config.heroPositions, actionCandidates)
      .slice(0, size)
      .map((candidate) => buildHeroCard(candidate, heroPool, counterContext)),
    ...(opportunity ? { opportunity } : {}),
    roleCollision: coachState.roleCollision,
    roleBeliefs: { own: displayBeliefs(coachState.ownRoleBeliefs), enemy: displayBeliefs(coachState.enemyRoleBeliefs) },
    meta: {
      round: roundOf(phase),
      phase,
      ownPicksRemaining: Math.max(5 - ownVisible, 0),
      confidence: isCollision ? "baja" : deriveConfidence(candidates, revealStrategy),
      decisionContext,
      trigger: config.trigger ?? "REFRESH",
      revision: config.revision ?? 0,
      basedOn: recommendationSet.basedOn,
      ...(recommendationSet.readiness ? { readiness: recommendationSet.readiness } : {}),
      ...(recommendationSet.degradations ? { degradations: recommendationSet.degradations } : {}),
    },
  };
}
