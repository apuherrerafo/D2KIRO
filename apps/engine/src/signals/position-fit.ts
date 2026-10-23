import type { DraftState, HeroId } from "../draft/reducer";
import { isCredibleForPosition, type HeroPositions } from "./hero-positions";
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

// AP Solo Mid data/signal repair, blocker 1 (2026-09): with `targetPosition === 2`, the question
// this signal answers changes from "what does my team still need, anywhere" to "how strong is the
// evidence this hero works AS Mid" -- admission (`isCandidateAdmittedForPosition`) already answers
// "can it enter"; this answers "how good is it once admitted", and the two must not collapse into
// the same formula (a hero can clear the admission floor and still be a weak Mid relative to
// another admitted candidate).
//
// Deliberately reads the RAW match count at `targetPosition`, never `shareInfo().vector` (the
// share renormalized over only the positions that survived `MIN_POSITION_MATCHES`) -- that
// renormalization is exactly the artifact the Dota Judge review traced Snapfire/Io/Earth Spirit's
// inflated scores to (docs/diagnostics/ap-solo-mid-dota-judge.md §2): a hero's Mid evidence must
// not move because its Support matches changed, and a raw count naturally can't, while a share of
// a shrinking/growing denominator always would.
//
// TARGET_EVIDENCE_SATURATION_MATCHES: ~p90 of real position-2 matches in hero-positions.json at
// collection time (7.41e, Dota2ProTracker 7000+ MMR) -- data-derived, not invented, and not tuned
// per hero. Beyond this many recorded Mid matches, more volume stops adding more evidence; below
// it, evidence scales linearly with how many games back the claim.
const TARGET_EVIDENCE_SATURATION_MATCHES = 3000;

// TSK-252 (F1 / T3): the fixed 3000 above makes `raw` a function of VOLUME. Measured over the whole credible field of the
// exam's recommended column (docs/diagnostics/ENGINE_P1_EXAM_T3_BASE.md, "I5 sobre todo el campo creíble"), `position_fit`
// explained ~82% of the spread of V6's score, every top-3 sat in the more-played half of its position, and removing its
// contribution kept only ~23% of the top-3: the cut at TOP_N was being made by how many games a hero has, not by the draft.
//
// "credible-median" saturates at the MEDIAN of the matches-at-that-position of the heroes CREDIBLE there (the same
// `isCredibleForPosition` the Coach uses to build its columns), so the more-played half ties at `raw = 1` and the rest of the
// draft (counters, synergy, meta) decides among them; heroes below the median keep a proportionally lower `raw`, so a thin
// tail is still penalised. The median is computed from the data once per dataset (never invented, never per hero).
// "volume" (default) is the legacy 3000 rule, byte for byte: the Enemy Bot, the Ally Bot and `/api/suggestions/preview` stay on it.
export type PositionFitSaturation = "volume" | "credible-median";

type PositionKey = 1 | 2 | 3 | 4 | 5;
const medianCache = new WeakMap<HeroPositions, Map<PositionKey, number | null>>();

/**
 * Median of the recorded matches at `position` over the heroes credible there; null when no hero is credible (or the median is not
 * positive). Exported so the scorer and its tests read the very same number (tests never hard-code a median).
 */
export function credibleMedianMatches(position: PositionKey, positions: HeroPositions): number | null {
  let byPosition = medianCache.get(positions);
  if (!byPosition) {
    byPosition = new Map();
    medianCache.set(positions, byPosition);
  }
  if (byPosition.has(position)) return byPosition.get(position) ?? null;

  const matches = Object.keys(positions)
    .map(Number)
    .filter((hero) => isCredibleForPosition(hero, position, positions))
    .map((hero) => positions[hero]!.find((share) => share.position === position)!.matches)
    .sort((a, b) => a - b);
  let median: number | null = null;
  if (matches.length > 0) {
    const middle = Math.floor(matches.length / 2);
    median = matches.length % 2 === 1 ? matches[middle]! : (matches[middle - 1]! + matches[middle]!) / 2;
    if (!(median > 0)) median = null;
  }
  byPosition.set(position, median);
  return median;
}

function saturationFor(position: PositionKey, positions: HeroPositions, saturation: PositionFitSaturation): number {
  if (saturation === "volume") return TARGET_EVIDENCE_SATURATION_MATCHES;
  return credibleMedianMatches(position, positions) ?? TARGET_EVIDENCE_SATURATION_MATCHES;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function targetEvidenceExplanation(raw: number, position: Position): string {
  const label = POSITION_LABELS[position];
  if (raw >= 0.66) return `Evidencia sólida de que funciona como ${label}`;
  if (raw >= 0.33) return `Evidencia moderada de que funciona como ${label}`;
  return `Evidencia limitada de que funciona como ${label}`;
}

function scoreForTargetPosition(candidate: HeroId, targetPosition: Position, positions: HeroPositions, saturation: PositionFitSaturation): SignalContribution {
  const targetShare = (positions[candidate] ?? []).find((share) => share.position === targetPosition);
  if (!targetShare) {
    return {
      signal: "position_fit",
      raw: null,
      weighted: 0,
      explanation: `Sin evidencia suficiente de ${POSITION_LABELS[targetPosition]} para este héroe`,
      sampleSize: 0,
    };
  }

  const raw = clamp01(targetShare.matches / saturationFor(targetPosition, positions, saturation));
  return {
    signal: "position_fit",
    raw,
    weighted: 0,
    explanation: targetEvidenceExplanation(raw, targetPosition),
    sampleSize: targetShare.matches,
  };
}

export function createPositionFitScorer(positions: HeroPositions, targetPosition?: Position, saturation: PositionFitSaturation = "volume"): SignalScorer {
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

      // Wave 5 Personal View repair: every targetPosition (1..5) gets the target-aware formula.
      // The no-target case (team opening / general draft need) falls through to the legacy
      // fill/safety formula below, unchanged.
      if (targetPosition !== undefined) {
        return scoreForTargetPosition(candidate, targetPosition, positions, saturation);
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
