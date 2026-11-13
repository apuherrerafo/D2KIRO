import { useRef, type ReactNode } from "react";
import { RecommendationFeedback } from "@/components/recommendation-feedback/RecommendationFeedback";
import { useRecommendationFeedbackTarget } from "../feedback-context";
import { Glass } from "@/design/canonical/primitives";
import { HeroIcon, HeroPortrait } from "@/design/canonical/hero-media";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { teamPositionName } from "@/features/team-coach/constants";
import { hasLimitedEvidence } from "@/features/team-coach/eligibility";
import type { TeamCoachCandidate, TeamCoachColumn, TeamPosition } from "@/features/team-coach/types";
import { heroName } from "../hero-name";
import { mergeColumnCandidates, type ColumnCandidate } from "../merge-candidates";
import { settleIn, useChanged } from "../motion";
import { cardModelOf, decisionViewOf, LEVEL_LABEL, type DecisionView, type Recommendation } from "../view-model";

// Derecha: análisis del héroe seleccionado. Solo lo que el candidato trae; un campo vacío no se dibuja ni se explica.
// D4 (NEEDS PO DESIGN DECISION): no existe una fila-de-razón canónica. Aquí cada fila es `HeroIcon` + texto con tipografía del DS, sin borde,
// chip ni color nuevo. Los niveles ("Fuerte" / "Ventaja posible") van en negrita como PALABRAS, no como etiqueta con forma propia.
// Fase 3D: el borde espectral de `Glass` (nivel 4) solo existe MIENTRAS se lee un candidato ("Level 4 edge only while active / selected / read");
// al cambiar de candidato, el contenido entra con el resorte `soft` (movimiento de panel, sin rebote).

export const DETAIL_EMPTY_TEXT = "Selecciona un héroe para ver su análisis";
export const DETAIL_EMPTY_HINT = "Aquí verás por qué se recomienda y el botón para elegirlo.";
export const DETAIL_NO_ACTION_NOTE = "Abrir el análisis no elige el héroe ni envía nada a Dota. Para elegir, usa el panel de la ronda.";

function Row({ heroId, lead, why }: { heroId: number; lead: string; why: string | undefined }) {
  return (
    <li className="sl-reason">
      <HeroIcon alt={heroName(heroId)} hero={heroId} size="sm" />
      <span className="sl-reason-text">
        <strong>{lead}</strong>
        {why !== undefined && <span> — {why}</span>}
      </span>
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="sl-reasons">
      <h4 className="sl-subhead">{title}</h4>
      <ul className="sl-reason-list">{children}</ul>
    </section>
  );
}

function Reasons({ candidate }: { candidate: TeamCoachCandidate }) {
  const wins = candidate.strengths ?? [];
  const risks = candidate.risks ?? [];
  const opened = candidate.opening?.openedBy ?? [];
  const free = candidate.opening?.stillFree ?? [];
  const synergies = candidate.synergies ?? [];
  const steals = candidate.steals ?? [];
  return (
    <>
      {wins.length > 0 && (
        <Section title="Le gana a · solo rivales revelados">
          {wins.map((item) => <Row heroId={item.vsHeroId} key={`w${item.vsHeroId}`} lead={`${LEVEL_LABEL[item.level]} vs ${heroName(item.vsHeroId)}`} why={item.why} />)}
        </Section>
      )}
      {risks.length > 0 && (
        <Section title="Riesgo · rivales revelados que lo counterean">
          {risks.map((item) => <Row heroId={item.vsHeroId} key={`r${item.vsHeroId}`} lead={`${heroName(item.vsHeroId)} lo counterea`} why={item.why} />)}
        </Section>
      )}
      {opened.length > 0 && (
        <Section title="Lo que abrieron los bans">
          {opened.map((item) => <Row heroId={item.heroId} key={`o${item.heroId}`} lead={`Se abre: ${heroName(item.heroId)} (${item.level === "hard" ? "fuerte" : "posible"})`} why={item.why} />)}
        </Section>
      )}
      {free.length > 0 && (
        <Section title="Sigue libre">
          {free.map((item) => <Row heroId={item.heroId} key={`f${item.heroId}`} lead={`${heroName(item.heroId)} (${item.level === "hard" ? "fuerte" : "posible"})`} why={item.takenPosition === undefined ? item.why : `menos probable: su ${teamPositionName(item.takenPosition)} ya la ocupa un rival revelado`} />)}
        </Section>
      )}
      {synergies.length > 0 && (
        <Section title="Sinergia con tus picks">
          {synergies.map((item) => <Row heroId={item.withHeroId} key={`s${item.withHeroId}`} lead={`Con ${heroName(item.withHeroId)}`} why={item.why} />)}
        </Section>
      )}
      {steals.length > 0 && (
        <Section title="Robo">
          {steals.map((item) => <Row heroId={item.protectsHeroId} key={`t${item.protectsHeroId}`} lead={`Le quita un counter a tu ${heroName(item.protectsHeroId)} (${item.level === "hard" ? "fuerte" : "posible"})`} why={item.why} />)}
        </Section>
      )}
    </>
  );
}

