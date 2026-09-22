import { observedDraftFacts } from "../drafter/observed-draft";
import type { DraftState, HeroId } from "../draft/reducer";
import { shrinkEstimate } from "../pro/shrinkage";
import { createRelationshipIndex, RELATIONSHIP_MIN_GAMES } from "./relationship-index";
import type { CuratedCounter } from "./hero-counters";
import type { MetaSnapshot, SignalContribution, SignalScorer } from "./types";

const MAX_NAMED_ENEMIES = 2;

// TSK-185 (SPEC.md §14.5/§14.6): `counter` pasa de singleton de módulo a fábrica
// `createCounterScorer(curated, opts)` -- mismo patrón que `createPositionFitScorer` /
// `createTeamSynergyScorer`. Dos capas:
//   1. Capa curada (piso): `hero-counters.json` (S9). Si el candidato está counterado por un
//      rival revelado -> `-M[level]`; si el candidato le hace counter a un rival -> `+M[level]`.
//      Bidireccional. No tiene muestra (reporta 0), igual que `team_synergy`/`archetype_fit`.
//   2. Capa estadística (sólo rivales NO cubiertos por el curado): shrinkage hacia el baseline
//      del candidato vía `shrinkEstimate` (`pro/shrinkage.ts`, TSK-165) -- una muestra chica
//      tiende a `c_r = 0` ("sin señal"), no a un offset fijo.
// `raw = sum(c_r)` sobre los rivales cubiertos (AP Solo Mid data/signal repair: era `mean`, ver
// nota junto al cálculo -- promediar borraba la cobertura de enfrentar a más de un rival);
// `null` si ninguno (idéntico a hoy). Con un solo rival cubierto, suma y promedio coinciden, así
// que `curated` vacío + `{ minGames: 200, shrinkPriorStrength: null }` sigue reproduciendo el
// comportamiento previo número por número (candado de regresión, §14.7).

// §14.6 -- valores de arranque, ajustables tras el QA en el simulador (no reabren el SPEC).
const M: Record<CuratedCounter["level"], number> = { hard: 0.12, medium: 0.06 };
// `hard = 0.12` satura `RAW_RANGE.counter` (`[-0.12, 0.12]`) en su extremo sin re-escalar.
export const COUNTER_MIN_GAMES = 10;
// 200 recortaba el 92.7% de los pares; 10 cubre ~93% (medido) y coincide con el
// `minimumSampleSize` que `shrinkEstimate` ya exige.
export const COUNTER_SHRINK_PRIOR_STRENGTH = 20;
// "Partidas virtuales" hacia el baseline del candidato: 42 partidas conservan ~68% del delta,
// 200 ~91%, 10 ~33%.

/**
 * Umbral mínimo de partidas para que una ventaja estadística califique para la insignia visible COUNTER.
 * Basado en la distribución empírica congelada (mediana de partidas = 51, p40 = 40): a 40 partidas con
 * shrinkPriorStrength = 20, el factor de contracción es 40/(40+20) = 0.667.
 */
export const STATISTICAL_COUNTER_BADGE_MIN_GAMES = 40;

/**
 * Ventaja estadística mínima (delta contraído sobre baseline) para que califique para la insignia visible COUNTER.
 * +0.04 (+4.0% de delta contraído) se sitúa en el percentil 78 (p78) de todos los pares y top 47% de los positivos,
 * requiriendo un delta observado crudo de al menos +6.0% a 40 partidas.
 */
export const STATISTICAL_COUNTER_BADGE_MIN_DELTA = 0.04;

// TSK-188 (SPEC.md §14.13): término POSITIVO "tus counters están baneados = pick más libre".
// No depende de picks rivales revelados -- vota desde el pick 1. Valores de arranque QA-tuneables.
const BAN_RELIEF: Record<CuratedCounter["level"], number> = { hard: 0.04, medium: 0.02 };
const BAN_RELIEF_CAP = 0.06; // la mitad de M.hard -- 5 counters baneados no saturan la señal.

