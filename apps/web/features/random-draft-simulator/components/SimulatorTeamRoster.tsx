"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { DraftState, HeroId } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { CoachRoleBelief } from "../coach-client";
import type { OwnAssignedPositionBinding, RecommendationPosition } from "../protocol-client";
import {
  controllerForPosition,
  enemyRoleBeliefLabel,
  rosterSeatForRoundSlot,
  SIMULATOR_POSITION_LABELS,
  SIMULATOR_POSITIONS,
  type SimulatorController,
} from "../roster";
import type { DraftConfig, DraftPhase } from "../types";

interface OwnRosterSeatProps {
  heroId: HeroId | null;
  heroCatalog: Map<number, HeroMeta>;
  position: 1 | 2 | 3 | 4 | 5;
  controller: SimulatorController;
}

function controllerClassName(controller: SimulatorController): string {
  if (controller === "YOU") return "border-accent-primary text-accent-primary";
  if (controller === "PARTY") return "border-surface-border text-content-primary";
  return "border-surface-border text-content-muted";
}

/** Own Team seat: Pos1-5 identity is known session truth (PD-027 point 3), never re-derived here. */
function OwnRosterSeat({ heroId, heroCatalog, position, controller }: OwnRosterSeatProps) {
  const hero = heroId === null ? undefined : heroCatalog.get(heroId);
  return (
    <div
      className="flex min-h-24 items-center gap-3 rounded-md border border-surface-border bg-surface-overlay p-3"
      data-testid={`own-roster-pos-${position}`}
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
        {heroId === null && <span className="text-caption text-content-muted">Sin elegir</span>}
        <span className={`self-start rounded-md border px-2 py-1 text-caption font-semibold ${controllerClassName(controller)}`}>
          {controller}
        </span>
      </div>
    </div>
  );
}

interface EnemyRosterSeatProps {
  heroId: HeroId | null;
  heroCatalog: Map<number, HeroMeta>;
  seat: number;
  roleLabel: string | null;
}

/**
 * Enemy seat (PD-027): `seat` is only the reveal-order slot (1-5), never a Ranked Roles position.
 * The role label, when shown, comes exclusively from Coach RoleBelief (`roleLabel`) -- with no
 * belief for that hero, no role label is shown at all, never a fabricated PosN. The Enemy Bot's
 * private position assignment never reaches this component.
 */
