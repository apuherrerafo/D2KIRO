"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { ActionQuiet } from "@/design/canonical/primitives";
import { SkinStage } from "@/design/canonical/motion/skin";
import { teamPositionName } from "@/features/team-coach/constants";
import type { RequestStatus, TeamCoachBoardData, TeamPosition } from "@/features/team-coach/types";
import { SimulatorLightScope } from "../SimulatorLightScope";
import { useSelectionTransfer, type SelectionKey } from "../use-selection-transfer";
import { COLUMNS_FR, noActionReasonOf, recommendationOf } from "../view-model";
import { Columns } from "./Columns";
import { DetailPanel, findSelected } from "./DetailPanel";
import type { AnalyzedCandidate, PickPosition } from "@/features/random-draft-simulator/analyzed-pick";

// <Dominio><Cosa>: el tablero del Simulador en Canonical Light. Lee el MISMO `TeamCoachBoardData` que el tablero anterior (contrato V6, verbatim):
// no calcula puntajes, no inventa recomendaciones ni estados. CENTRO = una columna por posición que el humano controla (Solo 1 · Party 2/3/5);
// DERECHA = el análisis del candidato abierto. El clic en una tarjeta solo ABRE el análisis: elegir al héroe sigue siendo una acción legal propia del Simulador.

export interface SimulatorLightBoardProps {
  board: TeamCoachBoardData | null;
  status: RequestStatus;
  /** Posición propia declarada en la configuración (null = no se resalta ninguna). */
  humanPosition: TeamPosition | null;
  onRetry?: () => void;
  /** Avisa qué candidato está abierto en el análisis (o `null`). Solo informa: abrir el análisis nunca elige. */
  onAnalyze?: (candidate: AnalyzedCandidate | null) => void;
}

function analyzedOf(key: SelectionKey | null): AnalyzedCandidate | null {
  if (key === null) return null;
  const [position, heroId] = key.split(":").map(Number);
  if (!Number.isInteger(position) || !Number.isInteger(heroId) || position < 1 || position > 5) return null;
  return { position: position as PickPosition, heroId };
}

export function partyTextOf(positions: readonly TeamPosition[], humanPosition: TeamPosition | null): string | null {
  if (positions.length === 0) return null;
  const mine = humanPosition === null ? "" : ` · Tú: ${teamPositionName(humanPosition)}`;
  return `Tu party: ${positions.map((position) => `Pos ${position}`).join(", ")}${mine}`;
}

function RetryAction({ onRetry }: { onRetry?: () => void }) {
  if (onRetry === undefined) return null;
  return <ActionQuiet onPress={onRetry}>Reintentar</ActionQuiet>;
}

function BoardPlaceholder({ status, onRetry }: { status: RequestStatus; onRetry?: () => void }) {
  if (status === "failed") {
    return (
      <div className="sl-retry" data-testid="team-coach-failed" role="alert">
        <p className="sl-placeholder">No se pudo calcular el Team Coach Board.</p>
        <RetryAction onRetry={onRetry} />
      </div>
    );
  }
  return <p className="sl-placeholder" data-testid="team-coach-loading">Calculando recomendaciones para cada posición…</p>;
}

function BoardStage({ board, humanPosition, onAnalyze }: { board: TeamCoachBoardData; humanPosition: TeamPosition | null; onAnalyze?: (candidate: AnalyzedCandidate | null) => void }) {
  const [openKey, setSelectedKey] = useState<SelectionKey | null>(null);
  const positions = board.positions;
  // Si el candidato abierto ya no está en el tablero (se eligió, se recalculó), el análisis se cierra solo; nada queda apuntando a un héroe fantasma.
  const selectedKey = openKey !== null && findSelected(positions, openKey) !== null ? openKey : null;
  const { stage, overlay } = useSelectionTransfer(selectedKey);
  useEffect(() => {
    onAnalyze?.(analyzedOf(selectedKey));
    return () => onAnalyze?.(null);
  }, [selectedKey, onAnalyze]);
  const visible = positions.map((column) => column.position);
  const recommendation = recommendationOf(board, visible, humanPosition);
  const showPlan = positions.length > 1;
  const fr = COLUMNS_FR[positions.length] ?? COLUMNS_FR[5];
  function handleSelect(key: SelectionKey) {
    setSelectedKey((current) => (current === key ? null : key));
  }
  if (positions.length === 0) return null;
  return (
    <SkinStage className="cm-skin-stage--flush sl-skin" ghost="">
      <div className="sl-skin-inner">
        <div className="sl-stage" data-columns={positions.length} ref={stage} style={{ "--sl-cols-fr": `${fr}fr` } as CSSProperties}>
          <Columns humanPosition={humanPosition} onSelect={handleSelect} positions={positions} recommendation={recommendation} selectedKey={selectedKey} showPlan={showPlan} />
          <DetailPanel noActionReason={noActionReasonOf(board)} positions={positions} recommendation={recommendation} selectedKey={selectedKey} showPlan={showPlan} />
          <span aria-hidden="true" className="sl-transfer" ref={overlay}>
            <span className="cm-corners sl-corners"><i /><i /><i /><i /></span>
          </span>
        </div>
      </div>
    </SkinStage>
  );
}

function BoardContent({ board, status, humanPosition, onRetry, onAnalyze }: SimulatorLightBoardProps) {
  if (board === null) return <BoardPlaceholder onRetry={onRetry} status={status} />;
  return (
    <>
      <p className="sl-party" data-testid="sl-party">{partyTextOf(board.positions.map((column) => column.position), humanPosition)}</p>
      <BoardStage board={board} humanPosition={humanPosition} onAnalyze={onAnalyze} />
    </>
  );
}

export function SimulatorLightBoard(props: SimulatorLightBoardProps) {
  const { board, status } = props;
  return (
    <SimulatorLightScope>
      <div data-state-identity={board?.stateIdentity ?? ""} data-status={status} data-testid="team-coach-board">
        <h2 className="sl-title">Team Coach</h2>
        <BoardContent {...props} />
      </div>
    </SimulatorLightScope>
  );
}
