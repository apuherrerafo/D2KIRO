import { computeJointRoleAssignment, type JointAssignmentHeroInput } from "../draft-protocol/roles/joint-assignment";
import { computeRoleBelief, type Position, type RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { HeroId } from "../draft-protocol/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { RecommendationDegradation, RecommendationRoleImpact } from "./types";

// R1 S5 -- role impact for a candidate action, built ENTIRELY on top of S4's joint-assignment
// primitive. CONSUMES computeRoleBelief/computeJointRoleAssignment; reinfers nothing.
//
// Design choice (S4 design doc, "no joint-assignment consumer is wired to treat [external] belief
// as something to act on ... left to whatever S5 recommendation consumer reads this layer" --
// this module is that consumer): every hero (already-picked own-team heroes AND the candidate(s)
// under evaluation) is fed into ONE joint assignment call using its RAW belief (hero/patch
// distribution + optional party preference, no per-hero occupied-position constraint). The mutual
// exclusivity between heroes is exactly what joint assignment's injective enumeration already
// models -- pre-constraining each hero individually before that enumeration would double-count the
// same correlation S4 built joint assignment specifically to capture.
//
// A marginal concentrating (within OPEN_POSITION_EPSILON's own tolerance, reused import-free here
// as a literal 1e-9-scale comparison against 1) on one position is reported CONFIRMED_FORCED even
// when no explicit confirmation exists -- exactly the "mathematically forced" case the party-
// compound contract calls for (e.g. 4 of 5 own-side heroes already narrow the 5th by elimination).
// No new threshold is invented for this: it is the literal complement of joint-assignment.ts's own
// `openPositions`/`positionCoverage` epsilon.

const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];
const FORCED_EPSILON = 1e-6;

function beliefInputFor(
  heroId: HeroId,
  heroPositions: HeroPositions,
  partyPreferredPositions?: readonly Position[],
  confirmedPosition?: Position | null,
): JointAssignmentHeroInput {
  return {
    heroId,
    belief: computeRoleBelief({ heroId, confirmedPosition, partyPreferredPositions, heroPositions }),
  };
}

function classifyMarginal(marginal: Readonly<Record<Position, number>>, entropy: number): RecommendationRoleImpact {
  const top = POSITIONS.reduce((best, position) => (marginal[position] > marginal[best] ? position : best), POSITIONS[0]!);
  if (marginal[top] >= 1 - FORCED_EPSILON) {
    return { status: "CONFIRMED_FORCED", position: top, marginals: marginal, entropy };
  }
  const isUniform = POSITIONS.every((position) => Math.abs(marginal[position] - marginal[top]) < FORCED_EPSILON);
  if (isUniform) return { status: "UNRESOLVED", position: null, marginals: marginal, entropy };
  return { status: "LIKELY", position: top, marginals: marginal, entropy };
}

export interface RoleImpactInput {
  /** Hero ids already confirmed/known on the actor's own side (KNOWN/REVEALED slots from
   * `view.ownPicks`), excluding the candidate(s) being evaluated. */
  ownPicks: readonly HeroId[];
  /** The hero(s) a candidate Recommendation would add -- 1 for a single action, N for a compound. */
  candidates: readonly HeroId[];
  heroPositions: HeroPositions;
  /** Applies to every candidate hero equally -- see build.ts's RecommendationOptions doc for why a
   * per-slot mapping isn't modeled (no roster-slot identity exists for AP round slots). */
  partyPreferredPositions?: readonly Position[];
  /** Explicit tier-1 confirmation for an already-picked own-side hero (e.g. a future captain UI
   * or party-declared role). No caller in this codebase populates this yet -- it exists so the
   * hook S4's own contract reserves for it (CONFIRMED_EXPLICIT) is real, not merely documented,
   * and so a genuinely contradictory input (two heroes hard-confirmed to the same position) has
   * a way to reach computeJointRoleAssignment's IMPOSSIBLE_ASSIGNMENT rejection at all. */
  ownConfirmedPositions?: ReadonlyMap<HeroId, Position>;
}

export interface RoleImpactResult {
  /** Keyed by candidate heroId only -- own-side already-picked heroes are context, not output. */
  impactByHero: ReadonlyMap<HeroId, RecommendationRoleImpact>;
  /** The pre-joint, per-hero RoleBeliefEvidence that fed this candidate's belief input --
   * traceable provenance for evidence.ts, distinct from the joint-assignment OUTPUT (which carries
   * no evidence text of its own, only probabilities). */
  evidenceByHero: ReadonlyMap<HeroId, readonly RoleBeliefEvidence[]>;
  degradation: RecommendationDegradation | null;
}

const UNRESOLVED_FALLBACK: RecommendationRoleImpact = {
  status: "UNRESOLVED",
  position: null,
  marginals: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 },
  entropy: Math.log2(5),
};

/** Pure. Never throws: an IMPOSSIBLE_ASSIGNMENT input (contradictory hard-confirmed positions
 * among own-side heroes) degrades explicitly to hero-only impact for the candidates -- no silent
 * repair, per contract. */
export function computeRoleImpact(input: RoleImpactInput): RoleImpactResult {
  const { ownPicks, candidates, heroPositions, partyPreferredPositions, ownConfirmedPositions } = input;
  const candidateInputs = candidates.map((heroId) => beliefInputFor(heroId, heroPositions, partyPreferredPositions));
  const heroes: JointAssignmentHeroInput[] = [
    ...ownPicks.map((heroId) => beliefInputFor(heroId, heroPositions, undefined, ownConfirmedPositions?.get(heroId) ?? null)),
    ...candidateInputs,
  ];
  const evidenceByHero = new Map<HeroId, readonly RoleBeliefEvidence[]>(
    candidateInputs.map((entry) => [entry.heroId, entry.belief.evidence]),
  );

  if (heroes.length > 5) {
    // Structurally unreachable in practice (own roster side caps at 5), but the joint-assignment
    // contract itself can reject this input -- degrade rather than let it throw upstream.
    const impactByHero = new Map(candidates.map((heroId) => [heroId, UNRESOLVED_FALLBACK]));
    return { impactByHero, evidenceByHero, degradation: { reason: "ROLE_ASSIGNMENT_IMPOSSIBLE", detail: "más de 5 héroes propios simultáneos" } };
  }

  const result = computeJointRoleAssignment(heroes);
  if (result.rejected === "IMPOSSIBLE_ASSIGNMENT") {
    const impactByHero = new Map(candidates.map((heroId) => [heroId, UNRESOLVED_FALLBACK]));
    return {
      impactByHero,
      evidenceByHero,
      degradation: {
        reason: "ROLE_ASSIGNMENT_IMPOSSIBLE",
        detail: `confirmaciones de posición contradictorias: ${JSON.stringify(result.conflicts ?? [])}`,
      },
    };
  }

  const impactByHero = new Map<HeroId, RecommendationRoleImpact>();
  for (const heroId of candidates) {
    const marginal = result.heroPositionMarginals.get(heroId);
    impactByHero.set(heroId, marginal ? classifyMarginal(marginal, result.entropy) : UNRESOLVED_FALLBACK);
  }
  return { impactByHero, evidenceByHero, degradation: null };
}
