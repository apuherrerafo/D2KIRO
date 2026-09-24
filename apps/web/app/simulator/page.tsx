"use client";

import { useState, type JSX } from "react";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import { DraftTimer } from "@/components/draft-timer/DraftTimer";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import { BanPhasePanel } from "@/features/random-draft-simulator/components/BanPhasePanel";
import { BlindRoundPanel } from "@/features/random-draft-simulator/components/BlindRoundPanel";
import { ConfigPanel } from "@/features/random-draft-simulator/components/ConfigPanel";
import { CopilotPanel } from "@/features/random-draft-simulator/components/CopilotPanel";
import { LiveBanEntryPanel, LivePendingPanel } from "@/features/random-draft-simulator/components/LiveCompanionPanel";
import { SessionSummaryPanel } from "@/features/random-draft-simulator/components/SessionSummaryPanel";
import { StaleWarningBanner } from "@/features/random-draft-simulator/components/StaleWarningBanner";
import { EngineUnreachableBanner } from "@/features/random-draft-simulator/components/EngineUnreachableBanner";
import { useRandomDraftSession } from "@/features/random-draft-simulator/use-random-draft-session";
import { CaptainsModeSimulator } from "@/features/captains-mode-simulator/components/CaptainsModeSimulator";
import type { RandomDraftState } from "@/features/random-draft-simulator";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

type Session = ReturnType<typeof useRandomDraftSession>;

// LIVE_COMPANION never renders a HeroGrid (LiveCompanionPanel uses HeroPicker's search box
// instead, task spec section 4) -- CopilotPanel still requires this callback, so a stable no-op
// function satisfies the prop without an inline anonymous handler (web.md).
function noopSetHighlightedHeroIds(): void {}

interface PhaseViewProps {
  session: Session;
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 1.1-1.4, 8.1, 8.4: configuración previa a cualquier draft.
function IdlePhaseView({ session }: PhaseViewProps) {
  return <ConfigPanel onStart={session.startDraft} />;
}

// Fail closed: la resolución de bans falló. No se inició la Ronda 1; el mismo pedido se puede reintentar.
function BanFailedPhaseView({ session }: PhaseViewProps) {
  if (session.state.phase.type !== "ban_failed") return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-signal-negative bg-surface-raised p-4" role="alert" data-testid="ban-failed">
      <span className="text-heading text-content-primary">No se pudieron resolver los bans</span>
      <span className="text-body text-content-secondary">{session.state.phase.message}</span>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={session.actions.retryBans} className={BUTTON_PRIMARY}>
          Reintentar bans
        </button>
        <button type="button" onClick={session.actions.resetDraft} className={BUTTON_SECONDARY}>
          Volver a la configuración
        </button>
      </div>
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
  const { phase, draftState, recommendations, coach, previewStatus } = session.state;
  const [highlightedHeroIds, setHighlightedHeroIds] = useState<ReadonlySet<number>>(new Set());
  if (phase.type !== "blind_round" && phase.type !== "round_revealed") return null;

  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <BanPhasePanel resolvedBans={draftState?.banned ?? []} heroCatalog={heroCatalog} />
        <BlindRoundPanel
          phase={phase}
          draftState={draftState}
          heroCatalog={heroCatalog}
          highlightedHeroIds={highlightedHeroIds}
          onLockPick={session.actions.lockPick}
        />
      </div>
      <div className="flex flex-col gap-4">
        {/* R1 S5 (blockers 1+8): la recomendación humana del simulador viene SIEMPRE de
            RecommendationSet/v2 -- ENABLE_PRO_DRAFTER no tiene ningún efecto sobre este panel ni
            sobre qué héroes se resaltan en la grilla. AP Ranked Roles V1 / Wave 2: sobre ese V2 el
            motor construye la salida del Coach (acción primaria + shortlist), que este panel muestra. */}
        <CopilotPanel
          recommendations={recommendations}
          coach={coach}
          heroCatalog={heroCatalog}
          previewStatus={previewStatus}
          onRetryPreview={session.actions.retryPreview}
          onAssignOwnPosition={session.actions.assignOwnPosition}
          onSuggestedHeroIdsChange={setHighlightedHeroIds}
        />
      </div>
    </div>
  );
}

// LIVE_COMPANION -- fase de bans observados. Nunca llama a /resolve-bans (la política seeded del
// Simulador): submits RECORD_RESOLVED_BANS + BAN_RESOLUTION_COMPLETE directo, con exactamente los
// héroes que el Player escribió.
function LiveBanEntryPhaseView({ session, heroCatalog }: PhaseViewProps) {
  const [submitting, setSubmitting] = useState(false);
  if (session.state.phase.type !== "live_ban_entry") return null;
  const phase = session.state.phase;
  async function handleConfirm(heroIds: number[]) {
    setSubmitting(true);
    try {
      await session.actions.recordObservedBans(heroIds);
    } finally {
      setSubmitting(false);
    }
  }
  return <LiveBanEntryPanel observedBans={phase.observedBans} error={phase.error} heroCatalog={heroCatalog} onConfirm={handleConfirm} submitting={submitting} />;
}

