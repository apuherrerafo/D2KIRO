"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { OffPoolTag } from "@/components/off-pool-tag/OffPoolTag";
import { RecommendationFeedback } from "@/components/recommendation-feedback/RecommendationFeedback";
import { CONFIDENCE_LABELS } from "@/features/draft/constants";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { EvidenceLimitedMark } from "@/features/team-coach/components/EvidenceLimitedMark";
import { CandidateOpening, CandidateSteals, CandidateStrengths, CandidateSynergies } from "@/features/team-coach/components/TeamCoachBoard";
import type { ActionableDecision, CandidateDegradation, CandidateResult, CoachPosition, CurrentDecisionOutput, NoHumanActionReason, PoolMembership, PoolOwner, RankedCandidateCard } from "../coach-client";
import { playerFacingDegradation } from "../degradation-copy";
import { SIMULATOR_POSITION_LABELS } from "../roster";
import { CardRiskNotice } from "./CardRiskNotice";
import { BADGE_LABELS, CoachRoleBeliefs, RoleCollisionBanner, SafeCoreOpportunity } from "./CoachPanel";

// Product Semantics Recovery WP3 -- the ONE visual owner of the Simulator's current human decision.
// Everything here is read verbatim from RecommendationOutputV4: one target line, one candidate
// section (cards with a real ground; zero cards = nothing is rendered) and ONLY that section's degradations. Nothing
// is scored, ranked or inferred here, and no second target or shortlist exists anywhere next to it.
// Advisory only: the Player may pick any legal hero for any pending position.

function positionName(position: CoachPosition): string {
  return `Pos${position} ${SIMULATOR_POSITION_LABELS[position]}`;
}

function heroName(heroId: number, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

const NO_ACTION_COPY: Record<NoHumanActionReason, string> = {
  YIELDED: "Cediste el resto de esta ronda al Ally Bot: no hay acción humana hasta la próxima ronda.",
  ROUND_COMPLETE: "Tus picks de esta ronda ya están sellados: esperando que cierre la ronda.",
  DRAFT_COMPLETE: "El draft terminó.",
};

// Solo una razón ESTRATÉGICA real (ventana de counter, último héroe del pool) se dice; con prioridad por defecto no hay nada que explicar.
function StrategicRationale({ decision }: TargetHeaderProps) {
  if (decision.targetBasis !== "STRATEGIC") return null;
  return <span className="text-caption text-content-secondary" data-testid="current-decision-rationale">{decision.targetRationale}</span>;
}

interface TargetHeaderProps {
  decision: ActionableDecision;
}

// The Coach RECOMMENDATION only (targetPosition/targetBasis). Contrato de elegibilidad (dueño del producto, 2026-11-03): una recomendación solo
// existe si hay un héroe con evidencia FUERTE detrás. "Objetivo recomendado" sale únicamente cuando el motor manda `primaryRecommendation` (el héroe
// primario de la posición objetivo es STRONG; la MISMA regla que el "ELIGE AHORA" del tablero en vivo) y, si se está viendo esa misma posición, solo
// con tarjetas a la vista. La prioridad entre posiciones (`targetBasis`) solo decide si hay una razón estratégica que decir: una vista por defecto
// ("No hay una prioridad clara", "Vista inicial sugerida") es un mensaje de falta de información y nunca se muestra.
function TargetHeader({ decision }: TargetHeaderProps) {
  const common = { "data-testid": "current-decision-target", "data-target-position": decision.targetPosition, "data-target-basis": decision.targetBasis };
  if (decision.primaryRecommendation !== null) {
    const viewingTarget = decision.viewedPosition === decision.targetPosition;
    if (viewingTarget && decision.candidates.cards.length === 0) return null;
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-accent-primary bg-surface-overlay p-3" {...common}>
        <span className="text-caption font-semibold text-accent-primary">Objetivo recomendado: {positionName(decision.targetPosition)}</span>
        <StrategicRationale decision={decision} />
        <span className="text-caption text-content-muted">Es una sugerencia: puedes elegir cualquier posición pendiente y cualquier héroe legal.</span>
      </div>
    );
  }
  if (decision.actionablePositions.length === 1) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-overlay p-3" {...common}>
        <span className="text-caption font-semibold text-content-primary">Única posición pendiente: {positionName(decision.targetPosition)}</span>
      </div>
    );
  }
  return null;
}

interface ViewedPositionNoticeProps {
  decision: ActionableDecision;
}

