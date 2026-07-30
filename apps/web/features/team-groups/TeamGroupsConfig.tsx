"use client";

import { useState, type ChangeEvent } from "react";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { HeroPicker } from "@/components/hero-picker/HeroPicker";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import {
  useCreateTeamGroupMutation,
  useDeleteTeamGroupMutation,
  useGetHeroesQuery,
  useGetTeamGroupsQuery,
  useUpdateTeamGroupMutation,
} from "@/lib/engine-api";
import { EMPTY_TEAM_GROUP_MESSAGE, MAX_COMPANION_POOL_SIZE, PARTY_SIZE_OPTIONS, TEAM_GROUP_DELETED_MESSAGE, TEAM_GROUP_SAVED_MESSAGE } from "./constants";
import type { DraftTeamGroup, PartySize, TeamGroupEntry, TeamGroupPutBody } from "./types";

function memberCountForParty(partySize: PartySize): number {
  return partySize - 1;
}

function createEmptyMembers(partySize: PartySize) {
  return Array.from({ length: memberCountForParty(partySize) }, (_item, index) => ({
    slot: index + 1,
    name: "",
    heroPool: [],
  }));
}

function createNewDraft(): DraftTeamGroup {
  return { id: null, name: "", partySize: 2, members: createEmptyMembers(2) };
}

function toDraftGroup(group: TeamGroupEntry): DraftTeamGroup {
  return {
    id: group.id,
    name: group.name,
    partySize: group.partySize,
    members: group.members.map((member) => ({ slot: member.slot, name: member.name, heroPool: member.heroPool })),
  };
}

function toPartySize(value: string): PartySize {
  const parsed = Number(value);
  if (parsed === 3) return 3;
  if (parsed === 5) return 5;
  return 2;
}

function findHero(heroes: HeroMeta[], id: number): HeroMeta | undefined {
  return heroes.find((hero) => hero.id === id);
}

function toPutBody(draft: DraftTeamGroup): TeamGroupPutBody {
  return {
    name: draft.name,
    partySize: draft.partySize,
    members: draft.members.map((member) => ({ slot: member.slot, name: member.name, heroPool: member.heroPool })),
  };
}

interface TeamGroupRowProps {
  group: TeamGroupEntry;
  onEdit: (group: TeamGroupEntry) => void;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}

function TeamGroupRow({ group, onEdit, onDelete, isDeleting }: TeamGroupRowProps) {
  function handleEdit() {
    onEdit(group);
  }

  function handleDelete() {
    onDelete(group.id);
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface-overlay p-3">
      <div className="flex flex-col">
        <span className="text-body text-content-primary">{group.name}</span>
        <span className="text-caption text-content-muted">
          Party de {group.partySize}, {group.members.length} compañero(s)
        </span>
      </div>
      <div className="flex gap-2">
        <button type="button" onClick={handleEdit} className={BUTTON_SECONDARY}>
          Editar
        </button>
        <button type="button" onClick={handleDelete} disabled={isDeleting} className={BUTTON_GHOST}>
          Eliminar
        </button>
      </div>
    </div>
  );
}

interface MemberEditorProps {
  member: DraftTeamGroup["members"][number];
  heroes: HeroMeta[];
  onNameChange: (slot: number, name: string) => void;
  onAddHero: (slot: number, hero: number) => void;
  onRemoveHero: (slot: number, hero: number) => void;
}

function MemberEditor({ member, heroes, onNameChange, onAddHero, onRemoveHero }: MemberEditorProps) {
  const poolIsFull = member.heroPool.length >= MAX_COMPANION_POOL_SIZE;

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    onNameChange(member.slot, event.target.value);
  }

  function handleAddHero(hero: number) {
    onAddHero(member.slot, hero);
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-surface-border bg-surface-overlay p-3">
      <input
        type="text"
        value={member.name}
        onChange={handleNameChange}
        placeholder={`Compañero ${member.slot}`}
        className="rounded-md border border-surface-border bg-surface-raised px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
      />
      <div className="flex flex-wrap gap-2">
        {member.heroPool.map((heroId) => (
          <MemberHero key={heroId} slot={member.slot} heroId={heroId} hero={findHero(heroes, heroId)} onRemove={onRemoveHero} />
        ))}
      </div>
      {member.heroPool.length === 0 && <span className="text-caption text-content-muted">Sin héroes cargados.</span>}
      {!poolIsFull && <HeroPicker heroes={heroes} onSelect={handleAddHero} />}
      {poolIsFull && <span className="text-caption text-content-muted">Máximo 5 héroes.</span>}
    </div>
  );
}

interface MemberHeroProps {
  slot: number;
  heroId: number;
  hero: HeroMeta | undefined;
  onRemove: (slot: number, hero: number) => void;
}

