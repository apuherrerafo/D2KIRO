"use client";

import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { useState } from "react";
import { BUTTON_COMPACT, BUTTON_GHOST } from "@/features/draft/styles";
import { SIMULATOR_POSITION_LABELS } from "../roster";
import type { DraftPhase, HeroId } from "../types";

type BlindRoundPhase = Extract<DraftPhase, { type: "blind_round" }>;
type RoundRevealedPhase = Extract<DraftPhase, { type: "round_revealed" }>;
type Position = 1 | 2 | 3 | 4 | 5;

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

interface ConflictBannerProps {
  conflictBans: HeroId[];
  notice: string | null;
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 5.2: notificación visible de una colisión -- permanece hasta que el Player elige de nuevo.
// Un rechazo del motor o una colisión nunca son un estado silencioso.
function ConflictBanner({ conflictBans, notice, heroCatalog }: ConflictBannerProps) {
  if (conflictBans.length === 0 && notice === null) return null;
  const names = conflictBans.map((heroId) => heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`);
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-signal-negative bg-surface-raised p-3" role="status">
      {names.length > 0 && (
        <span className="text-caption text-signal-negative">Baneados por colisión en esta ronda: {names.join(", ")}.</span>
      )}
      {notice !== null && <span className="text-caption text-signal-negative">{notice}</span>}
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
    <div className="flex flex-col items-center gap-1" data-testid="round-position-card">
      <span className="text-caption text-content-secondary">
        Pos{position} {SIMULATOR_POSITION_LABELS[position]}
      </span>
      {heroId !== null && <DraftHeroSlot heroId={heroId} heroMeta={heroMeta} variant="pick" />}
      {heroId === null && <span className="text-caption text-content-muted">Pendiente</span>}
    </div>
  );
}

interface TimerNoticeProps {
  phase: BlindRoundPhase;
}

// Al vencer el tiempo base NO se elige nada por el Player: sólo se explica qué está pasando.
function TimerExpiredNotice({ phase }: TimerNoticeProps) {
  if (phase.timerRemainingMs > 0 || phase.pendingPositions.length === 0) return null;
  return (
    <span className="text-caption text-signal-warning" role="alert" data-testid="timer-expired">
      Se acabó el tiempo base: tus posiciones pendientes pierden {phase.penaltyRatePerSecond} de oro por segundo. Podés seguir eligiendo.
    </span>
  );
}

interface GoldPenaltyNoticeProps {
  phase: BlindRoundPhase;
}

function GoldPenaltyNotice({ phase }: GoldPenaltyNoticeProps) {
  const gold = totalGoldPenalty(phase);
  if (gold <= 0) return null;
  return (
    <span className="text-caption text-signal-negative tabular-nums" data-testid="gold-penalty">
      -{gold} oro perdido en esta ronda
    </span>
  );
}

interface BlindRoundActiveProps {
  phase: BlindRoundPhase;
  draftState: DraftState | null;
  heroCatalog: Map<number, HeroMeta>;
  // TSK-084: mismos candidatos que ya destaca el Copilot al lado -- un solo highlight dorado
  // consistente entre las dos superficies, no una segunda heurística.
  highlightedHeroIds: ReadonlySet<HeroId>;
  onLockPick: (heroId: HeroId, position: Position) => void;
  onYield: () => void;
}

interface PositionTargetButtonProps {
  position: Position;
  selected: boolean;
  locked: boolean;
  onSelect(position: Position): void;
}

// PD-026/PD-027: el picker de posición humano muestra TODAS las posiciones humanas controladas
// que siguen sin sellar, en cualquier ronda válida -- nunca un calendario fijo asiento<->posición.
function PositionTargetButton({ position, selected, locked, onSelect }: PositionTargetButtonProps) {
  function handleSelect() {
    onSelect(position);
  }
  const selectedClass = selected ? "border-accent-primary text-accent-primary" : "border-surface-border text-content-secondary";
  const actionLabel = locked ? "Sellado" : "Elegir para";
  return (
    <button type="button" className={`${BUTTON_COMPACT} ${selectedClass}`} disabled={locked} onClick={handleSelect}>
      {actionLabel} Pos{position} {SIMULATOR_POSITION_LABELS[position]}
    </button>
  );
}

function BlindRoundActive({ phase, draftState, heroCatalog, highlightedHeroIds, onLockPick, onYield }: BlindRoundActiveProps) {
  const availablePositions = phase.attemptPositions.filter((position) => phase.lockedUserPicks[position] === undefined);
  const [preferredPosition, setPreferredPosition] = useState<Position | undefined>(availablePositions[0] ?? phase.attemptPositions[0]);
  const selectedPosition = preferredPosition !== undefined && availablePositions.includes(preferredPosition)
    ? preferredPosition
    : (availablePositions[0] ?? preferredPosition);
  const lockedHeroIds = Object.values(phase.lockedUserPicks).filter((heroId): heroId is HeroId => heroId !== undefined);
  const unavailable = unavailableHeroIds(draftState, lockedHeroIds);
  const pickablePool = Array.from(heroCatalog.values()).filter((hero) => !unavailable.has(hero.id));
  const total = phase.attemptPositions.length;
  const locked = lockedHeroIds.length;
  const canPick = locked < total && selectedPosition !== undefined;

  function handleHeroSelect(heroId: HeroId) {
    if (selectedPosition === undefined) return;
    onLockPick(heroId, selectedPosition);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      {/* TSK-086: el timer de la ronda se ve al centro de CompactBoard (page.tsx), no acá -- nunca
          dos timers en pantalla al mismo tiempo. */}
      <span className="text-heading text-content-primary">
        Ronda {phase.round} -- elegí {total} {total === 1 ? "héroe" : "héroes"} para tu equipo ({locked} de {total} sellados)
      </span>
      <span className="text-caption text-content-muted">
        Controlás tus posiciones (Pos{phase.attemptPositions.join(", Pos")}). Los demás aliados son simulados
        automáticamente. Al elegir un héroe queda sellado y oculto para el rival hasta que cierre la ronda.
      </span>
      <ConflictBanner conflictBans={phase.conflictBans} notice={phase.notice} heroCatalog={heroCatalog} />
      <TimerExpiredNotice phase={phase} />
      <div className="flex flex-wrap gap-4">
        {phase.attemptPositions.map((position) => (
          <PositionCard
            key={position}
            position={position}
            heroId={phase.lockedUserPicks[position] ?? null}
            heroMeta={phase.lockedUserPicks[position] === undefined ? undefined : heroCatalog.get(phase.lockedUserPicks[position]!)}
          />
        ))}
      </div>
      <GoldPenaltyNotice phase={phase} />
      {canPick && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Posición para el próximo pick">
          {phase.attemptPositions.map((position) => (
            <PositionTargetButton
              key={position}
              position={position}
              selected={position === selectedPosition}
              locked={phase.lockedUserPicks[position] !== undefined}
              onSelect={setPreferredPosition}
            />
          ))}
          {phase.canYield && (
            <button type="button" className={BUTTON_GHOST} onClick={onYield} data-testid="yield-round-button">
              Ceder el resto de la ronda al Ally Bot
            </button>
          )}
        </div>
      )}
      {canPick && <HeroGrid heroes={pickablePool} highlightedHeroIds={highlightedHeroIds} onSelect={handleHeroSelect} />}
    </div>
  );
}

interface RevealedSideProps {
  title: string;
  picks: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

function RevealedSide({ title, picks, heroCatalog }: RevealedSideProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption text-content-secondary">{title}</span>
      <div className="flex flex-wrap gap-2">
        {picks.map((heroId) => (
          <DraftHeroSlot key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} variant="pick" />
        ))}
      </div>
    </div>
  );
}

interface RoundRevealedViewProps {
  phase: RoundRevealedPhase;
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 3.3: revelación simultánea -- picks del usuario y del bot, uno al lado del otro.
function RoundRevealedView({ phase, heroCatalog }: RoundRevealedViewProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Ronda {phase.round} -- revelada</span>
      <div className="grid gap-4 sm:grid-cols-2">
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
  // TSK-084: opcional a propósito -- mismo criterio que HeroGrid.highlightedHeroIds, un caller
  // sin sugerencias frescas todavía (o ninguna) simplemente no resalta nada.
  highlightedHeroIds?: ReadonlySet<HeroId>;
  onLockPick: (heroId: HeroId, position: Position) => void;
  onYield: () => void;
}

const EMPTY_HIGHLIGHTED: ReadonlySet<HeroId> = new Set();

// <Dominio><Cosa>: cubre las fases blind_round y round_revealed (Req. 3) -- selección a ciegas
// con timer visible y revelación simultánea al cerrar la ronda, sin ternario para elegir la vista.
export function BlindRoundPanel({
  phase,
  draftState,
  heroCatalog,
  highlightedHeroIds = EMPTY_HIGHLIGHTED,
  onLockPick,
  onYield,
}: BlindRoundPanelProps) {
  if (phase.type === "round_revealed") {
    return <RoundRevealedView phase={phase} heroCatalog={heroCatalog} />;
  }
  return (
    <BlindRoundActive
      phase={phase}
      highlightedHeroIds={highlightedHeroIds}
      draftState={draftState}
      heroCatalog={heroCatalog}
      onLockPick={onLockPick}
      onYield={onYield}
    />
  );
}
