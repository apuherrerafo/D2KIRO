// apps/web/features/random-draft-simulator/store.ts
// RandomDraftStore: estado de interacción del usuario durante el Random Draft Simulator.
// Puro estado local -- ninguna acción llama a un endpoint HTTP ni al WebSocket del motor.
// La emisión de eventos al Draft_Reducer vive en useRandomDraftSession (tarea 11), que envuelve
// estas acciones con las llamadas de red correspondientes.
// Requirements: 6.4, 3.3

import { create } from "zustand";
import type { DraftState, SuggestionSet } from "@/features/draft/types";
import type { DraftConfig, DraftPhase, DraftSummary, HeroId, PicksByRound } from "./types";
import { BLIND_ROUND_SPECS } from "./constants";
import type { OrchestratorResult } from "./orchestrator";

// ---------------------------------------------------------------------------
// Estado público
// ---------------------------------------------------------------------------

// Máquina explícita del Copilot -- nunca "actualizando" indefinido: "loading" mientras se espera
// la respuesta del preview, "ready" cuando `suggestions` refleja el pedido vigente, "failed" si el
// fetch respondió error/excepción (con retry disponible), "idle" antes del primer pedido o tras
// resetSession.
export type PreviewStatus = "idle" | "loading" | "ready" | "failed";

// TSK-215: salud del transporte de eventos hacia el motor. No es lo mismo que `previewStatus`
// (que describe una sugerencia concreta): acá "unreachable" significa que el TABLERO dejó de
// reflejar la realidad, que es un fallo mucho más grave y hasta ahora invisible.
export type EngineStatus = "ok" | "unreachable";

export interface RandomDraftState {
  config: DraftConfig | null;
  phase: DraftPhase;
  sessionId: string | null;
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  staleWarning: boolean;
  lastSyncedAt: string | null;
  previewStatus: PreviewStatus;
  // TSK-215: "unreachable" = el motor dejó de aceptar eventos de draft tras agotar los reintentos.
  // El tablero visible ya no corresponde al estado real, así que la pantalla tiene que decirlo.
  // Antes esto era un console.error mudo -- es lo que dejó vivir semanas al bug de TSK-214.
  engineStatus: EngineStatus;
}

export interface RandomDraftActions {
  // Desviación deliberada de la firma de design.md (`startSession(config)`): el store no llama
  // a `initDraft` (eso implicaría I/O de meta dentro del store) -- el hook ya lo calculó y pasa
  // el resultado puro aquí, junto con el sessionId que el hook generó con crypto.randomUUID().
  startSession(config: DraftConfig, sessionId: string, orchestratorResult: OrchestratorResult): void;
  confirmPick(heroId: HeroId): void;
  deselectPick(heroId: HeroId): void;
  // Doble propósito según la fase actual (mismo botón/acción del usuario, ver comentario abajo):
  // blind_round -> round_revealed (revela); round_revealed -> siguiente blind_round o complete.
  confirmRound(): void;
  resetSession(): void;
  setDraftState(state: DraftState, suggestions: SuggestionSet | null): void;
  setStaleInfo(isStale: boolean, syncedAt: string | null): void;
  setPreviewStatus(status: PreviewStatus): void;
  setEngineStatus(status: EngineStatus): void;
  /** Sustituye el plan oculto del bot por una respuesta calculada contra los picks del usuario. */
  setBotPicksForRound(round: 1 | 2 | 3, botPicks: HeroId[]): void;

  // Las 3 acciones siguientes no están en la lista original de design.md (7 acciones) -- Req. 5
  // (Conflict_Ban) exige recalcular el pick del bot con SeededRng/MetaSnapshot en vivo, datos que
  // el store deliberadamente no tiene (mismo principio que llevó a mover `initDraft` fuera del
  // store). El hook (tarea 11) hace el cálculo y usa estas acciones para aplicar el resultado.

  /** Decrementa el timer de la blind_round activa; no-op fuera de esa fase. */
  tickTimer(deltaMs: number): void;
  /** Req. 5.1-5.3: colisión #1 o #2 de la ronda -- banea los héroes en conflicto (fuera de ambos
   *  lados) y vuelve a blind_round de la MISMA ronda con el pick del bot ya recalculado. */
  retryRoundAfterConflict(input: {
    pendingUserPicks: HeroId[];
    newBotPicks: HeroId[];
    conflictBans: HeroId[];
    conflictCount: number;
  }): void;
  /** Req. 5.4: colisión #3 de la ronda -- el usuario conserva el héroe, el bot recalcula con el
   *  siguiente candidato; parchea el round_revealed vigente in-place, sin volver a blind_round. */
  patchRevealedRound(input: { userPicks: HeroId[]; botPicks: HeroId[] }): void;
}

// Bookkeeping interno del store -- no forma parte del contrato público `RandomDraftState`
// (los paneles de UI no lo leen), pero vive dentro del estado de Zustand como cualquier otro
// campo para que el store siga siendo la única fuente de verdad (nada de módulo-singleton
// mutable fuera de `create`, que se compartiría entre instancias/tests sin querer).
interface InternalBookkeeping {
  /** Picks del bot pre-calculados por el orquestador, ocultos hasta la revelación de cada ronda. */
  precomputedRounds: { round: 1 | 2 | 3; botPicks: HeroId[] }[];
  /** Picks ya revelados de rondas anteriores, acumulados para construir el DraftSummary final. */
  revealedRounds: PicksByRound[];
}

