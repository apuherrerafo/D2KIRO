import type { HeroId } from "../draft/reducer";

const MIN_MATCHUP_GAMES = 200;
// TSK-191: subido de 0.12 a 0.30 (valor de arranque QA-tuneable). Con 0.12 el alivio por bans
// nunca alcanzaba a mover el top-5 de apertura frente a `position_fit`/`patch_meta` (que no
// cambian con los bans) -- la queja original de Fase 6. Ahora 2-3 counters baneados de un
// candidato lo reordenan de verdad, sin dominar un `baseScore` típico de 0.6-0.8.
const MAX_COUNTER_RELIEF = 0.3;
// Peso por counter curado baneado -- espeja `M` de `signals/counter.ts`.
const CURATED_RELIEF: Record<"hard" | "medium", number> = { hard: 0.12, medium: 0.06 };
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
  // TSK-191: lista curada de "quién counterea a este candidato" (de `hero-counters.json`). El
  // alivio por bans la usa antes que la capa estadística (misma prioridad que `counter.ts`).
  curatedCounters?: { vs: HeroId; level: "hard" | "medium" }[];
}

export type OpenerEvidence =
  | { kind: "counter_relief"; hero: HeroId; source: "statistical" }
  | { kind: "counter_relief"; hero: HeroId; source: "curated"; level: "hard" | "medium" };

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
  // Capa curada primero -- un `vs` cubierto acá no se vuelve a contar en la estadística.
  const curated = (candidate.curatedCounters ?? []).filter((entry) => banned.has(entry.vs));
  const covered = new Set(curated.map((entry) => entry.vs));
  const curatedEvidence = curated.map(
    (entry) => ({ kind: "counter_relief" as const, hero: entry.vs, source: "curated" as const, level: entry.level }),
  );

  const statisticalEvidence = candidate.matchups
    .filter(
      (matchup) =>
        banned.has(matchup.vsHero) &&
        !covered.has(matchup.vsHero) &&
        matchup.games >= MIN_MATCHUP_GAMES &&
        matchup.wins / matchup.games < 0.5,
    )
    .map((matchup) => ({ kind: "counter_relief" as const, hero: matchup.vsHero, source: "statistical" as const }));

  return [...curatedEvidence, ...statisticalEvidence];
}

function reliefScore(candidate: TeamOpenerCandidate, evidence: OpenerEvidence[]): number {
  const byHero = new Map(candidate.matchups.map((matchup) => [matchup.vsHero, matchup]));
  const total = evidence.reduce((sum, item) => {
    if (item.source === "curated") return sum + CURATED_RELIEF[item.level];
    const matchup = byHero.get(item.hero);
    return matchup ? sum + (0.5 - matchup.wins / matchup.games) : sum;
  }, 0);
  return Math.min(MAX_COUNTER_RELIEF, total);
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