function MemberHero({ slot, heroId, hero, onRemove }: MemberHeroProps) {
  function handleRemove() {
    onRemove(slot, heroId);
  }

  return (
    <button type="button" onClick={handleRemove} className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-raised px-2 py-1 text-caption text-content-primary">
      <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${heroId}`} size={28} />
      {hero?.localizedName ?? `Héroe ${heroId}`}
    </button>
  );
}

export function TeamGroupsConfig() {
  const { data: groups = [], isLoading, error } = useGetTeamGroupsQuery();
  const { data: heroes = [] } = useGetHeroesQuery();
  const [createTeamGroup, { isLoading: isCreating }] = useCreateTeamGroupMutation();
  const [updateTeamGroup, { isLoading: isUpdating }] = useUpdateTeamGroupMutation();
  const [deleteTeamGroup, { isLoading: isDeleting }] = useDeleteTeamGroupMutation();
  const [draft, setDraft] = useState<DraftTeamGroup>(createNewDraft);
  const [message, setMessage] = useState<string | null>(null);

  function handleNew() {
    setDraft(createNewDraft());
    setMessage(null);
  }

  function handleEdit(group: TeamGroupEntry) {
    setDraft(toDraftGroup(group));
    setMessage(null);
  }

  async function handleDelete(id: number) {
    await deleteTeamGroup(id).unwrap();
    if (draft.id === id) setDraft(createNewDraft());
    setMessage(TEAM_GROUP_DELETED_MESSAGE);
  }

  function handleNameChange(event: ChangeEvent<HTMLInputElement>) {
    setDraft({ ...draft, name: event.target.value });
    setMessage(null);
  }

  function handlePartySizeChange(event: ChangeEvent<HTMLSelectElement>) {
    const partySize = toPartySize(event.target.value);
    setDraft({ ...draft, partySize, members: createEmptyMembers(partySize) });
    setMessage(null);
  }

  function handleMemberNameChange(slot: number, name: string) {
    setDraft({ ...draft, members: draft.members.map((member) => (member.slot === slot ? { ...member, name } : member)) });
    setMessage(null);
  }

  function handleAddHero(slot: number, hero: number) {
    setDraft({
      ...draft,
      members: draft.members.map((member) => {
        if (member.slot !== slot || member.heroPool.includes(hero) || member.heroPool.length >= MAX_COMPANION_POOL_SIZE) return member;
        return { ...member, heroPool: [...member.heroPool, hero] };
      }),
    });
    setMessage(null);
  }

  function handleRemoveHero(slot: number, hero: number) {
    setDraft({ ...draft, members: draft.members.map((member) => (member.slot === slot ? { ...member, heroPool: member.heroPool.filter((id) => id !== hero) } : member)) });
    setMessage(null);
  }

  async function handleSave() {
    setMessage(null);
    const body = toPutBody(draft);
    if (draft.id === null) {
      // Sin esto, un segundo "Guardar" sobre el mismo equipo recién creado -- sin recargar ni
      // pulsar "Editar" -- creaba un duplicado en vez de actualizar (draft.id seguía en null).
      const created = await createTeamGroup(body).unwrap();
      setDraft(toDraftGroup(created));
    } else {
      await updateTeamGroup({ id: draft.id, body }).unwrap();
    }
    setMessage(TEAM_GROUP_SAVED_MESSAGE);
  }

  const isSaving = isCreating || isUpdating;

  return (
    <main className="flex min-h-screen flex-col gap-4 bg-surface-base p-6">
      <span className="text-heading text-content-primary">Equipos</span>

      <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-body text-content-primary">Guardados</span>
          <button type="button" onClick={handleNew} className={BUTTON_SECONDARY}>
            Nuevo
          </button>
        </div>
        {isLoading && <span className="text-body text-content-secondary">Cargando...</span>}
        {error && <span className="text-body text-signal-negative">No se pudieron cargar los equipos.</span>}
        {groups.length === 0 && !isLoading && <span className="text-caption text-content-muted">{EMPTY_TEAM_GROUP_MESSAGE}</span>}
        {groups.map((group) => (
          <TeamGroupRow key={group.id} group={group} onEdit={handleEdit} onDelete={handleDelete} isDeleting={isDeleting} />
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
        <input
          type="text"
          value={draft.name}
          onChange={handleNameChange}
          placeholder="Nombre del equipo"
          className="rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
        />
        <label className="flex items-center gap-2 text-caption text-content-secondary">
          Tamaño de party
          <select
            value={draft.partySize}
            onChange={handlePartySizeChange}
            className="rounded-md border border-surface-border bg-surface-overlay px-2 py-1 text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary"
          >
            {PARTY_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        {draft.members.map((member) => (
          <MemberEditor key={member.slot} member={member} heroes={heroes} onNameChange={handleMemberNameChange} onAddHero={handleAddHero} onRemoveHero={handleRemoveHero} />
        ))}
        {message && <span className="text-caption text-content-secondary">{message}</span>}
        <button type="button" onClick={handleSave} disabled={isSaving || draft.name.trim().length === 0} className={BUTTON_PRIMARY}>
          Guardar
        </button>
      </div>
    </main>
  );
}
