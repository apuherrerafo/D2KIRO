"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { RecommendationFeedback } from "@/components/recommendation-feedback/RecommendationFeedback";
import { CONFIDENCE_LABELS } from "@/features/draft/constants";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { ActionableDecision, CandidateDegradation, CandidateResult, CoachPosition, CurrentDecisionOutput, NoHumanActionReason, PositionalAlternative, RankedCandidateCard } from "../coach-client";
import { playerFacingDegradation } from "../degradation-copy";
import { SIMULATOR_POSITION_LABELS } from "../roster";
import { BADGE_LABELS, CoachRoleBeliefs, RoleCollisionBanner } from "./CoachPanel";

// Product Semantics Recovery WP3 -- the ONE visual owner of the Simulator's current human decision.
// Everything here is read verbatim from RecommendationOutputV4: one target line, one candidate
// section (RANKED | UNRANKED_POSITIONAL | UNAVAILABLE) and ONLY that section's degradations. Nothing
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

interface TargetHeaderProps {
  decision: ActionableDecision;
  /** The position the Player asked to view in the selector (null = the engine chose). */
  requestedTarget: CoachPosition | null;
}

// Exactly one of three headers -- STRATEGIC advice never shares wording with a default/navigation view.
function TargetHeader({ decision, requestedTarget }: TargetHeaderProps) {
  const common = { "data-testid": "current-decision-target", "data-target-position": decision.targetPosition, "data-target-basis": decision.targetBasis };
  if (decision.targetBasis === "STRATEGIC") {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-accent-primary bg-surface-overlay p-3" {...common}>
        <span className="text-caption font-semibold text-accent-primary">Objetivo recomendado: {positionName(decision.targetPosition)}</span>
        <span className="text-caption text-content-secondary" data-testid="current-decision-rationale">{decision.targetRationale}</span>
        <span className="text-caption text-content-muted">Es una sugerencia: podés elegir cualquier posición pendiente y cualquier héroe legal.</span>
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
  if (requestedTarget === decision.targetPosition) {
    return (
      <div className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-overlay p-3" {...common}>
        <span className="text-caption font-semibold text-content-primary">Vista elegida: {positionName(decision.targetPosition)}</span>
        <span className="text-caption text-content-secondary" data-testid="current-decision-rationale">{decision.targetRationale}</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-overlay p-3" {...common}>
      <span className="text-caption font-semibold text-content-primary">Sin prioridad estratégica</span>
      <span className="text-caption text-content-secondary">Vista inicial: {positionName(decision.targetPosition)}</span>
      <span className="text-caption text-content-muted" data-testid="current-decision-rationale">{decision.targetRationale}</span>
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

interface RankedCardViewProps {
  card: RankedCandidateCard;
  heroCatalog: Map<number, HeroMeta>;
  sessionId: string;
  stateIdentity: string;
  rulesetVersion: string | null;
}

function RankedCardView({ card, heroCatalog, sessionId, stateIdentity, rulesetVersion }: RankedCardViewProps) {
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
        {card.isFromPool && <span className="rounded-md border border-accent-primary px-2 py-1 text-caption text-accent-primary" data-testid="current-decision-pool-badge">Tu pool</span>}
      </div>
      <span className="text-caption text-content-secondary">{card.rationale}</span>
      <RecommendationFeedback sessionId={sessionId} heroId={card.heroId} targetPosition={card.position} stateIdentity={stateIdentity} rulesetVersion={rulesetVersion} />
    </li>
  );
}

interface AlternativeViewProps {
  alternative: PositionalAlternative;
  heroCatalog: Map<number, HeroMeta>;
}

// No rank, no confidence, no feedback control: there is no recommendation result to rate.
function AlternativeView({ alternative, heroCatalog }: AlternativeViewProps) {
  const meta = heroCatalog.get(alternative.heroId);
  return (
    <li className="flex items-center gap-2 rounded-lg border border-surface-border bg-surface-overlay p-2" data-testid="current-decision-alternative" data-hero-id={alternative.heroId}>
      <HeroIcon imgUrl={meta?.imgUrl ?? ""} alt={heroName(alternative.heroId, heroCatalog)} size={40} />
      <span className="text-caption text-content-primary">{heroName(alternative.heroId, heroCatalog)}</span>
    </li>
  );
}

interface CandidateSectionProps {
  candidates: CandidateResult;
  output: CurrentDecisionOutput;
  heroCatalog: Map<number, HeroMeta>;
}

function CandidateSection({ candidates, output, heroCatalog }: CandidateSectionProps) {
  const target = positionName(candidates.targetPosition);
  const common = { "data-testid": "current-decision-candidates", "data-candidate-state": candidates.state };
  if (candidates.state === "RANKED") {
    const rulesetVersion = output.meta.readiness?.empiricalPatchClaim?.patch ?? output.meta.readiness?.rulesetTarget ?? null;
    return (
      <div className="flex flex-col gap-2" {...common}>
        <span className="text-caption font-semibold text-content-primary">Ranking para {target}</span>
        <CandidateDegradations degradations={candidates.degradations} />
        <ol className="grid grid-cols-1 gap-2">
          {candidates.cards.map((card) => (
            <RankedCardView key={card.heroId} card={card} heroCatalog={heroCatalog} sessionId={output.sessionId} stateIdentity={output.meta.basedOn.stateIdentity} rulesetVersion={rulesetVersion} />
          ))}
        </ol>
      </div>
    );
  }
  if (candidates.state === "UNRANKED_POSITIONAL") {
    return (
      <div className="flex flex-col gap-2" {...common}>
        <span className="text-caption font-semibold text-signal-warning">Alternativas posicionales para {target} — sin ranking disponible</span>
        <span className="text-caption text-content-secondary">{candidates.reason}</span>
        <CandidateDegradations degradations={candidates.degradations} />
        <ul className="grid grid-cols-1 gap-2">
          {candidates.alternatives.map((alternative) => <AlternativeView key={alternative.heroId} alternative={alternative} heroCatalog={heroCatalog} />)}
        </ul>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2" {...common}>
      <span className="text-caption font-semibold text-signal-negative">No hay candidatos disponibles para {target}</span>
      <span className="text-caption text-content-secondary">{candidates.reason}</span>
      <CandidateDegradations degradations={candidates.degradations} />
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
  requestedTarget?: CoachPosition | null;
  onAssignOwnPosition?: (heroId: number, position: CoachPosition | null) => void;
}

interface DecisionBodyProps {
  output: CurrentDecisionOutput;
  heroCatalog: Map<number, HeroMeta>;
  requestedTarget: CoachPosition | null;
}

function DecisionBody({ output, heroCatalog, requestedTarget }: DecisionBodyProps) {
  const { decision } = output;
  if (decision.kind === "NO_HUMAN_ACTION") return <NoHumanActionView reason={decision.reason} />;
  return (
    <>
      <TargetHeader decision={decision} requestedTarget={requestedTarget} />
      <CandidateSection candidates={decision.candidates} output={output} heroCatalog={heroCatalog} />
    </>
  );
}

export function CurrentDecisionPanel({ output, heroCatalog, requestedTarget = null, onAssignOwnPosition }: CurrentDecisionPanelProps) {
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
      <DecisionBody output={output} heroCatalog={heroCatalog} requestedTarget={requestedTarget} />
      <CoachRoleBeliefs roleBeliefs={output.roleBeliefs} heroCatalog={heroCatalog} onAssignOwnPosition={onAssignOwnPosition} />
    </div>
  );
}
