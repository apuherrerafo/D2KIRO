"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ActionQuiet } from "@/design/canonical/primitives";
import { SkinStage } from "@/design/canonical/motion/skin";
import { teamPositionName } from "@/features/team-coach/constants";
import type { RequestStatus, TeamCoachBoardData, TeamPosition } from "@/features/team-coach/types";
import { SimulatorLightScope } from "../SimulatorLightScope";
import { useSelectionTransfer, type SelectionKey } from "../use-selection-transfer";
import { COLUMNS_FR, noActionReasonOf, recommendationOf } from "../view-model";
import { Columns, NO_RECOMMENDATIONS_COPY } from "./Columns";
import { DetailPanel, findSelected, ManualOnly, type ManualCandidate } from "./DetailPanel";
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
  /** Live: la posición propia puede estar solo declarada (`mine-unconfirmed`). En el Simulador la declara la configuración: siempre `mine`. */
  mineRelation?: "mine" | "mine-unconfirmed";
  /** Pie del panel de análisis. Ausente = el del Simulador (que remite al panel de la ronda). */
  footNote?: string;
  /** Texto de una columna sin candidatos. Ausente = el del Simulador (que remite a «Buscar otro héroe»). */
  emptyCopy?: string;
  /** Línea «Tu party…». Ausente = la derivada de las columnas; `null` = no se dibuja. */
  partyText?: string | null;
  /** Solo el Simulador: estado de la ronda (qué hacer ahora). Va arriba del tablero y se dibuja aunque el motor aún no haya respondido. */
  header?: ReactNode;
  /** Solo el Simulador: la acción de elegir (o el motivo por el que no se puede). Va DENTRO del análisis, junto al héroe que se lee. */
  pickAction?: ReactNode;
  /** Solo el Simulador: héroe encontrado con el buscador (sin análisis del coach). Sustituye al análisis de una tarjeta mientras esté. */
  manualCandidate?: ManualCandidate | null;
  /** Solo el Simulador: buscador de cualquier héroe legal, bajo las columnas. Se dibuja aunque el motor no tenga candidatos. */
  beneath?: ReactNode;
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

function ManualFallback({ beneath, manualCandidate, pickAction }: Pick<SimulatorLightBoardProps, "beneath" | "manualCandidate" | "pickAction">) {
  return (
    <div className="sl-fallback">
      {beneath}
      <ManualOnly manual={manualCandidate} pickAction={pickAction} />
    </div>
  );
}

type StageProps = Pick<SimulatorLightBoardProps, "humanPosition" | "onAnalyze" | "mineRelation" | "footNote" | "emptyCopy" | "pickAction" | "manualCandidate" | "beneath"> & { board: TeamCoachBoardData };

function BoardStage({ board, humanPosition, onAnalyze, mineRelation = "mine", footNote, emptyCopy = NO_RECOMMENDATIONS_COPY, pickAction, manualCandidate = null, beneath }: StageProps) {
  const [openKey, setSelectedKey] = useState<SelectionKey | null>(null);
  const positions = board.positions;
  // Si el candidato abierto ya no está en el tablero (se eligió, se recalculó), el análisis se cierra solo; nada queda apuntando a un héroe fantasma.
  // Un héroe buscado a mano ocupa el análisis: mientras esté, ninguna tarjeta figura como abierta (un solo héroe en análisis a la vez).
  const selectedKey = manualCandidate === null && openKey !== null && findSelected(positions, openKey) !== null ? openKey : null;
  const manualHeroId = manualCandidate?.heroId ?? null;
  // Al abrirse un héroe buscado, la carta que estaba abierta se suelta (ajuste de estado en el render, el patrón de React para "reaccionar a un cambio de prop").
  const [seenManualHeroId, setSeenManualHeroId] = useState<number | null>(manualHeroId);
  if (seenManualHeroId !== manualHeroId) {
    setSeenManualHeroId(manualHeroId);
    if (manualHeroId !== null) setSelectedKey(null);
  }
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
    const next = openKey === key ? null : key;
    setSelectedKey(next);
    // Con un héroe buscado abierto la selección efectiva sigue en `null` (no cambia, el efecto de arriba no dispara): se avisa aquí que una carta tomó el análisis.
    if (manualCandidate !== null) onAnalyze?.(analyzedOf(next));
  }
  if (positions.length === 0) return <ManualFallback beneath={beneath} manualCandidate={manualCandidate} pickAction={pickAction} />;
  return (
    <SkinStage className="cm-skin-stage--flush sl-skin" ghost="">
      <div className="sl-skin-inner">
        <div className="sl-stage" data-columns={positions.length} ref={stage} style={{ "--sl-cols-fr": `${fr}fr` } as CSSProperties}>
          <div className="sl-main">
            <Columns humanPosition={humanPosition} onSelect={handleSelect} mineRelation={mineRelation} emptyCopy={emptyCopy} positions={positions} recommendation={recommendation} selectedKey={selectedKey} showPlan={showPlan} />
            {beneath}
          </div>
          <DetailPanel footNote={footNote} manualCandidate={manualCandidate} noActionReason={noActionReasonOf(board)} pickAction={pickAction} positions={positions} recommendation={recommendation} selectedKey={selectedKey} showPlan={showPlan} />
          <span aria-hidden="true" className="sl-transfer" ref={overlay}>
            <span className="cm-corners sl-corners"><i /><i /><i /><i /></span>
          </span>
        </div>
      </div>
    </SkinStage>
  );
}

function PartyLine({ text }: { text: string | null }) {
  if (text === null) return null;
  return <p className="sl-party" data-testid="sl-party">{text}</p>;
}

function BoardContent({ board, status, humanPosition, onRetry, onAnalyze, mineRelation, footNote, emptyCopy, partyText, pickAction, manualCandidate, beneath }: SimulatorLightBoardProps) {
  // Sin tablero (motor calculando o caído) el jugador igual puede elegir: el buscador y la acción de elegir no dependen de las recomendaciones.
  if (board === null) {
    return (
      <>
        <BoardPlaceholder onRetry={onRetry} status={status} />
        <ManualFallback beneath={beneath} manualCandidate={manualCandidate} pickAction={pickAction} />
      </>
    );
  }
  const line = partyText === undefined ? partyTextOf(board.positions.map((column) => column.position), humanPosition) : partyText;
  return (
    <>
      <PartyLine text={line} />
      <BoardStage beneath={beneath} board={board} emptyCopy={emptyCopy} footNote={footNote} humanPosition={humanPosition} manualCandidate={manualCandidate} onAnalyze={onAnalyze} mineRelation={mineRelation} pickAction={pickAction} />
    </>
  );
}

export function SimulatorLightBoard(props: SimulatorLightBoardProps) {
  const { board, status, header } = props;
  return (
    <SimulatorLightScope>
      <div data-state-identity={board?.stateIdentity ?? ""} data-status={status} data-testid="team-coach-board">
        {header}
        <h2 className="sl-title">Team Coach</h2>
        <BoardContent {...props} />
      </div>
    </SimulatorLightScope>
  );
}
