"use client";

import { useEffect, useState } from "react";
import { ComparisonNote } from "@/components/comparison-note/ComparisonNote";
import { DraftBoard } from "@/components/draft-board/DraftBoard";
import { DraftSetupPanel } from "@/components/draft-setup-panel/DraftSetupPanel";
import { ManualEntryPanel } from "@/components/manual-entry-panel/ManualEntryPanel";
import { PartyPoolPanel } from "@/components/party-pool-panel/PartyPoolPanel";
import { SuggestionCard } from "@/components/suggestion-card/SuggestionCard";
import { DraftPathsCoverFlow } from "@/features/draft-paths";
import type { DraftTeamGroup } from "@/features/team-groups/types";
import { DEGRADATION_LABELS, SCREEN_STATE_GUIDANCE } from "./constants";
import { createDraftSocket } from "./socket";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./styles";
import { deriveScreenState, useDraftStore } from "./store";
import type { DraftSocket, DraftState, ScreenState, SuggestionSet } from "./types";
import type { HeroMeta } from "./use-hero-catalog";
import { useHeroCatalog } from "./use-hero-catalog";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://127.0.0.1:4000/ws/draft";

interface StateGuidanceProps {
  state: ScreenState;
}

// Texto en lenguaje llano de "qué es esto / qué puedo hacer ahora", uno por cada uno de los 6
// estados de TSK-012 -- ninguno se calla (regla dura de TSK-016).
function StateGuidance({ state }: StateGuidanceProps) {
  return <p className="text-body text-content-secondary">{SCREEN_STATE_GUIDANCE[state]}</p>;
}

interface WaitingForDraftStateProps {
  onOpenManualEntry: () => void;
  onOpenSimulator: () => void;
}

function WaitingForDraftState({ onOpenManualEntry, onOpenSimulator }: WaitingForDraftStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <span className="text-heading text-content-primary">Esperando a que empiece el draft</span>
      <StateGuidance state="esperando_draft" />
      <div className="flex gap-3">
        <button type="button" onClick={onOpenManualEntry} className={BUTTON_SECONDARY}>
          Entrada manual
        </button>
        <button type="button" onClick={onOpenSimulator} className={BUTTON_SECONDARY}>
          Simular draft
        </button>
      </div>
    </div>
  );
}

interface CaptureLostBannerProps {
  onOpenManualEntry: () => void;
}

// Camino de degradación: cuando capture_health:'lost' llega por WebSocket, el aviso se muestra y
// la entrada manual queda habilitada sin perder el estado ya capturado -- draftState sigue
// visible debajo, nunca se limpia (regla dura del ticket).
function CaptureLostBanner({ onOpenManualEntry }: CaptureLostBannerProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-signal-negative bg-surface-raised p-4">
      <span className="text-body text-content-primary">Se perdió la captura automática del draft.</span>
      <button type="button" onClick={onOpenManualEntry} className={BUTTON_PRIMARY}>
        Entrada manual
      </button>
    </div>
  );
}

interface ActiveDraftStateProps {
  sessionId: string;
  draftState: DraftState;
  suggestions: SuggestionSet | null;
  partyContext: DraftTeamGroup | null;
  heroCatalog: Map<number, HeroMeta>;
  onOpenManualEntry: () => void;
}

function ActiveDraftState({ sessionId, draftState, suggestions, partyContext, heroCatalog, onOpenManualEntry }: ActiveDraftStateProps) {
  const primary = suggestions?.suggestions.find((s) => s.rank === 1);
  const alternatives = suggestions?.suggestions.filter((s) => s.rank !== 1) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <StateGuidance state="activo" />
      {draftState.quality.captureStatus === "lost" && <CaptureLostBanner onOpenManualEntry={onOpenManualEntry} />}
      <DraftPathsCoverFlow sessionId={sessionId} heroCatalog={heroCatalog} />
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
        <div className="flex flex-col gap-3">
          <PartyPoolPanel partyContext={partyContext} draftState={draftState} heroCatalog={heroCatalog} />
          {primary && <SuggestionCard suggestion={primary} heroMeta={heroCatalog.get(primary.hero)} isPrimary />}
          {suggestions?.comparison && (
            <ComparisonNote comparison={suggestions.comparison} heroMeta={heroCatalog.get(suggestions.comparison.vsHero)} />
          )}
          {alternatives.map((suggestion) => (
            <SuggestionCard key={suggestion.hero} suggestion={suggestion} heroMeta={heroCatalog.get(suggestion.hero)} isPrimary={false} />
          ))}
        </div>
      </div>
    </div>
  );
}

