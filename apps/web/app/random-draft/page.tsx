"use client";

import type { JSX } from "react";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { BanPhasePanel } from "@/features/random-draft-simulator/components/BanPhasePanel";
import { BlindRoundPanel } from "@/features/random-draft-simulator/components/BlindRoundPanel";
import { ConfigPanel } from "@/features/random-draft-simulator/components/ConfigPanel";
import { CopilotPanel } from "@/features/random-draft-simulator/components/CopilotPanel";
import { SessionSummaryPanel } from "@/features/random-draft-simulator/components/SessionSummaryPanel";
import { StaleWarningBanner } from "@/features/random-draft-simulator/components/StaleWarningBanner";
import { useRandomDraftSession } from "@/features/random-draft-simulator/use-random-draft-session";
import type { RandomDraftState } from "@/features/random-draft-simulator";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

type Session = ReturnType<typeof useRandomDraftSession>;

interface PhaseViewProps {
  session: Session;
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 1.1-1.4, 8.1, 8.4: configuración previa a cualquier draft.
function IdlePhaseView({ session }: PhaseViewProps) {
  return <ConfigPanel onStart={session.startDraft} />;
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
  const { phase, draftState, suggestions } = session.state;
  if (phase.type !== "blind_round" && phase.type !== "round_revealed") return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <BanPhasePanel resolvedBans={draftState?.banned ?? []} heroCatalog={heroCatalog} />
        <BlindRoundPanel
          phase={phase}
          draftState={draftState}
          heroCatalog={heroCatalog}
          onConfirmPick={session.actions.confirmPick}
          onDeselectPick={session.actions.deselectPick}
          onConfirmRound={session.confirmRound}
        />
      </div>
      <CopilotPanel draftState={draftState} suggestions={suggestions} heroCatalog={heroCatalog} />
    </div>
  );
}

function CompletePhaseView({ session, heroCatalog }: PhaseViewProps) {
  if (session.state.phase.type !== "complete") return null;
  return (
    <SessionSummaryPanel summary={session.state.phase.summary} heroCatalog={heroCatalog} onNewDraft={session.actions.resetSession} />
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

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Random Draft Simulator</span>
      <StaleWarningBanner />
      <ActivePanel session={session} heroCatalog={heroCatalog} />
    </main>
  );
}
