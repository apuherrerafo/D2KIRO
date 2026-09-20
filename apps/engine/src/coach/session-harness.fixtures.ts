import type { ProtocolCommand, TeamSide } from "../draft-protocol/types";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";
import type { HeroPositions } from "../signals/hero-positions";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import type { SignalContribution } from "../signals/types";
import { ProtocolSessionStore } from "../server/protocol-session";
import { CoachOrchestrator } from "./orchestrator";
import type { CoachRecomputation } from "./orchestrator";

// Shared by coach/*.test.ts: the REAL kernel + REAL ProtocolSessionStore + the REAL perspective-safe
// recommendation path, with only V6's scorer replaced by a deterministic function of the LEGACY state V6 is
// given (so anything that reaches it is exactly what the Player may legally know).

export const HERO_POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 5, matches: 1000 }],
  3: [{ position: 4, matches: 1000 }],
  4: [{ position: 2, matches: 1000 }],
  5: [{ position: 3, matches: 1000 }],
  6: [{ position: 2, matches: 500 }, { position: 3, matches: 500 }],
};
export const POOL = [1, 2, 3, 4, 5, 6, 7, 8];
export const HERO_COUNTERING_ENEMY_9 = 5; // hero 5 gets a strong, data-backed counter signal ONLY once enemy hero 9 is revealed

export function fakeCompute(): ComputeSuggestionsForRecommendation {
  return async (state, _accountId, options) => {
    const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const enemyRevealed = new Set(state.localSide === "dire" ? state.picks.radiant : state.picks.dire);
    const candidates = POOL.filter((hero) => !excluded.has(hero) && (options?.targetPosition === undefined || HERO_POSITIONS[hero]?.some((entry) => entry.position === options.targetPosition)));
    const suggestions: Suggestion[] = candidates.map((hero, index) => {
      const countersRevealed = hero === HERO_COUNTERING_ENEMY_9 && enemyRevealed.has(9);
      const signals: SignalContribution[] = [
        { signal: "position_fit", raw: 0.6, normalized: 60, evidenceConfidence: 1, weighted: 20 - index, explanation: `posición de ${hero}`, sampleSize: 100 },
        countersRevealed
          ? { signal: "counter", raw: 0.8, normalized: 90, evidenceConfidence: 1, weighted: 40, explanation: `counter de ${hero}`, sampleSize: 100 }
          : { signal: "counter", raw: null, normalized: null, evidenceConfidence: 0, weighted: 0, explanation: "sin datos", sampleSize: 0 },
      ];
      return {
        hero,
        rank: Math.min(index + 1, 6) as Suggestion["rank"],
        score: signals.reduce((sum, signal) => sum + signal.weighted, 0),
        signals,
        reason: `fixture ${hero}`,
        confidence: "alta" as const,
        evidenceCoverage: 0.9,
        guessingIndex: 0.1,
      };
    });
    suggestions.sort((a, b) => b.score - a.score);
    const functionalEvidence: FunctionalRecommendationEvidence = {
      metaIsStale: false,
      signalEvidence: suggestions.map((s) => ({
        hero: s.hero,
        signals: s.signals.map((e) => ({ signal: e.signal, raw: e.raw, normalized: e.normalized ?? null, evidenceConfidence: e.evidenceConfidence ?? null, explanation: e.explanation, sampleSize: e.sampleSize, applicable: null })),
      })),
      heroPositions: [],
      teamOpening: null,
      partyPreferredPositions: [],
    };
    const set: SuggestionSet = {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "team_opening",
      suggestions,
      comparison: null,
      degraded: [],
      computedInMs: 1,
      functionalEvidence,
    };
    return set;
  };
}

export interface Harness {
  store: ProtocolSessionStore;
  id: string;
  side: TeamSide;
  enemy: TeamSide;
  coach: CoachOrchestrator;
  seal(side: TeamSide, slotIndex: number, heroId: number): void;
  compute(personal?: 1 | 2 | 3 | 4 | 5): Promise<CoachRecomputation>;
}

export function harness(options: { side?: TeamSide; seed?: string; humanPosition?: 1 | 2 | 3 | 4 | 5; sessionId?: string; bans?: number[] } = {}): Harness {
  const side = options.side ?? "radiant";
  const id = options.sessionId ?? "coach-it";
  const store = new ProtocolSessionStore();
  const created = store.create({
    sessionId: id,
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    humanPosition: options.humanPosition ?? 2,
    simulatorSeed: options.seed ?? "SEED0001",
    partyContext: { partySize: 5, side, controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side, slotIndex, controllerId: "player" })) },
  });
  if (!created.ok) throw new Error("setup failed");
  const applied = store.applyAtomically(id, [{ type: "RECORD_RESOLVED_BANS", heroes: options.bans ?? [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  if (!applied?.ok) throw new Error("bans failed");

  // The closure the server layer supplies: it (and only it) holds the authoritative session.
  const coach = new CoachOrchestrator({
    heroPositions: HERO_POSITIONS,
    // The REAL Coach path: perspective-safe context in, perspective-safe builder. No authoritative state anywhere.
    buildRecommendationSet: (context) => buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS }),
    buildPersonalRecommendation: (context, position) => buildRecommendationSetFromPerspective({
      context,
      computeSuggestions: fakeCompute(),
      heroPositions: HERO_POSITIONS,
      targetPosition: position,
      teamOpening: false,
      singleSlotEvaluation: true,
    }),
  });
  const seal = (sealSide: TeamSide, slotIndex: number, heroId: number) => {
    const command: ProtocolCommand = { type: "SUBMIT_SEALED_SELECTION", side: sealSide, slotIndex, heroId };
    const result = store.apply(id, command);
    if (!result || result.rejected) throw new Error(`seal rejected: ${result?.rejected}`);
  };
  return {
    store,
    id,
    side,
    enemy: side === "radiant" ? "dire" : "radiant",
    coach,
    seal,
    compute: (personal) => coach.recompute({ context: store.perspectiveRecommendationContext(id)!, playerPersonalPosition: personal ?? options.humanPosition ?? 2 }),
  };
}

export const stripSession = (recomputation: CoachRecomputation) => JSON.stringify({ output: recomputation.output, set: recomputation.recommendationSet });

