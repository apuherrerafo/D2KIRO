import { isSealedSelectionLegal } from "../draft-protocol";
import { derivePerspectiveSuggestionInputs, perspectiveToLegacyDraftState } from "../draft-protocol/adapters/suggestion-bridge";
import type { DraftProtocolState, HeroId, PerspectiveDraftView, TeamSide } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { loadHeroPositions, type HeroPositions } from "../signals/hero-positions";
import type { SuggestionSet } from "../signals/mix";
import type { DraftState } from "../draft/reducer";
import { buildBasedOn } from "./identity";
import { deriveLegalDecision } from "./decision";
import { computeRoleImpact } from "./role-impact";
import { buildCompoundCandidates, buildShortlist, type ShortlistEntry } from "./shortlist";
import {
  deriveRisks,
  evidenceFromEligibility,
  evidenceFromRoleBelief,
  evidenceFromRuleset,
  evidenceFromSignals,
  evidenceIdentityHash,
} from "./evidence";
import { deferredFieldsNotComputed } from "./types";
import type {
  Recommendation,
  RecommendationAction,
  RecommendationDegradation,
  RecommendationRoleImpact,
  RecommendationSetV2,
  RecommendationSlot,
} from "./types";

// R1 S5 -- RecommendationSet/v2 canonical builder. Pipeline (mandated end to end):
//
//   PerspectiveDraftView + legalGameplayActions (decision.ts)
//     -> shortlist of legal heroes ranked by V6 (shortlist.ts, over the SAME suggestion-bridge
//        seam S2 already built for exactly this purpose)
//     -> role impact (role-impact.ts, over S4's joint-assignment primitive)
//     -> evidence (evidence.ts)
//     -> RecommendationSetV2 (this file)
//
// LEGAL ACTION FIRST: decision.ts's `eligibleHeroIds` (Captain's Mode) or `null` (unrestricted,
// Ranked All Pick) is intersected against V6's ranked output BEFORE anything is scored further --
// V6 is never asked to "rank everything, filter later". `postValidateAction` below is the second,
// independent check against the same authoritative `state` immediately before a Recommendation is
// constructed -- a Recommendation that fails it is silently dropped (never constructed), so a
// caller can never observe an illegal action here even if a bug elsewhere in this file computed
// one. V6 stays the ONLY scoring engine: this module ranks the same shortlist V6 already ordered,
// never re-scores, and never imports drafter/team-opener.ts (Pro-Drafter) -- see
// architecture-guard.test.ts.
//
// Compound scoring (actionCount > 1, i.e. Ranked All Pick rounds 1/2 with two simultaneous
// slots for the same side) is a PLAIN SUM of each hero's independently-computed V6 score. V6 has
// no "score these two heroes as one simultaneous pick" primitive, and adding an invented synergy
// bonus here would be exactly the kind of unfrozen business threshold the contract forbids. Role
// impact (role-impact.ts) IS computed jointly for the pair (that primitive already exists in S4)
// and reported on the Recommendation for the caller to see -- it never feeds back into `score`.
//
// Determinism: no `Date.now()`, no unseeded `Math.random()`, anywhere in this module or its
// dependents (shortlist.ts, role-impact.ts, decision.ts, identity.ts, evidence.ts) -- verified by
// architecture-guard.test.ts. The only source of intentional variation is the caller-supplied
// `seed`, threaded to V6's own `diversitySeed` and nowhere else.

export const RECOMMENDATION_OUTPUT_LIMIT = 5;

/** Structurally compatible with routes/protocol-sessions.ts's `ComputeSuggestionsForDraftState` --
 * intentionally not imported from there, to avoid a route -> recommendation -> route cycle. */
export type ComputeSuggestionsForRecommendation = (
  state: DraftState,
  accountId: null,
  options?: { teamOpening?: boolean; diversitySeed?: string; candidateHeroIds?: readonly HeroId[] },
) => Promise<SuggestionSet>;

