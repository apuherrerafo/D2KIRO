import type { HeroId, ProtocolDegradationReason, RulesetId, TeamSide } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { DegradationFlag } from "../signals/mix";
import type { SignalContribution, SignalId } from "../signals/types";
import type { DraftDecisionContext } from "../drafter/decision-context";

// R1 S5 -- RecommendationSet/v2 canonical contract. This is the ONE recommendation truth for
// kernel-backed (draft-protocol) sessions: PerspectiveDraftView + legalGameplayActions + S4 role
// primitives + versioned evidence + V6 canonical scoring, converged into one shape. See
// recommendation/build.ts for the pipeline and .kiro/specs/r1-recommendation-v2/design.md for the
// frozen contract this module implements.
//
// V6 (apps/engine/src/signals/mix.ts) stays the only scoring engine -- nothing here re-scores.
// Pro-Drafter (drafter/team-opener.ts) is NOT wired into this module at all: see
// architecture-guard.test.ts, which asserts recommendation/** never imports it.

/** Literal marker for "not computed at all" -- distinct from every S6 sentinel below, which mean
 * "computed, and here is exactly why no concrete response/steal/lookahead exists". Used only when
 * there is no top recommendation to lookahead from at all (empty `recommendations[]`) or when V6
 * itself never ran for our own side (no legal action / computeSuggestions failed) -- see
 * build.ts's `emptyWithoutEvidence`/`empty` helpers, the only two call sites that still produce
 * this literal after S6. */
export const NOT_COMPUTED = "NOT_COMPUTED" as const;
export type NotComputed = typeof NOT_COMPUTED;

// ---------------------------------------------------------------------------------------------
// S6 -- One-Ply Opponent Response + Steal + Counterfactual Lookahead.
//
// Scope: ONE opponent ply, computed for `recommendations[0]` only (the top-ranked candidate) --
// `deferred` is a single set of 4 fields on the SET, not an array keyed per recommendation (that
// is the frozen RecommendationDeferredFields shape S5 already committed to). Bounded by
// construction: at most 2 extra V6 calls per RecommendationSetV2 build (one opponent "baseline"
// call against the CURRENT state, one opponent "after" call against the counterfactual state
// reached by hypothetically applying the top recommendation's own action(s) through the SAME
// ProtocolKernel -- never a second reducer, never a mutation of the real session).
//
// "Plausible", never "probable"/"likely %": no calibrated opponent-behavior model exists. Every
// score below is V6's own canonical model score, reused verbatim from the opponent's own
// perspective -- never converted into, or described as, a probability.
//
// See lookahead.ts for the orchestrator and observation-point.ts/opponent-model.ts/steal.ts for
// the primitives. All four sentinel-carrying literals below share ONE status vocabulary
// (OnePlyStatus) so a caller never has to reconcile two different "why nothing is here" stories
// for the same one-ply attempt.
// ---------------------------------------------------------------------------------------------

export type OnePlyStatus =
  /** A concrete, legal, scored opponent action was found -- see `action`/`score`. */
  | "PLAUSIBLE_RESPONSE"
  /** The counterfactual state has no legal HERO-targeting action for the opponent within one ply
   * (e.g. it is still our own side's turn again -- CM steps 1-2 share the same relative actor --
   * or the opponent's only legal action is a hero-less CM_BAN_SKIPPED). Never fabricated. */
  | "NO_LEGAL_RESPONSE"
  /** Our hypothetical action itself produced a 3rd+ same-hero collision -- the kernel pauses in
   * WAITING_FOR_COLLISION_AUTHORITY. No side has a legal gameplay action until an external
   * authority resolves it, so no opponent response is invented. */
  | "COLLISION_PENDING"
  /** The counterfactual state reached COMPLETE -- no further decision exists for anyone. */
  | "DRAFT_COMPLETE"
  /** The kernel rejected the top recommendation's own hypothetical action while simulating it.
   * Structurally unreachable in practice (build.ts already validated this exact action against
   * the SAME state via postValidateAction before it became `recommendations[0]`), kept as an
   * explicit fail-closed branch rather than letting a kernel rejection throw. */
  | "OWN_ACTION_UNAVAILABLE"
  /** The observation point was reachable and legal, but V6 could not be asked (computeSuggestions
   * threw) or returned no scorable candidate for the opponent's certified universe. */
  | "SIMULATION_UNAVAILABLE";

