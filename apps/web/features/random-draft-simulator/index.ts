// apps/web/features/random-draft-simulator/index.ts
// Exports públicos del feature random-draft-simulator.
// Los internals (seedToUint32, mulberry32) NO se re-exportan desde aquí.

// Types
export type {
  HeroId,
  TeamSide,
  PicksByRound,
  DraftSessionSnapshot,
  DraftConfig,
  DraftPhase,
  DraftSummary,
  ValidationResult,
} from "./types";
export { validateDraftSessionSnapshot } from "./types";

// Constants
export { SEED_PATTERN, STORAGE_KEY, BLIND_ROUND_SPECS } from "./constants";
export type { BlindRoundSpec } from "./constants";

// SeededRng
export { createSeededRng, generateDraftSeed } from "./seeded-rng";
export type { SeededRng } from "./seeded-rng";

// Ban list
export { addHeroToBanList, removeHeroFromBanList } from "./ban-list";
export type { AddHeroResult } from "./ban-list";

// BanPhaseResolver
export { resolveBanPhase } from "./ban-phase";
export type { BanPhaseInput, BanPhaseResult } from "./ban-phase";

// BotDrafter
export { botPickHero } from "./bot-drafter";
export type { BotDrafterInput, BotDrafterResult, MetaSnapshot, MetaHeroEntry, HeroPatchStat } from "./bot-drafter";

// RandomDraftOrchestrator
export { initDraft } from "./orchestrator";
export type { OrchestratorConfig, OrchestratorResult, OrchestratorRound } from "./orchestrator";

// RandomDraftStore
export { useRandomDraftStore } from "./store";
export type { RandomDraftState, RandomDraftActions } from "./store";

// Persistencia de configuración
export { useConfigPersistence } from "./use-config-persistence";
export type { PersistedConfig, UseConfigPersistenceResult } from "./use-config-persistence";

// Carga de meta (heroes + patchStats)
export { loadMetaSnapshot } from "./meta-loader";
export type { LoadedMeta } from "./meta-loader";

// Sesión interactiva (hook puente con el motor)
export { useRandomDraftSession } from "./use-random-draft-session";
export type { UseRandomDraftSessionOptions, UseRandomDraftSessionResult } from "./use-random-draft-session";