export interface CounterScorerOptions {
  /** Umbral de partidas para la capa estadística. Default `COUNTER_MIN_GAMES`. El candado de
   *  regresión pasa `200` (`RELATIONSHIP_MIN_GAMES`). */
  minGames?: number;
  /** Fuerza del prior del shrinkage hacia el baseline del candidato. Default
   *  `COUNTER_SHRINK_PRIOR_STRENGTH`. `null` -> usa el delta crudo (comportamiento previo). */
  shrinkPriorStrength?: number | null;
  /** Umbral de partidas para calificar para hasRevealedEnemyCounterEvidence (insignia COUNTER). Default STATISTICAL_COUNTER_BADGE_MIN_GAMES. */
  badgeMinGames?: number;
  /** Umbral de delta contraído para calificar para hasRevealedEnemyCounterEvidence (insignia COUNTER). Default STATISTICAL_COUNTER_BADGE_MIN_DELTA. */
  badgeMinDelta?: number;
}

// `knownEnemies` no depende del candidato ni de `meta` -- se deriva sólo del `state`, que el
// reductor nunca muta (siempre spread). Cache de módulo compartida entre scorers, se autolimpia
// cuando el DraftState deja de ser referenciado.
const knownEnemiesCache = new WeakMap<DraftState, HeroId[]>();
const bannedHeroesCache = new WeakMap<DraftState, HeroId[]>();

function cachedKnownEnemies(state: DraftState): HeroId[] {
  let cached = knownEnemiesCache.get(state);
  if (!cached) {
    cached = [...observedDraftFacts(state).revealedEnemyPicks];
    knownEnemiesCache.set(state, cached);
  }
  return cached;
}

function cachedBannedHeroes(state: DraftState): HeroId[] {
  let cached = bannedHeroesCache.get(state);
  if (!cached) {
    cached = [...observedDraftFacts(state).bannedHeroes];
    bannedHeroesCache.set(state, cached);
  }
  return cached;
}

function heroName(meta: MetaSnapshot, hero: HeroId): string {
  return meta.heroes[hero]?.localizedName ?? `héroe ${hero}`;
}

interface EnemyDelta {
  vsHero: HeroId;
  delta: number;
  games: number;
}

// Explicación cuando SÓLO hubo capa estadística.
function buildStatisticalExplanation(
  meta: MetaSnapshot,
  deltas: EnemyDelta[],
  badgeMinGames = STATISTICAL_COUNTER_BADGE_MIN_GAMES,
  badgeMinDelta = STATISTICAL_COUNTER_BADGE_MIN_DELTA,
): string {
  const qualifying = deltas
    .filter((d) => d.games >= badgeMinGames && d.delta >= badgeMinDelta)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MAX_NAMED_ENEMIES)
    .map((d) => heroName(meta, d.vsHero));
  if (qualifying.length > 0) return `Fuerte contra ${qualifying.join(" y ")}`;

  const strongAgainst = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MAX_NAMED_ENEMIES)
    .map((d) => heroName(meta, d.vsHero));
  if (strongAgainst.length === 0) return "Sin ventaja de contrapick conocida en este draft";
  return `Fuerte contra ${strongAgainst.join(" y ")}`;
}

// Explicación cuando hubo al menos una contribución curada: los `why` de los counters en tu
// contra primero (hasta 2), luego los rivales a los que les ganás.
function buildCuratedExplanation(negativeWhy: string[], positiveNames: string[]): string {
  const parts: string[] = [];
  if (negativeWhy.length > 0) parts.push(negativeWhy.slice(0, MAX_NAMED_ENEMIES).join(" "));
  if (positiveNames.length > 0) {
    parts.push(`Le ganás a ${positiveNames.slice(0, MAX_NAMED_ENEMIES).join(" y ")}`);
  }
  return parts.join(" ");
}

