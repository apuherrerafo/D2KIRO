import type { Seat } from "./types";

// Moving players between positions. Pure, no React: the editor (usual positions, saved explicitly) and the
// simulator setup (this match only, never saved unless asked) both use the same two functions.

export const SEATS: readonly Seat[] = [1, 2, 3, 4, 5];

/** A person on the board. `key` is whatever the caller uses to tell people apart (slot in the editor, member id in a match). */
export interface SeatedPlayer {
  key: number;
  position: Seat | null;
}

/**
 * Puts `key` on `target` (null = takes them off the board). If someone already sits there they SWAP: the other
 * person takes the seat `key` just left, which may be "no seat". Nobody is ever dropped, duplicated or moved
 * without the user having moved someone.
 */
export function placePlayer<T extends SeatedPlayer>(players: readonly T[], key: number, target: Seat | null): T[] {
  const mover = players.find((player) => player.key === key);
  if (mover === undefined || mover.position === target) return [...players];
  const previous = mover.position;
  return players.map((player) => {
    if (player.key === key) return { ...player, position: target };
    if (target !== null && player.position === target) return { ...player, position: previous };
    return player;
  });
}

/** `{ "<key>": seat }` for the people who are placed; unplaced people are left out (the engine treats that as "no pool"). */
export function placedAssignment(players: readonly SeatedPlayer[]): Record<string, Seat> {
  const assignment: Record<string, Seat> = {};
  for (const player of players) {
    if (player.position !== null) assignment[String(player.key)] = player.position;
  }
  return assignment;
}

export function samePositions(a: readonly SeatedPlayer[], b: readonly SeatedPlayer[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((player) => b.find((other) => other.key === player.key)?.position === player.position);
}

/**
 * The one-click confirmation of an OLD team: the user states "yes, Player N plays Pos N as listed". Only ever offered for a
 * team where nobody is placed yet, so it can't move anyone the user already decided on. Players are keyed by their list
 * position (1..5); anyone past the fifth is left unplaced. The result is still only a draft on screen until the user saves.
 */
export function confirmInListOrder<T extends SeatedPlayer>(players: readonly T[]): T[] {
  if (players.some((player) => player.position !== null)) return [...players];
  const ordered = [...players].sort((a, b) => a.key - b.key);
  return players.map((player) => ({ ...player, position: SEATS[ordered.indexOf(player)] ?? null }));
}
