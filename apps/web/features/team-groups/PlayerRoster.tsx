"use client";

import { StateTarget } from "@/design/canonical/primitives/StateTarget";
import { SEAT_SHORT } from "./constants";
import type { DraftMember } from "./MemberEditor";
import { pendingLegacyPool } from "./pool-editor";
import type { PartySize, TeamMemberEntry } from "./types";

// Who is being edited, at a glance: one target per player with their usual position and how much of their pool work is
// done. The open player is `selected` (a spectral segment AND aria-pressed); the rest are at rest.

function displayName(member: DraftMember, partySize: PartySize): string {
  const name = member.name.trim();
  if (name.length > 0) return name;
  if (partySize === 5) return `Jugador ${member.slot}`;
  return `Compañero ${member.slot}`;
}

function positionText(member: DraftMember): string {
  if (member.position === null) return "Sin posición";
  return `${SEAT_SHORT[member.position].title} · ${SEAT_SHORT[member.position].role}`;
}

function poolLines(member: DraftMember, saved: TeamMemberEntry | undefined, dirtyCount: number): string[] {
  const lines: string[] = [];
  if (saved === undefined) {
    if (member.heroPool.length === 0) lines.push("Sin héroes");
    if (member.heroPool.length > 0) lines.push(`${member.heroPool.length} héroes`);
  }
  if (saved !== undefined) {
    lines.push(`${saved.positionPools.length} de 5 posiciones con pool`);
    if (pendingLegacyPool(saved) !== null) lines.push("Lista antigua por confirmar");
  }
  if (dirtyCount === 1) lines.push("Pool sin guardar");
  if (dirtyCount > 1) lines.push(`${dirtyCount} pools sin guardar`);
  return lines;
}

interface RosterItemProps {
  member: DraftMember;
  partySize: PartySize;
  saved: TeamMemberEntry | undefined;
  dirtyCount: number;
  active: boolean;
  onSelect: (slot: number) => void;
}

function RosterItem({ member, partySize, saved, dirtyCount, active, onSelect }: RosterItemProps) {
  function handlePress() {
    onSelect(member.slot);
  }
  const state = active ? "selected" : "rest";
  return (
    <li data-testid={`roster-player-${member.slot}`}>
      <StateTarget state={state} title={displayName(member, partySize)} value={positionText(member)} onPress={handlePress}>
        <span className="tg-target-meta">
          {poolLines(member, saved, dirtyCount).map((line) => (
            <span key={line}>{line}</span>
          ))}
        </span>
      </StateTarget>
    </li>
  );
}

export interface PlayerRosterProps {
  members: DraftMember[];
  partySize: PartySize;
  activeSlot: number;
  savedMembers: readonly TeamMemberEntry[];
  /** Unsaved pool edits per saved person (by member id). */
  dirtyPools: Readonly<Record<number, number>>;
  onSelect: (slot: number) => void;
}

export function PlayerRoster({ members, partySize, activeSlot, savedMembers, dirtyPools, onSelect }: PlayerRosterProps) {
  return (
    <ul className="tg-roster" aria-label="Jugadores del equipo" data-testid="player-roster">
      {members.map((member) => (
        <RosterItem
          key={member.slot}
          member={member}
          partySize={partySize}
          saved={savedMembers.find((saved) => saved.id === member.id)}
          dirtyCount={dirtyPools[member.id ?? -1] ?? 0}
          active={member.slot === activeSlot}
          onSelect={onSelect}
        />
      ))}
    </ul>
  );
}
