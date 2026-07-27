"use client";

import { useEffect } from "react";
import { DraftBoard } from "@/components/draft-board/DraftBoard";
import { SuggestionCard } from "@/components/suggestion-card/SuggestionCard";
import { DEGRADATION_LABELS } from "./constants";
import { createDraftSocket } from "./socket";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "./styles";
import { deriveScreenState, useDraftStore } from "./store";
import type { DraftSocket, DraftState, ScreenState, SuggestionSet } from "./types";
import type { HeroMeta } from "./use-hero-catalog";
import { useHeroCatalog } from "./use-hero-catalog";

const DEFAULT_WS_URL = process.env.NEXT_PUBLIC_ENGINE_WS_URL ?? "ws://127.0.0.1:4000/ws/draft";

// TSK-011 (simulador) y TSK-013 (entrada manual) todavía no existen -- placeholders
// intencionales, nombrados (nunca funciones anónimas inline) para que el botón exista ya,
// tal como pide el estado `esperando_draft`, sin fingir una integración que no está lista.
function handleManualEntryClick() {}
function handleSimulatorClick() {}

function WaitingForDraftState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <span className="text-heading text-content-primary">Esperando a que empiece el draft</span>
      <div className="flex gap-3">
        <button type="button" onClick={handleManualEntryClick} className={BUTTON_SECONDARY}>
          Entrada manual
        </button>
        <button type="button" onClick={handleSimulatorClick} className={BUTTON_SECONDARY}>
          Simulador
        </button>
      </div>
    </div>
  );
}

interface ActiveDraftStateProps {
  draftState: DraftState;
  suggestions: SuggestionSet | null;
  heroCatalog: Map<number, HeroMeta>;
}

function ActiveDraftState({ draftState, suggestions, heroCatalog }: ActiveDraftStateProps) {
  const primary = suggestions?.suggestions.find((s) => s.rank === 1);
  const alternatives = suggestions?.suggestions.filter((s) => s.rank !== 1) ?? [];

  return (
    <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
      <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
      <div className="flex flex-col gap-3">
        {primary && <SuggestionCard suggestion={primary} heroMeta={heroCatalog.get(primary.hero)} isPrimary />}
        {alternatives.map((suggestion) => (
          <SuggestionCard key={suggestion.hero} suggestion={suggestion} heroMeta={heroCatalog.get(suggestion.hero)} isPrimary={false} />
        ))}
      </div>
    </div>
  );
}

interface DegradedDraftStateProps {
  draftState: DraftState;
  suggestions: SuggestionSet;
  heroCatalog: Map<number, HeroMeta>;
}

function DegradedDraftState({ draftState, suggestions, heroCatalog }: DegradedDraftStateProps) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-raised p-4">
        {suggestions.degraded.map((flag) => (
          <span key={flag} className="text-caption text-signal-warning">
            {DEGRADATION_LABELS[flag]}
          </span>
        ))}
      </div>
      <ActiveDraftState draftState={draftState} suggestions={suggestions} heroCatalog={heroCatalog} />
    </div>
  );
}

interface CompletedDraftStateProps {
  draftState: DraftState;
  heroCatalog: Map<number, HeroMeta>;
}

function CompletedDraftState({ draftState, heroCatalog }: CompletedDraftStateProps) {
  return (
    <div className="flex flex-col gap-4">
      <span className="text-heading text-content-primary">Draft final</span>
      <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
    </div>
  );
}

interface ErrorStateProps {
  message: string;
  onRetry: () => void;
}

function ErrorState({ message, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4">
      <span className="text-heading text-signal-negative">Ocurrió un error</span>
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
      {draftState && (
        <div className="opacity-40">
          <DraftBoard draftState={draftState} heroCatalog={heroCatalog} />
        </div>
      )}
    </div>
  );
}

interface DraftViewBodyProps {
  screenState: ScreenState;
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  errorMessage: string | null;
  heroCatalog: Map<number, HeroMeta>;
  onReconnect: () => void;
}

// deriveScreenState (store.ts) garantiza draftState/suggestions no nulos en las ramas que los
// exigen -- las aserciones `!` reflejan esa garantía, no una suposición del componente.
function DraftViewBody(props: DraftViewBodyProps) {
  switch (props.screenState) {
    case "desconectado":
      return <DisconnectedState draftState={props.draftState} heroCatalog={props.heroCatalog} onReconnect={props.onReconnect} />;
    case "esperando_draft":
      return <WaitingForDraftState />;
    case "activo":
      return <ActiveDraftState draftState={props.draftState!} suggestions={props.suggestions} heroCatalog={props.heroCatalog} />;
    case "degradado":
      return <DegradedDraftState draftState={props.draftState!} suggestions={props.suggestions!} heroCatalog={props.heroCatalog} />;
    case "completo":
      return <CompletedDraftState draftState={props.draftState!} heroCatalog={props.heroCatalog} />;
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
export function DraftView({ sessionId, wsUrl = DEFAULT_WS_URL, socketFactory = createDraftSocket }: DraftViewProps) {
  const connectionStatus = useDraftStore((s) => s.connectionStatus);
  const draftState = useDraftStore((s) => s.draftState);
  const suggestions = useDraftStore((s) => s.suggestions);
  const errorMessage = useDraftStore((s) => s.errorMessage);
  const connect = useDraftStore((s) => s.connect);
  const disconnect = useDraftStore((s) => s.disconnect);
  const clearError = useDraftStore((s) => s.clearError);
  const { heroes: heroCatalog } = useHeroCatalog();

  useEffect(() => {
    connect(socketFactory(wsUrl), sessionId);
    return disconnect;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- socketFactory/connect/disconnect son estables
  }, [wsUrl, sessionId]);

  function handleReconnect() {
    clearError();
    connect(socketFactory(wsUrl), sessionId);
  }

  const screenState = deriveScreenState({ connectionStatus, draftState, suggestions, errorMessage });

  return (
    <div className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <DraftViewBody
        screenState={screenState}
        draftState={draftState}
        suggestions={suggestions}
        errorMessage={errorMessage}
        heroCatalog={heroCatalog}
        onReconnect={handleReconnect}
      />
    </div>
  );
}
