"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { SimulatorLightBoard } from "@/features/simulator-light";
import { RecommendationFeedbackProvider, type RecommendationFeedbackTarget } from "@/features/simulator-light/feedback-context";
import type { RequestStatus, TeamCoachBoardData, TeamPosition } from "@/features/team-coach/types";
import { BUTTON_COMPACT, BUTTON_GHOST, BUTTON_PRIMARY } from "@/features/draft/styles";
import type { HumanActionability } from "../protocol-client";
import { analyzedPickOf, type AnalyzedCandidate, type AnalyzedPick } from "../analyzed-pick";
import { SIMULATOR_POSITION_LABELS } from "../roster";
import type { DraftPhase, HeroId } from "../types";
import { RoundInstruction } from "./RoundInstruction";

type BlindRoundPhase = Extract<DraftPhase, { type: "blind_round" }>;
type RoundRevealedPhase = Extract<DraftPhase, { type: "round_revealed" }>;
type Position = 1 | 2 | 3 | 4 | 5;

// <Dominio><Cosa>: EL tablero de la ronda del Simulador. Un solo lugar para descubrir, analizar y ejecutar:
//   · arriba, qué hacer ahora (ronda, posiciones que controlas, avisos);
//   · al centro, las recomendaciones por posición;
//   · a la derecha, el análisis del héroe abierto CON su botón «Elegir a X» (o el motivo por el que no se puede);
//   · bajo las columnas, el buscador de cualquier héroe legal (siempre a la vista: es la salida cuando el coach no propone a nadie).
// Tocar una carta o un resultado del buscador solo ABRE el análisis: confirmar es el botón, que llama a la MISMA `onLockPick` de siempre.

function unavailableHeroIds(draftState: DraftState | null, lockedPicks: HeroId[]): Set<HeroId> {
  const unavailable = new Set<HeroId>(lockedPicks);
  if (!draftState) return unavailable;
  for (const heroId of draftState.banned) unavailable.add(heroId);
  for (const heroId of draftState.picks.radiant) unavailable.add(heroId);
  for (const heroId of draftState.picks.dire) unavailable.add(heroId);
  return unavailable;
}

/** PD-026/PD-027: gold penalty bookkeeping stays seat-indexed on the wire (never re-keyed by
 * position in this P0) -- the UI shows the aggregate total, since a "seat" no longer identifies
 * anything the Player chose. */
function totalGoldPenalty(phase: BlindRoundPhase): number {
  const base = phase.goldPenaltyBySlot.reduce((sum, value) => sum + value, 0);
  if (phase.pendingPositions.length === 0) return base;
  return base + Math.floor((phase.penaltyElapsedMs * phase.penaltyRatePerSecond) / 1000);
}

function heroNameOf(heroCatalog: Map<number, HeroMeta>, heroId: HeroId): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