// LIVE_COMPANION -- fase activa de picks: reporta manualmente lo que el Player observa en el
// draft real (propio Y rival). Nunca invoca auto-drive/bot-selection -- el Enemy Bot no existe en
// este modo. El Coach (CopilotPanel) es EXACTAMENTE el mismo componente que SIMULATION usa, sin
// ninguna bifurcación de cómo se arman/renderizan las recomendaciones.
function LivePendingPhaseView({ session, heroCatalog }: PhaseViewProps) {
  const { phase, draftState, recommendations, coach, previewStatus } = session.state;
  if (phase.type !== "live_pending" || !draftState) return null;
  return (
    <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
      <div className="flex flex-col gap-4">
        <BanPhasePanel resolvedBans={draftState.banned} heroCatalog={heroCatalog} />
        <LivePendingPanel
          round={phase.round}
          openSlots={phase.openSlots}
          notice={phase.notice}
          heroCatalog={heroCatalog}
          banned={draftState.banned}
          picks={draftState.picks}
          localSide={draftState.localSide === "unknown" ? "radiant" : draftState.localSide}
          onSubmit={session.actions.submitLiveSelection}
        />
      </div>
      <div className="flex flex-col gap-4">
        <CopilotPanel
          recommendations={recommendations}
          coach={coach}
          heroCatalog={heroCatalog}
          previewStatus={previewStatus}
          onRetryPreview={session.actions.retryPreview}
          onAssignOwnPosition={session.actions.assignOwnPosition}
          onSuggestedHeroIdsChange={noopSetHighlightedHeroIds}
        />
      </div>
    </div>
  );
}

function LiveCollisionUnsupportedPhaseView({ session }: PhaseViewProps) {
  if (session.state.phase.type !== "live_collision_unsupported") return null;
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-signal-negative bg-surface-raised p-4" role="alert">
      <span className="text-heading text-content-primary">Colisión no soportada todavía</span>
      <span className="text-body text-content-secondary">
        Ambos equipos parecen haber elegido el mismo héroe una 3ra vez en esta ronda. Ese caso necesita una autoridad externa que este MVP de Live
        Companion todavía no expone -- reportalo y reiniciá el draft.
      </span>
      <button type="button" onClick={session.actions.resetDraft} className={`self-start ${BUTTON_SECONDARY}`}>
        Reiniciar draft
      </button>
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
  ban_failed: BanFailedPhaseView,
  ban_phase_complete: BanPhaseCompletePhaseView,
  blind_round: ActiveRoundPhaseView,
  round_revealed: ActiveRoundPhaseView,
  live_ban_entry: LiveBanEntryPhaseView,
  live_pending: LivePendingPhaseView,
  live_collision_unsupported: LiveCollisionUnsupportedPhaseView,
  complete: CompletePhaseView,
};

// <Dominio><Cosa>: árbol del Random_Draft_Simulator (Ranked All Pick) -- selector de panel por
// mapa de componentes (sin ternario, web.md) según la fase actual del store.
// useRandomDraftSession es el único punto que sabe hablar con el motor; este componente solo
// compone paneles alrededor de su `state`/`actions`. Extraído de lo que antes era el default
// export de esta página (R1 S7, Blocker 2) para que SimulatorPage pueda alternar con
// CaptainsModeSimulator sin que ninguno de los dos comparta estado con el otro.
function RankedAllPickSimulator() {
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
      <DraftTimer key={`${phase.round}-${phase.attemptId}`} waitMs={phase.timerDurationMs} />
    ) : undefined;

  return (
    <div className="flex flex-col gap-4">
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
    </div>
  );
}

type GameMode = "ranked_all_pick" | "captains_mode";

interface SimulatorModeSwitcherProps {
  mode: GameMode;
  onSelectMode(mode: GameMode): void;
}

function SimulatorModeSwitcher({ mode, onSelectMode }: SimulatorModeSwitcherProps) {
  function handleSelectAllPick() {
    onSelectMode("ranked_all_pick");
  }

  function handleSelectCaptainsMode() {
    onSelectMode("captains_mode");
  }

  return (
    <div className="flex items-center gap-2 border-b border-surface-border pb-3">
      <span className="mr-2 text-body font-semibold text-content-primary">Modo:</span>
      <button
        type="button"
        onClick={handleSelectAllPick}
        className={mode === "ranked_all_pick" ? BUTTON_PRIMARY : BUTTON_SECONDARY}
        data-testid="mode-tab-ranked-all-pick"
      >
        Ranked All Pick
      </button>
      <button
        type="button"
        onClick={handleSelectCaptainsMode}
        className={mode === "captains_mode" ? BUTTON_PRIMARY : BUTTON_SECONDARY}
        data-testid="mode-tab-captains-mode"
      >
        Captains Mode
      </button>
    </div>
  );
}

const MODE_VIEWS: Record<GameMode, () => JSX.Element> = {
  ranked_all_pick: RankedAllPickSimulator,
  captains_mode: CaptainsModeSimulator,
};

// /simulator: selector de modo entre Ranked All Pick (Ranked Roles) y Captains Mode.
export default function SimulatorPage() {
  const [gameMode, setGameMode] = useState<GameMode>("ranked_all_pick");
  const ActiveSimulator = MODE_VIEWS[gameMode];

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <SimulatorModeSwitcher mode={gameMode} onSelectMode={setGameMode} />
      <ActiveSimulator />
    </main>
  );
}