function EnemyRosterSeat({ heroId, heroCatalog, seat, roleLabel }: EnemyRosterSeatProps) {
  const hero = heroId === null ? undefined : heroCatalog.get(heroId);
  return (
    <div
      className="flex min-h-24 items-center gap-3 rounded-md border border-surface-border bg-surface-overlay p-3"
      data-testid={`enemy-roster-pos-${seat}`}
    >
      {heroId !== null && <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${heroId}`} size={48} />}
      {heroId === null && (
        <div className="flex h-12 w-12 items-center justify-center rounded-md border border-surface-border bg-surface-raised text-caption text-content-muted">
          ?
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {heroId !== null && <span className="truncate text-body text-content-primary">{hero?.localizedName ?? `Héroe ${heroId}`}</span>}
        {heroId === null && <span className="text-caption text-content-muted">Oculto hasta el reveal</span>}
        {heroId !== null && roleLabel !== null && (
          <span className="text-caption text-content-secondary" data-testid="enemy-roster-role">
            {roleLabel}
          </span>
        )}
      </div>
    </div>
  );
}

function picksByRosterSeat(picks: readonly HeroId[]): Map<number, HeroId> {
  return new Map(picks.map((heroId, seat) => [seat, heroId]));
}

/**
 * PD-026/PD-027 -- Own Team hero-by-position, reconstructed from the session-layer binding
 * (`ownAssignedPositions`), never from a fixed seat<->position table. Only CLOSED rounds' bindings
 * are cross-referenced against the seat-ordered `picks` array (safe: that ordering is settled once
 * a round resolves); the CURRENT in-progress attempt's picks come straight from `phase.lockedUserPicks`,
 * already keyed by position from this client's own successful submission -- the live array's
 * mid-round seat ordering is never assumed.
 */
function ownPicksByPosition(
  picks: readonly HeroId[],
  phase: DraftPhase,
  bindings: readonly OwnAssignedPositionBinding[],
): Map<RecommendationPosition, HeroId> {
  const completedSeatCount = phase.type === "blind_round" ? (phase.round === 1 ? 0 : phase.round === 2 ? 2 : 4) : picks.length;
  const byPosition = new Map<RecommendationPosition, HeroId>();
  for (const binding of bindings) {
    const seat = rosterSeatForRoundSlot(binding.round, binding.slotIndex);
    if (seat >= completedSeatCount) continue;
    const heroId = picks[seat];
    if (heroId !== undefined) byPosition.set(binding.assignedPosition, heroId);
  }
  if (phase.type === "blind_round") {
    for (const [position, heroId] of Object.entries(phase.lockedUserPicks)) {
      if (heroId !== undefined) byPosition.set(Number(position) as RecommendationPosition, heroId);
    }
  }
  return byPosition;
}

interface OwnRosterSideProps {
  byPosition: ReadonlyMap<RecommendationPosition, HeroId>;
  config: DraftConfig;
  heroCatalog: Map<number, HeroMeta>;
}

function OwnRosterSide({ byPosition, config, heroCatalog }: OwnRosterSideProps) {
  return (
    <section className="flex flex-col gap-2">
      <span className="text-body font-semibold text-content-primary">Tu equipo</span>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {SIMULATOR_POSITIONS.map((position) => (
          <OwnRosterSeat
            key={position}
            heroId={byPosition.get(position) ?? null}
            heroCatalog={heroCatalog}
            position={position}
            controller={controllerForPosition(config, position)}
          />
        ))}
      </div>
    </section>
  );
}

const ENEMY_SEATS: readonly number[] = [0, 1, 2, 3, 4];

interface EnemyRosterSideProps {
  bySeat: ReadonlyMap<number, HeroId>;
  heroCatalog: Map<number, HeroMeta>;
  roleBeliefs: readonly CoachRoleBelief[] | undefined;
}

/**
 * PD-027: enemy heroes are shown in reveal order, never remapped through a fixed seat->position
 * table. `roleBeliefByHero` is the only source for a displayed role -- with no belief for a hero,
 * that seat renders with no role label at all.
 */
function EnemyRosterSide({ bySeat, heroCatalog, roleBeliefs }: EnemyRosterSideProps) {
  const roleBeliefByHero = new Map((roleBeliefs ?? []).map((belief) => [belief.heroId, belief]));
  return (
    <section className="flex flex-col gap-2">
      <span className="text-body font-semibold text-content-primary">Equipo rival</span>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        {ENEMY_SEATS.map((seat) => {
          const heroId = bySeat.get(seat) ?? null;
          const belief = heroId === null ? undefined : roleBeliefByHero.get(heroId);
          return (
            <EnemyRosterSeat
              key={seat}
              heroId={heroId}
              heroCatalog={heroCatalog}
              seat={seat + 1}
              roleLabel={enemyRoleBeliefLabel(belief)}
            />
          );
        })}
      </div>
    </section>
  );
}

export interface SimulatorTeamRosterProps {
  draftState: DraftState;
  config: DraftConfig;
  phase: DraftPhase;
  heroCatalog: Map<number, HeroMeta>;
  /** PD-026/PD-027 -- Own Team's session-layer position binding (ProtocolSnapshot.ownAssignedPositions). */
  ownAssignedPositions: readonly OwnAssignedPositionBinding[];
  /** Coach RoleBelief for revealed enemy heroes (PD-027). Absent/empty means no belief yet -- never a fabricated position. */
  enemyRoleBeliefs?: readonly CoachRoleBelief[];
}

/** Own Team: persistent Pos1-5 identity, known session truth. Enemy: reveal order + Coach inference only (PD-027). */
export function SimulatorTeamRoster({ draftState, config, phase, heroCatalog, ownAssignedPositions, enemyRoleBeliefs }: SimulatorTeamRosterProps) {
  const own = draftState.localSide === "dire" ? draftState.picks.dire : draftState.picks.radiant;
  const enemy = draftState.localSide === "dire" ? draftState.picks.radiant : draftState.picks.dire;
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-border bg-surface-raised p-4" data-testid="team-roster">
      <span className="text-heading text-content-primary">Roster Pos1-5</span>
      <OwnRosterSide byPosition={ownPicksByPosition(own, phase, ownAssignedPositions)} config={config} heroCatalog={heroCatalog} />
      <EnemyRosterSide bySeat={picksByRosterSeat(enemy)} heroCatalog={heroCatalog} roleBeliefs={enemyRoleBeliefs} />
    </div>
  );
}