interface ConflictBannerProps {
  conflictBans: HeroId[];
  notice: string | null;
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 5.2: notificación visible de una colisión -- permanece hasta que el Player elige de nuevo.
// Un rechazo del motor o una colisión nunca son un estado silencioso.
function ConflictBanner({ conflictBans, notice, heroCatalog }: ConflictBannerProps) {
  if (conflictBans.length === 0 && notice === null) return null;
  const names = conflictBans.map((heroId) => heroNameOf(heroCatalog, heroId));
  return (
    <div className="ap-notice" data-tone="warning" role="status">
      {names.length > 0 && <span>Baneados por colisión en esta ronda: {names.join(", ")}.</span>}
      {notice !== null && <span>{notice}</span>}
    </div>
  );
}

interface PositionCardProps {
  position: Position;
  heroId: HeroId | null;
  heroMeta: HeroMeta | undefined;
}

// Una posición humana controlada: ya sellada (héroe) o pendiente. PD-026/PD-027: nunca un asiento
// cronológico -- la identidad mostrada es siempre PosN, la que el Player efectivamente eligió.
function PositionCard({ position, heroId, heroMeta }: PositionCardProps) {
  return (
    <li className="sl-round-pos" data-sealed={heroId === null ? "false" : "true"} data-testid="round-position-card">
      {heroId !== null && <HeroIcon imgUrl={heroMeta?.imgUrl ?? ""} alt={heroMeta?.localizedName ?? `Héroe ${heroId}`} size={28} />}
      <span className="sl-round-pos-text">
        <strong>Pos{position} {SIMULATOR_POSITION_LABELS[position]}</strong>
        {heroId !== null && <span>{heroMeta?.localizedName ?? `Héroe ${heroId}`}</span>}
        {heroId === null && <span>Pendiente</span>}
      </span>
    </li>
  );
}

interface TimerNoticeProps {
  phase: BlindRoundPhase;
}

// Al vencer el tiempo base NO se elige nada por el Player: sólo se explica qué está pasando.
function TimerExpiredNotice({ phase }: TimerNoticeProps) {
  if (phase.timerRemainingMs > 0 || phase.pendingPositions.length === 0) return null;
  return (
    <p className="ap-notice" data-testid="timer-expired" data-tone="warning" role="alert">
      Se acabó el tiempo base: tus posiciones pendientes pierden {phase.penaltyRatePerSecond} de oro por segundo. Puedes seguir eligiendo.
    </p>
  );
}

function GoldPenaltyNotice({ phase }: TimerNoticeProps) {
  const gold = totalGoldPenalty(phase);
  if (gold <= 0) return null;
  return (
    <span className="sl-round-gold" data-testid="gold-penalty">
      -{gold} oro perdido en esta ronda
    </span>
  );
}

interface YieldActionProps {
  phase: BlindRoundPhase;
  canPick: boolean;
  onYield: () => void;
}

function YieldAction({ phase, canPick, onYield }: YieldActionProps) {
  if (!canPick || !phase.canYield) return null;
  return (
    <button type="button" className={BUTTON_GHOST} onClick={onYield} data-testid="yield-round-button">
      Ceder el resto de la ronda al Ally Bot
    </button>
  );
}

interface RoundStatusProps {
  phase: BlindRoundPhase;
  heroCatalog: Map<number, HeroMeta>;
  humanActionability: HumanActionability | null;
  availablePositions: Position[];
  canPick: boolean;
  onYield: () => void;
}

// Qué toca ahora: la ronda, cuántos héroes caben, qué posiciones controlas y cuáles faltan. Todo lo calcula el motor; esto solo lo dice.
function RoundStatus({ phase, heroCatalog, humanActionability, availablePositions, canPick, onYield }: RoundStatusProps) {
  const pendingLabel = availablePositions.map((position) => `Pos${position}`).join(" ");
  return (
    <div className="sl-round" data-testid="round-status">
      <RoundInstruction round={phase.round} capacity={humanActionability?.roundCapacity ?? null} revealed={false} />
      <ConflictBanner conflictBans={phase.conflictBans} notice={phase.notice} heroCatalog={heroCatalog} />
      <TimerExpiredNotice phase={phase} />
      <div className="sl-round-meta">
        <p className="sl-round-line">
          <span data-testid="pending-human-positions">Posiciones humanas pendientes: {pendingLabel}</span>
          <span>Los demás aliados son simulados automáticamente.</span>
        </p>
        <ul className="sl-round-positions" aria-label="Tus posiciones en esta ronda">
          {phase.attemptPositions.map((position) => (
            <PositionCard
              key={position}
              position={position}
              heroId={phase.lockedUserPicks[position] ?? null}
              heroMeta={phase.lockedUserPicks[position] === undefined ? undefined : heroCatalog.get(phase.lockedUserPicks[position]!)}
            />
          ))}
        </ul>
      </div>
      <GoldPenaltyNotice phase={phase} />
      <YieldAction phase={phase} canPick={canPick} onYield={onYield} />
    </div>
  );
}

interface PickActionProps {
  pick: AnalyzedPick;
  heroCatalog: Map<number, HeroMeta>;
  onLockPick: (heroId: HeroId, position: Position) => void;
}

// La acción de elegir para el héroe que se está ANALIZANDO. Vive dentro del análisis, junto al héroe: el jugador no busca el botón en otro panel.
// Si el héroe no se puede elegir, no hay botón: solo el motivo. Si el botón queda fuera de pantalla (móvil, pantallas bajas), se acerca lo mínimo.
function PickAction({ pick, heroCatalog, onLockPick }: PickActionProps) {
  const host = useRef<HTMLDivElement>(null);
  const identity = pick.kind === "hidden" ? "hidden" : `${pick.kind}:${pick.position}:${pick.heroId}`;
  useEffect(() => {
    const element = host.current;
    if (element !== null && typeof element.scrollIntoView === "function") element.scrollIntoView({ block: "nearest" });
  }, [identity]);
  if (pick.kind === "hidden") return null;
  const name = heroNameOf(heroCatalog, pick.heroId);
  const place = `Pos${pick.position} ${SIMULATOR_POSITION_LABELS[pick.position]}`;
  function handleLock() {
    if (pick.kind !== "legal") return;
    onLockPick(pick.heroId, pick.position);
  }
  if (pick.kind === "blocked") {
    return (
      <div className="sl-pick" data-state="blocked" ref={host}>
        <p className="sl-pick-blocked" data-testid="analyzed-pick-blocked" role="status">
          No se puede elegir a {name} para {place}: {pick.reason}.
        </p>
      </div>
    );
  }
  return (
    <div className="sl-pick" data-state="legal" data-testid="analyzed-pick" ref={host} role="group" aria-label="Elegir el héroe que estás analizando">
      <button type="button" className={BUTTON_PRIMARY} onClick={handleLock} data-testid="analyzed-pick-button" aria-label={`Elegir a ${name} como ${place}`}>
        Elegir a {name}
      </button>
      <span className="sl-muted">Como {place}. Queda sellado hasta que termine la ronda.</span>
    </div>
  );
}

interface PositionTargetButtonProps {
  position: Position;
  selected: boolean;
  locked: boolean;
  onSelect(position: Position): void;
}

// PD-026/PD-027: el picker de posición humano muestra TODAS las posiciones humanas controladas, en cualquier ronda válida -- nunca un calendario fijo asiento<->posición.
// Solo existen las posiciones que el jugador controla: una posición de otro nunca se ofrece.
function PositionTargetButton({ position, selected, locked, onSelect }: PositionTargetButtonProps) {
  function handleSelect() {
    onSelect(position);
  }
  const suffix = locked ? " · sellada" : "";
  return (
    <button type="button" className={`${BUTTON_COMPACT} sl-pos-chip`} aria-pressed={selected} disabled={locked} onClick={handleSelect}>
      Pos{position} {SIMULATOR_POSITION_LABELS[position]}{suffix}
    </button>
  );
}

interface HeroSearchProps {
  heroes: HeroMeta[];
  unavailable: ReadonlySet<HeroId>;
  positions: Position[];
  lockedPositions: ReadonlySet<Position>;
  selectedPosition: Position | undefined;
  onSelectPosition: (position: Position) => void;
  onSelectHero: (heroId: HeroId) => void;
}

// Siempre visible: las recomendaciones son el camino principal, pero un héroe que el coach no propuso (o la ausencia total de propuestas) no deja al jugador sin salida.
// Baneados y ya elegidos aparecen deshabilitados y rotulados, no desaparecen: el jugador ve por qué no puede elegirlos.
function HeroSearch({ heroes, unavailable, positions, lockedPositions, selectedPosition, onSelectPosition, onSelectHero }: HeroSearchProps) {
  return (
    <section className="sl-search" data-testid="other-hero-search" aria-label="Buscar otro héroe">
      <h3 className="sl-subhead">Buscar otro héroe</h3>
      <p className="sl-muted">Cualquier héroe legal. Al tocarlo se abre su análisis y eliges con el botón.</p>
      <div className="sl-pos-chips" role="group" aria-label="Posición para el próximo pick">
        <span className="sl-muted">Para:</span>
        {positions.map((position) => (
          <PositionTargetButton key={position} position={position} selected={position === selectedPosition} locked={lockedPositions.has(position)} onSelect={onSelectPosition} />
        ))}
      </div>
      <HeroPicker heroes={heroes} onSelect={onSelectHero} unavailableHeroIds={unavailable} unavailableLabel="baneado o ya elegido" variant="board" />
    </section>
  );
}

interface BoardProps {
  board: TeamCoachBoardData | null;
  boardStatus: RequestStatus;
  humanPosition: TeamPosition | null;
  onRetryBoard: (() => void) | undefined;
}

interface BlindRoundActiveProps extends BoardProps {
  phase: BlindRoundPhase;
  draftState: DraftState | null;
  heroCatalog: Map<number, HeroMeta>;
  onLockPick: (heroId: HeroId, position: Position) => void;
  onYield: () => void;
  humanActionability: HumanActionability | null;
  /** The position being VIEWED (V4 decision `viewedPosition` / the Player's requested view) -- never the Coach recommendation. The selector renders exactly this. */
  selectedTarget: Position | null;
  onSelectTarget?: (position: Position) => void;
}

const ROUND_FOOT_NOTE = "Tocar una carta solo abre este análisis: el pick se confirma con el botón «Elegir a …».";

function sortedByName(heroCatalog: Map<number, HeroMeta>): HeroMeta[] {
  return Array.from(heroCatalog.values()).sort((a, b) => a.localizedName.localeCompare(b.localizedName, "es"));
}

function BlindRoundActive({ phase, draftState, heroCatalog, onLockPick, onYield, humanActionability, selectedTarget, onSelectTarget, board, boardStatus, humanPosition, onRetryBoard }: BlindRoundActiveProps) {
  // Qué carta del tablero está abierta en el análisis, y qué héroe se buscó a mano. Solo uno de los dos está abierto a la vez.
  const [analyzed, setAnalyzed] = useState<AnalyzedCandidate | null>(null);
  const [manualHeroId, setManualHeroId] = useState<HeroId | null>(null);
  const availablePositions = phase.attemptPositions.filter((position) => phase.lockedUserPicks[position] === undefined);
  const [preferredPosition, setPreferredPosition] = useState<Position | undefined>(availablePositions[0] ?? phase.attemptPositions[0]);
  // COHERENCE-013 / PSR-002 -- the selector shows the viewed position whenever there is one; the local
  // choice is only a fallback while the Coach is loading/unavailable (the Player can always pick).
  const localPosition = preferredPosition !== undefined && availablePositions.includes(preferredPosition)
    ? preferredPosition
    : (availablePositions[0] ?? preferredPosition);
  const selectedPosition = selectedTarget !== null && availablePositions.includes(selectedTarget) ? selectedTarget : localPosition;
  const lockedHeroIds = Object.values(phase.lockedUserPicks).filter((heroId): heroId is HeroId => heroId !== undefined);
  const unavailable = unavailableHeroIds(draftState, lockedHeroIds);
  const noHumanAction = humanActionability !== null && !humanActionability.hasHumanAction;
  const canPick = availablePositions.length > 0 && selectedPosition !== undefined && !noHumanAction;
  const manualCandidate = manualHeroId === null || selectedPosition === undefined ? null : { heroId: manualHeroId, position: selectedPosition };
  const analyzedPick = analyzedPickOf({ analyzed: manualCandidate ?? analyzed, availablePositions, attemptPositions: phase.attemptPositions, unavailable, noHumanAction });

  // Estable: el tablero lo usa como dependencia de un efecto.
  const handleAnalyze = useCallback(function handleAnalyze(candidate: AnalyzedCandidate | null) {
    setAnalyzed(candidate);
    if (candidate !== null) setManualHeroId(null);
  }, []);

  function handleSelectPosition(position: Position) {
    setPreferredPosition(position);
    onSelectTarget?.(position);
  }

  function handleSearchHero(heroId: HeroId) {
    setManualHeroId(heroId);
  }

  function handleLock(heroId: HeroId, position: Position) {
    setManualHeroId(null);
    onLockPick(heroId, position);
  }

  const search: ReactNode = canPick && (
    <HeroSearch
      heroes={sortedByName(heroCatalog)}
      unavailable={unavailable}
      positions={phase.attemptPositions}
      lockedPositions={new Set(phase.attemptPositions.filter((position) => phase.lockedUserPicks[position] !== undefined))}
      selectedPosition={selectedPosition}
      onSelectPosition={handleSelectPosition}
      onSelectHero={handleSearchHero}
    />
  );

  return (
    <SimulatorLightBoard
      board={board}
      status={boardStatus}
      humanPosition={humanPosition}
      onRetry={onRetryBoard}
      onAnalyze={handleAnalyze}
      footNote={ROUND_FOOT_NOTE}
      header={<RoundStatus phase={phase} heroCatalog={heroCatalog} humanActionability={humanActionability} availablePositions={availablePositions} canPick={canPick} onYield={onYield} />}
      pickAction={<PickAction pick={analyzedPick} heroCatalog={heroCatalog} onLockPick={handleLock} />}
      manualCandidate={manualCandidate}
      beneath={search}
    />
  );
}

interface RevealedSideProps {
  title: string;
  picks: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

function RevealedSide({ title, picks, heroCatalog }: RevealedSideProps) {
  return (
    <div className="sl-revealed-side">
      <span className="sl-caption">{title}</span>
      <ul className="sl-round-positions">
        {picks.map((heroId) => (
          <li className="sl-round-pos" data-sealed="true" key={heroId}>
            <HeroIcon imgUrl={heroCatalog.get(heroId)?.imgUrl ?? ""} alt={heroNameOf(heroCatalog, heroId)} size={28} />
            <span className="sl-round-pos-text"><strong>{heroNameOf(heroCatalog, heroId)}</strong></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface RoundRevealedViewProps {
  phase: RoundRevealedPhase;
  heroCatalog: Map<number, HeroMeta>;
  capacity: number | null;
}

// Req. 3.3: revelación simultánea -- picks del usuario y del bot, uno al lado del otro.
function RoundRevealedView({ phase, heroCatalog, capacity }: RoundRevealedViewProps) {
  return (
    <div className="sl-round" data-testid="round-status">
      <RoundInstruction round={phase.round} capacity={capacity} revealed />
      <div className="sl-revealed">
        <RevealedSide title="Tu equipo" picks={phase.userPicks} heroCatalog={heroCatalog} />
        <RevealedSide title="Equipo rival" picks={phase.botPicks} heroCatalog={heroCatalog} />
      </div>
    </div>
  );
}

export interface BlindRoundPanelProps {
  phase: BlindRoundPhase | RoundRevealedPhase;
  draftState: DraftState | null;
  heroCatalog: Map<number, HeroMeta>;
  onLockPick: (heroId: HeroId, position: Position) => void;
  onYield: () => void;
  /** WP1 -- server-derived eligibility vs. round capacity (latest snapshot). */
  humanActionability?: HumanActionability | null;
  /** WP3 -- the Coach's current target; the position selector renders exactly this. */
  selectedTarget?: Position | null;
  onSelectTarget?: (position: Position) => void;
  /** Tablero del Team Coach (contrato V6, verbatim). Sin él, el tablero dice que está calculando y el jugador igual puede elegir con el buscador. */
  board?: TeamCoachBoardData | null;
  boardStatus?: RequestStatus;
  /** Posición propia declarada en la configuración. */
  humanPosition?: TeamPosition | null;
  onRetryBoard?: () => void;
  /** Sesión + decisión V4 sobre la que se puede opinar (👍/👎 en el análisis). Sin él no hay control. */
  feedbackTarget?: RecommendationFeedbackTarget | null;
}

// <Dominio><Cosa>: cubre las fases blind_round y round_revealed (Req. 3) -- selección a ciegas
// con timer visible y revelación simultánea al cerrar la ronda, sin ternario para elegir la vista.
export function BlindRoundPanel({
  phase,
  draftState,
  heroCatalog,
  onLockPick,
  onYield,
  humanActionability = null,
  selectedTarget = null,
  onSelectTarget,
  board = null,
  boardStatus = "loading",
  humanPosition = null,
  onRetryBoard,
  feedbackTarget = null,
}: BlindRoundPanelProps) {
  if (phase.type === "round_revealed") {
    return (
      <SimulatorLightBoard
        board={board}
        status={boardStatus}
        humanPosition={humanPosition}
        onRetry={onRetryBoard}
        footNote={ROUND_FOOT_NOTE}
        header={<RoundRevealedView phase={phase} heroCatalog={heroCatalog} capacity={humanActionability?.roundCapacity ?? null} />}
      />
    );
  }
  return (
    <RecommendationFeedbackProvider target={feedbackTarget}>
      <BlindRoundActive
        phase={phase}
        draftState={draftState}
        heroCatalog={heroCatalog}
        onLockPick={onLockPick}
        onYield={onYield}
        humanActionability={humanActionability}
        selectedTarget={selectedTarget}
        onSelectTarget={onSelectTarget}
        board={board}
        boardStatus={boardStatus}
        humanPosition={humanPosition}
        onRetryBoard={onRetryBoard}
      />
    </RecommendationFeedbackProvider>
  );
}
