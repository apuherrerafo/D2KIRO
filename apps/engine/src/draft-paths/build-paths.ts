import type { DraftState, HeroId } from "../draft/reducer";
import type { MetaSnapshot } from "../signals/types";
import { capabilitiesByHero, detectDraftGaps, filledGaps, levelScore, ownCapabilities } from "./gaps";
import type { DamageType, DraftCapabilityGap, DraftPath, DraftPathArchetype, DraftPathSet, DraftPathStep, HeroCapabilities } from "./types";

const MAX_PATHS = 3;
const MAX_FOLLOW_UPS = 2;
const MIN_PATH_SCORE = 3;

const PATH_LABELS: Record<DraftPathArchetype, DraftPath["label"]> = {
  push: "Push",
  teamfight: "Teamfight",
  pickoff: "Pickoff",
  scaling: "Scaling",
};

const PATH_PRIORITIES: Record<DraftPathArchetype, Partial<Record<DraftCapabilityGap, number>>> = {
  push: { structural_damage: 3, waveclear: 2, catch: 1 },
  teamfight: { initiation: 3, teamfight: 3, damage_mix: 1 },
  pickoff: { catch: 3, initiation: 2 },
  scaling: { scaling: 3, waveclear: 1, damage_mix: 1 },
};

const PATH_ORDER: DraftPathArchetype[] = ["push", "teamfight", "pickoff", "scaling"];

const GAP_LABELS: Record<DraftCapabilityGap, string> = {
  initiation: "initiation",
  catch: "catch",
  waveclear: "waveclear",
  structural_damage: "daño a estructuras",
  teamfight: "teamfight",
  scaling: "scaling",
  damage_mix: "mezcla de daño",
};

function takenHeroes(state: DraftState): Set<HeroId> {
  return new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
}

function archetypeFitBonus(archetype: DraftPathArchetype, candidate: HeroCapabilities): number {
  if (archetype === "push") return levelScore(candidate.structuralDamage);
  if (archetype === "teamfight") return levelScore(candidate.teamfight);
  if (archetype === "pickoff") return (candidate.hasCatch ? 2 : 0) + (candidate.hasInitiation ? 1 : 0);
  return levelScore(candidate.scaling);
}

function scoreCandidate(
  archetype: DraftPathArchetype,
  candidate: HeroCapabilities,
  gaps: DraftCapabilityGap[],
  ownDamageTypes: DamageType[],
): DraftPathStep {
  const fills = filledGaps(candidate, gaps, ownDamageTypes);
  const priority = PATH_PRIORITIES[archetype];
  const score = fills.reduce((sum, gap) => sum + (priority[gap] ?? 0), 0) + archetypeFitBonus(archetype, candidate);
  return {
    hero: candidate.hero,
    score,
    fills,
    reasons: fills.map((gap) => `Cubre ${GAP_LABELS[gap]}`),
  };
}

function buildReason(archetype: DraftPathArchetype, step: DraftPathStep): string {
  const firstFill = step.fills[0];
  if (!firstFill) return `Camino ${PATH_LABELS[archetype]}: este pick mantiene abierta esa win condition.`;
  return `Camino ${PATH_LABELS[archetype]}: le falta al draft ${GAP_LABELS[firstFill]}, este pick lo resuelve.`;
}

function candidateCapabilities(state: DraftState, meta: MetaSnapshot, capabilities: HeroCapabilities[]): HeroCapabilities[] {
  const taken = takenHeroes(state);
  const byHero = capabilitiesByHero(capabilities);
  return Object.keys(meta.heroes)
    .map((id) => byHero.get(Number(id)))
    .filter((entry): entry is HeroCapabilities => entry !== undefined && !taken.has(entry.hero));
}

function buildPath(
  archetype: DraftPathArchetype,
  candidates: HeroCapabilities[],
  gaps: DraftCapabilityGap[],
  ownDamageTypes: DamageType[],
): DraftPath | null {
  const steps = candidates
    .map((candidate) => scoreCandidate(archetype, candidate, gaps, ownDamageTypes))
    .filter((step) => step.score >= MIN_PATH_SCORE && step.fills.length > 0)
    .sort((a, b) => b.score - a.score || a.hero - b.hero);

  const nextPick = steps[0];
  if (!nextPick) return null;
  return {
    archetype,
    label: PATH_LABELS[archetype],
    score: nextPick.score,
    missing: gaps.filter((gap) => PATH_PRIORITIES[archetype][gap] !== undefined),
    nextPick,
    followUps: steps.slice(1, MAX_FOLLOW_UPS + 1),
    reason: buildReason(archetype, nextPick),
  };
}

export function buildDraftPaths(state: DraftState, meta: MetaSnapshot, capabilities: HeroCapabilities[]): DraftPathSet {
  const startedAt = performance.now();
  if (state.localSide === "unknown") {
    return { schema: "draft-paths/v1", sessionId: state.sessionId, basedOnSeq: state.lastSeq, paths: [], computedInMs: 0 };
  }

  const gaps = detectDraftGaps(state, capabilities);
  const ownDamageTypes = ownCapabilities(state, capabilities).map((entry) => entry.damageType);
  const candidates = candidateCapabilities(state, meta, capabilities);
  const paths = PATH_ORDER.map((archetype) => buildPath(archetype, candidates, gaps, ownDamageTypes))
    .filter((path): path is DraftPath => path !== null)
    .sort((a, b) => b.score - a.score || PATH_ORDER.indexOf(a.archetype) - PATH_ORDER.indexOf(b.archetype))
    .slice(0, MAX_PATHS);

  return {
    schema: "draft-paths/v1",
    sessionId: state.sessionId,
    basedOnSeq: state.lastSeq,
    paths,
    computedInMs: Math.max(0, Math.round(performance.now() - startedAt)),
  };
}
