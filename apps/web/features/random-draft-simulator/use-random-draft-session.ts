// apps/web/features/random-draft-simulator/use-random-draft-session.ts
// Puente entre RandomDraftStore y el motor: crea el sessionId, resuelve la Ban_Phase, emite
// todos los eventos, gestiona el timer de cada Blind_Round y resuelve Conflict_Ban.
// Requirements: 2.1, 2.4, 3.3, 3.4-3.7, 5.1-5.4, 9.3, 9.6

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftArchetype } from "@/features/draft/types";
import { postSimulatorEvent } from "@/features/draft/manual-entry";
import { createDraftSocket } from "@/features/draft/socket";
import { isValidServerMessage, isValidSuggestionSet } from "@/features/draft/validation";
import type { SimulatorEvent } from "@/features/draft/simulator-scripts";
import type {
  DraftSocket,
  DraftSocketFactory,
  DraftState as EngineDraftState,
  HeroId as EngineHeroId,
  ServerMessage,
  SuggestionSet,
  TeamSide,
} from "@/features/draft/types";
import { postLowConfidenceReport } from "@/features/pro-drafter/types";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import type { SeededRng } from "./seeded-rng";
import { createSeededRng } from "./seeded-rng";
import { initDraft, type OrchestratorResult } from "./orchestrator";
import { botPickHeroFromEngine, type MetaSnapshot } from "./bot-drafter";
import { BLIND_ROUND_SPECS } from "./constants";
import { useLowConfidenceStore } from "./low-confidence-store";
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

// El preview HTTP no comparte el seq/sessionId de la sesión viva. Solo se vincula al estado
// local después de validar el payload real del engine; un cambio de contrato no llega a Zustand
// como una suggestion parcialmente tipada.
export function bindPreviewSuggestions(payload: unknown, draftState: Pick<EngineDraftState, "sessionId" | "lastSeq">): SuggestionSet | null {
  if (!isValidSuggestionSet(payload)) return null;
  return { ...payload, sessionId: draftState.sessionId, basedOnSeq: draftState.lastSeq };
}

export function specForRound(round: 1 | 2 | 3) {
  return BLIND_ROUND_SPECS.find((spec) => spec.round === round)!;
}

// La siguiente ronda no puede pedir un preview hasta que el motor haya confirmado los picks de
// las rondas anteriores. Antes de esa confirmación, el Copilot calcularía contra el tablero viejo
// y su respuesta quedaría inválida en cuanto llegue el WebSocket.
export function isPreviewReadyForRound(draftState: EngineDraftState, userSide: TeamSide, round: 1 | 2 | 3): boolean {
  if (round === 1) return true;
  const expectedRevealedPicks = (round - 1) * 2;
  const botSide = otherSide(userSide);
  return draftState.picks[userSide].length >= expectedRevealedPicks
    && draftState.picks[botSide].length >= expectedRevealedPicks;
}

// Los picks de una Blind_Round siguen siendo privados hasta la revelación. Esta proyección se
// usa solo para pedir recomendaciones: incorpora lo que el usuario acaba de elegir, pero nunca
// muta la sesión real del motor ni expone los picks ocultos del bot.
export function buildPendingPickPreview(
  draftState: EngineDraftState,
  userSide: TeamSide,
  previousPendingPicks: HeroId[],
  pendingUserPicks: HeroId[],
): EngineDraftState {
  const pendingBefore = new Set(previousPendingPicks);
  const visiblePicks = draftState.picks[userSide].filter((heroId) => !pendingBefore.has(heroId));
  return {
    ...draftState,
    picks: {
      ...draftState.picks,
      [userSide]: [...visiblePicks, ...pendingUserPicks],
    },
  };
}

export function buildBotPickPreview(
  draftState: EngineDraftState,
  userSide: TeamSide,
  userPicks: HeroId[],
  botPicks: HeroId[],
): EngineDraftState {
  const botSide = otherSide(userSide);
  const addUnique = (existing: HeroId[], additions: HeroId[]) => [...existing, ...additions.filter((heroId) => !existing.includes(heroId))];

  return {
    ...draftState,
    localSide: botSide,
    picks: {
      radiant: botSide === "radiant" ? addUnique(draftState.picks.radiant, botPicks) : addUnique(draftState.picks.radiant, userPicks),
      dire: botSide === "dire" ? addUnique(draftState.picks.dire, botPicks) : addUnique(draftState.picks.dire, userPicks),
    },
  };
}

