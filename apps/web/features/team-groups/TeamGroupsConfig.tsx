"use client";

import { useCallback, useState, type ChangeEvent } from "react";
import { PositionBoard, type PositionBoardPlayer } from "@/components/position-board/PositionBoard";
import { ActionPrimary } from "@/design/canonical/primitives/ActionPrimary";
import { ActionQuiet } from "@/design/canonical/primitives/ActionQuiet";
import { Glass } from "@/design/canonical/primitives/Glass";
import {
  useCreateTeamGroupMutation,
  useDeleteTeamGroupMutation,
  useGetHeroesQuery,
  useGetTeamGroupsQuery,
  useUpdateTeamGroupMutation,
} from "@/lib/engine-api";
import { CanonicalLightScope } from "./CanonicalLightScope";
import { MAX_COMPANION_POOL_SIZE, PARTY_SIZE_OPTIONS, TEAM_GROUP_DELETED_MESSAGE, TEAM_GROUP_SAVED_MESSAGE } from "./constants";
import { MemberEditor } from "./MemberEditor";
import { PlayerRoster } from "./PlayerRoster";
import { describeSaveFailure, needsReload, type SaveFailure } from "./pool-editor";
import { confirmInListOrder, placePlayer } from "./position-assignment";
import { SavedTeamsPanel } from "./SavedTeamsPanel";
import { TgNotice } from "./TgNotice";
import type { DraftTeamGroup, PartySize, Seat, TeamGroupEntry, TeamGroupPutBody } from "./types";

const LEGACY_POSITIONS_MESSAGE =
  "Este equipo se guardó antes de registrar posiciones, así que no sabemos quién juega dónde. Colócalos en el tablero y pulsa Guardar equipo: hasta entonces no se aplica ningún pool de este equipo.";
const CONFIRM_LIST_ORDER_LABEL = "Confirmar tal como están (Jugador 1 = Pos 1 … Jugador 5 = Pos 5)";
const CONFIRMED_ON_SCREEN_MESSAGE = "Posiciones confirmadas en pantalla. Pulsa Guardar equipo para conservarlas.";
const USUAL_POSITIONS_HINT = "Posiciones habituales de este equipo. Se guardan al pulsar Guardar equipo; para cambiar solo una partida, hazlo al empezar el draft, sin guardar.";

type DraftMember = DraftTeamGroup["members"][number];

// Un equipo NUEVO de Party 5 arranca con una posición visible por jugador (editable en el tablero, se guarda al pulsar
// Guardar equipo). Nunca se aplica a un equipo ya guardado: ahí la posición es la que el usuario confirmó, o ninguna.
function defaultPositionFor(partySize: PartySize, index: number): Seat | null {
  if (partySize !== 5) return null;
  return (index + 1) as Seat;
}

function toBoardPlayers(members: DraftMember[]): PositionBoardPlayer[] {
  return members.map((member) => ({ key: member.slot, name: member.name, position: member.position }));
}

function memberCountForParty(partySize: PartySize): number {
  return partySize === 5 ? 5 : partySize - 1;
}