type RandomDraftStore = RandomDraftState & RandomDraftActions & { _internal: InternalBookkeeping };

const initialBookkeeping: InternalBookkeeping = {
  precomputedRounds: [],
  revealedRounds: [],
};

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function botPicksForRound(bookkeeping: InternalBookkeeping, round: 1 | 2 | 3): HeroId[] {
  return bookkeeping.precomputedRounds.find((entry) => entry.round === round)?.botPicks ?? [];
}

function specForRound(round: 1 | 2 | 3) {
  return BLIND_ROUND_SPECS.find((spec) => spec.round === round)!;
}

function freshBlindRoundPhase(round: 1 | 2 | 3): DraftPhase {
  return {
    type: "blind_round",
    round,
    timerRemainingMs: specForRound(round).timerMs,
    pendingUserPicks: [],
    conflictBans: [],
    conflictCount: 0,
  };
}

function buildSummary(config: DraftConfig, resolvedBans: HeroId[], revealedRounds: PicksByRound[]): DraftSummary {
  return {
    draftSeed: config.draftSeed,
    userSide: config.userSide,
    personalBanList: config.personalBanList,
    resolvedBans,
    picksByRound: revealedRounds,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useRandomDraftStore = create<RandomDraftStore>((set, get) => ({
  config: null,
  phase: { type: "idle" },
  sessionId: null,
  draftState: null,
  suggestions: null,
  staleWarning: false,
  lastSyncedAt: null,
  previewStatus: "idle",
  engineStatus: "ok",
  _internal: initialBookkeeping,

  startSession(config, sessionId, orchestratorResult) {
    set({
      config,
      sessionId,
      draftState: null,
      suggestions: null,
      phase: { type: "ban_phase_complete", resolvedBans: orchestratorResult.resolvedBans },
      previewStatus: "idle",
      engineStatus: "ok",
      _internal: { precomputedRounds: orchestratorResult.rounds, revealedRounds: [] },
    });
  },

  confirmPick(heroId) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    if (phase.pendingUserPicks.includes(heroId)) return;
    set({ phase: { ...phase, pendingUserPicks: [...phase.pendingUserPicks, heroId] } });
  },

  deselectPick(heroId) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({
      phase: {
        ...phase,
        pendingUserPicks: phase.pendingUserPicks.filter((id) => id !== heroId),
      },
    });
  },

  confirmRound() {
    const { phase, config, _internal } = get();

    if (phase.type === "blind_round") {
      const botPicks = botPicksForRound(_internal, phase.round);
      const conflictBans = phase.pendingUserPicks.filter((heroId) => botPicks.includes(heroId));
      set({
        phase: {
          type: "round_revealed",
          round: phase.round,
          userPicks: phase.pendingUserPicks,
          botPicks,
          conflictBans,
        },
      });
      return;
    }

    if (phase.type === "round_revealed" && config) {
      const revealedRounds = [
        ..._internal.revealedRounds,
        { userPicks: phase.userPicks, botPicks: phase.botPicks },
      ];

      if (phase.round < 3) {
        set({
          phase: freshBlindRoundPhase((phase.round + 1) as 1 | 2 | 3),
          _internal: { ..._internal, revealedRounds },
        });
        return;
      }

      const resolvedBans = get().draftState?.banned ?? [];
      set({
        phase: { type: "complete", summary: buildSummary(config, resolvedBans, revealedRounds) },
        _internal: { ..._internal, revealedRounds },
      });
    }
  },

  resetSession() {
    set({
      config: null,
      phase: { type: "idle" },
      sessionId: null,
      draftState: null,
      suggestions: null,
      previewStatus: "idle",
      engineStatus: "ok",
      _internal: initialBookkeeping,
    });
  },

  setDraftState(draftState, suggestions) {
    set({ draftState, suggestions });
  },

  setStaleInfo(isStale, syncedAt) {
    set({ staleWarning: isStale, lastSyncedAt: syncedAt });
  },

  setPreviewStatus(status) {
    set({ previewStatus: status });
  },

  setEngineStatus(status) {
    set({ engineStatus: status });
  },

  setBotPicksForRound(round, botPicks) {
    const { _internal } = get();
    set({
      _internal: {
        ..._internal,
        precomputedRounds: _internal.precomputedRounds.map((entry) => (entry.round === round ? { ...entry, botPicks } : entry)),
      },
    });
  },

  tickTimer(deltaMs) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({ phase: { ...phase, timerRemainingMs: Math.max(0, phase.timerRemainingMs - deltaMs) } });
  },

  retryRoundAfterConflict({ pendingUserPicks, newBotPicks, conflictBans, conflictCount }) {
    const { phase, _internal } = get();
    if (phase.type !== "round_revealed") return;

    set({
      phase: {
        type: "blind_round",
        round: phase.round,
        timerRemainingMs: specForRound(phase.round).timerMs,
        pendingUserPicks,
        conflictBans,
        conflictCount,
      },
      _internal: {
        ..._internal,
        precomputedRounds: _internal.precomputedRounds.map((entry) =>
          entry.round === phase.round ? { ...entry, botPicks: newBotPicks } : entry,
        ),
      },
    });
  },

  patchRevealedRound({ userPicks, botPicks }) {
    const { phase } = get();
    if (phase.type !== "round_revealed") return;
    set({ phase: { ...phase, userPicks, botPicks } });
  },
}));