function sameHeroIds(left: HeroId[], right: HeroId[]): boolean {
  return left.length === right.length && left.every((heroId, index) => heroId === right[index]);
}

// La respuesta del preview llega por HTTP y el estado canónico por WS: no se compara identidad
// de objeto porque el WS siempre deserializa otro objeto. Solo se aplica si el tablero todavía
// representa exactamente el escenario que se pidió, evitando pintar una respuesta vieja.
function matchesPreviewState(current: EngineDraftState, preview: EngineDraftState): boolean {
  return (
    current.localSide === preview.localSide &&
    sameHeroIds(current.banned, preview.banned) &&
    sameHeroIds(current.picks.radiant, preview.picks.radiant) &&
    sameHeroIds(current.picks.dire, preview.picks.dire)
  );
}

// Cuando el preview HTTP llega antes que el último draft_state del WS, el contenido sigue siendo
// válido si el tablero es idéntico. Se adelanta solo la secuencia para que Copilot no lo descarte
// como obsoleto; cualquier pick o ban distinto invalida el preview por completo.
export function rebasePreviewSuggestions(
  previewState: EngineDraftState,
  websocketState: EngineDraftState,
  suggestions: SuggestionSet,
): SuggestionSet | null {
  if (!matchesPreviewState(websocketState, previewState)) return null;
  return { ...suggestions, sessionId: websocketState.sessionId, basedOnSeq: websocketState.lastSeq };
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
  state: RandomDraftState & { archetypeIntent: DraftArchetype | null };
  actions: Pick<RandomDraftActions, "confirmPick" | "deselectPick"> & {
    resetDraft(): void;
    retryPreview(): void;
    setArchetypeIntent(intent: DraftArchetype | null): void;
  };
  startDraft(config: StartDraftConfig): Promise<void>;
  confirmRound(): Promise<void>;
}

export interface UseRandomDraftSessionOptions {
  wsUrl?: string;
  // Costura S5 (testing-seams.md): mismo patrón que DraftViewProps.socketFactory -- inyectable
  // para pruebas (FakeSocket), por defecto el WebSocket real del navegador.
  socketFactory?: DraftSocketFactory;
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
  const previewStatus = useRandomDraftStore((s) => s.previewStatus);
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
  const previewRequestKeyRef = useRef<string | null>(null);
  const previewPendingRef = useRef<{ round: 1 | 2 | 3; picks: HeroId[] } | null>(null);
  // TSK-182 (Fase 4.3b): intención de draft del usuario para archetype_fit. Ref para que
  // refreshPendingPickPreview (useCallback [], 100% imperativo) lea el valor vigente; state
  // para que el selector de la UI se pinte. `null` = sin intención.
  const archetypeIntentRef = useRef<DraftArchetype | null>(null);
  const [archetypeIntent, setArchetypeIntentState] = useState<DraftArchetype | null>(null);

  const stopTimer = useCallback(function stopTimer(): void {
    if (timerIdRef.current !== null) {
      clearInterval(timerIdRef.current);
      timerIdRef.current = null;
    }
  }, []);

  // Un nuevo simulador no puede heredar el timer ni el WebSocket de la partida anterior.
  // Al vaciar primero el ref de sesión, el onClose del socket no intentará reconectarlo.
  const resetDraft = useCallback(function resetDraft(): void {
    stopTimer();
    sessionIdRef.current = null;
    previewRequestKeyRef.current = null;
    previewPendingRef.current = null;
    archetypeIntentRef.current = null;
    setArchetypeIntentState(null);
    socketRef.current?.close();
    socketRef.current = null;
    resetSession();
  }, [resetSession, stopTimer]);

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