function createEmptyMembers(partySize: PartySize) {
  return Array.from({ length: memberCountForParty(partySize) }, (_item, index) => ({
    slot: index + 1,
    position: defaultPositionFor(partySize, index),
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
    members: group.members.map((member) => ({ id: member.id, slot: member.slot, position: member.position ?? null, name: member.name, heroPool: member.heroPool })),
  };
}

function toPartySize(value: string): PartySize {
  const parsed = Number(value);
  if (parsed === 3) return 3;
  if (parsed === 5) return 5;
  return 2;
}

function toPutBody(draft: DraftTeamGroup): TeamGroupPutBody {
  return {
    name: draft.name,
    partySize: draft.partySize,
    members: draft.members.map((member) => ({ id: member.id, slot: member.slot, position: member.position, name: member.name, heroPool: member.heroPool })),
  };
}

// What is on screen vs what was last loaded or saved: the one honest source for "cambios sin guardar" at team level.
function snapshotOf(draft: DraftTeamGroup): string {
  return JSON.stringify(toPutBody(draft));
}

interface TeamStateProps {
  isNew: boolean;
  dirty: boolean;
}

function TeamStateLine({ isNew, dirty }: TeamStateProps) {
  if (isNew) {
    return (
      <span className="tg-state" data-state="new" data-testid="team-state">
        Equipo nuevo · aún sin guardar
      </span>
    );
  }
  if (dirty) {
    return (
      <span className="tg-state" data-state="dirty" data-testid="team-state">
        Cambios sin guardar
      </span>
    );
  }
  return (
    <span className="tg-state" data-state="saved" data-testid="team-state">
      Todo guardado
    </span>
  );
}

interface TeamFailureProps {
  failure: SaveFailure;
  onReload: () => void;
}

// A rejected team save keeps the draft exactly as it is. A stale tab can only recover by reading the teams again, so that
// action is offered right here -- it refreshes the saved list and leaves the draft on screen alone.
function TeamFailure({ failure, onReload }: TeamFailureProps) {
  return (
    <div data-testid="team-save-failure" data-code={failure.code ?? "unknown"}>
      <TgNotice tone="error" title={failure.title}>
        <p>{failure.body}</p>
        {needsReload(failure) && (
          <div className="tg-notice-actions">
            <ActionQuiet onPress={onReload}>Recargar equipos</ActionQuiet>
            <span className="tg-hint">Lo que tienes en pantalla no se borra.</span>
          </div>
        )}
      </TgNotice>
    </div>
  );
}

export function TeamGroupsConfig() {
  const { data: groups = [], isLoading, error, refetch } = useGetTeamGroupsQuery();
  const { data: heroes = [] } = useGetHeroesQuery();
  const [createTeamGroup, { isLoading: isCreating }] = useCreateTeamGroupMutation();
  const [updateTeamGroup, { isLoading: isUpdating }] = useUpdateTeamGroupMutation();
  const [deleteTeamGroup, { isLoading: isDeleting }] = useDeleteTeamGroupMutation();
  const [draft, setDraft] = useState<DraftTeamGroup>(createNewDraft);
  const [baseline, setBaseline] = useState<string>(() => snapshotOf(createNewDraft()));
  const [selectedSlot, setSelectedSlot] = useState(1);
  const [dirtyPools, setDirtyPools] = useState<Record<number, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saveFailure, setSaveFailure] = useState<SaveFailure | null>(null);

  const handlePoolDirtyChange = useCallback((memberId: number, dirtyCount: number) => {
    setDirtyPools((current) => (current[memberId] === dirtyCount ? current : { ...current, [memberId]: dirtyCount }));
  }, []);

  function openDraft(next: DraftTeamGroup) {
    setDraft(next);
    setBaseline(snapshotOf(next));
    setSelectedSlot(1);
    setMessage(null);
    setSaveFailure(null);
  }

  function handleNew() {
    openDraft(createNewDraft());
  }

  function handleEdit(group: TeamGroupEntry) {
    openDraft(toDraftGroup(group));
  }

  async function handleDelete(id: number) {
    setSaveFailure(null);
    try {
      await deleteTeamGroup(id).unwrap();
    } catch (failure) {
      setSaveFailure(describeSaveFailure(failure));
      return;
    }
    if (draft.id === id) openDraft(createNewDraft());
    setMessage(TEAM_GROUP_DELETED_MESSAGE);
  }

  function handleReload() {
    void refetch();
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

  function handlePlace(key: number, seat: Seat | null) {
    const moved = placePlayer(toBoardPlayers(draft.members), key, seat);
    setDraft({ ...draft, members: draft.members.map((member) => ({ ...member, position: moved.find((player) => player.key === member.slot)?.position ?? null })) });
    setMessage(null);
  }

  // The user says "yes, they play where they are listed": explicit, visible on the board, and only saved on Guardar equipo.
  function handleConfirmListOrder() {
    const confirmed = confirmInListOrder(toBoardPlayers(draft.members));
    setDraft({ ...draft, members: draft.members.map((member) => ({ ...member, position: confirmed.find((player) => player.key === member.slot)?.position ?? null })) });
    setMessage(CONFIRMED_ON_SCREEN_MESSAGE);
  }

  // Editing the nickname renames the SAME person (their pool stays). This is the explicit "somebody else sits here now":
  // the saved identity is dropped, so the newcomer starts with no pool and a fresh id on Guardar equipo.
  function handleReplaceMember(slot: number) {
    setDraft({ ...draft, members: draft.members.map((member) => (member.slot === slot ? { slot, position: member.position, name: "", heroPool: [] } : member)) });
    setMessage(null);
  }

  function handleRemoveHero(slot: number, hero: number) {
    setDraft({ ...draft, members: draft.members.map((member) => (member.slot === slot ? { ...member, heroPool: member.heroPool.filter((id) => id !== hero) } : member)) });
    setMessage(null);
  }

  // Un rechazo del motor (409 `positions_required`, `member_ids_required`, `use_position_pool_editor`...) se muestra con su
  // recuperación y deja el borrador intacto: nunca "Equipo guardado." si no se guardó.
  async function handleSave() {
    setMessage(null);
    setSaveFailure(null);
    const body = toPutBody(draft);
    try {
      if (draft.id === null) {
        // Sin esto, un segundo "Guardar" sobre el mismo equipo recién creado -- sin recargar ni
        // pulsar "Editar" -- creaba un duplicado en vez de actualizar (draft.id seguía en null).
        const created = await createTeamGroup(body).unwrap();
        const saved = toDraftGroup(created);
        setDraft(saved);
        setBaseline(snapshotOf(saved));
      } else {
        await updateTeamGroup({ id: draft.id, body }).unwrap();
        setBaseline(JSON.stringify(body));
      }
    } catch (failure) {
      setSaveFailure(describeSaveFailure(failure));
      return;
    }
    setMessage(TEAM_GROUP_SAVED_MESSAGE);
  }

  const isSaving = isCreating || isUpdating;
  const savedGroup = groups.find((group) => group.id === draft.id);
  const activeSlot = draft.members.find((member) => member.slot === selectedSlot)?.slot ?? draft.members[0]?.slot ?? 1;
  const isDirty = snapshotOf(draft) !== baseline;
  const needsPlacement = draft.id !== null && draft.partySize === 5;

  return (
    <CanonicalLightScope>
      <main className="tg-main">
        <header className="tg-head">
          <h1 className="tg-title">Equipos</h1>
          <p className="tg-lede">Cada jugador tiene un pool de héroes distinto por posición. Si una posición no tiene pool, el draft sigue con recomendaciones del rol.</p>
        </header>

        <SavedTeamsPanel
          groups={groups}
          isLoading={isLoading}
          loadFailed={error !== undefined}
          editingId={draft.id}
          isDeleting={isDeleting}
          onNew={handleNew}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />

        <Glass className="tg-section">
          <div className="tg-section-head">
            <h2 className="tg-h2">{draft.id === null ? "Equipo nuevo" : "Editando equipo"}</h2>
          </div>

          <div className="tg-fields">
            <div className="tg-field">
              <label className="tg-label" htmlFor="team-name">
                Nombre del equipo
              </label>
              <input id="team-name" type="text" value={draft.name} onChange={handleNameChange} placeholder="Nombre del equipo" className="tg-input" />
            </div>
            <div className="tg-field">
              <label className="tg-label" htmlFor="team-party-size">
                Tamaño de party
              </label>
              <select id="team-party-size" value={draft.partySize} onChange={handlePartySizeChange} className="tg-select">
                {PARTY_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {needsPlacement && draft.members.some((member) => member.position === null) && (
            <div data-testid="team-legacy-positions">
              <TgNotice tone="warning" title="Equipo sin posiciones confirmadas">
                <p>{LEGACY_POSITIONS_MESSAGE}</p>
                {draft.members.every((member) => member.position === null) && (
                  <div className="tg-notice-actions">
                    <button type="button" onClick={handleConfirmListOrder} className="tg-btn" data-testid="team-confirm-list-order">
                      {CONFIRM_LIST_ORDER_LABEL}
                    </button>
                  </div>
                )}
              </TgNotice>
            </div>
          )}

          <div className="tg-block">
            <h3 className="tg-h3">Posición habitual</h3>
            <span className="tg-hint">{USUAL_POSITIONS_HINT}</span>
            <PositionBoard variant="canonical" players={toBoardPlayers(draft.members)} onPlace={handlePlace} />
          </div>

          <div className="tg-block">
            <h3 className="tg-h3">Jugadores y sus pools</h3>
            <span className="tg-hint">Elige a un jugador para ver y editar el pool de cada una de sus posiciones.</span>
            <div className="tg-split">
              <PlayerRoster
                members={draft.members}
                partySize={draft.partySize}
                activeSlot={activeSlot}
                savedMembers={savedGroup?.members ?? []}
                dirtyPools={dirtyPools}
                onSelect={setSelectedSlot}
              />
              <div>
                {draft.members.map((member) => (
                  <MemberEditor
                    key={`${draft.id ?? "new"}:${member.slot}`}
                    member={member}
                    partySize={draft.partySize}
                    heroes={heroes}
                    active={member.slot === activeSlot}
                    savedMember={savedGroup?.members.find((saved) => saved.id === member.id)}
                    teamGroupId={draft.id}
                    onNameChange={handleMemberNameChange}
                    onAddHero={handleAddHero}
                    onRemoveHero={handleRemoveHero}
                    onReplace={handleReplaceMember}
                    onPoolDirtyChange={handlePoolDirtyChange}
                  />
                ))}
              </div>
            </div>
          </div>

          {saveFailure && <TeamFailure failure={saveFailure} onReload={handleReload} />}
          {message && (
            <div data-testid="team-save-message">
              <TgNotice tone="success" title={message}>
                <p>Los pools por posición se guardan aparte, con su propio botón.</p>
              </TgNotice>
            </div>
          )}

          <div className="tg-savebar">
            <TeamStateLine isNew={draft.id === null} dirty={isDirty} />
            <ActionPrimary onPress={handleSave} status={isSaving ? "busy" : "idle"} busyLabel="Guardando…" disabled={draft.name.trim().length === 0}>
              Guardar equipo
            </ActionPrimary>
          </div>
        </Glass>
      </main>
    </CanonicalLightScope>
  );
}
