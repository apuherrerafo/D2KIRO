import { useState } from "react";
import type { PositionBoardPlayer } from "@/components/position-board/PositionBoard";
import { placedAssignment, placePlayer, samePositions } from "@/features/team-groups/position-assignment";
import type { Seat, TeamGroupEntry, TeamGroupPutBody } from "@/features/team-groups/types";
import { useUpdateTeamGroupMutation } from "@/lib/engine-api";

// Who plays where in THIS match, starting from the team's usual positions. Changing it never touches the saved
// team: saving is a separate, explicit action (`saveAsUsual`).

export const MATCH_POSITIONS_SAVED = "Posiciones guardadas como habituales del equipo.";
export const MATCH_POSITIONS_SAVE_FAILED = "No se pudieron guardar las posiciones. Inténtalo de nuevo.";

interface MatchOverride {
  groupId: number;
  players: PositionBoardPlayer[];
}

function usualPlayers(group: TeamGroupEntry): PositionBoardPlayer[] {
  return group.members.map((member) => ({ key: member.id, name: member.name, position: member.position ?? null }));
}

function sameKeys(a: readonly PositionBoardPlayer[], b: readonly PositionBoardPlayer[]): boolean {
  return a.length === b.length && a.every((player) => b.some((other) => other.key === player.key));
}

// A swap only applies to the team it was made on, and only while that team's members are the same people: after the
// team is edited or re-saved (new member ids) the old swap is dropped instead of being half-applied to different rows.
function currentPlayers(override: MatchOverride | null, group: TeamGroupEntry | undefined, usual: PositionBoardPlayer[]): PositionBoardPlayer[] {
  if (group === undefined || override === null) return usual;
  if (override.groupId !== group.id || !sameKeys(override.players, usual)) return usual;
  return override.players;
}

function toSaveBody(group: TeamGroupEntry, players: readonly PositionBoardPlayer[]): TeamGroupPutBody {
  return {
    name: group.name,
    partySize: group.partySize,
    members: group.members.map((member) => ({
      id: member.id,
      slot: member.slot,
      position: players.find((player) => player.key === member.id)?.position ?? null,
      name: member.name,
      heroPool: member.heroPool,
    })),
  };
}

/**
 * How many positions will actually get a team pool: someone is placed there on their confirmed usual position, they have
 * heroes, and it isn't the owner's own seat (the owner always plays from their personal pool). The engine decides for real; this only keeps the screen
 * from saying "pools active" when none will be.
 */
export function countActivePools(group: TeamGroupEntry | undefined, players: readonly PositionBoardPlayer[], ownerSeat: Seat | null): number {
  if (group === undefined) return 0;
  return players.filter((player) => {
    if (player.position === null || player.position === ownerSeat) return false;
    const saved = group.members.find((member) => member.id === player.key);
    // Same rule as the engine: only the pool saved for THIS seat counts. The legacy single list and the pools of other
    // seats are never borrowed -- a person moved to a seat they have no pool for gets none.
    const pool = saved?.positionPools.find((candidate) => candidate.position === player.position);
    return pool !== undefined && pool.heroPool.length > 0;
  }).length;
}

export interface MatchPositions {
  players: PositionBoardPlayer[];
  /** This match differs from the team's usual positions. */
  changed: boolean;
  /** `{ memberId: seat }` of everyone placed, ready to send when the draft starts. `undefined` = no team selected. */
  assignment: Record<string, Seat> | undefined;
  saving: boolean;
  message: string | null;
  place(key: number, seat: Seat | null): void;
  reset(): void;
  saveAsUsual(): Promise<void>;
}

export function useMatchPositions(group: TeamGroupEntry | undefined): MatchPositions {
  const [override, setOverride] = useState<MatchOverride | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [updateTeamGroup, { isLoading: saving }] = useUpdateTeamGroupMutation();
  const usual = group === undefined ? [] : usualPlayers(group);
  const players = currentPlayers(override, group, usual);

  function place(key: number, seat: Seat | null) {
    if (group === undefined) return;
    setOverride({ groupId: group.id, players: placePlayer(players, key, seat) });
    setMessage(null);
  }

  function reset() {
    setOverride(null);
    setMessage(null);
  }

  async function saveAsUsual() {
    if (group === undefined) return;
    try {
      await updateTeamGroup({ id: group.id, body: toSaveBody(group, players) }).unwrap();
      setMessage(MATCH_POSITIONS_SAVED);
    } catch {
      setMessage(MATCH_POSITIONS_SAVE_FAILED);
    }
  }

  return {
    players,
    changed: group !== undefined && !samePositions(players, usual),
    assignment: group === undefined ? undefined : placedAssignment(players),
    saving,
    message,
    place,
    reset,
    saveAsUsual,
  };
}
