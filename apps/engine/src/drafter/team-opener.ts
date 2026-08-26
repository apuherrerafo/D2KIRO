import type { HeroId } from "../draft/reducer";

const MIN_MATCHUP_GAMES = 200;
const MAX_COUNTER_RELIEF = 0.12;
const REPEAT_STRATEGY_PENALTY = 0.04;

export interface TeamOpenerMatchup {
  vsHero: HeroId;
  games: number;
  wins: number;
}

// `strategy` no es un rol ni una posición individual. Es una etiqueta de plan de equipo que
// permite ofrecer aperturas realmente distintas sin asumir desde el primer pick quién jugará qué.
export interface TeamOpenerCandidate {
  hero: HeroId;
  baseScore: number;
  strategy: string;
  matchups: TeamOpenerMatchup[];
}

export type OpenerEvidence = { kind: "counter_relief"; hero: HeroId };

export interface TeamOpenerOption {
  hero: HeroId;
  strategy: string;
  score: number;
  evidence: OpenerEvidence[];
  summary: string;
}

export interface TeamOpenerRequest {
  candidates: TeamOpenerCandidate[];
  banned: HeroId[];
  // La explicación de apertura debe hablar de hechos legibles, no de un "ban relevante"
  // anónimo. El snapshot ya contiene estos nombres; se inyectan para que esta política siga
  // siendo pura y testeable.
  heroNames?: Record<HeroId, string>;
  limit?: number;
}

function counterRelief(candidate: TeamOpenerCandidate, banned: Set<HeroId>): OpenerEvidence[] {
  return candidate.matchups
    .filter((matchup) => banned.has(matchup.vsHero) && matchup.games >= MIN_MATCHUP_GAMES && matchup.wins / matchup.games < 0.5)
    .map((matchup) => ({ kind: "counter_relief" as const, hero: matchup.vsHero }));
}

function reliefScore(candidate: TeamOpenerCandidate, evidence: OpenerEvidence[]): number {
  const byHero = new Map(candidate.matchups.map((matchup) => [matchup.vsHero, matchup]));
  return Math.min(
    MAX_COUNTER_RELIEF,
    evidence.reduce((total, item) => {
      const matchup = byHero.get(item.hero)!;
      return total + 0.5 - matchup.wins / matchup.games;
    }, 0),
  );
}

function strategySummary(candidate: TeamOpenerCandidate, heroNames: Record<HeroId, string> | undefined): string {
  const heroName = heroNames?.[candidate.hero] ?? `Héroe ${candidate.hero}`;
  if (candidate.strategy === "push") return `${heroName} abre un plan de presión a estructuras.`;
  if (candidate.strategy === "pickoff") return `${heroName} abre un plan de pickoff e iniciación.`;
  if (candidate.strategy === "teamfight") return `${heroName} abre un plan de peleas de equipo.`;
  return `${heroName} abre un plan de escalado para la composición.`;
}

function summary(
  candidate: TeamOpenerCandidate,
  evidence: OpenerEvidence[],
  heroNames: Record<HeroId, string> | undefined,
): string {
  const strategy = strategySummary(candidate, heroNames);
  if (evidence.length === 0) return strategy;

  const counterNames = evidence.map((item) => heroNames?.[item.hero] ?? `Héroe ${item.hero}`);
  const counterList = counterNames.length === 1 ? counterNames[0]! : `${counterNames.slice(0, -1).join(", ")} y ${counterNames.at(-1)}`;
  const verb = counterNames.length === 1 ? "está baneado" : "están baneados";
  const heroName = heroNames?.[candidate.hero] ?? `Héroe ${candidate.hero}`;
  return `${counterList} ${verb}; ${heroName} pierde una respuesta adversa identificada por el matchup. ${strategy}`;
}

// Política pura para la apertura (antes de que All Pick revele picks rivales). La disponibilidad
// es una restricción dura; los bans adversos aportan una señal acotada y explicable, no una
// afirmación de seguridad. La diversidad se aplica después de puntuar, para no convertir cinco
// copias del mismo plan de equipo en las cinco opciones de apertura.
export function recommendTeamOpeners({ candidates, banned, heroNames, limit = 5 }: TeamOpenerRequest): TeamOpenerOption[] {
  const bannedSet = new Set(banned);
  const scored = candidates
    .filter((candidate) => !bannedSet.has(candidate.hero))
    .map((candidate) => {
      const evidence = counterRelief(candidate, bannedSet);
      return {
        hero: candidate.hero,
        strategy: candidate.strategy,
        score: candidate.baseScore + reliefScore(candidate, evidence),
        evidence,
        summary: summary(candidate, evidence, heroNames),
      };
    })
    .sort((left, right) => right.score - left.score || left.hero - right.hero);

  const selected: TeamOpenerOption[] = [];
  const remaining = [...scored];
  while (selected.length < limit && remaining.length > 0) {
    const usedStrategies = new Set(selected.map((option) => option.strategy));
    remaining.sort((left, right) => {
      const leftScore = left.score - (usedStrategies.has(left.strategy) ? REPEAT_STRATEGY_PENALTY : 0);
      const rightScore = right.score - (usedStrategies.has(right.strategy) ? REPEAT_STRATEGY_PENALTY : 0);
      return rightScore - leftScore || left.hero - right.hero;
    });
    selected.push(remaining.shift()!);
  }
  return selected;
}
