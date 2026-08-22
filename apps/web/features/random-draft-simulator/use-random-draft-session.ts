// apps/web/features/random-draft-simulator/use-random-draft-session.ts
// Puente entre RandomDraftStore y el motor: crea el sessionId, resuelve la Ban_Phase, emite
// todos los eventos, gestiona el timer de cada Blind_Round y resuelve Conflict_Ban.
// Requirements: 2.1, 2.4, 3.3, 3.4-3.7, 5.1-5.4, 9.3, 9.6

"use client";

import { useCallback, useEffect, useRef } from "react";
import { postSimulatorEvent } from "@/features/draft/manual-entry";
import { createDraftSocket } from "@/features/draft/socket";
import { isValidServerMessage } from "@/features/draft/validation";
import type { SimulatorEvent } from "@/features/draft/simulator-scripts";
import type {
  DraftSocket,
  DraftState as EngineDraftState,
  HeroId as EngineHeroId,
  ServerMessage,
  SuggestionSet,
  TeamSide,
} from "@/features/draft/types";
import type { SeededRng } from "./seeded-rng";
import { createSeededRng } from "./seeded-rng";
import { initDraft, type OrchestratorResult } from "./orchestrator";
import { botPickHero, type MetaSnapshot } from "./bot-drafter";
import { BLIND_ROUND_SPECS } from "./constants";
import { loadMetaSnapshot } from "./meta-loader";
import { useRandomDraftStore, type RandomDraftActions, type RandomDraftState } from "./store";
import type { DraftConfig, HeroId } from "./types";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://127.0.0.1:4000/ws/draft";
const TIMER_TICK_MS = 250;
// Sin requisito explícito de duración -- el propósito es que el usuario alcance a leer los picks
// revelados antes de que arranque la siguiente ronda (Req. 3.3 solo exige que se revele "antes
// de comenzar la siguiente ronda", no un tiempo mínimo); 2.5s es la misma escala que ya usa
// runSimulatorPlayback para picks (features/draft/simulator.ts).
const REVEAL_PAUSE_MS = 2500;
const MAX_CONFLICT_BANS_PER_ROUND = 2;

// Exportadas para prueba directa (funciones puras) -- el resto del hook depende de refs/efectos
// de React y no se puede probar sin renderizar (sin `renderHook` disponible en este proyecto,
// ver testing-seams.md; la cobertura de integración completa vive en la tarea 16.2, contra un
// motor real en el navegador).
export function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

export function specForRound(round: 1 | 2 | 3) {
  return BLIND_ROUND_SPECS.find((spec) => spec.round === round)!;
}

// ---------------------------------------------------------------------------
// Selección aleatoria para picks pendientes al expirar el timer (Req. 3.6)
// ---------------------------------------------------------------------------