export interface BuildRecommendationSetV2Input {
  state: DraftProtocolState;
  /** MUST be `project(state, actor)` -- the caller's own perspective, never a spectator/opponent
   * view. Accepted as an argument (not recomputed here) so callers that already hold it (routes,
   * ProtocolSessionStore.view) never pay for projecting twice. */
  view: PerspectiveDraftView;
  actor: TeamSide;
  patch: string;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  heroPositions?: HeroPositions;
  /** Whether V6 ran with empirical calibration or the fallback range -- folds into
   * basedOn.evidenceVersion. Defaults to "fallback": no caller in this codebase passes
   * `calibration` to buildSuggestions today (Fase 9.1, TSK-213's own measured decision), so
   * "fallback" is the honest default, not a guess. */
  calibrationMode?: "fallback" | "empirical";
  /** Determinism seed, threaded to V6's diversitySeed only. Omit for a purely stable order. */
  seed?: string;
  /** Soft preference for whoever is requesting this recommendation -- applies to every candidate
   * hero equally. See role-impact.ts's RoleImpactInput doc for why no per-slot mapping exists. */
  partyPreferredPositions?: readonly Position[];
}

function pushUniqueDegradation(list: RecommendationDegradation[], entry: RecommendationDegradation): void {
  if (list.some((existing) => existing.reason === entry.reason && existing.detail === entry.detail)) return;
  list.push(entry);
}

function excludedHeroes(legacyState: DraftState): Set<HeroId> {
  return new Set([...legacyState.banned, ...legacyState.picks.radiant, ...legacyState.picks.dire]);
}

/** Second, independent legality check against the SAME authoritative state a Recommendation is
 * about to be built from -- deliberately re-derives legality from `state` directly rather than
 * trusting `excludedHeroes(legacyState)` (the suggestion-bridge projection), so a bridging bug
 * cannot silently produce an illegal Recommendation.
 *
 * Blocker 2 (independent architecture review, hidden noninterference): the Ranked All Pick branch
 * used to also treat EVERY currently-sealed hero (both sides, including the opponent's
 * hidden-but-unrevealed selection) as "taken". That is wrong on two counts at once: it is not what
 * the kernel itself enforces (rulesets/ranked-all-pick.ts's own `heroAlreadyTaken` only checks
 * banned + CONFIRMED picks -- a same-hero collision between sides is legal, resolved later at
 * round close), and it let a hidden enemy sealed hero silently change which Recommendations this
 * side sees, purely through presence/absence, before that hero was ever revealed -- a real
 * information leak through an observable side channel. `isSealedSelectionLegal` is the kernel's
 * own per-heroId oracle for this exact slot; reusing it verbatim (instead of re-deriving a second,
 * divergent predicate here) makes it structurally impossible for this check to be either more
 * restrictive OR more permissive than the kernel's own SUBMIT_SEALED_SELECTION acceptance. */
function postValidateAction(
  state: DraftProtocolState,
  heroId: HeroId,
  eligibleHeroIds: readonly HeroId[] | null,
  slot: RecommendationSlot,
): boolean {
  if (eligibleHeroIds !== null && !eligibleHeroIds.includes(heroId)) return false;
  if (state.rankedAp) {
    return isSealedSelectionLegal(state, slot.side, slot.slotIndex, heroId);
  }
  if (state.captainsMode) {
    // Captain's Mode has no hidden information at all (perspective.ts's own contract: CM picks/
    // bans are immediately REVEALED) -- banned/picked here can never include anything the actor
    // couldn't already see, so no analogous leak exists on this branch.
    const cm = state.captainsMode;
    return !cm.bannedHeroes.includes(heroId) && !cm.picks.radiant.includes(heroId) && !cm.picks.dire.includes(heroId);
  }
  return false;
}

function evidenceForHero(
  hero: HeroId,
  signals: ShortlistEntry["suggestion"]["signals"],
  roleEvidence: ReturnType<typeof computeRoleImpact>["evidenceByHero"],
  state: DraftProtocolState,
) {
  const items = [...evidenceFromSignals(hero, signals), ...evidenceFromRoleBelief(hero, roleEvidence.get(hero) ?? [])];
  items.push(evidenceFromRuleset(state.ruleset));
  if (state.captainsMode?.eligibilitySnapshot) {
    items.push(evidenceFromEligibility(state.captainsMode.eligibilitySnapshot.contentHash, state.captainsMode.eligibilitySnapshot.heroIds.length));
  }
  return items;
}

