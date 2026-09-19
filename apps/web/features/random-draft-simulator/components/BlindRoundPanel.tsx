"use client";

import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { DraftPhase, HeroId } from "../types";

type BlindRoundPhase = Extract<DraftPhase, { type: "blind_round" }>;
type RoundRevealedPhase = Extract<DraftPhase, { type: "round_revealed" }>;

function unavailableHeroIds(draftState: DraftState | null, lockedPicks: HeroId[]): Set<HeroId> {
  const unavailable = new Set<HeroId>(lockedPicks);
  if (!draftState) return unavailable;
  for (const heroId of draftState.banned) unavailable.add(heroId);
  for (const heroId of draftState.picks.radiant) unavailable.add(heroId);
  for (const heroId of draftState.picks.dire) unavailable.add(heroId);
  return unavailable;
}

/** Gold shown for a seat: the engine's figure plus what has elapsed on screen since the last sync, for a seat still pending. */
export function displayedGoldPenalty(phase: BlindRoundPhase, seat: number): number {
  const base = phase.goldPenaltyBySlot[seat] ?? 0;
  if (!phase.pendingSeats.includes(seat)) return base;
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

interface SeatCardProps {
  label: string;
  heroId: HeroId | null;
  heroMeta: HeroMeta | undefined;
  gold: number;
}

// Un asiento del Player: ya sellado (héroe) o pendiente. Cada uno acumula su penalización por separado.
function SeatCard({ label, heroId, heroMeta, gold }: SeatCardProps) {
  return (
    <div className="flex flex-col items-center gap-1" data-testid="round-seat">
      <span className="text-caption text-content-secondary">{label}</span>
      {heroId !== null && <DraftHeroSlot heroId={heroId} heroMeta={heroMeta} variant="pick" />}
      {heroId === null && <span className="text-caption text-content-muted">Pendiente</span>}
      {gold > 0 && (
        <span className="text-caption text-signal-negative tabular-nums" data-testid="gold-penalty">
          -{gold} oro
        </span>
      )}
    </div>
  );
}

interface TimerNoticeProps {
  phase: BlindRoundPhase;
}

// Al vencer el tiempo base NO se elige nada por el Player: sólo se explica qué está pasando.
function TimerExpiredNotice({ phase }: TimerNoticeProps) {
  if (phase.timerRemainingMs > 0 || phase.pendingSeats.length === 0) return null;
  return (
    <span className="text-caption text-signal-warning" role="alert" data-testid="timer-expired">
      Se acabó el tiempo base: cada asiento pendiente pierde {phase.penaltyRatePerSecond} de oro por segundo. Podés seguir eligiendo.
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
  onLockPick: (heroId: HeroId) => void;
}

function BlindRoundActive({ phase, draftState, heroCatalog, highlightedHeroIds, onLockPick }: BlindRoundActiveProps) {
  const unavailable = unavailableHeroIds(draftState, phase.pendingUserPicks);
  const pickablePool = Array.from(heroCatalog.values()).filter((hero) => !unavailable.has(hero.id));
  const total = phase.attemptSeats.length;
  const locked = phase.pendingUserPicks.length;
  const canPick = locked < total;

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      {/* TSK-086: el timer de la ronda se ve al centro de CompactBoard (page.tsx), no acá -- nunca
          dos timers en pantalla al mismo tiempo. */}
      <span className="text-heading text-content-primary">
        Ronda {phase.round} -- elegí {total} {total === 1 ? "héroe" : "héroes"} para tu equipo ({locked} de {total} sellados)
      </span>
      <span className="text-caption text-content-muted">
        Controlás los 5 asientos de tu equipo. Al elegir un héroe queda sellado y oculto para el rival hasta que cierre la ronda.
      </span>
      <ConflictBanner conflictBans={phase.conflictBans} notice={phase.notice} heroCatalog={heroCatalog} />
      <TimerExpiredNotice phase={phase} />
      <div className="flex flex-wrap gap-4">
        {phase.attemptSeats.map((seat, index) => {
          const heroId = phase.pendingUserPicks[index] ?? null;
          return (
            <SeatCard
              key={seat}
              label={`Asiento ${index + 1}`}
              heroId={heroId}
              heroMeta={heroId === null ? undefined : heroCatalog.get(heroId)}
              gold={displayedGoldPenalty(phase, seat)}
            />
          );
        })}
      </div>
      {canPick && <HeroGrid heroes={pickablePool} highlightedHeroIds={highlightedHeroIds} onSelect={onLockPick} />}
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
  onLockPick: (heroId: HeroId) => void;
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
    />
  );
}
