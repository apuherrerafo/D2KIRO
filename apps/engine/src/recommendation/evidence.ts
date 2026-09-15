import { rulesHash } from "../draft-protocol";
import type { RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { HeroId, RulesetIdentity } from "../draft-protocol/types";
import type { SignalContribution } from "../signals/types";
import type { EvidenceItem, RecommendationRisk, RecommendationRoleImpact } from "./types";

const EVIDENCE_VERSION_V6_SIGNAL = "v6-signals/v6";
const EVIDENCE_VERSION_ROLE_BELIEF = "role-belief/v1";
const EVIDENCE_VERSION_PROTOCOL = "draft-protocol/v1";

export function evidenceFromSignals(hero: HeroId, signals: readonly SignalContribution[]): EvidenceItem[] {
  return signals.map((signal) => ({
    source: "v6-signal",
    version: EVIDENCE_VERSION_V6_SIGNAL,
    subject: hero,
    signal: signal.signal,
    value: signal.raw ?? signal.normalized ?? null,
    contribution: signal.weighted,
    reason: signal.explanation,
  }));
}

export function evidenceFromRoleBelief(hero: HeroId, entries: readonly RoleBeliefEvidence[]): EvidenceItem[] {
  return entries.map((entry) => ({
    source: "role-belief",
    version: EVIDENCE_VERSION_ROLE_BELIEF,
    subject: hero,
    signal: "role_belief",
    value: entry.kind,
    contribution: null,
    reason: entry.detail,
  }));
}

export function evidenceFromRuleset(ruleset: RulesetIdentity): EvidenceItem {
  return {
    source: "protocol-ruleset",
    version: EVIDENCE_VERSION_PROTOCOL,
    subject: null,
    signal: "ruleset_identity",
    value: ruleset.rulesHash,
    contribution: null,
    reason: `${ruleset.id}@${ruleset.version} (patches ${ruleset.applicableFromPatch}..${ruleset.verifiedThroughPatch})`,
  };
}

export function evidenceFromEligibility(contentHash: string, heroCount: number): EvidenceItem {
  return {
    source: "cm-eligibility",
    version: "cm-hero-eligibility/v1",
    subject: null,
    signal: "eligibility",
    value: contentHash,
    contribution: null,
    reason: `snapshot certificado con ${heroCount} héroes elegibles`,
  };
}

/**
 * Canonical inputs used by V6 before any final suggestion is ranked, selected, or rendered.
 * `mix.ts` builds this descriptor from scorer/opening inputs and attaches it non-enumerably to
 * its internal SuggestionSet transport. The hash API deliberately cannot accept a SuggestionSet:
 * final rank, score, selected hero, confidence, degradation, and final reason are not identity
 * material and cannot be introduced by accident.
 */
export interface FunctionalRecommendationEvidence {
  metaIsStale: boolean;
  signalEvidence: readonly {
    hero: HeroId;
    signals: readonly {
      signal: string;
      raw: number | null;
      normalized: number | null;
      evidenceConfidence: number | null;
      explanation: string;
      sampleSize: number;
      applicable: boolean | null;
    }[];
  }[];
  /** Inputs used by flex reasons and role impact. `matches` is functional because it orders
   * flex explanations and changes role beliefs. */
  heroPositions: readonly { hero: HeroId; positions: readonly { position: number; matches: number }[] }[];
  /** Direct inputs of the empty-board team-opening policy, never its resulting score/order/text. */
  teamOpening: {
    heroCapabilities: readonly {
      hero: HeroId;
      damageType: string;
      hasInitiation: boolean;
      hasCatch: boolean;
      hasWaveclear: boolean;
      structuralDamage: string;
      teamfight: string;
      scaling: string;
    }[];
    matchups: readonly { hero: HeroId; vsHero: HeroId; games: number; wins: number }[];
    curatedCounters: readonly { hero: HeroId; vsHero: HeroId; level: string; why: string }[];
    heroNames: readonly { hero: HeroId; name: string }[];
  } | null;
  /** Consumed after V6 by role-impact.ts. */
  partyPreferredPositions: readonly number[];
}

function byHero<T extends { hero: HeroId }>(a: T, b: T): number {
  return a.hero - b.hero;
}

/** Hashes only canonical functional inputs. */
export function evidenceIdentityHash(evidence: FunctionalRecommendationEvidence): string {
  return rulesHash({
    metaIsStale: evidence.metaIsStale,
    signalEvidence: evidence.signalEvidence
      .map((candidate) => ({ ...candidate, signals: [...candidate.signals].sort((a, b) => a.signal.localeCompare(b.signal)) }))
      .sort(byHero),
    heroPositions: evidence.heroPositions
      .map((entry) => ({ ...entry, positions: [...entry.positions].sort((a, b) => a.position - b.position || a.matches - b.matches) }))
      .sort(byHero),
    teamOpening: evidence.teamOpening && {
      heroCapabilities: [...evidence.teamOpening.heroCapabilities].sort(byHero),
      matchups: [...evidence.teamOpening.matchups].sort((a, b) => a.hero - b.hero || a.vsHero - b.vsHero || a.games - b.games || a.wins - b.wins),
      curatedCounters: [...evidence.teamOpening.curatedCounters].sort((a, b) => a.hero - b.hero || a.vsHero - b.vsHero || a.level.localeCompare(b.level) || a.why.localeCompare(b.why)),
      heroNames: [...evidence.teamOpening.heroNames].sort(byHero),
    },
    partyPreferredPositions: [...evidence.partyPreferredPositions].sort((a, b) => a - b),
  });
}

/** Reuses V6's own frozen confidence tiers; this names existing evidence as a risk without
 * creating a second cutoff. */
export function deriveRisks(
  confidence: "alta" | "media" | "baja",
  roleImpacts: readonly RecommendationRoleImpact[],
  metaIsStale: boolean,
): RecommendationRisk[] {
  const risks: RecommendationRisk[] = [];
  if (confidence === "baja") risks.push({ kind: "low_evidence", detail: "evidenceCoverage baja en la señal V6 subyacente" });
  if (roleImpacts.some((impact) => impact.status === "UNRESOLVED")) {
    risks.push({ kind: "unresolved_role", detail: "sin evidencia de posición para al menos un héroe de la acción" });
  }
  if (metaIsStale) risks.push({ kind: "degraded_meta", detail: "meta snapshot stale (stale_meta)" });
  return risks;
}
