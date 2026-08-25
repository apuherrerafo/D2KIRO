// apps/web/features/random-draft-simulator/orchestrator.ts
// RandomDraftOrchestrator: inicialización del draft.
// Resuelve únicamente la Ban_Phase antes de que arranque el timer del usuario. Los picks del
// bot se calculan al cerrar cada ronda, con el tablero que acaba de revelarse.
// Requirements: 2.1, 3.1, 3.2, 4.4

import type { TeamSide } from "@/features/draft/types";
import type { HeroId } from "./types";
import { createSeededRng } from "./seeded-rng";
import { resolveBanPhase } from "./ban-phase";
import type { MetaSnapshot } from "./bot-drafter";
import { BLIND_ROUND_SPECS, type BlindRoundSpec } from "./constants";

export { BLIND_ROUND_SPECS };
export type { BlindRoundSpec };

// ---------------------------------------------------------------------------
// Interfaces públicas
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  /** 8 chars A-Z0-9 */
  draftSeed: string;
  userSide: TeamSide;
  /** 0-4 héroes configurados por el usuario */
  personalBanList: HeroId[];
  /** Snapshot del meta con patchStats para el scoring del bot */
  meta: MetaSnapshot;
  /** Héroes ordenados por tasa de ban descendente en el bracket activo */
  metaBanPool: HeroId[];
  patch: string;
}

export interface OrchestratorRound {
  round: 1 | 2 | 3;
  /** Picks pre-calculados del bot, ocultos hasta la revelación de la ronda (Req. 3.2) */
  botPicks: HeroId[];
}

export interface OrchestratorResult {
  resolvedBans: HeroId[];
  rounds: OrchestratorRound[];
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Función pública
// ---------------------------------------------------------------------------

/**
 * Inicializa una Draft_Session del Random_Draft_Simulator: resuelve la Ban_Phase completa y
 * prepara las tres rondas sin picks rivales. El hook calcula la respuesta rival recién cuando el
 * usuario cierra una ronda, por lo que no puede sugerir contra un tablero inicial ya obsoleto.
 */
export async function initDraft(config: OrchestratorConfig): Promise<OrchestratorResult> {
  const { draftSeed, personalBanList, meta, metaBanPool } = config;
  const rng = createSeededRng(draftSeed);

  const allHeroIds = Object.keys(meta.heroes).map(Number);

  const { resolvedBans } = resolveBanPhase({
    personalBanList,
    metaBanPool,
    allHeroIds,
    rng,
  });

  const rounds: OrchestratorRound[] = BLIND_ROUND_SPECS.map((spec) => ({ round: spec.round, botPicks: [] }));

  return { resolvedBans, rounds };
}
