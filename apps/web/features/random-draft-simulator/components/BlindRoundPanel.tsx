"use client";

import { useEffect, useRef } from "react";
import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { HeroGrid } from "@/components/hero-grid/HeroGrid";
import { BUTTON_GHOST } from "@/features/draft/styles";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { specForRound } from "../use-random-draft-session";
import type { DraftPhase, HeroId } from "../types";

type BlindRoundPhase = Extract<DraftPhase, { type: "blind_round" }>;
type RoundRevealedPhase = Extract<DraftPhase, { type: "round_revealed" }>;

function unavailableHeroIds(draftState: DraftState | null, pendingUserPicks: HeroId[]): Set<HeroId> {
  const unavailable = new Set<HeroId>(pendingUserPicks);
  if (!draftState) return unavailable;
  for (const heroId of draftState.banned) unavailable.add(heroId);
  for (const heroId of draftState.picks.radiant) unavailable.add(heroId);
  for (const heroId of draftState.picks.dire) unavailable.add(heroId);
  return unavailable;
}

interface ConflictBannerProps {
  conflictBans: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

// Req. 5.2: notificación visible del héroe baneado por conflicto -- permanece mientras el usuario
// todavía no eligió un alternativo (el store solo la limpia al pasar de ronda, ver store.ts).
function ConflictBanner({ conflictBans, heroCatalog }: ConflictBannerProps) {
  if (conflictBans.length === 0) return null;
  const names = conflictBans.map((heroId) => heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`);
  return (
    <div className="rounded-lg border border-signal-negative bg-surface-raised p-3">
      <span className="text-caption text-signal-negative">
        Conflict_Ban: {names.join(", ")} coincidió con el pick del bot y quedó baneado. Elegí un héroe alternativo.
      </span>
    </div>
  );
}

interface PendingPickRowProps {
  heroId: HeroId;
  heroMeta: HeroMeta | undefined;
  onDeselect: (heroId: HeroId) => void;
}

function PendingPickRow({ heroId, heroMeta, onDeselect }: PendingPickRowProps) {
  function handleDeselect() {
    onDeselect(heroId);
  }
  return (
    <div className="flex flex-col items-center gap-1">
      <DraftHeroSlot heroId={heroId} heroMeta={heroMeta} variant="pick" />
      <button type="button" onClick={handleDeselect} className={BUTTON_GHOST}>
        Quitar
      </button>
    </div>
  );
}

interface BlindRoundActiveProps {
  phase: BlindRoundPhase;
  draftState: DraftState | null;
  heroCatalog: Map<number, HeroMeta>;
  // TSK-084: mismos candidatos que ya destaca el Copilot al lado -- un solo highlight dorado
  // consistente entre las dos superficies, no una segunda heurística.
  highlightedHeroIds: ReadonlySet<HeroId>;
  onConfirmPick: (heroId: HeroId) => void;
  onDeselectPick: (heroId: HeroId) => void;
  onConfirmRound: () => void;
}

function BlindRoundActive({
  phase,
  draftState,
  heroCatalog,
  highlightedHeroIds,
  onConfirmPick,
  onDeselectPick,
  onConfirmRound,
}: BlindRoundActiveProps) {
  const spec = specForRound(phase.round);
  const unavailable = unavailableHeroIds(draftState, phase.pendingUserPicks);
  const pickablePool = Array.from(heroCatalog.values()).filter((hero) => !unavailable.has(hero.id));
  const slotsLeft = spec.picksPerTeam - phase.pendingUserPicks.length;
  const readyToAdvance = slotsLeft === 0;

  // TSK-087: auto-avanza en cuanto se completan los picks de la ronda -- pedido explícito del
  // usuario ("si ya escogí 2, directo pasamos a lo siguiente"), el botón "Confirmar ronda" era un
  // paso manual innecesario una vez que no queda nada más que elegir. `advancedRef` evita
  // disparar dos veces para la misma ronda completa (el efecto se re-ejecuta en cada render
  // mientras readyToAdvance siga en true, hasta que confirmRound cambia la fase y este componente
  // deja de montarse).
  const advancedRef = useRef(false);
  useEffect(() => {
    if (!readyToAdvance) {
      advancedRef.current = false;
      return;
    }
    if (advancedRef.current) return;
    advancedRef.current = true;
    onConfirmRound();
  }, [readyToAdvance, onConfirmRound]);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      {/* TSK-086: el timer de la ronda se ve ahora al centro de CompactBoard (page.tsx), no acá --
          nunca dos timers en pantalla al mismo tiempo. */}
      <span className="text-heading text-content-primary">Ronda {phase.round} -- elegí {spec.picksPerTeam} héroe(s)</span>
      <ConflictBanner conflictBans={phase.conflictBans} heroCatalog={heroCatalog} />
      <div className="flex flex-wrap gap-3">
        {phase.pendingUserPicks.map((heroId) => (
          <PendingPickRow key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} onDeselect={onDeselectPick} />
        ))}
      </div>
      {slotsLeft > 0 && <HeroGrid heroes={pickablePool} highlightedHeroIds={highlightedHeroIds} onSelect={onConfirmPick} />}
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
        <RevealedSide title="Vos" picks={phase.userPicks} heroCatalog={heroCatalog} />
        <RevealedSide title="Bot" picks={phase.botPicks} heroCatalog={heroCatalog} />
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
  onConfirmPick: (heroId: HeroId) => void;
  onDeselectPick: (heroId: HeroId) => void;
  onConfirmRound: () => void;
}

const EMPTY_HIGHLIGHTED: ReadonlySet<HeroId> = new Set();

// <Dominio><Cosa>: cubre las fases blind_round y round_revealed (Req. 3) -- selección a ciegas
// con timer visible y revelación simultánea al confirmar, sin ternario para elegir la vista.
export function BlindRoundPanel({
  phase,
  draftState,
  heroCatalog,
  highlightedHeroIds = EMPTY_HIGHLIGHTED,
  onConfirmPick,
  onDeselectPick,
  onConfirmRound,
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
      onConfirmPick={onConfirmPick}
      onDeselectPick={onDeselectPick}
      onConfirmRound={onConfirmRound}
    />
  );
}