interface DegradedDraftStateProps {
  sessionId: string;
  draftState: DraftState;
  suggestions: SuggestionSet;
  partyContext: DraftTeamGroup | null;
  heroCatalog: Map<number, HeroMeta>;
  onOpenManualEntry: () => void;
}

function DegradedDraftState({ sessionId, draftState, suggestions, partyContext, heroCatalog, onOpenManualEntry }: DegradedDraftStateProps) {
  return (
    <div className="flex flex-col gap-4">
      <StateGuidance state="degradado" />
      <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-raised p-4">
        {suggestions.degraded.map((flag) => (
          <span key={flag} className="text-caption text-signal-warning">
            {DEGRADATION_LABELS[flag]}
          </span>
        ))}
      </div>
      <ActiveDraftState
        sessionId={sessionId}
        draftState={draftState}
        suggestions={suggestions}
        partyContext={partyContext}
        heroCatalog={heroCatalog}
        onOpenManualEntry={onOpenManualEntry}
      />
    </div>
  );
}

interface CompletedDraftStateProps {
  draftState: DraftState;
  heroCatalog: Map<number, HeroMeta>;
  onOpenSimulator: () => void;
}

function CompletedDraftState({ draftState, heroCatalog, onOpenSimulator }: CompletedDraftStateProps) {
  return (
    <div className="flex flex-col gap-4">
      <span className="text-heading text-content-primary">Draft final</span>
      <StateGuidance state="completo" />
      <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
      <button type="button" onClick={onOpenSimulator} className={`self-start ${BUTTON_SECONDARY}`}>
        Simular otro draft
      </button>
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <span className="text-heading text-signal-negative">Ocurrió un error</span>
      <StateGuidance state="error" />
      <span className="text-body text-content-secondary">{message}</span>
      <button type="button" onClick={onRetry} className={BUTTON_PRIMARY}>
        Reintentar
      </button>
    </div>
  );
}

interface DisconnectedStateProps {
  draftState: DraftState | null;
  heroCatalog: Map<number, HeroMeta>;
  onReconnect: () => void;
}

function DisconnectedState({ draftState, heroCatalog, onReconnect }: DisconnectedStateProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border border-signal-warning bg-surface-raised p-4">
        <span className="text-body text-content-primary">Desconectado del motor de sugerencias</span>
        <button type="button" onClick={onReconnect} className={BUTTON_PRIMARY}>
          Reconectar
        </button>
      </div>
      <StateGuidance state="desconectado" />
      {draftState && (
        <div className="opacity-40">
          <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
        </div>
      )}
    </div>
  );
}

interface DraftViewBodyProps {
  sessionId: string;
  screenState: ScreenState;
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  partyContext: DraftTeamGroup | null;
  errorMessage: string | null;
  heroCatalog: Map<number, HeroMeta>;
  onReconnect: () => void;
  onOpenManualEntry: () => void;
  onOpenSimulator: () => void;
}

// deriveScreenState (store.ts) garantiza draftState/suggestions no nulos en las ramas que los
// exigen -- las aserciones `!` reflejan esa garantía, no una suposición del componente.
function DraftViewBody(props: DraftViewBodyProps) {
  switch (props.screenState) {
    case "desconectado":
      return <DisconnectedState draftState={props.draftState} heroCatalog={props.heroCatalog} onReconnect={props.onReconnect} />;
    case "esperando_draft":
      return <WaitingForDraftState onOpenManualEntry={props.onOpenManualEntry} onOpenSimulator={props.onOpenSimulator} />;
    case "activo":
      return (
        <ActiveDraftState
          draftState={props.draftState!}
          sessionId={props.sessionId}
          suggestions={props.suggestions}
          partyContext={props.partyContext}
          heroCatalog={props.heroCatalog}
          onOpenManualEntry={props.onOpenManualEntry}
        />
      );
    case "degradado":
      return (
        <DegradedDraftState
          draftState={props.draftState!}
          sessionId={props.sessionId}
          suggestions={props.suggestions!}
          partyContext={props.partyContext}
          heroCatalog={props.heroCatalog}
          onOpenManualEntry={props.onOpenManualEntry}
        />
      );
    case "completo":
      return <CompletedDraftState draftState={props.draftState!} heroCatalog={props.heroCatalog} onOpenSimulator={props.onOpenSimulator} />;
    case "error":
      return <ErrorState message={props.errorMessage ?? "Error desconocido"} onRetry={props.onReconnect} />;
  }
}

