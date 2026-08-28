import { analyzeSignalContributions, type SignalSnapshot } from "./signal-stability";
import { loadDraftCorpus } from "../../apps/engine/src/knn/corpus";
import { buildDraftIndex } from "../../apps/engine/src/knn/draft-index";
import { loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { loadHeroLineProfiles } from "../../apps/engine/src/lane/profiles";
import { loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import { loadPipelineWeights } from "../../apps/engine/src/pipeline/weight-loader";
import { runProDrafterPipeline } from "../../apps/engine/src/pipeline/run-pipeline";
import type { DraftState, HeroId } from "../../apps/engine/src/draft/reducer";
import { profileDistance, rolePressure } from "../role-pressure";
import { classifyPressurePair } from "./signal-stability";

const SEED = 1_352_026;
const DRAFTS = 50;
const BANS = 16;

function next(seed: number): number { let value = seed >>> 0; value ^= value << 13; value ^= value >>> 17; value ^= value << 5; return value >>> 0; }
function sample(ids: readonly HeroId[], seed: number): HeroId[] {
  const values = [...ids]; let state = seed;
  for (let i = values.length - 1; i > 0; i -= 1) { state = next(state); const j = state % (i + 1); [values[i], values[j]] = [values[j]!, values[i]!]; }
  return values.slice(0, BANS);
}
function state(patch: string, banned: readonly HeroId[]): DraftState {
  return { sessionId: "stability-report", schema: "draft-state/v1", format: "all_pick", patch, localSide: "radiant", phase: "active", banned: [...banned], picks: { radiant: [], dire: [] }, lastSeq: 0, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" }, updatedAt: new Date(0).toISOString(), firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null };
}
function snapshots(bans: readonly HeroId[], patch: string, index: ReturnType<typeof buildDraftIndex>, corpus: ReturnType<typeof loadDraftCorpus>, positions: ReturnType<typeof loadHeroPositions>, profiles: ReturnType<typeof loadHeroLineProfiles>, capabilities: ReturnType<typeof loadHeroCapabilities>, weights: ReturnType<typeof loadPipelineWeights>): SignalSnapshot[] {
  return runProDrafterPipeline(state(patch, bans), index, corpus, positions, weights, profiles, { teamOpening: true, heroCapabilities: capabilities }).slice(0, 5).flatMap((result) => result.signals);
}

export interface InstabilityReport {
  readonly all: ReturnType<typeof analyzeSignalContributions>;
  readonly irrelevant: ReturnType<typeof analyzeSignalContributions>;
  readonly pivotal: ReturnType<typeof analyzeSignalContributions>;
}

export function buildInstabilityReport(): InstabilityReport {
  const corpus = loadDraftCorpus(); const drafts = corpus.slice(0, DRAFTS); const ids = [...new Set(corpus.flatMap((d) => [...d.radiantHeroes, ...d.direHeroes]))];
  const index = buildDraftIndex(corpus, drafts[0]?.patch ?? "7.41"); const positions = loadHeroPositions(); const profiles = loadHeroLineProfiles(); const capabilities = loadHeroCapabilities(); const weights = loadPipelineWeights();
  const before: SignalSnapshot[][] = []; const after: SignalSnapshot[][] = []; const groups: ("irrelevant" | "pivotal")[] = [];
  drafts.forEach((draft, i) => {
    const firstBans = sample(ids, SEED + i * 2); const secondBans = sample(ids, SEED + i * 2 + 1);
    before.push(snapshots(firstBans, draft.patch, index, corpus, positions, profiles, capabilities, weights));
    after.push(snapshots(secondBans, draft.patch, index, corpus, positions, profiles, capabilities, weights));
    groups.push(classifyPressurePair(profileDistance(rolePressure(firstBans, positions), rolePressure(secondBans, positions))));
  });
  const select = (group: "irrelevant" | "pivotal") => ({ before: before.filter((_, i) => groups[i] === group), after: after.filter((_, i) => groups[i] === group) });
  const irrelevant = select("irrelevant"); const pivotal = select("pivotal");
  return { all: analyzeSignalContributions(before, after, weights), irrelevant: analyzeSignalContributions(irrelevant.before, irrelevant.after, weights), pivotal: analyzeSignalContributions(pivotal.before, pivotal.after, weights) };
}

if (import.meta.main) console.log(JSON.stringify(buildInstabilityReport(), null, 2));