// TSK-188: cláusula de alivio -- "N de sus counters están baneados: <hasta 2 nombres>".
function buildBanReliefClause(names: string[]): string {
  const noun =
    names.length === 1 ? "1 de sus counters está baneado" : `${names.length} de sus counters están baneados`;
  return `${noun}: ${names.slice(0, MAX_NAMED_ENEMIES).join(" y ")}`;
}

export function createCounterScorer(
  curated: Map<HeroId, CuratedCounter[]>,
  options: CounterScorerOptions = {},
): SignalScorer {
  const minGames = options.minGames ?? COUNTER_MIN_GAMES;
  const shrinkPriorStrength =
    options.shrinkPriorStrength === undefined ? COUNTER_SHRINK_PRIOR_STRENGTH : options.shrinkPriorStrength;
  const badgeMinGames = options.badgeMinGames ?? STATISTICAL_COUNTER_BADGE_MIN_GAMES;
  const badgeMinDelta = options.badgeMinDelta ?? STATISTICAL_COUNTER_BADGE_MIN_DELTA;

  // Cache por instancia: el índice depende de `minGames`, así que no puede compartirse entre
  // scorers con distinto umbral.
  const relationshipIndexCache = new WeakMap<MetaSnapshot, ReturnType<typeof createRelationshipIndex>>();
  function cachedRelationshipIndex(meta: MetaSnapshot): ReturnType<typeof createRelationshipIndex> {
    let cached = relationshipIndexCache.get(meta);
    if (!cached) {
      cached = createRelationshipIndex(meta.matchups, minGames);
      relationshipIndexCache.set(meta, cached);
    }
    return cached;
  }

  return {
    id: "counter",
    score(state, candidate, meta): SignalContribution {
      const knownEnemies = cachedKnownEnemies(state);
      const bannedHeroes = cachedBannedHeroes(state);
      const curatedForCandidate = curated.get(candidate) ?? [];

      const contribs: number[] = [];
      const negativeWhy: string[] = [];
      const positiveHardNames: string[] = [];
      const positiveMediumNames: string[] = [];
      const statDeltas: EnemyDelta[] = [];
      let statSampleSize = 0;

      for (const rival of knownEnemies) {
        // Capa curada -- prioridad, bidireccional.
        let curatedValue = 0;
        let curatedHit = false;

        const against = curatedForCandidate.find((entry) => entry.vs === rival);
        if (against) {
          curatedValue -= M[against.level];
          negativeWhy.push(against.why);
          curatedHit = true;
        }

        const counters = (curated.get(rival) ?? []).find((entry) => entry.vs === candidate);
        if (counters) {
          curatedValue += M[counters.level];
          if (counters.level === "hard") {
            positiveHardNames.push(heroName(meta, rival));
          } else {
            positiveMediumNames.push(heroName(meta, rival));
          }
          curatedHit = true;
        }

        if (curatedHit) {
          contribs.push(curatedValue);
          continue;
        }

        // Capa estadística -- sólo si el curado no cubrió a este rival en ninguna dirección.
        const row = cachedRelationshipIndex(meta).counterRows(candidate, [rival])[0];
        if (!row) continue;

        const base = row.observedWinrate - row.delta;
        let cr: number;
        if (shrinkPriorStrength === null) {
          cr = row.delta;
        } else {
          const shrunk = shrinkEstimate(row.observedWinrate, row.games, base, shrinkPriorStrength);
          if (shrunk === null) continue;
          cr = shrunk - base;
        }

        contribs.push(cr);
        statSampleSize += row.games;
        statDeltas.push({ vsHero: rival, delta: cr, games: row.games });
      }

      // TSK-188: alivio positivo -- counters del candidato que están baneados (fuera de la mesa).
      // No depende de `knownEnemies`: vota desde el pick 1.
      const banReliefNames: string[] = [];
      let banRelief = 0;
      for (const entry of curatedForCandidate) {
        if (!bannedHeroes.includes(entry.vs)) continue;
        banRelief += BAN_RELIEF[entry.level];
        banReliefNames.push(heroName(meta, entry.vs));
      }
      banRelief = Math.min(BAN_RELIEF_CAP, banRelief);

      if (contribs.length === 0 && banRelief === 0) {
        return {
          signal: "counter",
          raw: null,
          weighted: 0,
          explanation: "Sin datos suficientes de enfrentamientos para este candidato",
          sampleSize: 0,
          hasRevealedEnemyCounterEvidence: false,
        };
      }

      // AP Solo Mid data/signal repair (Dota Judge root cause 3.1, P0 confirmado y reproducido en
      // counter.test.ts): `contribs` SE SUMABA COMO PROMEDIO, no como total -- un candidato que
      // cubre a DOS rivales revelados con un `medium` cada uno (0.06 + 0.06) promediaba a 0.06,
      // exactamente el mismo valor que cubrir a UN SOLO rival con `medium`. Cubrir el doble de
      // amenazas terminaba valiendo lo mismo que cubrir la mitad -- el caso medido: Riki (medium
      // vs Storm Y Puck, pierde contra ninguno) rankeó #6 con el mismo raw que Huskar (medium vs
      // Puck solamente). La suma preserva la cobertura: dos evidencias positivas comparables nunca
      // valen menos que una sola. Sigue SIN clamp antes del alivio (candado de regresión §14.7: el
      // fixture de un solo rival da 0.12222 > M.hard y debe seguir dándolo -- con un solo elemento,
      // suma y promedio coinciden). Con alivio, el total sí se acota a `RAW_RANGE.counter`.
      const sumRevealed = contribs.reduce((sum, value) => sum + value, 0);
      const raw =
        banRelief === 0 ? sumRevealed : Math.max(-M.hard, Math.min(M.hard, sumRevealed + banRelief));

      let explanation: string;
      const allPositiveCurated = [...positiveHardNames, ...positiveMediumNames];
      if (contribs.length > 0) {
        const base =
          negativeWhy.length > 0 || allPositiveCurated.length > 0
            ? buildCuratedExplanation(negativeWhy, allPositiveCurated)
            : buildStatisticalExplanation(meta, statDeltas, badgeMinGames, badgeMinDelta);
        explanation = banRelief > 0 ? `${base}. ${buildBanReliefClause(banReliefNames)}` : base;
      } else {
        explanation = buildBanReliefClause(banReliefNames);
      }

      // Wave 5 Domain Remediation: valid visible counter evidence requires:
      // 1. Curated HARD counter against a revealed enemy (curated level="hard" only), OR
      // 2. Statistical counter against a revealed enemy with sufficient sample floor and effect size:
      //    games >= badgeMinGames (default 40) AND shrunk delta >= badgeMinDelta (default +0.04).
      // Curated medium relations contribute to numerical scoring (+0.06) but do NOT qualify
      // alone for the visible COUNTER claim.
      // Ban relief alone or net-negative/sub-threshold statistical evidence never qualifies.
      const hasCuratedHardCounter = positiveHardNames.length > 0;
      const hasStatisticalCounter = statDeltas.some(
        (d) => d.games >= badgeMinGames && d.delta >= badgeMinDelta
      );
      const hasRevealedEnemyCounterEvidence =
        hasCuratedHardCounter || hasStatisticalCounter;

      // `weighted` queda en 0: la mezcla y la redistribución cuando otras señales dan `null` es
      // responsabilidad de `mix.ts`, no de este scorer.
      return {
        signal: "counter",
        raw,
        weighted: 0,
        explanation,
        sampleSize: statSampleSize,
        hasRevealedEnemyCounterEvidence,
      };
    },
  };
}

// Singleton de módulo con el comportamiento PREVIO exacto (umbral 200, sin shrinkage, sin capa
// curada). Lo consume `mix.ts` hasta que TSK-186 lo reemplace por el ensamblado por llamada con
// `MODULE_HERO_COUNTERS` y los defaults nuevos.
export const counterScorer: SignalScorer = createCounterScorer(new Map(), {
  minGames: RELATIONSHIP_MIN_GAMES,
  shrinkPriorStrength: null,
});
