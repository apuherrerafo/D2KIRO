"use client";

import { useState, type JSX, type ReactNode } from "react";
import { CompactBoard } from "@/components/draft-layout/DraftLayout";
import { DraftTimer } from "@/components/draft-timer/DraftTimer";
import { useHeroCatalog } from "@/features/draft/use-hero-catalog";
import { FlightRecorderPanel } from "@/features/flight-recorder";
import { BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import { BanPhasePanel } from "@/features/random-draft-simulator/components/BanPhasePanel";
import { BlindRoundPanel } from "@/features/random-draft-simulator/components/BlindRoundPanel";
import { ConfigPanel } from "@/features/random-draft-simulator/components/ConfigPanel";
import { CopilotPanel } from "@/features/random-draft-simulator/components/CopilotPanel";
import { LiveBanEntryPanel, LivePendingPanel } from "@/features/random-draft-simulator/components/LiveCompanionPanel";
import { RoundInstruction } from "@/features/random-draft-simulator/components/RoundInstruction";
import { SessionSummaryPanel } from "@/features/random-draft-simulator/components/SessionSummaryPanel";
import { SimulatorTeamRoster } from "@/features/random-draft-simulator/components/SimulatorTeamRoster";
import { StaleWarningBanner } from "@/features/random-draft-simulator/components/StaleWarningBanner";
import { EngineUnreachableBanner } from "@/features/random-draft-simulator/components/EngineUnreachableBanner";
import { useRandomDraftSession } from "@/features/random-draft-simulator/use-random-draft-session";
import { useScrollToTop } from "@/features/random-draft-simulator/use-scroll-to-top";
import { TeamCoachBoard, type TeamPosition } from "@/features/team-coach";
import type { RandomDraftState } from "@/features/random-draft-simulator";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

type Session = ReturnType<typeof useRandomDraftSession>;

// Ni LIVE_COMPANION ni la ronda del simulador renderizan ya una HeroGrid (buscan por nombre con
// HeroPicker) -- CopilotPanel igual exige este callback, así que una función estable que no hace
// nada cumple el prop sin un handler anónimo inline (web.md).
function noopSetHighlightedHeroIds(): void {}

// El roster ("Tu equipo / Equipo rival") es información, no una acción. Durante una ronda va DEBAJO
// del consejo (ActiveRoundPhaseView) para que lo primero que se vea sea qué elegir; en cualquier otra
// fase (bans, resumen final) se queda arriba como siempre.
function SimulatorRosterSection({ session, heroCatalog }: PhaseViewProps) {
  const { phase, draftState, config, coach } = session.state;
  if (!draftState || !config) return null;
  return (
    <SimulatorTeamRoster
      draftState={draftState}
      config={config}
      phase={phase}
      heroCatalog={heroCatalog}
      ownAssignedPositions={session.state.ownAssignedPositions}
      enemyRoleBeliefs={coach?.roleBeliefs?.enemy}
    />
  );
}

function RosterBeforeRound({ session, heroCatalog }: PhaseViewProps) {
  const { phase } = session.state;
  if (phase.type === "blind_round" || phase.type === "round_revealed") return null;
  return <SimulatorRosterSection session={session} heroCatalog={heroCatalog} />;
}

interface RoundInstructionBarProps {
  phase: Session["state"]["phase"];
  capacity: number | null;
}

// Sólo existe mientras hay una ronda en juego; en cualquier otra fase no renderiza nada.
function RoundInstructionBar({ phase, capacity }: RoundInstructionBarProps) {
  if (phase.type !== "blind_round" && phase.type !== "round_revealed") return null;
  return <RoundInstruction round={phase.round} capacity={capacity} revealed={phase.type === "round_revealed"} />;
}

interface PhaseViewProps {
  session: Session;
  heroCatalog: Map<number, HeroMeta>;
}

interface RoundBansStripProps {
  phase: Session["state"]["phase"];
  bans: number[];
  heroCatalog: Map<number, HeroMeta>;
}

// Los bans viven en la franja fija de arriba durante toda la ronda: antes desaparecían del tope y
// reaparecían 1500 px más abajo, así que había que hacer scroll para ver el draft entero.
function RoundBansStrip({ phase, bans, heroCatalog }: RoundBansStripProps) {
  if (phase.type !== "blind_round" && phase.type !== "round_revealed") return null;
  return <BanPhasePanel resolvedBans={bans} heroCatalog={heroCatalog} compact />;
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
  const { phase, draftState, recommendations, coach, previewStatus, config, currentDecision, requestedTarget, humanActionability, teamBoard, teamBoardStatus } = session.state;
  // Antes del `return null` de abajo: un hook no puede quedar detrás de un return condicional.
  const roundNumber = phase.type === "blind_round" || phase.type === "round_revealed" ? phase.round : 0;
  useScrollToTop(roundNumber);
  if (phase.type !== "blind_round" && phase.type !== "round_revealed") return null;
  // Team Coach Board: picking any hero for any open position goes through the SAME protocol selection
  // (lockPick -> SUBMIT_SEALED_SELECTION + assignedPosition). Only while the round accepts human picks.
  function handleBoardPick(position: TeamPosition, heroId: number) {
    void session.actions.lockPick(heroId, position);
  }
  const boardPick = phase.type === "blind_round" ? handleBoardPick : undefined;
  // PSR-002 -- the selector highlights the position being VIEWED (the V4 decision's viewedPosition, or the
  // one the Player just requested while the engine recomputes). The Coach RECOMMENDATION is a separate
  // field of the same decision and is rendered only by CurrentDecisionPanel.
  const decisionView = currentDecision?.decision.kind === "ACTIONABLE" ? currentDecision.decision.viewedPosition : null;
  const selectedTarget = requestedTarget ?? decisionView;

  return (
    <div className="flex flex-col gap-4">
      <TeamCoachBoard
        board={teamBoard}
        status={teamBoardStatus}
        heroCatalog={heroCatalog}
        selectedPosition={selectedTarget}
        onSelectPosition={session.actions.selectTarget}
        onPickHero={boardPick}
        onRetry={session.actions.retryPreview}
      />
      <SimulatorRosterSection session={session} heroCatalog={heroCatalog} />
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <BlindRoundPanel
            phase={phase}
            draftState={draftState}
            heroCatalog={heroCatalog}
            onLockPick={session.actions.lockPick}
            onYield={session.actions.yieldRound}
            humanActionability={humanActionability}
            selectedTarget={selectedTarget}
            onSelectTarget={session.actions.selectTarget}
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
            currentDecision={currentDecision}
            heroCatalog={heroCatalog}
            previewStatus={previewStatus}
            onRetryPreview={session.actions.retryPreview}
            onAssignOwnPosition={session.actions.assignOwnPosition}
            onSuggestedHeroIdsChange={noopSetHighlightedHeroIds}
            playerPosition={config?.playerPosition}
            partyPositions={config?.partyPositions}
            roundPickState={phase.type === "blind_round" ? {
              round: phase.round,
              // PD-026/PD-027: keyed by POSITION directly -- Object.keys/values already gives exactly
              // the shape RoundPickState wants, no round-slot arithmetic needed.
              lockedPositions: Object.keys(phase.lockedUserPicks).map(Number) as (1 | 2 | 3 | 4 | 5)[],
              lockedHeroesByPosition: phase.lockedUserPicks,
            } : undefined}
          />
        </div>
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
        Companion todavía no expone -- repórtalo y reinicia el draft.
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
  modeSwitcher: ReactNode;
}

interface ResetDraftButtonProps {
  canReset: boolean;
  onReset(): void;
}

function ResetDraftButton({ canReset, onReset }: ResetDraftButtonProps) {
  if (!canReset) return null;
  return (
    <button className={BUTTON_SECONDARY} onClick={onReset} type="button">
      Reiniciar draft
    </button>
  );
}

// Una sola fila: el modo y "Reiniciar draft" comparten línea. El título "Simulador de Draft" ya está
// en la pestaña activa del menú; repetirlo ocupaba otra fila entera antes de ver una sola recomendación.
function SimulatorHeader({ canReset, onReset, modeSwitcher }: SimulatorHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-border pb-2">
      {modeSwitcher}
      <ResetDraftButton canReset={canReset} onReset={onReset} />
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
interface SimulatorModeViewProps {
  modeSwitcher: ReactNode;
}

function RankedAllPickSimulator({ modeSwitcher }: SimulatorModeViewProps) {
  const session = useRandomDraftSession();
  const { heroes: heroCatalog } = useHeroCatalog();
  const ActivePanel = PHASE_VIEWS[session.state.phase.type];

  const { phase, draftState, humanActionability } = session.state;

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
      <SimulatorHeader canReset={phase.type !== "idle"} onReset={session.actions.resetDraft} modeSwitcher={modeSwitcher} />
      <StaleWarningBanner />
      <EngineUnreachableBanner />
      {/* TSK-085: persistente en todas las fases con sesión ya arrancada -- antes, los picks de
          una ronda ya confirmada dejaban de verse en cuanto arrancaba la siguiente ronda (el
          DraftState real los seguía teniendo, ningún componente los mostraba). Mismo componente
          que ya usa DraftLayout en /live-draft -- Radiant a la izquierda, centro (bans o timer de
          ronda), Dire a la derecha, siempre visible. */}
      {/* El temporizador de la ronda corre mientras eliges héroes al fondo de la página: la franja
          queda fija arriba para que el tiempo siempre se vea (antes se perdía al hacer scroll). */}
      {draftState && (
        <div className="sticky top-0 z-20 bg-surface-base py-1" data-testid="draft-sticky-strip">
          <CompactBoard
            banned={draftState.banned}
            picks={draftState.picks}
            localSide={draftState.localSide}
            heroCatalog={heroCatalog}
            centerContent={centerContent}
          />
          <RoundBansStrip phase={phase} bans={draftState.banned} heroCatalog={heroCatalog} />
        </div>
      )}
      {/* Lo primero que se lee tras el temporizador es QUÉ HACER AHORA; el roster (informativo) va después. */}
      <RoundInstructionBar phase={phase} capacity={humanActionability?.roundCapacity ?? null} />
      <RosterBeforeRound session={session} heroCatalog={heroCatalog} />
      <ActivePanel session={session} heroCatalog={heroCatalog} />
      {/* Diagnóstico temporal: sin NEXT_PUBLIC_D2_FLIGHT_RECORDER=1 en el build y ?flightRecorder=1 en la URL no renderiza ni graba nada. */}
      <FlightRecorderPanel />
    </div>
  );
}

type GameMode = "ranked_all_pick";

interface SimulatorModeSwitcherProps {
  mode: GameMode;
  onSelectMode(mode: GameMode): void;
}

function SimulatorModeSwitcher({ mode, onSelectMode }: SimulatorModeSwitcherProps) {
  function handleSelectAllPick() {
    onSelectMode("ranked_all_pick");
  }

  return (
    <div className="flex items-center gap-2">
      <span className="mr-2 text-body font-semibold text-content-primary">Modo:</span>
      <button
        type="button"
        onClick={handleSelectAllPick}
        className={mode === "ranked_all_pick" ? BUTTON_PRIMARY : BUTTON_SECONDARY}
        data-testid="mode-tab-ranked-all-pick"
      >
        Ranked All Pick
      </button>
    </div>
  );
}

const MODE_VIEWS: Record<GameMode, (props: SimulatorModeViewProps) => JSX.Element> = {
  ranked_all_pick: RankedAllPickSimulator,
};

// Private beta: /simulator exposes only the certified Ranked All Pick flow.
export default function SimulatorPage() {
  const [gameMode, setGameMode] = useState<GameMode>("ranked_all_pick");
  const ActiveSimulator = MODE_VIEWS[gameMode];

  return (
    <main className="flex min-h-screen flex-col gap-3 bg-surface-base p-4">
      <ActiveSimulator modeSwitcher={<SimulatorModeSwitcher mode={gameMode} onSelectMode={setGameMode} />} />
    </main>
  );
}
