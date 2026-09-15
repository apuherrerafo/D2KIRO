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

/** S6 (lookahead/opponent-modeling) is out of scope for this slice. Every deferred field carries
 * this exact literal -- never `null`, never a fabricated number -- so a consumer can never mistake
 * "not built yet" for "computed and empty/zero". */
export const NOT_COMPUTED = "NOT_COMPUTED" as const;
export type NotComputed = typeof NOT_COMPUTED;

export interface RecommendationDeferredFields {
  opponentResponse: NotComputed;
  steal: NotComputed;
  lookahead: NotComputed;
  counterfactual: NotComputed;
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
  source: "v6-signal" | "role-belief" | "protocol-ruleset" | "cm-eligibility";
  version: string;
  subject: HeroId | null;
  signal: SignalId | "role_belief" | "ruleset_identity" | "eligibility";
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
