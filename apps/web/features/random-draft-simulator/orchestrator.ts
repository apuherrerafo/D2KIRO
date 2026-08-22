// apps/web/features/random-draft-simulator/orchestrator.ts
// RandomDraftOrchestrator: función pura de inicialización del draft.
// Resuelve la Ban_Phase y pre-calcula los picks del bot para las 3 rondas antes de que
// arranque cualquier timer del usuario (Req. 2.1, 3.1, 3.2, 4.4).
// Requirements: 2.1, 3.1, 3.2, 4.4

import type { DraftState, TeamSide } from "@/features/draft/types";
import type { HeroId } from "./types";
import { createSeededRng } from "./seeded-rng";
import { resolveBanPhase } from "./ban-phase";
import { botPickHero, type MetaSnapshot } from "./bot-drafter";
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
  };
}

// ---------------------------------------------------------------------------
// Función pública
// ---------------------------------------------------------------------------

/**
 * Inicializa una Draft_Session del Random_Draft_Simulator: resuelve la Ban_Phase completa y
 * pre-calcula todos los picks del bot para las 3 Blind_Rounds. Función pura — sin I/O, sin
 * reloj ni ids propios. El objetivo del bot es QA del motor (ver bot-drafter.ts), por lo que
 * sus picks se calculan sin conocer los picks reales del usuario.
 */
export function initDraft(config: OrchestratorConfig): OrchestratorResult {
  const { draftSeed, userSide, personalBanList, meta, metaBanPool, patch } = config;
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
      const picked = botPickHero({
        draftState,
        botSide,
        meta,
        rng,
        conflictCount: 0,
      });

      if (picked === null) break; // Req. 4.3: pool agotado, se omite el pick sin detener la sesión

      roundPicks.push(picked.heroId);
      botPicksSoFar.push(picked.heroId);
    }

    rounds.push({ round: spec.round, botPicks: roundPicks });
  }

  return { resolvedBans, rounds };
}