export async function buildRecommendationSetV2(input: BuildRecommendationSetV2Input): Promise<RecommendationSetV2> {
  const { state, view, actor, patch, computeSuggestions, seed, partyPreferredPositions } = input;
  const heroPositions = input.heroPositions ?? MODULE_HERO_POSITIONS;
  const calibrationMode = input.calibrationMode ?? "fallback";

  const legal = deriveLegalDecision(state, actor);
  const degradations: RecommendationDegradation[] = [...legal.degradations];
  const eligibilitySnapshot = state.captainsMode?.eligibilitySnapshot ?? null;
  // Blocker 6 (independent architecture review) -- identity inputs shared by every basedOn built
  // below. `partyContext` only exists at the kernel-state level for Ranked All Pick (Captain's
  // Mode carries no party slot in CmState); CM decisions are always single-action regardless of
  // party, so `null` there is correct, not a gap.
  const identityInputs = {
    view,
    eligibilitySnapshot,
    calibrationMode,
    seed: seed ?? null,
    patch,
    partyContext: state.rankedAp?.partyContext ?? null,
  };
  // No evidence has been computed yet at this point -- used for every return that never reaches
  // computeSuggestions (no legal action) or where computeSuggestions itself failed.
  const basedOnWithoutEvidence = buildBasedOn({ ...identityInputs, evidenceHash: null });

  const emptyWithoutEvidence = (decisionContext: RecommendationSetV2["decisionContext"]): RecommendationSetV2 => ({
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn: basedOnWithoutEvidence,
    decision: legal.decision,
    recommendations: [],
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext,
  });

  if (legal.decision.actionCount === 0) return emptyWithoutEvidence("no_action");

  const legacyState = perspectiveToLegacyDraftState(view, { patch });
  let suggestionSet: SuggestionSet;
  try {
    // teamOpening: true -- a kernel-backed session is by construction a captain drafting for a
    // whole roster (accountId is always null on this path), never one logged-in user's own pick;
    // this excludes V6's hero_pool_fit signal exactly like the simulator's own team-opening calls
    // already do (mix.ts's own doc on `options.teamOpening`), rather than scoring against a
    // personal pool that has no meaning here. Blocker 3: `candidateHeroIds` is the kernel's own
    // certified legal universe (null = unrestricted, Ranked All Pick) -- V6 ranks ONLY that
    // universe, never the global catalog filtered after the fact (see mix.ts's candidatePool).
    suggestionSet = await computeSuggestions(legacyState, null, {
      teamOpening: true,
      diversitySeed: seed,
      candidateHeroIds: legal.eligibleHeroIds ?? undefined,
    });
  } catch {
    pushUniqueDegradation(degradations, { reason: "SNAPSHOT_UNAVAILABLE", detail: "computeSuggestions falló; sin datos de meta disponibles" });
    return emptyWithoutEvidence("no_action");
  }
  for (const flag of suggestionSet.degraded) pushUniqueDegradation(degradations, { reason: flag, detail: `V6 degraded flag: ${flag}` });

  // Blocker 7: evidence was actually computed now -- every return from here on reflects it.
  const basedOn = buildBasedOn({ ...identityInputs, evidenceHash: evidenceIdentityHash(suggestionSet) });
  const empty = (decisionContext: RecommendationSetV2["decisionContext"]): RecommendationSetV2 => ({
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn,
    decision: legal.decision,
    recommendations: [],
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext,
  });

  const shortlist = buildShortlist(suggestionSet, legal.eligibleHeroIds, excludedHeroes(legacyState));
  if (shortlist.length === 0) {
    pushUniqueDegradation(degradations, { reason: "NO_LEGAL_HERO_UNIVERSE", detail: "ningún héroe legal quedó en el shortlist tras intersectar con la elegibilidad certificada" });
    return empty("no_action");
  }

  const ownPicks = derivePerspectiveSuggestionInputs(view).ownPicks;
  const metaIsStale = suggestionSet.degraded.includes("stale_meta");
  const sortedControlledSlots = [...legal.decision.controlledSlots].sort((a, b) => a.slotIndex - b.slotIndex);

  const recommendations: Recommendation[] =
    legal.decision.actionCount >= 2
      ? buildCompoundRecommendations(state, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots, legal.eligibleHeroIds, metaIsStale, degradations)
      : buildSingleRecommendations(state, shortlist, ownPicks, heroPositions, partyPreferredPositions, sortedControlledSlots[0]!, legal.eligibleHeroIds, metaIsStale, suggestionSet, degradations);

  if (recommendations.length === 0) {
    pushUniqueDegradation(degradations, { reason: "NO_LEGAL_HERO_UNIVERSE", detail: "el shortlist no sobrevivió la post-validación final contra el estado" });
    return empty("no_action");
  }

  return {
    schema: "recommendation-set/v2",
    sessionId: view.sessionId,
    basedOn,
    decision: legal.decision,
    recommendations,
    degradations,
    deferred: deferredFieldsNotComputed(),
    decisionContext: suggestionSet.decisionContext,
  };
}

