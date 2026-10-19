"use client";

import { ActionQuiet } from "@/design/canonical/primitives/ActionQuiet";
import { Glass } from "@/design/canonical/primitives/Glass";
import { EMPTY_TEAM_GROUP_MESSAGE } from "./constants";
import { TgNotice } from "./TgNotice";
import type { TeamGroupEntry } from "./types";

// The saved teams, and which one is open in the editor below. Rows say "Editando" in words, not just with a frame.

interface TeamGroupRowProps {
  group: TeamGroupEntry;
  editing: boolean;
  onEdit: (group: TeamGroupEntry) => void;
  onDelete: (id: number) => void;
  isDeleting: boolean;
}

function TeamGroupRow({ group, editing, onEdit, onDelete, isDeleting }: TeamGroupRowProps) {
  function handleEdit() {
    onEdit(group);
  }

  function handleDelete() {
    onDelete(group.id);
  }

  return (
    <li className="tg-row" aria-current={editing ? "true" : undefined}>
      <div className="tg-row-main">
        <span className="tg-row-name">{group.name}</span>
        <span className="tg-row-meta">
          Party de {group.partySize}, {group.members.length} {group.partySize === 5 ? "posiciones" : "compañero(s)"}
        </span>
      </div>
      <div className="tg-actions">
        {editing && <span className="tg-tag">Editando</span>}
        <ActionQuiet onPress={handleEdit}>
          Editar<span className="cx-sr"> {group.name}</span>
        </ActionQuiet>
        <ActionQuiet onPress={handleDelete} disabled={isDeleting}>
          Eliminar<span className="cx-sr"> {group.name}</span>
        </ActionQuiet>
      </div>
    </li>
  );
}

export interface SavedTeamsPanelProps {
  groups: TeamGroupEntry[];
  isLoading: boolean;
  loadFailed: boolean;
  editingId: number | null;
  isDeleting: boolean;
  onNew: () => void;
  onEdit: (group: TeamGroupEntry) => void;
  onDelete: (id: number) => void;
}

export function SavedTeamsPanel({ groups, isLoading, loadFailed, editingId, isDeleting, onNew, onEdit, onDelete }: SavedTeamsPanelProps) {
  return (
    <Glass className="tg-section">
      <div className="tg-section-head">
        <h2 className="tg-h2">Guardados</h2>
        <ActionQuiet onPress={onNew}>
          Nuevo equipo
        </ActionQuiet>
      </div>
      {isLoading && <span className="tg-hint">Cargando...</span>}
      {loadFailed && (
        <TgNotice tone="error" title="No se pudieron cargar los equipos.">
          <p>El motor no respondió. Lo que hay en pantalla no se perdió; recarga la página para volver a intentarlo.</p>
        </TgNotice>
      )}
      {groups.length === 0 && !isLoading && <span className="tg-hint">{EMPTY_TEAM_GROUP_MESSAGE}</span>}
      <ul className="tg-list">
        {groups.map((group) => (
          <TeamGroupRow key={group.id} group={group} editing={group.id === editingId} onEdit={onEdit} onDelete={onDelete} isDeleting={isDeleting} />
        ))}
      </ul>
    </Glass>
  );
}