// Only when the Player inspects a position other than the recommended one: navigation is stated as
// navigation, and the recommendation is restated unchanged -- clicking never re-labels the Coach's advice.
function ViewedPositionNotice({ decision }: ViewedPositionNoticeProps) {
  if (decision.viewedPosition === decision.targetPosition) return null;
  // "Coach sugiere X" es una recomendación: sin héroe STRONG detrás el objetivo es solo una vista por defecto y no se afirma nada.
  if (decision.primaryRecommendation === null) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-raised p-3" data-testid="current-decision-viewed" data-viewed-position={decision.viewedPosition}>
      <span className="text-caption font-semibold text-content-primary">Estás viendo {positionName(decision.viewedPosition)}</span>
      <span className="text-caption text-content-secondary" data-testid="current-decision-coach-suggests">Coach sugiere {positionName(decision.targetPosition)}</span>
      <span className="text-caption text-content-muted">Cambiar de vista no cambia la sugerencia del Coach.</span>
    </div>
  );
}

interface CandidateDegradationsProps {
  degradations: readonly CandidateDegradation[];
}

// Only the degradations of the candidate result on screen -- never those of another evaluation.
function CandidateDegradations({ degradations }: CandidateDegradationsProps) {
  const notices = new Map<string, string>();
  for (const degradation of degradations) {
    const text = playerFacingDegradation(degradation);
    if (text) notices.set(text, text);
  }
  if (notices.size === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-signal-warning bg-surface-raised p-2" data-testid="current-decision-degradations">
      {[...notices.values()].map((text) => (
        <span key={text} className="text-caption text-signal-warning">{text}</span>
      ))}
    </div>
  );
}

const POOL_BADGE_LABELS: Record<PoolOwner, { inside: string; outside: string }> = {
  PLAYER: { inside: "Tu pool", outside: "Fuera de tu pool" },
  TEAMMATE: { inside: "Pool del compañero", outside: "Fuera del pool del compañero" },
};

interface PoolBadgeProps {
  membership: PoolMembership;
  owner: PoolOwner | null;
}

// A pool mark says whose pool it is; "outside" is the shared OFF-POOL tag and appears only when a pool really voted (NO_POOL shows nothing).
function PoolBadge({ membership, owner }: PoolBadgeProps) {
  if (membership === "NO_POOL" || owner === null) return null;
  if (membership === "IN_POOL") {
    return <span className="rounded-md border border-accent-primary px-2 py-1 text-caption text-accent-primary" data-testid="current-decision-pool-badge">{POOL_BADGE_LABELS[owner].inside}</span>;
  }
  return <OffPoolTag membership={membership} title={POOL_BADGE_LABELS[owner].outside} testId="current-decision-outside-pool-badge" />;
}

interface CardReasonsProps {
  card: RankedCandidateCard;
  heroCatalog: Map<number, HeroMeta>;
}

// La frase de la tarjeta es la de su fundamento; el motor decide (`hideRationale`) cuándo se calla porque los chips de contexto ya lo dicen.
function CardRationale({ card }: { card: RankedCandidateCard }) {
  if (card.hideRationale === true) return null;
  return <span className="text-caption text-content-secondary">{card.rationale}</span>;
}

// Las MISMAS razones del draft que el tablero del equipo (bans que abren al héroe, a quién de lo ya revelado le gana, con quién combina):
// mismos componentes, misma fuente en el motor. Nada de esto supone lo que el rival va a sacar.
function CardDraftReasons({ card, heroCatalog }: CardReasonsProps) {
  if (!card.context) return null;
  const source = { ...card.context, reasons: [card.rationale] };
  return (
    <>
      <CandidateOpening candidate={source} heroCatalog={heroCatalog} />
      <CandidateStrengths candidate={source} heroCatalog={heroCatalog} />
      <CandidateSynergies candidate={source} heroCatalog={heroCatalog} />
      <CandidateSteals candidate={source} heroCatalog={heroCatalog} />
    </>
  );
}

interface RankedCardViewProps {
  card: RankedCandidateCard;
  poolOwner: PoolOwner | null;
  heroCatalog: Map<number, HeroMeta>;
  sessionId: string;
  stateIdentity: string;
  rulesetVersion: string | null;
}