const BASIS_TEXT: Record<"STRATEGIC" | "DETERMINISTIC_DEFAULT" | "PHASE_FALLBACK", string> = {
  STRATEGIC: "Criterio del motor: estratégico",
  DETERMINISTIC_DEFAULT: "Criterio del motor: orden por defecto",
  PHASE_FALLBACK: "Criterio del motor: orden de la fase",
};

function hasHeroReasons(candidate: TeamCoachCandidate): boolean {
  const lists = [candidate.strengths, candidate.risks, candidate.opening?.openedBy, candidate.opening?.stillFree, candidate.synergies, candidate.steals];
  return candidate.reasons[0] !== undefined || lists.some((list) => list !== undefined && list.length > 0);
}

// Decisión DEL EQUIPO (la de `currentDecision`), aparte de las razones del héroe. Texto y razón verbatim del motor; si apunta a otro héroe, lo dice por su nombre.
function DecisionSection({ view, openHeroId }: { view: DecisionView; openHeroId: number }) {
  if (view.kind === "none") {
    return (
      <section aria-labelledby="sl-decision-title" className="sl-decision" data-testid="sl-decision" data-decision="none">
        <h4 className="sl-subhead" id="sl-decision-title">Decisión del equipo</h4>
        <p className="sl-decision-line">{view.reason}</p>
      </section>
    );
  }
  const place = teamPositionName(view.position);
  const lead = view.sameAsOpen ? `${view.forMe ? "ELIGE AHORA" : "Recomendado para tu party"}: ${heroName(view.heroId)} · ${place}` : `El motor recomienda a ${heroName(view.heroId)} · ${place}`;
  return (
    <section aria-labelledby="sl-decision-title" className="sl-decision" data-decision={view.sameAsOpen ? "same" : "other"} data-testid="sl-decision">
      <h4 className="sl-subhead" id="sl-decision-title">Decisión del equipo</h4>
      <p className="sl-decision-line"><strong>{lead}</strong></p>
      {!view.sameAsOpen && <p className="sl-muted">Esta decisión es sobre {heroName(view.heroId)}, no sobre {heroName(openHeroId)}.</p>}
      {view.reason !== null && <p className="sl-decision-reason" data-testid="sl-decision-reason">{view.reason}</p>}
      {view.basis !== null && <p className="sl-muted">{BASIS_TEXT[view.basis]}</p>}
    </section>
  );
}

function EmptyDetail({ footNote }: { footNote: string }) {
  return (
    <Glass className="sl-detail" level="b" surfaceLevel="3">
      <p className="sl-caption">Análisis del candidato</p>
      <p className="sl-detail-empty">{DETAIL_EMPTY_TEXT}</p>
      <p className="sl-muted">{DETAIL_EMPTY_HINT}</p>
      <p className="sl-foot">{footNote}</p>
    </Glass>
  );
}

/** Héroe que el jugador encontró con el buscador. No viene del motor: no trae razones, y no se inventan. */
export interface ManualCandidate {
  heroId: number;
  position: number;
}

function ManualBody({ manual, pickAction }: { manual: ManualCandidate; pickAction: ReactNode }) {
  return (
    <div className="sl-detail-body" data-detail-key={`manual:${manual.heroId}`} data-testid="sl-manual-detail">
      <p className="sl-caption">Héroe elegido por búsqueda</p>
      <div className="sl-detail-head">
        <div className="sl-detail-portrait">
          <HeroPortrait hero={manual.heroId} size="fill" />
        </div>
        <div className="sl-detail-meta">
          <h3 className="sl-detail-name">{heroName(manual.heroId)}</h3>
          <p className="sl-muted">{teamPositionName(manual.position as TeamPosition)}</p>
          {pickAction}
        </div>
      </div>
      <p className="sl-muted">El coach no analizó a este héroe: lo elegiste tú. Puedes confirmarlo igual si es legal.</p>
    </div>
  );
}

/** Sin columnas que mostrar (motor calculando o sin candidatos) el héroe buscado igual necesita su lugar para elegirse. */
export function ManualOnly({ manual, pickAction }: { manual: ManualCandidate | null | undefined; pickAction: ReactNode }) {
  if (manual === null || manual === undefined) return null;
  return (
    <Glass className="sl-detail sl-detail--solo" edge level="b" surfaceLevel="4">
      <ManualBody manual={manual} pickAction={pickAction} />
    </Glass>
  );
}