export interface DraftViewProps {
  sessionId: string;
  wsUrl?: string;
  socketFactory?: (url: string) => DraftSocket; // inyectable para pruebas (FakeSocket, costura S5)
}

// Única excepción de datos en apps/web: WebSocket + Zustand, nunca RTK Query, para el estado de
// draft en vivo (web.md). El mismo árbol de componentes sirve en pestaña normal o embebido en un
// overlay de Overwolf -- sin ninguna rama de "modo overlay".
export function DraftView({ sessionId: initialSessionId, wsUrl = DEFAULT_WS_URL, socketFactory = createDraftSocket }: DraftViewProps) {
  const connectionStatus = useDraftStore((s) => s.connectionStatus);
  const draftState = useDraftStore((s) => s.draftState);
  const suggestions = useDraftStore((s) => s.suggestions);
  const partyContext = useDraftStore((s) => s.partyContext);
  const errorMessage = useDraftStore((s) => s.errorMessage);
  const connect = useDraftStore((s) => s.connect);
  const disconnect = useDraftStore((s) => s.disconnect);
  const clearError = useDraftStore((s) => s.clearError);
  const { heroes: heroCatalog } = useHeroCatalog();
  const [sessionId, setSessionId] = useState(initialSessionId);
  const [isManualEntryOpen, setManualEntryOpen] = useState(false);
  const [isSetupPanelOpen, setSetupPanelOpen] = useState(false);

  useEffect(() => {
    connect(socketFactory(wsUrl), sessionId);
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- socketFactory/connect/disconnect son estables
  }, [wsUrl, sessionId]);

  function handleReconnect() {
    clearError();
    connect(socketFactory(wsUrl), sessionId);
  }

  function openManualEntry() {
    setManualEntryOpen(true);
  }

  function closeManualEntry() {
    setManualEntryOpen(false);
  }

  function openSetupPanel() {
    setSetupPanelOpen(true);
  }

  function closeSetupPanel() {
    setSetupPanelOpen(false);
  }

  // Arrancar un escenario cambia de sesión (nunca reutiliza una sesión ya usada, para no
  // acumular estado de una corrida anterior) -- el efecto de arriba reconecta el socket solo.
  function startScenario(newSessionId: string) {
    setSessionId(newSessionId);
  }

  const screenState = deriveScreenState({ connectionStatus, draftState, suggestions, errorMessage });
  // La entrada manual existe para "cuando la detección automática falla o no existe" -- una vez
  // el draft termina, ya no tiene nada que corregir. Se deriva del estado en vez de sincronizarla
  // con un efecto: si el draft ya está completo, el panel nunca se muestra aunque siga "abierto".
  const isManualEntryVisible = isManualEntryOpen && draftState?.phase !== "complete" && draftState?.phase !== "aborted";

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <DraftViewBody
        screenState={screenState}
        sessionId={sessionId}
        draftState={draftState}
        suggestions={suggestions}
        partyContext={partyContext}
        errorMessage={errorMessage}
        heroCatalog={heroCatalog}
        onReconnect={handleReconnect}
        onOpenManualEntry={openManualEntry}
        onOpenSimulator={openSetupPanel}
      />
      {isManualEntryVisible && (
        <ManualEntryPanel
          sessionId={sessionId}
          lastSeq={draftState?.lastSeq ?? 0}
          heroes={Array.from(heroCatalog.values())}
          onClose={closeManualEntry}
        />
      )}
      {isSetupPanelOpen && (
        <DraftSetupPanel connectionStatus={connectionStatus} onStart={startScenario} onClose={closeSetupPanel} />
      )}
    </div>
  );
}
