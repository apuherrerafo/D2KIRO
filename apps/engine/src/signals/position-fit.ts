import type { DraftState, HeroId } from "../draft/reducer";
import type { HeroPositions } from "./hero-positions";
import type { SignalContribution, SignalScorer } from "./types";

// TSK-044 (SPEC.md §10.4): fusiona role_gap ("no repitas rol") + role_safety ("support primero,
// revela el core después") en una sola señal continua. La intención de producto de role_safety
// (TSK-027) se conserva completa -- lo que se descarta es su implementación sobre roles[] de
// OpenDota y su ventana dura de 2 picks.

const POSITIONS = [1, 2, 3, 4, 5] as const;
type Position = (typeof POSITIONS)[number];
type PositionVector = Record<Position, number>;

const SUPPORT_POSITIONS: readonly Position[] = [4, 5];

// Decae suave con cada pick propio -- no la ventana dura de 2 picks que usaba role_safety.
// Índice = cantidad de picks propios ya confirmados, saturado en 3.
const TIMING_BLEND = [0.5, 0.3, 0.15, 0.0];

// Nombres visibles en castellano (web.md: "hard support, support, offlane, midlane, carry" --
// terminología confirmada con el usuario, nunca "pos 1/2/3/4/5" a secas en texto de UI).
const POSITION_LABELS: Record<Position, string> = {
  1: "carry",
  2: "midlane",
  3: "offlane",
  4: "support",
  5: "hard support",
};

function emptyVector(): PositionVector {
  return { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

interface HeroShareInfo {
  vector: PositionVector;
  totalMatches: number;
}

function shareInfo(hero: HeroId, positions: HeroPositions): HeroShareInfo | null {
  const shares = positions[hero];
  if (!shares || shares.length === 0) return null;

  const totalMatches = shares.reduce((sum, share) => sum + share.matches, 0);
  const vector = emptyVector();
  for (const share of shares) vector[share.position] = share.matches / totalMatches;

  return { vector, totalMatches };
}

function ownPicks(state: DraftState): HeroId[] {
  return state.localSide === "unknown" ? [] : state.picks[state.localSide];
}

function coverage(own: HeroId[], positions: HeroPositions): PositionVector {
  const cov = emptyVector();
  for (const hero of own) {
    const info = shareInfo(hero, positions);
    if (!info) continue; // héroe propio sin dato -- aporta 0, degrada, nunca rompe
    for (const p of POSITIONS) cov[p] += info.vector[p];
  }
  return cov;
}

function need(cov: PositionVector): PositionVector {
  const result = emptyVector();
  for (const p of POSITIONS) result[p] = Math.max(0, 1 - cov[p]);
  return result;
}

function fillOf(vector: PositionVector, needVector: PositionVector): number {
  return POSITIONS.reduce((sum, p) => sum + vector[p] * needVector[p], 0);
}

function safetyOf(vector: PositionVector): number {
  return SUPPORT_POSITIONS.reduce((sum, p) => sum + vector[p], 0);
}

// Posición que más aporta a `fill` -- la que mejor describe qué hueco llena el candidato.
function dominantNeededPosition(vector: PositionVector, needVector: PositionVector): Position {
  let best: Position = POSITIONS[0];
  let bestScore = -1;
  for (const p of POSITIONS) {
    const score = vector[p] * needVector[p];
    if (score > bestScore) {
      best = p;
      bestScore = score;
    }
  }
  return best;
}

function buildExplanation(fill: number, safety: number, t: number, ownCount: number, vector: PositionVector, needVector: PositionVector): string {
  if (ownCount > 0 && fill < 0.05) {
    return "Repite una posición que tu equipo ya cubre";
  }
  if (t > 0 && safety > 0.5) {
    return "Rol flexible: pick temprano seguro, no revela tu core";
  }
  if (fill > 0.5) {
    const position = dominantNeededPosition(vector, needVector);
    return `Cubre la posición ${POSITION_LABELS[position]} que a tu equipo le falta`;
  }
  return "Encaja parcialmente en lo que le falta a tu equipo";
}

export function createPositionFitScorer(positions: HeroPositions): SignalScorer {
  // TSK-060: `buildSuggestions` llama a `score()` una vez por candidato (~120 héroes) sobre el
  // MISMO `state` -- `coverage`/`need` no dependen del candidato, así que recalcularlos en cada
  // llamada es trabajo O(candidatos × picks propios) que en realidad es O(picks propios). Un
  // WeakMap indexado por referencia de `state` es seguro porque el reductor nunca muta el estado
  // (siempre spread, reducer.ts) y esta cache se crea de nuevo en cada `createPositionFitScorer`,
  // que a su vez `buildSuggestions` invoca una vez por llamada (mix.ts) -- nunca sobrevive entre
  // drafts ni entre llamadas, se descarta junto con el scorer.
  const needCache = new WeakMap<DraftState, PositionVector>();

  function neededCoverage(state: DraftState): PositionVector {
    let cached = needCache.get(state);
    if (!cached) {
      cached = need(coverage(ownPicks(state), positions));
      needCache.set(state, cached);
    }
    return cached;
  }

  return {
    id: "position_fit",
    score(state, candidate): SignalContribution {
      if (state.localSide === "unknown") {
        return {
          signal: "position_fit",
          raw: null,
          weighted: 0,
          explanation: "Sin lado propio identificado todavía",
          sampleSize: 0,
        };
      }

      const candidateInfo = shareInfo(candidate, positions);
      if (!candidateInfo) {
        return {
          signal: "position_fit",
          raw: null,
          weighted: 0,
          explanation: "Sin datos de posición para este héroe este parche",
          sampleSize: 0,
        };
      }

      const own = ownPicks(state);
      const needVector = neededCoverage(state);
      const fill = fillOf(candidateInfo.vector, needVector);
      const safety = safetyOf(candidateInfo.vector);
      const t = TIMING_BLEND[Math.min(own.length, TIMING_BLEND.length - 1)]!;
      const raw = (1 - t) * fill + t * safety;

      return {
        signal: "position_fit",
        raw,
        weighted: 0,
        explanation: buildExplanation(fill, safety, t, own.length, candidateInfo.vector, needVector),
        sampleSize: candidateInfo.totalMatches,
      };
    },
  };
}