export interface CounterfactualIdentity {
  /** perspectiveStateHash of the OPPONENT's own view of the counterfactual (post-hypothetical-
   * action) state -- same redaction discipline as basedOn.stateIdentity, computed from the
   * opponent's perspective because that is whose legal/plausible universe this identity covers. */
  stateIdentity: string;
  /** Names WHICH perspective this is (ruleset + opponent side), separate from stateIdentity --
   * same split as identity.ts's own perspectiveIdentity. */
  perspectiveIdentity: string;
  rulesHash: string;
  /** Captain's Mode only -- content hash of the eligibility snapshot governing the opponent's
   * certified universe at the counterfactual point. Null for Ranked All Pick and for CM with no
   * snapshot loaded. */
  eligibilityHash: string | null;
  /** Functional hash of the evidence V6 actually produced for the opponent's "after" call --
   * evidence.ts's evidenceIdentityHash, reused verbatim. Null whenever no opponent V6 call was
   * ever made (NO_LEGAL_RESPONSE / COLLISION_PENDING / DRAFT_COMPLETE / OWN_ACTION_UNAVAILABLE). */
  evidenceIdentity: string | null;
  seed: string | null;
}

export interface OpponentResponse {
  status: OnePlyStatus;
  actor: TeamSide | null;
  action: RecommendationAction | null;
  /** V6's own canonical model score for `action.hero` from the opponent's perspective -- NOT a
   * probability, NOT a percentage. Null whenever `action` is null. */
  score: number | null;
  confidence: "alta" | "media" | "baja" | null;
  evidence: EvidenceItem[];
  basedOnCounterfactualState: CounterfactualIdentity;
}

export type StealStatus =
  | OnePlyStatus
  /** Our candidate action truly removed a hero the opponent's own V6 model already considered a
   * strong baseline candidate -- it is banned/confirmed-picked AND revealed to them now. */
  | "MATERIALIZED"
  /** The hero remains in the opponent's own visible/legal universe after our action (still sealed-
   * but-hidden to them, or simply untouched) -- protocol-real availability, never "probably safe". */
  | "STILL_CONTESTABLE"
  /** Opponent modeling succeeded, but none of our candidate's hero(es) were ever a baseline
   * candidate for the opponent at all (absent from their own V6 ranking before our action). */
  | "NOT_APPLICABLE";

export interface StealEvaluation {
  status: StealStatus;
  heroId: HeroId | null;
  /** V6's own canonical model score for `heroId` from the opponent's perspective BEFORE our
   * candidate action (the CURRENT, unmodified authoritative state) -- null when `heroId` is null
   * or was never scored (absent from the opponent's own baseline ranking). */
  opponentBaselineValue: number | null;
  /** Same, from the opponent's perspective AFTER our candidate action (the counterfactual state).
   * Null when `heroId` is null, or when the hero is genuinely gone from their universe (status
   * MATERIALIZED) -- V6 never scores an already-banned/picked hero, so "gone" IS the absence,
   * never a fabricated 0. */
  afterOurActionValue: number | null;
  /** The concrete action the opponent settles for once `heroId` is gone (status MATERIALIZED) --
   * the SAME object as `opponentResponse.action` when both are computed, never re-derived. */
  displacedResponse: RecommendationAction | null;
  evidence: EvidenceItem[];
}

export interface OnePlyLookahead {
  depth: 1;
  status: OnePlyStatus;
  ourAction: readonly RecommendationAction[];
  /** Same object as the sibling `opponentResponse` field -- restated here because the frozen
   * suggested shape names it as part of the lookahead container, never re-derived. */
  opponentResponse: OpponentResponse | null;
  resultingEvaluation: {
    /** `recommendations[0].score` -- the same S5 number, restated for convenience, never
     * recomputed. */
    ourActionScore: number;
    opponentResponseScore: number | null;
    /** opponentResponseScore - ourActionScore, in canonical V6 model units. Purely descriptive --
     * no threshold/verdict is attached to this number anywhere in this codebase. */
    scoreDelta: number | null;
  } | null;
}

export interface RecommendationDeferredFields {
  opponentResponse: OpponentResponse | NotComputed;
  steal: StealEvaluation | NotComputed;
  lookahead: OnePlyLookahead | NotComputed;
  counterfactual: CounterfactualIdentity | NotComputed;
}

export function deferredFieldsNotComputed(): RecommendationDeferredFields {
  return { opponentResponse: NOT_COMPUTED, steal: NOT_COMPUTED, lookahead: NOT_COMPUTED, counterfactual: NOT_COMPUTED };
}

