"use client";

import type { ChangeEvent } from "react";
import { teamPositionName } from "../constants";
import { PANEL } from "../styles";
import type { LivePartyPreset, LiveTeamContext, TeamPosition } from "../types";
import { useLiveTeamGroup, type PresetListState } from "../use-live-team-group";

// /live-draft -- "Preset de Party 5": el equipo guardado (Equipos) cuyos pools de cada posición usa el
// Team Coach en el draft en vivo. Los pools son una señal suave, nunca una lista cerrada: un héroe fuera
// del pool sigue siendo elegible. Lo que se muestra como "activo" es lo que el MOTOR informa, no lo elegido.

const POSITIONS: readonly TeamPosition[] = [1, 2, 3, 4, 5];

function isPositionActive(teamContext: LiveTeamContext | undefined, position: TeamPosition): boolean {
  return teamContext?.positions[String(position) as keyof LiveTeamContext["positions"]] === true;
}

function countActivePositions(teamContext: LiveTeamContext | undefined): number {
  return POSITIONS.filter((position) => isPositionActive(teamContext, position)).length;
}

interface PartyStatusLineProps {
  teamContext: LiveTeamContext | undefined;
  presets: readonly LivePartyPreset[];
  chosenId: number | null;
}

function UnconfirmedChoice({ preset }: { preset: LivePartyPreset | undefined }) {
  if (preset === undefined) return null;
  return <span className="text-caption text-content-muted" data-testid="live-party-unconfirmed">Elegiste «{preset.name}», pero el motor todavía no lo confirmó: no se está usando.</span>;
}

// The headline is SERVER truth only: the preset id and the pools come from the engine's live status. The
// dropdown / localStorage choice never makes this line say "active" -- at most it adds an "aún no confirmado" hint.
function PartyStatusLine({ teamContext, presets, chosenId }: PartyStatusLineProps) {
  if (teamContext === undefined) {
    return <span className="text-caption text-content-muted" role="status" data-testid="live-party-status" data-state="unknown">Party 5: verificando con el motor…</span>;
  }
  const active = countActivePositions(teamContext);
  if (teamContext.teamGroupId === null || active === 0) {
    const waiting = chosenId !== null ? presets.find((preset) => preset.id === chosenId) : undefined;
    return (
      <>
        <span className="text-body font-semibold text-signal-warning" role="status" data-testid="live-party-status" data-state="none">Party 5: SIN PRESET</span>
        <UnconfirmedChoice preset={waiting} />
      </>
    );
  }
  const name = presets.find((preset) => preset.id === teamContext.teamGroupId)?.name ?? "preset activo";
  return <span className="text-body font-semibold text-signal-positive" role="status" data-testid="live-party-status" data-state="active">Party 5: {name} · pools {active}/5</span>;
}

function PoolItem({ teamContext, position }: { teamContext: LiveTeamContext | undefined; position: TeamPosition }) {
  const active = isPositionActive(teamContext, position);
  const className = active ? "text-caption text-signal-positive" : "text-caption text-content-muted";
  const mark = active ? "✓" : "—";
  return (
    <li className={className} data-testid={`live-preset-pos-${position}`} data-active={active} title={teamPositionName(position)}>
      Pos {position} {mark}
    </li>
  );
}

function PositionPools({ teamContext }: { teamContext: LiveTeamContext | undefined }) {
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Pools activos" data-testid="live-preset-pools">
      {POSITIONS.map((position) => (
        <PoolItem key={position} teamContext={teamContext} position={position} />
      ))}
    </ul>
  );
}

interface PresetStatusProps {
  listState: PresetListState;
  teamContext: LiveTeamContext | undefined;
}

function PresetStatus({ listState, teamContext }: PresetStatusProps) {
  if (listState === "failed") return <span className="text-caption text-signal-warning" role="alert" data-testid="live-preset-list-failed">No se pudieron cargar tus equipos guardados.</span>;
  if (listState === "loading") return <span className="text-caption text-content-muted" role="status">Cargando tus equipos…</span>;
  if (!POSITIONS.some((position) => isPositionActive(teamContext, position))) {
    return <span className="text-caption text-content-muted" data-testid="live-preset-inactive">Sin pools de equipo activos: las recomendaciones no consideran qué héroes juega cada uno.</span>;
  }
  return (
    <>
      <span className="text-caption text-signal-positive" data-testid="live-preset-active">Pools de equipo activos</span>
      <PositionPools teamContext={teamContext} />
      <span className="text-caption text-content-muted">Los pools orientan las sugerencias de cada posición; un héroe fuera del pool puede recomendarse igual si la evidencia es fuerte.</span>
    </>
  );
}

function PresetNotice({ notice }: { notice: string | null }) {
  if (notice === null) return null;
  return <span className="text-caption text-signal-warning" role="alert" data-testid="live-preset-notice">{notice}</span>;
}

export interface LivePartyPresetPanelProps {
  sessionId: string;
  teamContext: LiveTeamContext | undefined;
  fetchImpl?: typeof fetch;
}

export function LivePartyPresetPanel({ sessionId, teamContext, fetchImpl }: LivePartyPresetPanelProps) {
  const { listState, presets, chosenId, applying, notice, select } = useLiveTeamGroup({ sessionId, teamContext, fetchImpl });

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const value = event.target.value;
    select(value === "" ? null : Number(value));
  }

  return (
    <div className={PANEL} role="group" aria-label="Preset de Party 5" data-testid="live-party-preset">
      <label htmlFor="live-preset-select" className="text-caption font-semibold text-content-muted">Preset de Party 5</label>
      <select
        id="live-preset-select"
        value={chosenId === null ? "" : String(chosenId)}
        onChange={handleChange}
        disabled={listState !== "ready" || applying}
        className="rounded-md border border-surface-border bg-surface-overlay px-3 py-2 text-body text-content-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-primary disabled:opacity-50"
        data-testid="live-preset-select"
      >
        <option value="">Sin preset (el Team Coach no usa pools de tu equipo)</option>
        {presets.map((preset) => (
          <option key={preset.id} value={preset.id}>{preset.name}</option>
        ))}
      </select>
      <PartyStatusLine teamContext={teamContext} presets={presets} chosenId={chosenId} />
      <PresetStatus listState={listState} teamContext={teamContext} />
      <PresetNotice notice={notice} />
    </div>
  );
}
