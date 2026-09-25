"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { DraftState, HeroId } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import {
  controllerForPosition,
  rosterSeatForPosition,
  SIMULATOR_POSITION_LABELS,
  SIMULATOR_POSITIONS,
  type SimulatorController,
} from "../roster";
import type { DraftConfig, DraftPhase } from "../types";

interface RosterSeatProps {
  heroId: HeroId | null;
  heroCatalog: Map<number, HeroMeta>;
  position: 1 | 2 | 3 | 4 | 5;
  controller: SimulatorController | null;
  isEnemy: boolean;
}

function controllerClassName(controller: SimulatorController): string {
  if (controller === "YOU") return "border-accent-primary text-accent-primary";
  if (controller === "PARTY") return "border-surface-border text-content-primary";
  return "border-surface-border text-content-muted";
}

function SimulatorRosterSeat({ heroId, heroCatalog, position, controller, isEnemy }: RosterSeatProps) {
  const hero = heroId === null ? undefined : heroCatalog.get(heroId);
  const emptyLabel = isEnemy ? "Oculto hasta el reveal" : "Sin elegir";
  const team = isEnemy ? "enemy" : "own";
  return (
    <div
      className="flex min-h-24 items-center gap-3 rounded-md border border-surface-border bg-surface-overlay p-3"
      data-testid={`${team}-roster-pos-${position}`}
    >
      {heroId !== null && <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${heroId}`} size={48} />}
      {heroId === null && (
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-surface-border bg-surface-raised text-caption text-content-muted">
          ?
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-caption font-semibold text-content-primary">
          Pos{position} {SIMULATOR_POSITION_LABELS[position]}
        </span>
        {heroId !== null && <span className="truncate text-body text-content-primary">{hero?.localizedName ?? `Héroe ${heroId}`}</span>}
        {heroId === null && <span className="text-caption text-content-muted">{emptyLabel}</span>}
        {controller && (
          <span className={`self-start rounded-md border px-2 py-1 text-caption font-semibold ${controllerClassName(controller)}`}>
            {controller}
          </span>
        )}
      </div>
    </div>
  );
}

function picksByRosterSeat(picks: readonly HeroId[]): Map<number, HeroId> {
  return new Map(picks.map((heroId, seat) => [seat, heroId]));
}

function ownPicksByRosterSeat(picks: readonly HeroId[], phase: DraftPhase): Map<number, HeroId> {
  if (phase.type !== "blind_round") return picksByRosterSeat(picks);
  const completedSeatCount = phase.round === 1 ? 0 : phase.round === 2 ? 2 : 4;
  const bySeat = picksByRosterSeat(picks.slice(0, completedSeatCount));
  for (const [seat, heroId] of Object.entries(phase.lockedUserPicks)) {
    if (heroId !== undefined) bySeat.set(Number(seat), heroId);
  }
  return bySeat;
}

interface RosterSideProps {
  title: string;
  bySeat: ReadonlyMap<number, HeroId>;
  config: DraftConfig;
  heroCatalog: Map<number, HeroMeta>;
  isEnemy: boolean;
}

function SimulatorRosterSide({ title, bySeat, config, heroCatalog, isEnemy }: RosterSideProps) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-body font-semibold text-content-primary">{title}</span>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {SIMULATOR_POSITIONS.map((position) => (
          <SimulatorRosterSeat
            key={position}
            heroId={bySeat.get(rosterSeatForPosition(position)) ?? null}
            heroCatalog={heroCatalog}
            position={position}
            controller={isEnemy ? null : controllerForPosition(config, position)}
            isEnemy={isEnemy}
          />
        ))}
      </div>
    </section>
  );
}

export interface SimulatorTeamRosterProps {
  draftState: DraftState;
  config: DraftConfig;
  phase: DraftPhase;
  heroCatalog: Map<number, HeroMeta>;
}

/** Persistent Pos1-5 representation. It only consumes perspective-safe DraftState identities. */
export function SimulatorTeamRoster({ draftState, config, phase, heroCatalog }: SimulatorTeamRosterProps) {
  const own = draftState.localSide === "dire" ? draftState.picks.dire : draftState.picks.radiant;
  const enemy = draftState.localSide === "dire" ? draftState.picks.radiant : draftState.picks.dire;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-border bg-surface-raised p-4" data-testid="team-roster">
      <span className="text-heading text-content-primary">Roster Pos1-5</span>
      <SimulatorRosterSide title="Tu equipo" bySeat={ownPicksByRosterSeat(own, phase)} config={config} heroCatalog={heroCatalog} isEnemy={false} />
      <SimulatorRosterSide title="Equipo rival" bySeat={picksByRosterSeat(enemy)} config={config} heroCatalog={heroCatalog} isEnemy />
    </div>
  );
}