function buildSingleRecommendations(
  state: DraftProtocolState,
  shortlist: readonly ShortlistEntry[],
  ownPicks: readonly HeroId[],
  heroPositions: HeroPositions,
  partyPreferredPositions: readonly Position[] | undefined,
  slot: RecommendationSlot,
  eligibleHeroIds: readonly HeroId[] | null,
  metaIsStale: boolean,
  suggestionSet: SuggestionSet,
  degradations: RecommendationDegradation[],
): Recommendation[] {
  const out: Recommendation[] = [];
  for (const entry of shortlist) {
    if (out.length >= RECOMMENDATION_OUTPUT_LIMIT) break;
    if (!postValidateAction(state, entry.hero, eligibleHeroIds, slot)) continue;

    const roleImpact = computeRoleImpact({ ownPicks, candidates: [entry.hero], heroPositions, partyPreferredPositions });
    if (roleImpact.degradation) pushUniqueDegradation(degradations, roleImpact.degradation);
    const impact = roleImpact.impactByHero.get(entry.hero)!;
    const action: RecommendationAction = { slot, hero: entry.hero };

    out.push({
      actions: [action],
      score: entry.suggestion.score,
      confidence: entry.suggestion.confidence,
      evidence: evidenceForHero(entry.hero, entry.suggestion.signals, roleImpact.evidenceByHero, state),
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

function buildCompoundRecommendations(
  state: DraftProtocolState,
  shortlist: readonly ShortlistEntry[],
  ownPicks: readonly HeroId[],
  heroPositions: HeroPositions,
  partyPreferredPositions: readonly Position[] | undefined,
  slots: readonly RecommendationSlot[],
  eligibleHeroIds: readonly HeroId[] | null,
  metaIsStale: boolean,
  degradations: RecommendationDegradation[],
): Recommendation[] {
  if (slots.length < 2) return [];
  const [slotA, slotB] = slots;
  const combos = buildCompoundCandidates(shortlist);
  const out: Recommendation[] = [];

  for (const combo of combos) {
    if (out.length >= RECOMMENDATION_OUTPUT_LIMIT) break;
    const [a, b] = combo.entries;
    // Step 1/2 (blocker 4 -- hero uniqueness + per-action legality) BEFORE any role/joint work.
    if (a.hero === b.hero) continue; // structurally unreachable (distinct shortlist entries), kept as an explicit guard
    if (!postValidateAction(state, a.hero, eligibleHeroIds, slotA!) || !postValidateAction(state, b.hero, eligibleHeroIds, slotB!)) continue;

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
    const impactA = roleImpact.impactByHero.get(a.hero)!;
    const impactB = roleImpact.impactByHero.get(b.hero)!;

    const evidence = [
      ...evidenceForHero(a.hero, a.suggestion.signals, roleImpact.evidenceByHero, state),
      ...evidenceForHero(b.hero, b.suggestion.signals, roleImpact.evidenceByHero, state),
    ];

    out.push({
      // Deterministic-but-arbitrary convention: higher-scored hero fills the lower-numbered open
      // slot. The kernel treats both open slots as interchangeable (isSealedSelectionLegal has no
      // hero-specific slot semantics) -- there is no "correct" assignment to recover here, only a
      // stable one.
      actions: [
        { slot: slotA!, hero: a.hero },
        { slot: slotB!, hero: b.hero },
      ],
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

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