  const refreshPendingPickPreview = useCallback(async function refreshPendingPickPreview(
    previousPendingPicks: HeroId[],
    pendingUserPicks: HeroId[],
  ): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (!current.config || !current.sessionId) return;

    const baseState = current.draftState ?? {
      sessionId: current.sessionId,
      schema: "draft-state/v1" as const,
      format: "all_pick" as const,
      patch: current.config.patch,
      localSide: current.config.userSide,
      phase: "active" as const,
      banned: resolvedBansRef.current,
      picks: { radiant: [], dire: [] },
      lastSeq: 0,
      appliedEventIds: [],
      quality: { unconfirmed: [], captureStatus: "ok" as const },
      updatedAt: new Date(0).toISOString(),
      firstPickSide: null,
      turnStartedAt: null,
      reserveRemainingMs: null,
      turn: null,
    };

    const previewState = buildPendingPickPreview(
      baseState,
      current.config.userSide,
      previousPendingPicks,
      pendingUserPicks,
    );
    // Mientras se calcula, las sugerencias anteriores no se presentan como si correspondieran
    // al pick recién elegido. Copilot pasa a "loading" -- nunca queda en un "actualizando" sin
    // salida: termina en "ready" o "failed" (con retry), nunca vuelve a colgarse en silencio.
    useRandomDraftStore.getState().setDraftState(previewState, null);
    useRandomDraftStore.getState().setPreviewStatus("loading");

    function isStillCurrentRequest(): boolean {
      const latest = useRandomDraftStore.getState();
      if (!latest.draftState || !matchesPreviewState(latest.draftState, previewState)) return false;
      if (latest.phase.type !== "blind_round") return false;
      return latest.phase.pendingUserPicks.join(",") === pendingUserPicks.join(",");
    }

    try {
      const response = await fetch(`${ENGINE_HTTP_BASE_URL}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: previewState.format,
          patch: previewState.patch,
          localSide: previewState.localSide,
          banned: previewState.banned,
          picks: previewState.picks,
          teamOpening: previewState.picks.radiant.length === 0 && previewState.picks.dire.length === 0,
          diversitySeed: current.config.draftSeed,
          archetypeIntent: archetypeIntentRef.current ?? undefined,
        }),
      });
      if (!response.ok) {
        if (isStillCurrentRequest()) useRandomDraftStore.getState().setPreviewStatus("failed");
        return;
      }

      const payload: unknown = await response.json();
      if (!isStillCurrentRequest()) return;
      const latest = useRandomDraftStore.getState();
      const draftStateForResponse = latest.draftState!;
      const suggestions = bindPreviewSuggestions(payload, draftStateForResponse);
      if (suggestions === null) {
        useRandomDraftStore.getState().setPreviewStatus("failed");
        return;
      }

      useRandomDraftStore.getState().setDraftState(draftStateForResponse, suggestions);
      useRandomDraftStore.getState().setPreviewStatus("ready");
    } catch {
      // La selección sigue siendo válida sin preview: el motor recalcula al revelar la ronda.
      // El estado visible para el usuario es "failed" -- CopilotPanel ofrece reintentar, nunca
      // se queda mostrando "actualizando" para siempre.
      if (isStillCurrentRequest()) useRandomDraftStore.getState().setPreviewStatus("failed");
    }
  }, []);

  // Único disparador de previews: cada cambio de ronda o pick pendiente solicita exactamente una
  // recomendación. Para las rondas 2 y 3 espera el estado revelado del motor; así nunca queda una
  // sugerencia asociada a una ronda anterior ni un Copilot esperando una llamada que nadie hizo.
  useEffect(function refreshPreviewForBlindRound() {
    if (!config || phase.type !== "blind_round") return;
    if (phase.round > 1 && (!draftState || !isPreviewReadyForRound(draftState, config.userSide, phase.round))) return;

    const requestKey = `${sessionId}:${phase.round}:${phase.pendingUserPicks.join(",")}`;
    if (previewRequestKeyRef.current === requestKey) return;
    previewRequestKeyRef.current = requestKey;
    const previousPendingPicks = previewPendingRef.current?.round === phase.round
      ? previewPendingRef.current.picks
      : [];
    previewPendingRef.current = { round: phase.round, picks: phase.pendingUserPicks };
    void refreshPendingPickPreview(previousPendingPicks, phase.pendingUserPicks);
  }, [config, draftState, phase, refreshPendingPickPreview, sessionId]);

  // Reintento manual (Copilot "failed"): repite el mismo pedido de la ronda vigente sin esperar un
  // nuevo pick/ban -- el guard de `refreshPreviewForBlindRound` de arriba solo dispara ante un
  // cambio de estado, así que un reintento explícito necesita saltarlo a propósito.
  const retryPreview = useCallback(function retryPreview(): void {
    const { phase: currentPhase } = useRandomDraftStore.getState();
    if (currentPhase.type !== "blind_round") return;
    const previousPendingPicks = previewPendingRef.current?.round === currentPhase.round
      ? previewPendingRef.current.picks
      : [];
    void refreshPendingPickPreview(previousPendingPicks, currentPhase.pendingUserPicks);
  }, [refreshPendingPickPreview]);

  // TSK-182 (Fase 4.3b): elegir/limpiar la intención re-pide la sugerencia de la ronda vigente
  // con el arquetipo nuevo en el body (bypass del dedup, igual que retryPreview). En idle/ban
  // sólo guarda el valor -- el próximo preview natural lo toma del ref.
  const setArchetypeIntent = useCallback(function setArchetypeIntent(next: DraftArchetype | null): void {
    archetypeIntentRef.current = next;
    setArchetypeIntentState(next);
    const { phase: currentPhase } = useRandomDraftStore.getState();
    if (currentPhase.type !== "blind_round") return;
    const previousPendingPicks = previewPendingRef.current?.round === currentPhase.round
      ? previewPendingRef.current.picks
      : [];
    void refreshPendingPickPreview(previousPendingPicks, currentPhase.pendingUserPicks);
  }, [refreshPendingPickPreview]);

  const confirmPendingPick = useCallback(function confirmPendingPick(heroId: HeroId): void {
    const before = useRandomDraftStore.getState().phase;
    if (before.type !== "blind_round" || before.pendingUserPicks.includes(heroId)) return;

    confirmPick(heroId);
  }, [confirmPick]);

  const deselectPendingPick = useCallback(function deselectPendingPick(heroId: HeroId): void {
    const before = useRandomDraftStore.getState().phase;
    if (before.type !== "blind_round" || !before.pendingUserPicks.includes(heroId)) return;

    deselectPick(heroId);
  }, [deselectPick]);

  async function emit(payload: SimulatorEvent): Promise<void> {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return;
    // Reintento con backoff -- Req. 9.6, mismo patrón que reconectar el WebSocket abajo.
    const delays = [0, 200, 400];
    // Diagnóstico: el motivo real de rechazo (rejected) o "network_error" -- antes el log final
    // solo mostraba el payload, una caja negra para diagnosticar por qué falló cada reintento.
    let lastReason: string | undefined;
    for (const delay of delays) {
      if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        const result = await postSimulatorEvent(sessionId, nextSeq(), payload);
        if (result.accepted) return;
        lastReason = result.rejected ?? "rejected_no_reason";
      } catch {
        // Reintenta con el siguiente delay; si se agotan, el evento se pierde (no hay más
        // reintentos posibles sin bloquear indefinidamente la sesión).
        lastReason = "network_error";
      }
    }
    console.error("[useRandomDraftSession] no se pudo emitir el evento tras reintentos:", payload, "motivo:", lastReason);
  }

  async function connectSocket(sessionId: string): Promise<void> {
    socketRef.current?.close();
    let socket: DraftSocket;
    let accountToken: string;
    try {
      ({ socket, accountToken } = await socketFactory(wsUrl));
    } catch {
      console.error("[useRandomDraftSession] no se pudo autenticar la conexión de draft");
      return;
    }
    socket.onMessage(function handleMessage(message: ServerMessage) {
      if (!isValidServerMessage(message)) return;
      if (message.type === "draft_state" || message.type === "snapshot") {
        const websocketState = message.payload as EngineDraftState;
        const current = useRandomDraftStore.getState();
        const rebased = current.config && current.draftState && current.suggestions
          ? rebasePreviewSuggestions(current.draftState, websocketState, current.suggestions)
          : null;
        useRandomDraftStore.getState().setDraftState(websocketState, rebased ?? current.suggestions);
      } else if (message.type === "suggestions") {
        // El simulador pide su preview autenticado (pool + rol + diversidad). Las sugerencias
        // genéricas del WS no tienen ese contexto y nunca deben sobrescribirlo.
        if (useRandomDraftStore.getState().config) return;
        const current = useRandomDraftStore.getState().draftState;
        if (current) useRandomDraftStore.getState().setDraftState(current, message.payload as SuggestionSet);
      }
    });
    // Req. 9.6: al reconectar, reenvía "hello" con el mismo sessionId -- createDraftSocket ya
    // encola el primer mensaje si el WS todavía está CONNECTING (ver socket.ts).
    socket.onClose(function handleClose() {
      if (sessionIdRef.current !== sessionId) return; // sesión ya se cerró/cambió, no reconectar
      void connectSocket(sessionId);
    });
    socket.send({ schema: "draft-ws/v1", type: "hello", sessionId, accountToken });
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
    previewRequestKeyRef.current = null;
    previewPendingRef.current = null;

    const { meta, allHeroIds, metaBanPool, currentPatch } = await loadMetaSnapshot();
    const config: DraftConfig = { ...input, patch: currentPatch };
    metaRef.current = { meta, allHeroIds };
    rngRef.current = createSeededRng(config.draftSeed);

    const orchestratorResult: OrchestratorResult = await initDraft({
      draftSeed: config.draftSeed,
      userSide: config.userSide,
      personalBanList: config.personalBanList,
      meta,
      metaBanPool,
      patch: config.patch,
    });
    resolvedBansRef.current = orchestratorResult.resolvedBans;

    useRandomDraftStore.getState().startSession(config, sessionId, orchestratorResult);
    void connectSocket(sessionId);

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
  }, [refreshPendingPickPreview, stopTimer]);

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

    const rng = rngRef.current;
    const meta = metaRef.current;
    if (!rng || !meta) return;

    // El bot responde a los picks que el usuario acaba de cerrar. El plan original se generaba
    // con un tablero vacío y por eso coincidía demasiado con las recomendaciones del Copilot.
    const botPicks = await recalculateBotPicks(before.round, before.pendingUserPicks, [], specForRound(before.round).picksPerTeam, rng, meta);
    const current = useRandomDraftStore.getState().phase;
    if (current.type !== "blind_round" || current.round !== before.round) return;
    useRandomDraftStore.getState().setBotPicksForRound(before.round, botPicks);

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
      const newBotPicks = await recalculateBotPicks(round, remainingUserPicks, remainingBotPicks, collidedHeroes.length, rng, meta);

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
    const newBotPicks = await recalculateBotPicks(round, userPicks, survivingBotPicks, collidedHeroes.length, rng, meta);
    useRandomDraftStore.getState().patchRevealedRound({ userPicks, botPicks: newBotPicks });
    await revealAndAdvance(round, userPicks, newBotPicks);
  }

  // TSK-083: async -- cada pick recalculado le pide la sugerencia real al motor
  // (botPickHeroFromEngine), con el mismo fallback al scoring simplificado que initDraft.
  async function recalculateBotPicks(
    round: 1 | 2 | 3,
    userPicks: HeroId[],
    survivingBotPicks: HeroId[],
    countNeeded: number,
    rng: SeededRng,
    meta: { meta: MetaSnapshot; allHeroIds: HeroId[] },
  ): Promise<HeroId[]> {
    const state = useRandomDraftStore.getState();
    const result = [...survivingBotPicks];
    for (let i = 0; i < countNeeded; i++) {
      const picked = await botPickHeroFromEngine({
        draftState: buildBotDraftState(state, userPicks, result),
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

  function buildBotDraftState(state: RandomDraftState, userPicks: HeroId[], botPicksSoFar: HeroId[]) {
    const visibleState = state.draftState;
    const baseState: EngineDraftState = visibleState ?? {
      sessionId: sessionIdRef.current ?? "",
      schema: "draft-state/v1" as const,
      format: "all_pick" as const,
      patch: state.config!.patch,
      localSide: state.config!.userSide,
      phase: "active" as const,
      banned: resolvedBansRef.current,
      picks: { radiant: [], dire: [] },
      lastSeq: 0,
      appliedEventIds: [],
      quality: { unconfirmed: [], captureStatus: "ok" as const },
      updatedAt: new Date(0).toISOString(),
      firstPickSide: null,
      turnStartedAt: null,
      reserveRemainingMs: null,
      turn: null,
    };
    return buildBotPickPreview(baseState, state.config!.userSide, userPicks, botPicksSoFar);
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

      // Diagnóstico de curación de corpus (sesión Gobernanza 2.0): best-effort, nunca bloquea ni
      // rompe el cierre real de la sesión de arriba -- postLowConfidenceReport ya atrapa sus
      // propios errores. `getState()` en vez de una dependencia del hook: este flush corre una
      // sola vez, al cerrar, no necesita re-suscribirse a cambios de `sightings` durante el draft.
      const { sightings, reset } = useLowConfidenceStore.getState();
      if (sightings.size > 0) {
        // Hallazgo real (verificado en navegador, no supuesto): el DraftState del simulador puede
        // traer `patch: ""` (string vacío, no null/undefined) -- `??` no lo cubre, `||` sí.
        const patch = useRandomDraftStore.getState().draftState?.patch || "unknown";
        void postLowConfidenceReport(sessionIdRef.current ?? "unknown", patch, [...sightings.values()]);
        reset();
      }
    }
  }

  return {
    state: { config, phase, sessionId, draftState, suggestions, previewStatus, staleWarning, lastSyncedAt, archetypeIntent },
    actions: { confirmPick: confirmPendingPick, deselectPick: deselectPendingPick, resetDraft, retryPreview, setArchetypeIntent },
    startDraft,
    confirmRound,
  };
}
