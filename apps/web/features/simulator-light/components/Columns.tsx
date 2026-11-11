import { useRef } from "react";
import { Glass, StateTarget } from "@/design/canonical/primitives";
import { HeroDraftSlot, HeroIcon } from "@/design/canonical/hero-media";
import { isPlannedCandidate } from "@/features/team-coach/eligibility";
import { D2Icon } from "@/design/round-3b/icons";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { useSettleFlip } from "@/design/canonical/motion/flip";
import { teamPositionName } from "@/features/team-coach/constants";
import type { TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { heroName } from "../hero-name";
import { mergeColumnCandidates, type ColumnCandidate } from "../merge-candidates";
import { acquireCorners, useChanged } from "../motion";
import { keyOf, type SelectionKey } from "../use-selection-transfer";
import { cardModelOf, RELATION_LABEL, relationOf, type CardModel, type Recommendation } from "../view-model";

// Fase 3D.2 · TODA la tarjeta es el control. LA REJILLA EXPLORA; EL PANEL EXPLICA. El clic solo abre el análisis: no elige ni envía nada a Dota.
// Composición con las dos extensiones mínimas aprobadas del DS (aditivas, default = comportamiento anterior):
//   · `StateTarget onPress` es el ÚNICO control (un `<button>`): `state` = estado del MOTOR (recommended / uncertain / rest) y
//     `pressed` = candidato abierto en el análisis (aria-pressed + segmento espectral) SIN perder `recommended`.
//   · `HeroDraftSlot showPlate={false}` (no interactivo): retrato + riel + stroke, sin repetir el nombre (el nombre lo dice el StateTarget).
// Sin botones anidados, sin hacks de DOM.

function CardTags({ entry, model }: { entry: ColumnCandidate; model: CardModel }) {
  const { candidate } = entry;
  return (
    <span className="sl-cand-lines">
      {model.selected && <span className="sl-tag" data-reading="true">En análisis</span>}
      {model.isPlan && <span className="sl-tag">Plan de equipo</span>}
      {model.poolText !== null && <span className="sl-tag" data-pool={candidate.poolMembership}>{model.poolText}</span>}
    </span>
  );
}

interface CandidateCardProps {
  entry: ColumnCandidate;
  column: TeamCoachColumn;
  recommendation: Recommendation | null;
  selectedKey: SelectionKey | null;
  showPlan: boolean;
  compact: boolean;
  onSelect(key: SelectionKey): void;
}

function CandidateCard({ entry, column, recommendation, selectedKey, showPlan, compact, onSelect }: CandidateCardProps) {
  const reduced = useReducedMotion();
  const host = useRef<HTMLLIElement>(null);
  const key = keyOf(column.position, entry.candidate.heroId);
  const model = cardModelOf({ entry, column, recommendation, selected: selectedKey === key, showPlan });
  // Una recomendación NUEVA llega una vez: las esquinas cierran sobre la tarjeta (no al montar la pantalla).
  useChanged(model.isRecommended, (next) => {
    if (next) acquireCorners(host.current, reduced);
  });
  function handlePress() {
    onSelect(key);
  }
  return (
    <li className="sl-cand" data-card-key={key} data-hero-id={entry.candidate.heroId} data-primary={isPlannedCandidate(entry.candidate)} data-testid={entry.generalRank === null ? "team-coach-pool-candidate" : "team-coach-candidate"} data-compact={compact ? "true" : "false"} data-flip-key={entry.candidate.heroId} data-recommended={model.isRecommended ? "true" : "false"} data-selected={model.selected ? "true" : "false"} ref={host}>
      <StateTarget notch={model.notch} note={model.note} onPress={handlePress} pressed={model.selected} state={model.state} title={`${model.rankText} · ${model.title}`} value={heroName(entry.candidate.heroId)}>
        <span className="sl-cand-body" data-compact={compact ? "true" : "false"}>
          <span className="sl-art-slot">
            <HeroDraftSlot alt="" hero={entry.candidate.heroId} showPlate={false} showRole={false} showStateBadge={false} size="fill" state="available" />
          </span>
          <CardTags entry={entry} model={model} />
        </span>
      </StateTarget>
      <span aria-hidden="true" className="cm-corners sl-corners"><i /><i /><i /><i /></span>
    </li>
  );
}

function CandidateList(props: Omit<CandidateCardProps, "entry"> & { entries: ColumnCandidate[]; label?: string }) {
  const { entries, label, ...rest } = props;
  if (entries.length === 0) return null;
  return (
    <>
      {label !== undefined && <h4 className="sl-subhead">{label}</h4>}
      <ul className="sl-cands">
        {entries.map((entry) => (
          <CandidateCard key={entry.candidate.heroId} {...rest} entry={entry} />
        ))}
      </ul>
    </>
  );
}

export const NO_RECOMMENDATIONS_COPY = "Sin recomendaciones disponibles con la información actual. Puedes elegir cualquier héroe legal con «Buscar otro héroe», aquí debajo.";

function ColumnBody({ column, emptyCopy, ...rest }: { column: TeamCoachColumn; emptyCopy: string } & Omit<CandidateCardProps, "entry" | "column">) {
  if (column.state === "FILLED") {
    return <FilledBody column={column} />;
  }
  if (column.state === "WAITING" || column.state === "UNAVAILABLE") {
    return <NoteBody column={column} />;
  }
  const merged = mergeColumnCandidates(column);
  // RANKED sin candidatos = ningún héroe con fundamento. Nunca se fabrica uno: solo se dice, en llano, que no hay recomendaciones con lo que se sabe ahora.
  if (merged.general.length === 0 && merged.poolOnly.length === 0) {
    return <p className="sl-note" data-empty="true" data-testid="sl-column-empty">{emptyCopy}</p>;
  }
  const hasPoolOnly = merged.poolOnly.length > 0;
  return (
    <>
      <CandidateList {...rest} column={column} entries={merged.general} label={hasPoolOnly ? "Ranking general" : undefined} />
      <CandidateList {...rest} column={column} entries={merged.poolOnly} label="Más de tu pool" />
    </>
  );
}

function FilledBody({ column }: { column: TeamCoachColumn }) {
  if (column.filledHeroId === null) {
    return <p className="sl-note">{column.note}</p>;
  }
  return (
    <div className="sl-filled">
      <HeroIcon alt={heroName(column.filledHeroId)} hero={column.filledHeroId} size="lg" />
      <span className="sl-filled-text">
        <strong>{heroName(column.filledHeroId)}</strong>
        <span className="sl-muted">Posición cubierta</span>
      </span>
    </div>
  );
}

function NoteBody({ column }: { column: TeamCoachColumn }) {
  const failed = column.state === "UNAVAILABLE";
  return (
    <p className="sl-note" data-failed={failed ? "true" : "false"} role={failed ? "alert" : undefined}>
      {failed && <D2Icon name="attention" size={16} />}
      <span>{column.note}</span>
    </p>
  );
}

interface PositionColumnProps {
  column: TeamCoachColumn;
  humanPosition: TeamPosition | null;
  showPlan: boolean;
  recommendation: Recommendation | null;
  selectedKey: SelectionKey | null;
  compact: boolean;
  mineRelation: "mine" | "mine-unconfirmed";
  emptyCopy: string;
  onSelect(key: SelectionKey): void;
}

/** Movimiento 07 «el dato se reordena»: cuando el motor cambia el orden de una columna, las tarjetas se deslizan a su lugar (FLIP, resorte `settle`, sin rebote). */
function PositionColumn({ column, humanPosition, showPlan, recommendation, selectedKey, compact, mineRelation, emptyCopy, onSelect }: PositionColumnProps) {
  const reduced = useReducedMotion();
  const body = useRef<HTMLDivElement>(null);
  const relation = relationOf(column.position, humanPosition, mineRelation);
  const order = column.top.map((candidate) => candidate.heroId).join(",");
  useSettleFlip(body, order, reduced);
  return (
    <Glass className="sl-col" level="b" surfaceLevel="3">
      <section aria-label={teamPositionName(column.position)} data-eligible={column.eligibleNow} data-relation={relation} data-state={column.state} data-testid={`team-coach-column-${column.position}`}>
        <header className="sl-col-head">
          <p className="sl-relation" data-relation={relation}>{RELATION_LABEL[relation]}</p>
          <h3 className="sl-col-title">{teamPositionName(column.position)}</h3>
        </header>
        <div ref={body}>
          <ColumnBody column={column} compact={compact} emptyCopy={emptyCopy} onSelect={onSelect} recommendation={recommendation} selectedKey={selectedKey} showPlan={showPlan} />
        </div>
      </section>
    </Glass>
  );
}

export interface ColumnsProps {
  humanPosition: TeamPosition | null;
  positions: TeamCoachColumn[];
  recommendation: Recommendation | null;
  selectedKey: SelectionKey | null;
  showPlan: boolean;
  mineRelation: "mine" | "mine-unconfirmed";
  /** Texto de una columna RANKED sin candidatos. Cada superficie dice sus propias salidas (el Simulador remite a «Buscar otro héroe»). */
  emptyCopy: string;
  onSelect(key: SelectionKey): void;
}

export function Columns({ humanPosition, positions, recommendation, selectedKey, showPlan, mineRelation, emptyCopy, onSelect }: ColumnsProps) {
  const compact = positions.length >= 5;
  return (
    <div className="sl-columns" data-count={positions.length}>
      {positions.map((column) => (
        <PositionColumn column={column} compact={compact} humanPosition={humanPosition} key={column.position} onSelect={onSelect} mineRelation={mineRelation} emptyCopy={emptyCopy} recommendation={recommendation} selectedKey={selectedKey} showPlan={showPlan} />
      ))}
    </div>
  );
}
