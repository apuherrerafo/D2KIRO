import type { RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { HeroId, RulesetIdentity } from "../draft-protocol/types";
import type { SignalContribution } from "../signals/types";
import type { EvidenceItem, RecommendationRisk, RecommendationRoleImpact } from "./types";

// R1 S5 -- structured, sourced evidence. Every item traces back to a real, already-computed value
// (a V6 SignalContribution, a RoleBeliefEvidence entry, a RulesetIdentity/eligibility hash) --
// never a freestanding string invented at this layer, and never an LLM-authored explanation.

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

/** Reuses V6's OWN already-frozen confidence tiers (mix.ts / SPEC.md §16.7-4: alta >= 0.75,
 * media >= 0.5, baja < 0.5 de evidenceCoverage) -- "baja" IS the low-evidence signal; this
 * function names that fact as a risk instead of re-deriving a second cutoff. */
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