// ---------------------------------------------------------------------------------------------
// basedOn -- deterministic identity. Two calls with the same rules/state/perspective/evidence
// version/seed produce byte-identical basedOn (and, by construction of build.ts, byte-identical
// recommendations). A change in any of these fields is exactly what "stale recommendation" means.
// ---------------------------------------------------------------------------------------------

export interface RecommendationBasedOn {
  protocolId: RulesetId;
  protocolVersion: string;
  rulesHash: string;
  /** Captain's Mode only (content hash of the loaded eligibility snapshot). Null for Ranked All
   * Pick (no eligibility mechanism exists for it) and for CM with no snapshot loaded yet. */
  heroEligibilityHash: string | null;
  /** perspectiveStateHash(view) -- already redacted for the viewer, already strips volatile keys
   * (sessionId included, see identity-hash.ts's FUNCTIONAL_IDENTITY_EXCLUDED_KEYS). Two structurally
   * identical hidden states (different sessionId, same visible+hidden-shape) hash identically --
   * this IS the "hidden twins identical pre-reveal" property, not a separate mechanism. */
  stateIdentity: string;
  /** Identity of the viewing perspective itself (which side, which ruleset) -- kept separate from
   * stateIdentity so a caller can tell "the rules/side changed" apart from "the draft advanced". */
  perspectiveIdentity: string;
  /** Current game patch, verbatim -- NOT covered by stateIdentity/rulesHash (neither the
   * perspective view nor the ruleset manifest carries the CURRENT patch, only the ruleset's
   * static applicable/verified patch range). Two identical hero arrangements on different patches
   * must be distinguishable: V6 scores against patch-dependent meta data. */
  patch: string;
  /** Canonical identity of the actor's PartyContext (partySize/side/controlled roster-slot
   * indexes) -- null when no PartyContext was ever threaded (legacy/no-party session, fully
   * unrestricted). NOT covered by stateIdentity: PerspectiveDraftView carries no party
   * information at all, so two sessions with identical visible+hidden state but different
   * control structure (e.g. a party controlling 1 of 2 open round slots vs. all of them) would
   * otherwise hash identically despite `decision.controlledSlots`/`actionCount` actually
   * differing between them. Together with stateIdentity + perspectiveIdentity this fully
   * determines `decision` (a pure function of state + party + actor) -- `decision` itself is not
   * separately hashed here to avoid duplicating what these three fields already cover. */
  partyIdentity: string | null;
  /** Names the scoring + evidence mechanism version AND folds in a functional hash of the actual
   * evidence V6 produced for this decision (see evidence.ts's evidenceIdentityHash) -- e.g.
   * "v6-signals/v6+role-belief/v1+calibration:fallback+evidence:<sha256>". Two calls against
   * different meta/curated data that changed what V6 actually returned hash differently here even
   * when state/patch/party/seed are all identical; metadata irrelevant to scoring (computedInMs)
   * never moves it, because evidenceIdentityHash never reads it. */
  evidenceVersion: string;
  /** Caller-supplied determinism seed (diversity tie-break only) -- null when the caller supplied none. */
  seed: string | null;
}

// ---------------------------------------------------------------------------------------------
// decision -- what is actually being decided right now, for `actor`.
// ---------------------------------------------------------------------------------------------

export type RecommendationActionKind = "BAN" | "PICK";

export interface RecommendationSlot {
  side: TeamSide;
  /** Ruleset-specific slot numbering: AP round-scoped open-slot index (types.ts's OpenSlot), or
   * the CM step number for the single CM decision "slot". Never a roster position (0..4) -- see
   * decision.ts's header comment for why that mapping does not exist in the kernel today. */
  slotIndex: number;
}

export interface RecommendationDecision {
  actor: TeamSide;
  /** Null when it is not `actor`'s turn right now -- see degradations for "NO_ACTION_FOR_ACTOR". */
  actionKind: RecommendationActionKind | null;
  /** Coarse ruleset-specific phase label (RankedApPhase | CmPhaseLabel), for display/logging only. */
  phase: string | null;
  /** Ranked All Pick round (1|2|3). Null for Captain's Mode. */
  round: number | null;
  /** Captain's Mode step (1..24). Null for Ranked All Pick. */
  step: number | null;
  /** Every slot currently open AND legal for `actor` right now -- the compound universe. */
  controlledSlots: readonly RecommendationSlot[];
  actionCount: number;
}