function RankedCardView({ card, poolOwner, heroCatalog, sessionId, stateIdentity, rulesetVersion }: RankedCardViewProps) {
  const meta = heroCatalog.get(card.heroId);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-overlay p-2" data-testid="current-decision-card" data-hero-id={card.heroId} data-rank={card.rank}>
      <div className="flex items-center gap-2">
        <span className="text-caption font-semibold text-content-muted">{card.rank}.</span>
        <HeroIcon imgUrl={meta?.imgUrl ?? ""} alt={heroName(card.heroId, heroCatalog)} size={40} />
        <div className="flex flex-col">
          <span className="text-body font-semibold text-content-primary">{heroName(card.heroId, heroCatalog)}</span>
          <span className="text-caption text-content-muted">{CONFIDENCE_LABELS[card.confidence]}</span>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {card.badges.map((badge) => (
          <span key={badge} className="rounded-md border border-surface-border bg-surface-raised px-2 py-1 text-caption text-content-secondary">{BADGE_LABELS[badge]}</span>
        ))}
        <PoolBadge membership={card.poolMembership} owner={poolOwner} />
        <EvidenceLimitedMark strength={card.evidenceStrength} />
      </div>
      <CardRationale card={card} />
      <CardDraftReasons card={card} heroCatalog={heroCatalog} />
      <CardRiskNotice risks={card.risks} />
      <RecommendationFeedback sessionId={sessionId} heroId={card.heroId} targetPosition={card.position} stateIdentity={stateIdentity} rulesetVersion={rulesetVersion} />
    </li>
  );
}

interface CandidateSectionProps {
  candidates: CandidateResult;
  poolOwner: PoolOwner | null;
  output: CurrentDecisionOutput;
  heroCatalog: Map<number, HeroMeta>;
}

function CandidateSection({ candidates, poolOwner, output, heroCatalog }: CandidateSectionProps) {
  // Ningún héroe con fundamento: no se pinta nada (ni encabezado, ni mensaje, ni lista de relleno).
  if (candidates.cards.length === 0) return null;
  const target = positionName(candidates.targetPosition);
  const rulesetVersion = output.meta.readiness?.empiricalPatchClaim?.patch ?? output.meta.readiness?.rulesetTarget ?? null;
  return (
    <div className="flex flex-col gap-2" data-testid="current-decision-candidates" data-candidate-state={candidates.state}>
      <span className="text-caption font-semibold text-content-primary">Ranking para {target}</span>
      <CandidateDegradations degradations={candidates.degradations} />
      <ol className="grid grid-cols-1 gap-2">
        {candidates.cards.map((card) => (
          <RankedCardView key={card.heroId} card={card} poolOwner={poolOwner} heroCatalog={heroCatalog} sessionId={output.sessionId} stateIdentity={output.meta.basedOn.stateIdentity} rulesetVersion={rulesetVersion} />
        ))}
      </ol>
    </div>
  );
}

interface NoHumanActionViewProps {
  reason: NoHumanActionReason;
}

function NoHumanActionView({ reason }: NoHumanActionViewProps) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-overlay p-3" data-testid="current-decision-no-action" data-reason={reason}>
      <span className="text-caption text-content-secondary">{NO_ACTION_COPY[reason]}</span>
    </div>
  );
}

export interface CurrentDecisionPanelProps {
  output: CurrentDecisionOutput;
  heroCatalog: Map<number, HeroMeta>;
  onAssignOwnPosition?: (heroId: number, position: CoachPosition | null) => void;
}

interface DecisionBodyProps {
  output: CurrentDecisionOutput;
  heroCatalog: Map<number, HeroMeta>;
}

function DecisionBody({ output, heroCatalog }: DecisionBodyProps) {
  const { decision } = output;
  if (decision.kind === "NO_HUMAN_ACTION") return <NoHumanActionView reason={decision.reason} />;
  return (
    <>
      <TargetHeader decision={decision} />
      <ViewedPositionNotice decision={decision} />
      <CandidateSection candidates={decision.candidates} poolOwner={decision.poolOwner} output={output} heroCatalog={heroCatalog} />
    </>
  );
}

export function CurrentDecisionPanel({ output, heroCatalog, onAssignOwnPosition }: CurrentDecisionPanelProps) {
  return (
    <div
      className="flex flex-col gap-3"
      data-testid="current-decision-panel"
      data-decision-kind={output.decision.kind}
      data-revision={output.meta.revision}
      data-trigger={output.meta.trigger}
      data-state-identity={output.meta.basedOn.stateIdentity}
    >
      {output.roleCollision?.infeasible && <RoleCollisionBanner collision={output.roleCollision} heroCatalog={heroCatalog} />}
      <DecisionBody output={output} heroCatalog={heroCatalog} />
      {/* Safe Core: informational, outside the decision -- no target, no view, no capacity, no ordering. */}
      <SafeCoreOpportunity
        opportunity={output.opportunity}
        sessionId={output.sessionId}
        stateIdentity={output.meta.basedOn.stateIdentity}
        rulesetVersion={output.meta.readiness?.empiricalPatchClaim?.patch ?? output.meta.readiness?.rulesetTarget ?? null}
        heroCatalog={heroCatalog}
      />
      <CoachRoleBeliefs roleBeliefs={output.roleBeliefs} heroCatalog={heroCatalog} onAssignOwnPosition={onAssignOwnPosition} />
    </div>
  );
}
