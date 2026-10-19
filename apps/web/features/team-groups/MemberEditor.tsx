"use client";

import type { ChangeEvent } from "react";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import { ActionQuiet } from "@/design/canonical/primitives/ActionQuiet";
import { Glass } from "@/design/canonical/primitives/Glass";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { MAX_COMPANION_POOL_SIZE, REPLACE_MEMBER_HINT, SEAT_LABELS } from "./constants";
import { MemberPoolEditor } from "./MemberPoolEditor";
import { PoolHeroChip, renderCanonicalPickerIcon } from "./PoolHeroChip";
import type { DraftTeamGroup, PartySize, TeamMemberEntry } from "./types";

// The panel of the player being edited: who they are, and where their pools live. Every player's panel stays mounted (the
// inactive ones are only hidden) so that picking another player never throws away an unsaved pool edit.

export type DraftMember = DraftTeamGroup["members"][number];

export function memberTitle(member: DraftMember, partySize: PartySize): string {
  const who = partySize === 5 ? `Jugador ${member.slot}` : `Compañero ${member.slot}`;
  if (member.position === null) return `${who} — sin posición confirmada`;
  return `${who} — ${SEAT_LABELS[member.position]}`;
}

interface NewMemberHeroesProps {
  member: DraftMember;
  heroes: HeroMeta[];
  onAddHero: (slot: number, hero: number) => void;
  onRemoveHero: (slot: number, hero: number) => void;
}

// A person who isn't saved yet: their list becomes the pool of their position when the team is saved (POST).
function NewMemberHeroes({ member, heroes, onAddHero, onRemoveHero }: NewMemberHeroesProps) {
  const poolIsFull = member.heroPool.length >= MAX_COMPANION_POOL_SIZE;

  function handleAddHero(hero: number) {
    onAddHero(member.slot, hero);
  }

  function handleRemoveHero(hero: number) {
    onRemoveHero(member.slot, hero);
  }

  return (
    <div className="tg-pool">
      <ul className="tg-heroes">
        {member.heroPool.map((heroId) => (
          <li key={heroId}>
            <PoolHeroChip heroId={heroId} hero={heroes.find((hero) => hero.id === heroId)} onRemove={handleRemoveHero} />
          </li>
        ))}
      </ul>
      <span className="tg-count">{`${member.heroPool.length} de ${MAX_COMPANION_POOL_SIZE} héroes`}</span>
      {member.heroPool.length === 0 && <span className="tg-hint">Sin héroes cargados.</span>}
      {!poolIsFull && <HeroPicker variant="canonical" renderIcon={renderCanonicalPickerIcon} heroes={heroes} onSelect={handleAddHero} unavailableHeroIds={new Set(member.heroPool)} unavailableLabel="ya en el pool" />}
      {poolIsFull && <span className="tg-hint">Máximo 5 héroes.</span>}
      <span className="tg-hint">Se guarda como pool de su posición al pulsar Guardar equipo. Después podrás crear un pool distinto para cada posición.</span>
    </div>
  );
}

export interface MemberEditorProps {
  member: DraftMember;
  partySize: PartySize;
  heroes: HeroMeta[];
  active: boolean;
  /** The stored person behind this entry (same id), when the team is saved. Their pools are edited per position. */
  savedMember: TeamMemberEntry | undefined;
  teamGroupId: number | null;
  onNameChange: (slot: number, name: string) => void;
  onAddHero: (slot: number, hero: number) => void;
  onRemoveHero: (slot: number, hero: number) => void;
  onReplace: (slot: number) => void;
  onPoolDirtyChange: (memberId: number, dirtyCount: number) => void;
}

export function MemberEditor({ member, partySize, heroes, active, savedMember, teamGroupId, onNameChange, onAddHero, onRemoveHero, onReplace, onPoolDirtyChange }: MemberEditorProps) {
  const slotLabel = memberTitle(member, partySize);
  const hasSavedPools = savedMember !== undefined && teamGroupId !== null && member.id !== undefined;

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    onNameChange(member.slot, event.target.value);
  }

  function handleReplace() {
    onReplace(member.slot);
  }

  return (
    <div className="tg-member" hidden={!active} data-testid={`member-editor-${member.slot}`}>
      <Glass edge className="tg-panel">
        <h3 className="tg-h2">{slotLabel}</h3>
        <div className="tg-field">
          <label className="tg-label" htmlFor={`member-name-${member.slot}`}>
            Nombre
          </label>
          <input
            id={`member-name-${member.slot}`}
            type="text"
            value={member.name}
            onChange={handleNameChange}
            placeholder={`Nombre del jugador (${slotLabel})`}
            className="tg-input"
          />
        </div>
        {member.id !== undefined && (
          <div className="tg-actions">
            <span data-testid={`team-replace-member-${member.slot}`}>
              <ActionQuiet onPress={handleReplace}>Es otra persona</ActionQuiet>
            </span>
            <span className="tg-hint">{REPLACE_MEMBER_HINT}</span>
          </div>
        )}
        {hasSavedPools && <MemberPoolEditor teamGroupId={teamGroupId} member={savedMember} habitualSeat={member.position} heroes={heroes} onDirtyChange={onPoolDirtyChange} />}
        {!hasSavedPools && <NewMemberHeroes member={member} heroes={heroes} onAddHero={onAddHero} onRemoveHero={onRemoveHero} />}
      </Glass>
    </div>
  );
}
