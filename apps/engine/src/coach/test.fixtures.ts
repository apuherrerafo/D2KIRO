import type { PerspectiveDraftView, PerspectiveHeroSlot } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type {
  Recommendation,
  RecommendationBasedOn,
  RecommendationDegradation,
  RecommendationRoleImpact,
  RecommendationSetV2,
  RoleImpactStatus,
} from "../recommendation/types";
import { deferredFieldsNotComputed } from "../recommendation/types";
import type { SignalContribution, SignalId } from "../signals/types";

// Inline fixtures for coach/** tests. Nothing here reads a curated dataset, a SQLite or the network.

export const known = (heroId: number): PerspectiveHeroSlot => ({ visibility: "KNOWN", heroId });
export const revealed = (heroId: number): PerspectiveHeroSlot => ({ visibility: "REVEALED", heroId });
export const hidden = (): PerspectiveHeroSlot => ({ visibility: "HIDDEN" });

export function view(
  phase: "PICK_ROUND_1" | "PICK_ROUND_2" | "PICK_ROUND_3",
  own: PerspectiveHeroSlot[],
  enemy: PerspectiveHeroSlot[],
  bans: number[] = [],
  side: "radiant" | "dire" = "radiant",
): PerspectiveDraftView {
  return {
    schema: "draft-protocol-perspective/v1",
    sessionId: "coach-fixture",
    ruleset: { id: "dota2/ranked-all-pick" } as PerspectiveDraftView["ruleset"],
    status: "ACTIVE",
    degradation: null,
    viewerSide: side,
    bannedHeroes: bans,
    ownPicks: own,
    enemyPicks: enemy,
    rankedAp: { phase, banResolutionComplete: true },
    captainsMode: null,
  };
}

export function signal(id: SignalId, raw: number | null, weighted: number, extra: Partial<SignalContribution> = {}): SignalContribution {
  return {
    signal: id,
    raw,
    normalized: raw === null ? null : extra.normalized ?? 80,
    evidenceConfidence: raw === null ? 0 : 1,
    weighted,
    explanation: `${id} fixture`,
    sampleSize: raw === null ? 0 : 100,
    ...extra,
  };
}

/** Marginals: `main` gets 0.8, the rest split the remainder. */
export function resolvedImpact(position: Position, status: RoleImpactStatus = "LIKELY"): RecommendationRoleImpact {
  const marginals = { 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.05 } as Record<Position, number>;
  marginals[position] = 0.8;
  return { status, position, marginals, entropy: 1 };
}

/** A hero spread over `positions` (equal shares), UNRESOLVED -- genuinely Flex. */
export function flexImpact(positions: Position[]): RecommendationRoleImpact {
  const marginals = { 1: 0.02, 2: 0.02, 3: 0.02, 4: 0.02, 5: 0.02 } as Record<Position, number>;
  for (const position of positions) marginals[position] = 0.9 / positions.length;
  return { status: "UNRESOLVED", position: null, marginals, entropy: 2 };
}

/** No position evidence at all (neutral prior). */
export function neutralImpact(): RecommendationRoleImpact {
  return { status: "UNRESOLVED", position: null, marginals: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 }, entropy: Math.log2(5) };
}

export interface HeroFixture {
  heroId: number;
  signals: SignalContribution[];
  impact: RecommendationRoleImpact;
  confidence?: "alta" | "media" | "baja";
}

/** A single-hero V2 recommendation. */
export function singleRec(hero: HeroFixture, slotIndex = 0): Recommendation {
  const score = hero.signals.reduce((sum, entry) => sum + entry.weighted, 0);
  return {
    actions: [{ slot: { side: "radiant", slotIndex }, hero: hero.heroId }],
    score,
    confidence: hero.confidence ?? "alta",
    evidence: [],
    signalsByHero: { [hero.heroId]: hero.signals },
    roleImpact: { [hero.heroId]: hero.impact },
    risks: [],
    legal: true,
    legacy: null,
  };
}

export function basedOn(stateIdentity = "state-A"): RecommendationBasedOn {
  return {
    protocolId: "dota2/ranked-all-pick",
    protocolVersion: "1",
    rulesHash: "rules",
    heroEligibilityHash: null,
    stateIdentity,
    perspectiveIdentity: "perspective",
    patch: "7.41e",
    partyIdentity: null,
    evidenceVersion: "evidence-1",
    seed: null,
  };
}

export function recSet(
  heroes: HeroFixture[],
  options: { degradations?: RecommendationDegradation[]; stateIdentity?: string } = {},
): RecommendationSetV2 {
  return {
    schema: "recommendation-set/v2",
    sessionId: "coach-fixture",
    basedOn: basedOn(options.stateIdentity),
    decision: { actor: "radiant", actionKind: "PICK", phase: "PICK_ROUND_1", round: 1, step: null, controlledSlots: [{ side: "radiant", slotIndex: 0 }], actionCount: 1 },
    recommendations: heroes.map((hero, index) => singleRec(hero, index)),
    degradations: options.degradations ?? [],
    deferred: deferredFieldsNotComputed(),
    decisionContext: "team_opening",
  };
}

/** A hero whose ONLY real evidence is `position_fit` (role-level evidence, nothing hero-specific). */
export function roleOnlyHero(heroId: number, position: Position, weighted = 10): HeroFixture {
  return { heroId, signals: [signal("position_fit", 0.7, weighted), signal("counter", null, 0), signal("patch_meta", null, 0)], impact: resolvedImpact(position) };
}
