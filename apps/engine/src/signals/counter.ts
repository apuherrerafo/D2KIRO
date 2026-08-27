import { observedDraftFacts } from "../drafter/observed-draft";
import type { DraftState, HeroId } from "../draft/reducer";
import { createRelationshipIndex } from "./relationship-index";
import type { MetaSnapshot, SignalContribution, SignalScorer } from "./types";

const MAX_NAMED_ENEMIES = 2;

// TSK-060: `buildSuggestions` llama a `score()` una vez por candidato sobre el MISMO `state` --
// `knownEnemies` no depende del candidato. Seguro cachear solo por `state` (a diferencia de
// team_synergy, esto no depende de `meta`): un WeakMap se autolimpia cuando el DraftState deja de
// ser referenciado (el reductor nunca muta, siempre spread -- reducer.ts), y `counterScorer` es
// un singleton de módulo, así que la cache vive mientras el proceso viva, sin crecer sin límite.
const knownEnemiesCache = new WeakMap<DraftState, HeroId[]>();
const relationshipIndexCache = new WeakMap<MetaSnapshot, ReturnType<typeof createRelationshipIndex>>();

function cachedKnownEnemies(state: DraftState): HeroId[] {
  let cached = knownEnemiesCache.get(state);
  if (!cached) {
    cached = [...observedDraftFacts(state).revealedEnemyPicks];
    knownEnemiesCache.set(state, cached);
  }
  return cached;
}

function cachedRelationshipIndex(meta: MetaSnapshot): ReturnType<typeof createRelationshipIndex> {
  let cached = relationshipIndexCache.get(meta);
  if (!cached) {
    cached = createRelationshipIndex(meta.matchups);
    relationshipIndexCache.set(meta, cached);
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

function buildExplanation(meta: MetaSnapshot, deltas: EnemyDelta[]): string {
  const strongAgainst = deltas
    .filter((d) => d.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, MAX_NAMED_ENEMIES)
    .map((d) => heroName(meta, d.vsHero));
  if (strongAgainst.length === 0) return "Sin ventaja de contrapick conocida en este draft";
  return `Fuerte contra ${strongAgainst.join(" y ")}`;
}

export const counterScorer: SignalScorer = {
  id: "counter",
  score(state, candidate, meta): SignalContribution {
    const knownEnemies = cachedKnownEnemies(state);
    const deltas: EnemyDelta[] = cachedRelationshipIndex(meta)
      .counterRows(candidate, knownEnemies)
      .map((row) => ({ vsHero: row.rival, delta: row.delta, games: row.games }));

    if (deltas.length === 0) {
      return {
        signal: "counter",
        raw: null,
        weighted: 0,
        explanation: "Sin datos suficientes de enfrentamientos para este candidato",
        sampleSize: 0,
      };
    }

    // `weighted` queda en 0: la mezcla de pesos y la redistribución cuando otras señales dan
    // `null` es responsabilidad del motor (ticket aparte, C3 etapa MEZCLA), no de este scorer.
    return {
      signal: "counter",
      raw: deltas.reduce((sum, d) => sum + d.delta, 0) / deltas.length,
      weighted: 0,
      explanation: buildExplanation(meta, deltas),
      sampleSize: deltas.reduce((sum, d) => sum + d.games, 0),
    };
  },
};