export function randomPickForSlots(
  count: number,
  rng: SeededRng,
  resolvedBans: HeroId[],
  alreadyTaken: HeroId[],
  allHeroIds: HeroId[],
): HeroId[] {
  const taken = new Set<HeroId>([...resolvedBans, ...alreadyTaken]);
  const pool = allHeroIds.filter((heroId) => !taken.has(heroId));
  const picks: HeroId[] = [];
  for (let i = 0; i < count; i++) {
    const picked = rng.pick(pool.filter((heroId) => !picks.includes(heroId)));
    if (picked === undefined) break;
    picks.push(picked);
  }
  return picks;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

// El caller (ConfigPanel) no conoce el patch actual de antemano -- viene de loadMetaSnapshot,
// que solo se resuelve al arrancar. startDraft lo completa internamente con el patch real.
export type StartDraftConfig = Omit<DraftConfig, "patch">;

export interface UseRandomDraftSessionResult {
  state: RandomDraftState;
  actions: Pick<RandomDraftActions, "confirmPick" | "deselectPick" | "resetSession">;
  startDraft(config: StartDraftConfig): Promise<void>;
  confirmRound(): Promise<void>;
}

export interface UseRandomDraftSessionOptions {
  wsUrl?: string;
  // Costura S5 (testing-seams.md): mismo patrón que DraftViewProps.socketFactory -- inyectable
  // para pruebas (FakeSocket), por defecto el WebSocket real del navegador.
  socketFactory?: (url: string) => DraftSocket;
}

export function useRandomDraftSession(options: UseRandomDraftSessionOptions = {}): UseRandomDraftSessionResult {
  const wsUrl = options.wsUrl ?? DEFAULT_WS_URL;
  const socketFactory = options.socketFactory ?? createDraftSocket;

  // Selectores individuales (mismo patrón que DraftView.tsx) en vez de suscribirse al store
  // entero -- evita re-renders en cada cambio de `_internal` (bookkeeping interno del store,
  // irrelevante para la UI) y expone exactamente el contrato público `RandomDraftState`.
  const config = useRandomDraftStore((s) => s.config);
  const phase = useRandomDraftStore((s) => s.phase);
  const sessionId = useRandomDraftStore((s) => s.sessionId);
  const draftState = useRandomDraftStore((s) => s.draftState);
  const suggestions = useRandomDraftStore((s) => s.suggestions);
  const staleWarning = useRandomDraftStore((s) => s.staleWarning);
  const lastSyncedAt = useRandomDraftStore((s) => s.lastSyncedAt);
  const confirmPick = useRandomDraftStore((s) => s.confirmPick);
  const deselectPick = useRandomDraftStore((s) => s.deselectPick);
  const resetSession = useRandomDraftStore((s) => s.resetSession);

  const rngRef = useRef<SeededRng | null>(null);
  const metaRef = useRef<{ meta: MetaSnapshot; allHeroIds: HeroId[] } | null>(null);
  const seqRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const socketRef = useRef<DraftSocket | null>(null);
  const timerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolvedBansRef = useRef<HeroId[]>([]);

  const stopTimer = useCallback(function stopTimer(): void {
    if (timerIdRef.current !== null) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
  }, []);

  useEffect(function cleanupOnUnmount() {
    return function cleanup() {
      stopTimer();
      socketRef.current?.close();
    };
  }, [stopTimer]);

  const nextSeq = useCallback(function nextSeq(): number {
    seqRef.current += 1;
    return seqRef.current;
  }, []);

  async function emit(payload: SimulatorEvent): Promise<void> {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    // Reintento con backoff -- Req. 9.6, mismo patrón que reconectar el WebSocket abajo.
    const delays = [0, 200, 400];
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const result = await postSimulatorEvent(sessionId, nextSeq(), payload);
        if (result.accepted) return;
      } catch {
        // Reintenta con el siguiente delay; si se agotan, el evento se pierde (no hay más
        // reintentos posibles sin bloquear indefinidamente la sesión).
      }
    }
    console.error("[useRandomDraftSession] no se pudo emitir el evento tras reintentos:", payload);
  }

  function connectSocket(sessionId: string): void {
    socketRef.current?.close();
    const socket = socketFactory(wsUrl);
    socket.onMessage(function handleMessage(message: ServerMessage) {
      if (!isValidServerMessage(message)) return;
      if (message.type === "draft_state" || message.type === "snapshot") {
        useRandomDraftStore.getState().setDraftState(message.payload as EngineDraftState, useRandomDraftStore.getState().suggestions);
      } else if (message.type === "suggestions") {
        const current = useRandomDraftStore.getState().draftState;
        if (current) useRandomDraftStore.getState().setDraftState(current, message.payload as SuggestionSet);
      }
    });
    // Req. 9.6: al reconectar, reenvía "hello" con el mismo sessionId -- createDraftSocket ya
    // encola el primer mensaje si el WS todavía está CONNECTING (ver socket.ts).
    socket.onClose(function handleClose() {
      if (sessionIdRef.current !== sessionId) return; // sesión ya se cerró/cambió, no reconectar
      connectSocket(sessionId);
    });
    socket.send({ schema: "draft-ws/v1", type: "hello", sessionId });
    socketRef.current = socket;
  }

  // -------------------------------------------------------------------------
  // startDraft
  // -------------------------------------------------------------------------

  const startDraft = useCallback(async function startDraft(input: StartDraftConfig): Promise<void> {
    stopTimer();
    const sessionId = crypto.randomUUID();
    sessionIdRef.current = sessionId;
    seqRef.current = 0;

    const { meta, allHeroIds, metaBanPool, currentPatch } = await loadMetaSnapshot();
    const config: DraftConfig = { ...input, patch: currentPatch };
    metaRef.current = { meta, allHeroIds };
    rngRef.current = createSeededRng(config.draftSeed);

    const orchestratorResult: OrchestratorResult = initDraft({
      draftSeed: config.draftSeed,
      userSide: config.userSide,
      personalBanList: config.personalBanList,
      meta,
      metaBanPool,
      patch: config.patch,
    });
    resolvedBansRef.current = orchestratorResult.resolvedBans;

    useRandomDraftStore.getState().startSession(config, sessionId, orchestratorResult);
    connectSocket(sessionId);

    await emit({ type: "session_started", format: "all_pick", patch: config.patch });
    await emit({ type: "local_side_identified", side: config.userSide });

    // Req. 2.4: primer evento al lado Radiant, alternando en cada evento subsiguiente.
    for (let i = 0; i < orchestratorResult.resolvedBans.length; i++) {
      const side: TeamSide = i % 2 === 0 ? "radiant" : "dire";
      await emit({ type: "hero_banned", hero: orchestratorResult.resolvedBans[i] as EngineHeroId, side });
    }

    // ban_phase_complete -> blind_round(1): único punto de la sesión donde ninguna acción del
    // store ya deja la fase en blind_round por su cuenta (confirmRound y retryRoundAfterConflict
    // sí lo hacen para las rondas siguientes) -- startSession se detiene en ban_phase_complete
    // a propósito (Req. 2.1: los 16 bans deben verse resueltos antes de arrancar el timer).
    useRandomDraftStore.setState({
      phase: {
        type: "blind_round",
        round: 1,
        timerRemainingMs: specForRound(1).timerMs,
        pendingUserPicks: [],
        conflictBans: [],
        conflictCount: 0,
      },
    });
    beginRound(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stopTimer/connectSocket/emit son estables por closure de refs
  }, [stopTimer]);

  // -------------------------------------------------------------------------
  // Timer de la Blind_Round activa
  // -------------------------------------------------------------------------

  function beginRound(round: 1 | 2 | 3): void {
    stopTimer();
    timerIdRef.current = setInterval(function tick() {
      const { phase } = useRandomDraftStore.getState();
      if (phase.type !== "blind_round") {
        stopTimer();
        return;
      }
      useRandomDraftStore.getState().tickTimer(TIMER_TICK_MS);
      if (phase.timerRemainingMs - TIMER_TICK_MS <= 0) {
        stopTimer();
        void autoCompleteAndConfirm(round);
      }
    }, TIMER_TICK_MS);
  }

  // Req. 3.6: al expirar el timer, completa los picks pendientes con héroes aleatorios del pool
  // disponible antes de proceder a la revelación.
  async function autoCompleteAndConfirm(round: 1 | 2 | 3): Promise<void> {
    const { phase } = useRandomDraftStore.getState();
    if (phase.type !== "blind_round" || phase.round !== round) return;

    const rng = rngRef.current;
    const meta = metaRef.current;
    if (!rng || !meta) return;

    const spec = specForRound(round);
    const missing = spec.picksPerTeam - phase.pendingUserPicks.length;
    if (missing > 0) {
      const filled = randomPickForSlots(missing, rng, resolvedBansRef.current, phase.pendingUserPicks, meta.allHeroIds);
      for (const heroId of filled) useRandomDraftStore.getState().confirmPick(heroId);
    }

    await confirmRound();
  }

  // -------------------------------------------------------------------------
  // confirmRound (expuesto) — revela, resuelve Conflict_Ban, avanza de ronda
  // -------------------------------------------------------------------------

  const confirmRound = useCallback(async function confirmRound(): Promise<void> {
    stopTimer();
    const before = useRandomDraftStore.getState().phase;
    if (before.type !== "blind_round") return;

    useRandomDraftStore.getState().confirmRound(); // blind_round -> round_revealed

    const revealed = useRandomDraftStore.getState().phase;
    if (revealed.type !== "round_revealed") return;

    if (revealed.conflictBans.length > 0) {
      await resolveConflicts(before.round, before.conflictCount, revealed.userPicks, revealed.botPicks, revealed.conflictBans);
      return; // resolveConflicts ya decide si vuelve a blind_round o continúa la revelación
    }

    await revealAndAdvance(revealed.round, revealed.userPicks, revealed.botPicks);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resolveConflicts/revealAndAdvance solo leen refs/getState(), estables entre renders
  }, [stopTimer]);

  // Req. 5: colisiones entre pendingUserPicks y botPicks de la ronda.
  async function resolveConflicts(
    round: 1 | 2 | 3,
    conflictCountBefore: number,
    userPicks: HeroId[],
    botPicks: HeroId[],
    collidedHeroes: HeroId[],
  ): Promise<void> {
    const rng = rngRef.current;
    const meta = metaRef.current;
    if (!rng || !meta) return;

    if (conflictCountBefore < MAX_CONFLICT_BANS_PER_ROUND) {
      // Colisión #1 o #2: Conflict_Ban -- banea el/los héroe(s) en conflicto, el bot recalcula.
      for (const heroId of collidedHeroes) {
        await emit({ type: "hero_banned", hero: heroId as EngineHeroId, side: "unknown" });
      }
      resolvedBansRef.current = [...resolvedBansRef.current, ...collidedHeroes];

      const remainingUserPicks = userPicks.filter((heroId) => !collidedHeroes.includes(heroId));
      const remainingBotPicks = botPicks.filter((heroId) => !collidedHeroes.includes(heroId));
      const newBotPicks = recalculateBotPicks(round, remainingBotPicks, collidedHeroes.length, rng, meta);

      useRandomDraftStore.getState().retryRoundAfterConflict({
        pendingUserPicks: remainingUserPicks,
        newBotPicks,
        conflictBans: collidedHeroes,
        conflictCount: conflictCountBefore + 1,
      });
      beginRound(round);
      return;
    }

    // Req. 5.4: 3ra colisión de la ronda -- el usuario conserva el héroe, el bot recalcula.
    const survivingBotPicks = botPicks.filter((heroId) => !collidedHeroes.includes(heroId));
    const newBotPicks = recalculateBotPicks(round, survivingBotPicks, collidedHeroes.length, rng, meta);
    useRandomDraftStore.getState().patchRevealedRound({ userPicks, botPicks: newBotPicks });
    await revealAndAdvance(round, userPicks, newBotPicks);
  }

  function recalculateBotPicks(
    round: 1 | 2 | 3,
    survivingBotPicks: HeroId[],
    countNeeded: number,
    rng: SeededRng,
    meta: { meta: MetaSnapshot; allHeroIds: HeroId[] },
  ): HeroId[] {
    const state = useRandomDraftStore.getState();
    const result = [...survivingBotPicks];
    for (let i = 0; i < countNeeded; i++) {
      const picked = botPickHero({
        draftState: buildBotDraftState(state, round, result),
        botSide: otherSide(state.config!.userSide),
        meta: meta.meta,
        rng,
        conflictCount: 0,
      });
      if (picked === null) break;
      result.push(picked.heroId);
    }
    return result;
  }

  function buildBotDraftState(state: RandomDraftState, round: 1 | 2 | 3, botPicksSoFar: HeroId[]) {
    const botSide = otherSide(state.config!.userSide);
    return {
      sessionId: sessionIdRef.current ?? "",
      schema: "draft-state/v1" as const,
      format: "all_pick" as const,
      patch: state.config!.patch,
      localSide: botSide,
      phase: "active" as const,
      banned: resolvedBansRef.current,
      picks: {
        radiant: botSide === "radiant" ? botPicksSoFar : [],
        dire: botSide === "dire" ? botPicksSoFar : [],
      },
      lastSeq: 0,
      appliedEventIds: [],
      quality: { unconfirmed: [], captureStatus: "ok" as const },
      updatedAt: new Date(0).toISOString(),
    };
  }

  // Emite los hero_picked de ambos lados y decide si sigue a la próxima ronda o cierra la sesión.
  async function revealAndAdvance(round: 1 | 2 | 3, userPicks: HeroId[], botPicks: HeroId[]): Promise<void> {
    const config = useRandomDraftStore.getState().config;
    if (!config) return;
    const botSide = otherSide(config.userSide);

    for (const heroId of userPicks) {
      await emit({ type: "hero_picked", hero: heroId as EngineHeroId, side: config.userSide });
    }
    for (const heroId of botPicks) {
      await emit({ type: "hero_picked", hero: heroId as EngineHeroId, side: botSide });
    }

    await new Promise((resolve) => setTimeout(resolve, REVEAL_PAUSE_MS));

    useRandomDraftStore.getState().confirmRound(); // round_revealed -> siguiente blind_round o complete

    const next = useRandomDraftStore.getState().phase;
    if (next.type === "blind_round") {
      beginRound(next.round);
    } else if (next.type === "complete") {
      await emit({ type: "session_ended", reason: "completed" }); // Req. 3.8
    }
  }

  return {
    state: { config, phase, sessionId, draftState, suggestions, staleWarning, lastSyncedAt },
    actions: { confirmPick, deselectPick, resetSession },
    startDraft,
    confirmRound,
  };
}