export function findSelected(positions: TeamCoachColumn[], selectedKey: string): { column: TeamCoachColumn; entry: ColumnCandidate } | null {
  for (const column of positions) {
    const merged = mergeColumnCandidates(column);
    const entry = [...merged.general, ...merged.poolOnly].find((item) => `${column.position}:${item.candidate.heroId}` === selectedKey);
    if (entry !== undefined) return { column, entry };
  }
  return null;
}

export interface DetailPanelProps {
  positions: TeamCoachColumn[];
  selectedKey: string | null;
  recommendation: Recommendation | null;
  /** Razón del motor cuando NO hay pick humano ahora (posición null). */
  noActionReason: string | null;
  showPlan: boolean;
  /** Pie del panel; ausente = el del Simulador. */
  footNote?: string;
  /** Solo el Simulador: la acción de elegir al héroe que se lee (o el motivo de no poder). Ausente = el panel solo informa (Live). */
  pickAction?: ReactNode;
  /** Solo el Simulador: héroe buscado a mano; ocupa el panel en lugar de una tarjeta. */
  manualCandidate?: ManualCandidate | null;
}

/**
 * 👍/👎 sobre el candidato que el motor propuso y el jugador tiene abierto. Sin proveedor (Live) no se pinta nada.
 * La `key` es por héroe + identidad de estado: sin ella, abrir otro héroe heredaba el estado "ya enviado" del anterior (bug visto en el E2E).
 */
function CandidateFeedback({ heroId, position }: { heroId: number; position: number }) {
  const target = useRecommendationFeedbackTarget();
  if (target === null) return null;
  return (
    <div className="sl-feedback" data-testid="sl-feedback">
      <RecommendationFeedback key={`${heroId}:${target.stateIdentity}`} sessionId={target.sessionId} heroId={heroId} targetPosition={position} stateIdentity={target.stateIdentity} rulesetVersion={target.rulesetVersion} />
    </div>
  );
}

export function DetailPanel({ positions, selectedKey, recommendation, noActionReason, showPlan, footNote = DETAIL_NO_ACTION_NOTE, pickAction, manualCandidate = null }: DetailPanelProps) {
  const reduced = useReducedMotion();
  const body = useRef<HTMLDivElement>(null);
  const found = selectedKey === null ? null : findSelected(positions, selectedKey);
  const openKey = found === null ? null : selectedKey;
  // Cambia de candidato (o se abre el panel): el contenido entra una vez. No al montar la pantalla.
  useChanged(openKey, (next) => {
    if (next !== null) settleIn(body.current, reduced);
  });
  if (manualCandidate !== null) {
    return (
      <Glass className="sl-detail" edge level="b" surfaceLevel="4">
        <ManualBody manual={manualCandidate} pickAction={pickAction} />
      </Glass>
    );
  }
  if (found === null) return <EmptyDetail footNote={footNote} />;
  const { column, entry } = found;
  const model = cardModelOf({ entry, column, recommendation, selected: false, showPlan });
  const { candidate } = entry;
  const decision = decisionViewOf(recommendation, noActionReason, { position: column.position, heroId: candidate.heroId });
  // Los mismos hechos que la tarjeta, dichos con palabras (ninguno es un componente nuevo).
  const marks = [
    model.isRecommended ? (recommendation?.forMe ? "ELIGE AHORA" : `Recomendado para tu party · Pos ${column.position}`) : null,
    model.isPlan ? "Plan de equipo" : null,
    model.poolText,
    hasLimitedEvidence(candidate) ? "Evidencia limitada" : null,
  ].filter((mark): mark is string => mark !== null);
  return (
    <Glass className="sl-detail" edge level="b" surfaceLevel="4">
      <div className="sl-detail-body" data-detail-key={openKey} ref={body}>
        <p className="sl-caption">Análisis del candidato</p>
        <div className="sl-detail-head">
          <div className="sl-detail-portrait">
            <HeroPortrait hero={candidate.heroId} size="fill" />
          </div>
          <div className="sl-detail-meta">
            <h3 className="sl-detail-name">{heroName(candidate.heroId)}</h3>
            <p className="sl-muted">{model.rankText} · {model.title}</p>
            <ul className="sl-marks">
              {marks.map((mark) => <li key={mark}>{mark}</li>)}
            </ul>
            {pickAction}
          </div>
        </div>
        {hasHeroReasons(candidate) && (
          <section aria-labelledby="sl-hero-reasons-title" className="sl-hero-reasons" data-testid="sl-hero-reasons">
            <h4 className="sl-subhead" id="sl-hero-reasons-title">Razones de {heroName(candidate.heroId)}</h4>
            {candidate.reasons[0] !== undefined && <p className="sl-detail-reason">{candidate.reasons[0]}</p>}
            <Reasons candidate={candidate} />
          </section>
        )}
        {decision !== null && <DecisionSection openHeroId={candidate.heroId} view={decision} />}
        <CandidateFeedback heroId={candidate.heroId} position={column.position} />
        <p className="sl-foot">{footNote}</p>
      </div>
    </Glass>
  );
}
