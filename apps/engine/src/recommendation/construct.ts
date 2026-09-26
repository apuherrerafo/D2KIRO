import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { isCredibleForPosition, type HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import { deriveRisks, evidenceFromRoleBelief, evidenceFromSignals } from "./evidence";
import { computeRoleImpact } from "./role-impact";
import { buildCompoundCandidates, type ShortlistEntry } from "./shortlist";
import type {
  EvidenceItem,
  Recommendation,
  RecommendationAction,
  RecommendationDegradation,
  RecommendationSlot,
} from "./types";

// R1 S5 -- Recommendation construction (single-action and compound), shared by TWO callers:
//   - build.ts (legacy V2, authoritative state) -- supplies `isLegal` from the kernel's own oracle;
//   - build-from-perspective.ts (Coach path) -- supplies `isLegal` derived from a PerspectiveDraftView.
// This module knows NEITHER: it receives a legality predicate and pre-built context evidence, so it
// can be shared without either caller's information source leaking into the other. It never names an
// authoritative protocol state (recommendation/architecture-guard + coach guard enforce that on the
// perspective path's whole import graph).
//
// Moved verbatim out of build.ts (behaviour-preserving: build.test.ts is the lock). The only change is
// that `postValidateAction(state, hero, eligibleHeroIds, slot)` became `context.isLegal(hero, slot)`
// and the per-hero context evidence (ruleset identity, CM eligibility) is passed in rather than read
// from `state`.

export const RECOMMENDATION_OUTPUT_LIMIT = 5;
/** Simulator recovery preserves all six V6 suggestions; other callers keep the legacy limit. */
export const AP_RECOMMENDATION_OUTPUT_LIMIT = 6;

export interface ConstructContext {
  /** Second, independent legality check immediately before a Recommendation is constructed. */
  isLegal(hero: HeroId, slot: RecommendationSlot): boolean;
  /** Evidence appended after each hero's own evidence (ruleset identity, CM eligibility). */
  contextEvidence: readonly EvidenceItem[];
}

export function pushUniqueDegradation(list: RecommendationDegradation[], entry: RecommendationDegradation): void {
  if (list.some((existing) => existing.reason === entry.reason && existing.detail === entry.detail)) return;
  list.push(entry);
}

function evidenceForHero(
  hero: HeroId,
  signals: ShortlistEntry["suggestion"]["signals"],
  roleEvidence: ReturnType<typeof computeRoleImpact>["evidenceByHero"],
  contextEvidence: readonly EvidenceItem[],
) {
  return [...evidenceFromSignals(hero, signals), ...evidenceFromRoleBelief(hero, roleEvidence.get(hero) ?? []), ...contextEvidence];
}

export function buildSingleRecommendations(
  context: ConstructContext,
  shortlist: readonly ShortlistEntry[],
  ownPicks: readonly HeroId[],
  heroPositions: HeroPositions,
  partyPreferredPositions: readonly Position[] | undefined,
  slot: RecommendationSlot | readonly RecommendationSlot[],
  metaIsStale: boolean,
  suggestionSet: SuggestionSet,
  degradations: RecommendationDegradation[],
  outputLimit = RECOMMENDATION_OUTPUT_LIMIT,
  // Compound-failure fallback only: the single step must still be role-feasible with the own picks already
  // made (a hard gate, exactly like the compound one). Legacy single-seat callers keep their behaviour.
  requireRoleFeasibility = false,
  filterBySlotPosition = true,
): Recommendation[] {
  const candidateSlots: readonly RecommendationSlot[] = Array.isArray(slot) ? slot : [slot];
  const out: Recommendation[] = [];
  for (const entry of shortlist) {
    if (out.length >= outputLimit) break;
    const targetSlot = candidateSlots.find((s) => {
      if (!context.isLegal(entry.hero, s)) return false;
      if (filterBySlotPosition && s.position !== undefined && s.position !== null) {
        return isCredibleForPosition(entry.hero, s.position, heroPositions);
      }
      return true;
    });
    if (!targetSlot) continue;

    const roleImpact = computeRoleImpact({ ownPicks, candidates: [entry.hero], heroPositions, partyPreferredPositions });
    if (roleImpact.degradation) pushUniqueDegradation(degradations, roleImpact.degradation);
    if (requireRoleFeasibility && roleImpact.degradation?.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE") continue;
    const impact = roleImpact.impactByHero.get(entry.hero)!;
    const action: RecommendationAction = { slot: targetSlot, hero: entry.hero };

    out.push({
      actions: [action],
      score: entry.suggestion.score,
      confidence: entry.suggestion.confidence,
      evidence: evidenceForHero(entry.hero, entry.suggestion.signals, roleImpact.evidenceByHero, context.contextEvidence),
      signalsByHero: { [entry.hero]: entry.suggestion.signals },
      roleImpact: { [entry.hero]: impact },
      risks: deriveRisks(entry.suggestion.confidence, [impact], metaIsStale),
      legal: true,
      legacy: {
        hero: entry.hero,
        signals: entry.suggestion.signals,
        evidenceCoverage: entry.suggestion.evidenceCoverage,
        guessingIndex: entry.suggestion.guessingIndex,
        reason: entry.suggestion.reason,
        decisionContext: suggestionSet.decisionContext,
      },
    });
  }
  return out;
}

export function buildCompoundRecommendations(
  context: ConstructContext,
  shortlist: readonly ShortlistEntry[],
  ownPicks: readonly HeroId[],
  heroPositions: HeroPositions,
  partyPreferredPositions: readonly Position[] | undefined,
  slots: readonly RecommendationSlot[],
  metaIsStale: boolean,
  degradations: RecommendationDegradation[],
  outputLimit = RECOMMENDATION_OUTPUT_LIMIT,
): Recommendation[] {
  if (slots.length < 2) return [];
  const [slotA, slotB] = slots;
  const combos = buildCompoundCandidates(shortlist);
  const out: Recommendation[] = [];

  const posA = slotA?.position;
  const posB = slotB?.position;

  for (const combo of combos) {
    if (out.length >= outputLimit) break;
    const [a, b] = combo.entries;
    // Step 1/2 (blocker 4 -- hero uniqueness + per-action legality) BEFORE any role/joint work.
    if (a.hero === b.hero) continue; // structurally unreachable (distinct shortlist entries), kept as an explicit guard

    // Steps 3-5 (blocker 4 -- joint feasibility is a HARD GATE, not a warning): compute the same
    // joint role assignment single-action recommendations already use, and DROP this pair entirely
    // when it rejects as IMPOSSIBLE_ASSIGNMENT. A high-score pair that can never be jointly
    // assigned a position must never be recommendable merely with a caveat attached -- the next,
    // lower-scored-but-feasible pair takes its place because `combos` is already score-sorted
    // (shortlist.ts's buildCompoundCandidates) and this loop simply continues past the rejected one.
    const roleImpact = computeRoleImpact({ ownPicks, candidates: [a.hero, b.hero], heroPositions, partyPreferredPositions });
    if (roleImpact.degradation) {
      pushUniqueDegradation(degradations, roleImpact.degradation);
      if (roleImpact.degradation.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE") continue;
    }

    const directAdmitted = (posA === undefined || posA === null || isCredibleForPosition(a.hero, posA, heroPositions))
      && (posB === undefined || posB === null || isCredibleForPosition(b.hero, posB, heroPositions));

    const swappedAdmitted = (posA === undefined || posA === null || isCredibleForPosition(b.hero, posA, heroPositions))
      && (posB === undefined || posB === null || isCredibleForPosition(a.hero, posB, heroPositions));

    const directLegal = directAdmitted && context.isLegal(a.hero, slotA!) && context.isLegal(b.hero, slotB!);
    const swappedLegal = swappedAdmitted && context.isLegal(b.hero, slotA!) && context.isLegal(a.hero, slotB!);

    if (!directLegal && !swappedLegal) continue;

    const assignedActions: RecommendationAction[] = directLegal
      ? [
          { slot: slotA!, hero: a.hero },
          { slot: slotB!, hero: b.hero },
        ]
      : [
          { slot: slotA!, hero: b.hero },
          { slot: slotB!, hero: a.hero },
        ];
    const impactA = roleImpact.impactByHero.get(a.hero)!;
    const impactB = roleImpact.impactByHero.get(b.hero)!;

    const evidence = [
      ...evidenceForHero(a.hero, a.suggestion.signals, roleImpact.evidenceByHero, context.contextEvidence),
      ...evidenceForHero(b.hero, b.suggestion.signals, roleImpact.evidenceByHero, context.contextEvidence),
    ];

    out.push({
      actions: assignedActions,
      score: combo.score,
      confidence: combo.confidence,
      evidence,
      signalsByHero: { [a.hero]: a.suggestion.signals, [b.hero]: b.suggestion.signals },
      roleImpact: { [a.hero]: impactA, [b.hero]: impactB },
      risks: deriveRisks(combo.confidence, [impactA, impactB], metaIsStale),
      legal: true,
      legacy: null,
    });
  }
  return out;
}