// ---------------------------------------------------------------------------------------------
// role impact -- read from S4 (role-belief.ts / joint-assignment.ts), never re-derived.
// ---------------------------------------------------------------------------------------------

export type RoleImpactStatus = "CONFIRMED_FORCED" | "LIKELY" | "UNRESOLVED";

export interface RecommendationRoleImpact {
  status: RoleImpactStatus;
  /** Set iff status !== "UNRESOLVED" and one position carries essentially all the marginal mass
   * (CONFIRMED_FORCED) or is merely favored (LIKELY, hero-only display still preferred by product
   * policy upstream of this module -- S4.5's threshold stays unfrozen here too). */
  position: Position | null;
  marginals: Readonly<Record<Position, number>>;
  entropy: number;
}

// ---------------------------------------------------------------------------------------------
// evidence -- structured, sourced, versioned. Never a bare string as the only truth.
// ---------------------------------------------------------------------------------------------

export interface EvidenceItem {
  source: "v6-signal" | "role-belief" | "protocol-ruleset" | "cm-eligibility" | "opponent-model";
  version: string;
  subject: HeroId | null;
  /** "opponent_model" (S6, opponent-model.ts/steal.ts): V6's canonical score for `subject` from
   * the OPPONENT's own perspective -- structurally distinct from "v6-signal" (which is always
   * OUR OWN side's score) so a consumer can never confuse the two by accident. */
  signal: SignalId | "role_belief" | "ruleset_identity" | "eligibility" | "opponent_model";
  value: number | string | null;
  /** Weighted contribution to score, when this evidence item came from a scored signal. Null for
   * provenance-only evidence (ruleset identity, eligibility, role belief). */
  contribution: number | null;
  reason: string;
}

export interface RecommendationRisk {
  kind: "low_evidence" | "unresolved_role" | "degraded_meta";
  detail: string;
}

export interface RecommendationAction {
  slot: RecommendationSlot;
  hero: HeroId;
}

/** Only populated when `actions.length === 1` -- an honest single-hero projection translate-v1.ts
 * can reuse verbatim (never rescored, never re-derived). Null for compound recommendations: V1 has
 * no compound concept, and inventing a flattening rule would be exactly the kind of silent
 * reinterpretation the V1 translator must never do. */
export interface LegacyProjection {
  hero: HeroId;
  signals: SignalContribution[];
  evidenceCoverage: number;
  guessingIndex: number;
  reason: string;
  decisionContext: DraftDecisionContext;
}

export interface Recommendation {
  actions: readonly RecommendationAction[];
  /** Sum of each action's independently-computed V6 score. NOT a probability -- see build.ts's
   * header comment on why compound scoring is a plain sum, not an invented synergy bonus. */
  score: number;
  /** Categorical, non-probabilistic -- passed through from V6's own `Suggestion.confidence`
   * (single-action) or the lower of the two involved confidences (compound; never invented). */
  confidence: "alta" | "media" | "baja";
  evidence: EvidenceItem[];
  signalsByHero: Readonly<Record<HeroId, readonly SignalContribution[]>>;
  roleImpact: Readonly<Record<HeroId, RecommendationRoleImpact>>;
  risks: readonly RecommendationRisk[];
  /** Every hero in `actions` was checked, at construction time, against the same state's
   * banned/picked/ineligible sets -- see build.ts's postValidate. A Recommendation that failed
   * that check is never constructed, so this field is always `true`; it exists so a consumer can
   * assert on it without re-deriving the check itself. */
  legal: true;
  legacy: LegacyProjection | null;
}

export type RecommendationDegradationReason =
  | ProtocolDegradationReason
  | DegradationFlag
  | "NO_ACTION_FOR_ACTOR"
  | "ROLE_ASSIGNMENT_IMPOSSIBLE"
  | "NO_LEGAL_HERO_UNIVERSE"
  | "SNAPSHOT_UNAVAILABLE";

export interface RecommendationDegradation {
  reason: RecommendationDegradationReason;
  detail: string;
}

export interface RecommendationSetV2 {
  schema: "recommendation-set/v2";
  sessionId: string;
  basedOn: RecommendationBasedOn;
  decision: RecommendationDecision;
  recommendations: readonly Recommendation[];
  degradations: readonly RecommendationDegradation[];
  deferred: RecommendationDeferredFields;
  decisionContext: DraftDecisionContext | "no_action";
}
