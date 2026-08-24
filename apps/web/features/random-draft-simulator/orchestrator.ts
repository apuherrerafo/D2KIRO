// apps/web/features/random-draft-simulator/orchestrator.ts
// RandomDraftOrchestrator: inicialización del draft.
// Resuelve la Ban_Phase y pre-calcula los picks del bot para las 3 rondas antes de que
// arranque cualquier timer del usuario (Req. 2.1, 3.1, 3.2, 4.4).
// TSK-083: ya no es pura -- initDraft le pide cada pick del bot al motor real (async).
// Requirements: 2.1, 3.1, 3.2, 4.4

import type { DraftState, TeamSide } from "@/features/draft/types";
import type { HeroId } from "./types";
import { createSeededRng } from "./seeded-rng";
import { resolveBanPhase } from "./ban-phase";
import { botPickHeroFromEngine, type MetaSnapshot, type RemoteBotPickOptions } from "./bot-drafter";
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
  // TSK-083: inyectable para pruebas (fetchImpl/baseUrl falsos, costura S6/S7 -- nunca red real
  // en las pruebas). Ausente en producción real -- botPickHeroFromEngine usa sus propios
  // defaults (fetch real, motor local).
  remoteBotPick?: RemoteBotPickOptions;
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

function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

/**
 * Construye un `DraftState` mínimo para el pre-cálculo del bot: solo bans resueltos y los
 * picks propios que el bot ya lleva acumulados en el precálculo. Los picks del usuario nunca
 * se conocen en este punto (la Blind_Round es simultánea) — el lado del usuario se deja vacío
 * a propósito, no es un dato faltante.
 */
function buildPrecomputeDraftState(
  botSide: TeamSide,
  resolvedBans: HeroId[],
  botPicksSoFar: HeroId[],
  patch: string,
): DraftState {
  return {
    sessionId: "precompute",
    schema: "draft-state/v1",
    format: "all_pick",
    patch,
    localSide: botSide,
    phase: "active",
    banned: resolvedBans,
    picks: {
      radiant: botSide === "radiant" ? botPicksSoFar : [],
      dire: botSide === "dire" ? botPicksSoFar : [],
    },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: new Date(0).toISOString(),
    // TSK-073: siempre null -- este DraftState de precálculo es format:"all_pick", que nunca
    // tiene tabla de turnos (spec §2.1, sus picks son por rondas simultáneas, no por turno).
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    turn: null,
  };
}

// ---------------------------------------------------------------------------
// Función pública
// ---------------------------------------------------------------------------

/**
 * Inicializa una Draft_Session del Random_Draft_Simulator: resuelve la Ban_Phase completa y
 * pre-calcula todos los picks del bot para las 3 Blind_Rounds. Sus picks se calculan sin
 * conocer los picks reales del usuario.
 *
 * TSK-083: ya NO es una función pura -- cada pick del bot le pide la sugerencia real al motor
 * (`botPickHeroFromEngine`, POST /api/suggestions/preview) en vez del scoring simplificado que
 * usaba antes. Trade-off aceptado a propósito (confirmado con el usuario): se pierde la
 * reproducibilidad bit a bit desde el mismo `draftSeed` -- ahora depende del estado real del
 * motor/meta en el momento de la llamada, no solo del seed. La resolución de la Ban_Phase (arriba)
 * sigue siendo 100% determinística, solo los picks del bot dejaron de serlo.
 */
export async function initDraft(config: OrchestratorConfig): Promise<OrchestratorResult> {
  const { draftSeed, userSide, personalBanList, meta, metaBanPool, patch, remoteBotPick } = config;
  const botSide = otherSide(userSide);
  const rng = createSeededRng(draftSeed);

  const allHeroIds = Object.keys(meta.heroes).map(Number);

  const { resolvedBans } = resolveBanPhase({
    personalBanList,
    metaBanPool,
    allHeroIds,
    rng,
  });

  const rounds: OrchestratorRound[] = [];
  const botPicksSoFar: HeroId[] = [];

  for (const spec of BLIND_ROUND_SPECS) {
    const roundPicks: HeroId[] = [];

    for (let slot = 0; slot < spec.picksPerTeam; slot++) {
      const draftState = buildPrecomputeDraftState(botSide, resolvedBans, botPicksSoFar, patch);
      const picked = await botPickHeroFromEngine(
        {
          draftState,
          botSide,
          meta,
          rng,
          conflictCount: 0,
        },
        remoteBotPick,
      );

      if (picked === null) break; // Req. 4.3: pool agotado, se omite el pick sin detener la sesión

      roundPicks.push(picked.heroId);
      botPicksSoFar.push(picked.heroId);
    }

    rounds.push({ round: spec.round, botPicks: roundPicks });
  }

  return { resolvedBans, rounds };
}
