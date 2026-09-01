"use client";

import type { JSX } from "react";
import { useState } from "react";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import { DraftTimer } from "@/components/draft-timer/DraftTimer";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { BUTTON_SECONDARY } from "@/features/draft/styles";
import { BanPhasePanel } from "@/features/random-draft-simulator/components/BanPhasePanel";
import { BlindRoundPanel } from "@/features/random-draft-simulator/components/BlindRoundPanel";
import { DraftIntentSelector } from "@/components/draft-intent-selector/DraftIntentSelector";
import { ConfigPanel } from "@/features/random-draft-simulator/components/ConfigPanel";
import { CopilotPanel } from "@/features/random-draft-simulator/components/CopilotPanel";
import { SessionSummaryPanel } from "@/features/random-draft-simulator/components/SessionSummaryPanel";
import { StaleWarningBanner } from "@/features/random-draft-simulator/components/StaleWarningBanner";
import { EngineUnreachableBanner } from "@/features/random-draft-simulator/components/EngineUnreachableBanner";
import { specForRound, useRandomDraftSession } from "@/features/random-draft-simulator/use-random-draft-session";
import type { RandomDraftState } from "@/features/random-draft-simulator";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { isProDrafterEnabled } from "@/app/live-draft/live-config";

type Session = ReturnType<typeof useRandomDraftSession>;

interface PhaseViewProps {
  session: Session;
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 1.1-1.4, 8.1, 8.4: configuración previa a cualquier draft.
function IdlePhaseView({ session }: PhaseViewProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* TSK-182 (Fase 4.3b): elegir la intención de draft antes de arrancar; el Copilot la usa. */}
      <DraftIntentSelector value={session.state.archetypeIntent} onChange={session.actions.setArchetypeIntent} />
      <ConfigPanel onStart={session.startDraft} />
    </div>
  );
}

// Transitorio -- el hook emite los 16 hero_banned justo después de esto y arranca la ronda 1
// (Req. 2.1). Sigue mostrándose explícitamente en vez de una pantalla en blanco mientras dura.
function BanPhaseCompletePhaseView({ session, heroCatalog }: PhaseViewProps) {
  if (session.state.phase.type !== "ban_phase_complete") return null;
  return <BanPhasePanel resolvedBans={session.state.phase.resolvedBans} heroCatalog={heroCatalog} />;
}

// BanPhasePanel "y siguientes" (Req. de la tarea 16): durante blind_round/round_revealed se seguí
// mostrando, ahora leyendo `draftState.banned` (incluye los Conflict_Ban que se hayan agregado) en
// vez del snapshot fijo de `ban_phase_complete`.
function ActiveRoundPhaseView({ session, heroCatalog }: PhaseViewProps) {
  const { phase, draftState, suggestions, previewStatus } = session.state;
  const proDrafterEnabled = isProDrafterEnabled();
  const [proHeroIds, setProHeroIds] = useState<ReadonlySet<number>>(new Set());
  if (phase.type !== "blind_round" && phase.type !== "round_revealed") return null;

  // TSK-084: mismo criterio que DraftView.tsx en /live-draft -- los mismos candidatos que ya destaca
  // el Copilot al lado, resaltados directo sobre la grilla, un solo highlight consistente.
  const highlightedHeroIds = proDrafterEnabled ? proHeroIds : new Set(suggestions?.suggestions.map((s) => s.hero) ?? []);

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <BanPhasePanel resolvedBans={draftState?.banned ?? []} heroCatalog={heroCatalog} />
        <BlindRoundPanel
          phase={phase}
          draftState={draftState}
          heroCatalog={heroCatalog}
          highlightedHeroIds={highlightedHeroIds}
          onConfirmPick={session.actions.confirmPick}
          onDeselectPick={session.actions.deselectPick}
          onConfirmRound={session.confirmRound}
        />
      </div>
      <div className="flex flex-col gap-4">
        <DraftIntentSelector value={session.state.archetypeIntent} onChange={session.actions.setArchetypeIntent} />
        <CopilotPanel
          draftState={draftState}
          suggestions={suggestions}
          heroCatalog={heroCatalog}
          previewStatus={previewStatus}
          onRetryPreview={session.actions.retryPreview}
          onSuggestedHeroIdsChange={proDrafterEnabled ? setProHeroIds : undefined}
          playerPosition={session.state.config?.playerPosition}
        />
      </div>
    </div>
  );
}

function CompletePhaseView({ session, heroCatalog }: PhaseViewProps) {
  if (session.state.phase.type !== "complete") return null;
  return (
    <SessionSummaryPanel summary={session.state.phase.summary} heroCatalog={heroCatalog} onNewDraft={session.actions.resetDraft} />
  );
}

interface SimulatorHeaderProps {
  canReset: boolean;
  onReset(): void;
}

function SimulatorHeader({ canReset, onReset }: SimulatorHeaderProps) {
  if (!canReset) {
    return <span className="text-heading text-content-primary">Simulador de Draft</span>;
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-heading text-content-primary">Simulador de Draft</span>
      <button className={BUTTON_SECONDARY} onClick={onReset} type="button">
        Reiniciar draft
      </button>
    </div>
  );
}

type PhaseView = (props: PhaseViewProps) => JSX.Element | null;

const PHASE_VIEWS: Record<RandomDraftState["phase"]["type"], PhaseView> = {
  idle: IdlePhaseView,
  ban_phase_complete: BanPhaseCompletePhaseView,
  blind_round: ActiveRoundPhaseView,
  round_revealed: ActiveRoundPhaseView,
  complete: CompletePhaseView,
};

// <Dominio><Cosa>: ruta del Random_Draft_Simulator -- selector de panel por mapa de componentes
// (sin ternario, web.md) según la fase actual del store. useRandomDraftSession es el único punto
// que sabe hablar con el motor; esta página solo compone paneles alrededor de su `state`/`actions`.
export default function RandomDraftPage() {
  const session = useRandomDraftSession();
  const { heroes: heroCatalog } = useHeroCatalog();
  const ActivePanel = PHASE_VIEWS[session.state.phase.type];

  const { phase, draftState } = session.state;

  // TSK-086: mismo timer que antes vivía dentro de BlindRoundPanel, ahora armado acá para
  // pasarlo como centerContent de CompactBoard -- solo durante blind_round (única fase con un
  // timer de ronda real). En cualquier otra fase, undefined -- CompactBoard cae solo a su
  // resumen de bans por defecto, nunca queda un hueco vacío.
  const centerContent =
    phase.type === "blind_round" ? (
      <DraftTimer key={`${phase.round}-${phase.conflictCount}`} waitMs={specForRound(phase.round).timerMs} />
    ) : undefined;

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <SimulatorHeader canReset={phase.type !== "idle"} onReset={session.actions.resetDraft} />
      <StaleWarningBanner />
      <EngineUnreachableBanner />
      {/* TSK-085: persistente en todas las fases con sesión ya arrancada -- antes, los picks de
          una ronda ya confirmada dejaban de verse en cuanto arrancaba la siguiente ronda (el
          DraftState real los seguía teniendo, ningún componente los mostraba). Mismo componente
          que ya usa DraftLayout en /live-draft -- Radiant a la izquierda, centro (bans o timer de
          ronda), Dire a la derecha, siempre visible. */}
      {draftState && (
        <CompactBoard
          banned={draftState.banned}
          picks={draftState.picks}
          localSide={draftState.localSide}
          heroCatalog={heroCatalog}
          centerContent={centerContent}
        />
      )}
      <ActivePanel session={session} heroCatalog={heroCatalog} />
    </main>
  );
}
