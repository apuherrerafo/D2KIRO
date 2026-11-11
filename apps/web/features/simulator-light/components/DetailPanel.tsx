import { useRef, type ReactNode } from "react";
import { Glass } from "@/design/canonical/primitives";
import { HeroIcon, HeroPortrait } from "@/design/canonical/hero-media";
import { useReducedMotion } from "@/design/round-3a/lab-context";
import { teamPositionName } from "@/features/team-coach/constants";
import type { TeamCoachCandidate, TeamCoachColumn } from "@/features/team-coach/types";
import { heroName } from "../hero-name";
import { mergeColumnCandidates, type ColumnCandidate } from "../merge-candidates";
import { settleIn, useChanged } from "../motion";
import { cardModelOf, LEVEL_LABEL, type Recommendation } from "../view-model";

// Derecha: análisis del héroe seleccionado. Solo lo que el candidato trae; un campo vacío no se dibuja ni se explica.
// D4 (NEEDS PO DESIGN DECISION): no existe una fila-de-razón canónica. Aquí cada fila es `HeroIcon` + texto con tipografía del DS, sin borde,
// chip ni color nuevo. Los niveles ("Fuerte" / "Ventaja posible") van en negrita como PALABRAS, no como etiqueta con forma propia.
// Fase 3D: el borde espectral de `Glass` (nivel 4) solo existe MIENTRAS se lee un candidato ("Level 4 edge only while active / selected / read");
// al cambiar de candidato, el contenido entra con el resorte `soft` (movimiento de panel, sin rebote).

export const DETAIL_EMPTY_TEXT = "Selecciona un héroe para ver su análisis";
export const DETAIL_NO_ACTION_NOTE = "Abrir el análisis no elige el héroe ni envía nada a Dota.";

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

function EmptyDetail() {
  return (
    <Glass className="sl-detail" level="b" surfaceLevel="3">
      <p className="sl-caption">Análisis del candidato</p>
      <p className="sl-detail-empty">{DETAIL_EMPTY_TEXT}</p>
      <p className="sl-foot">{DETAIL_NO_ACTION_NOTE}</p>
    </Glass>
  );
}

function findSelected(positions: TeamCoachColumn[], selectedKey: string): { column: TeamCoachColumn; entry: ColumnCandidate } | null {
  for (const column of positions) {
    const merged = mergeColumnCandidates(column);
    const entry = [...merged.general, ...merged.poolOnly].find((item) => `${column.position}:${item.candidate.heroId}` === selectedKey);
    if (entry !== undefined) return { column, entry };
  }
  return null;
}

export function DetailPanel({ positions, selectedKey, recommendation, showPlan }: { positions: TeamCoachColumn[]; selectedKey: string | null; recommendation: Recommendation | null; showPlan: boolean }) {
  const reduced = useReducedMotion();
  const body = useRef<HTMLDivElement>(null);
  const found = selectedKey === null ? null : findSelected(positions, selectedKey);
  const openKey = found === null ? null : selectedKey;
  // Cambia de candidato (o se abre el panel): el contenido entra una vez. No al montar la pantalla.
  useChanged(openKey, (next) => {
    if (next !== null) settleIn(body.current, reduced);
  });
  if (found === null) return <EmptyDetail />;
  const { column, entry } = found;
  const model = cardModelOf({ entry, column, recommendation, selected: false, showPlan });
  const { candidate } = entry;
  // Los mismos hechos que la tarjeta, dichos con palabras (ninguno es un componente nuevo).
  const marks = [
    model.isRecommended ? (recommendation?.forMe ? "ELIGE AHORA" : `Recomendado para tu party · Pos ${column.position}`) : null,
    model.isPlan ? "Plan de equipo" : null,
    model.poolText,
    candidate.evidenceStrength === "WEAK" ? "Evidencia limitada" : null,
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
            {candidate.reasons[0] !== undefined && <p className="sl-detail-reason">{candidate.reasons[0]}</p>}
          </div>
        </div>
        <Reasons candidate={candidate} />
        <p className="sl-foot">{DETAIL_NO_ACTION_NOTE}</p>
      </div>
    </Glass>
  );
}
