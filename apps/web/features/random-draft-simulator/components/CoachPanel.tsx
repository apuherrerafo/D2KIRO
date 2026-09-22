"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { CONFIDENCE_LABELS } from "@/features/draft/constants";
import { BUTTON_COMPACT } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { CoachBadge, CoachHeroCard, CoachOutput, CoachPosition, CoachRoleStatus, CoachStrategy } from "../coach-client";

// AP Ranked Roles V1 / Wave 2 -- the Coach: PRIMARY ACTION first (what to reveal / preserve / do now),
// then the SHORTLIST (concrete hero options for that action). Everything shown is read verbatim from
// the engine's RecommendationOutputV3: this file never scores, ranks or infers a role. How specific
// the advice is comes only from `strategy.kind` -- a role-level action is never dressed up as a hero.
//
// The panel is advisory: the Player can pick any legal hero, and nothing here marks a choice as
// wrong. Terminology in castellano, consistent with the rest of the product (web.md).

const POSITION_LABELS: Record<CoachPosition, string> = {
  1: "Carry",
  2: "Midlane",
  3: "Offlane",
  4: "Support",
  5: "Hard support",
};

const BADGE_LABELS: Record<CoachBadge, string> = {
  COUNTER: "Counter",
  SYNERGY: "Sinergia",
  POSITION_FIT: "Encaja en la posición",
  META: "Aporta el meta",
  FLEX: "Flex",
  YOUR_POOL: "Tu pool",
  OUTSIDE_YOUR_POOL: "Fuera de tu pool",
};

const SHORTLIST_TITLES: Record<CoachStrategy["kind"], string> = {
  REVEAL_POSITION: "Opciones de héroe para esta posición",
  REVEAL_HERO: "Otras opciones",
  DEFER_POSITION: "Opciones para otras posiciones",
  REVEAL_FLEX: "Opciones flexibles",
  OPPORTUNITY: "Opciones",
};

// Una posición sólo se muestra como hecho si el motor la tiene resuelta; si no, se dice.
const ROLE_NOTES: Record<CoachRoleStatus, (position: CoachPosition) => string> = {
  CONFIRMED_FORCED: (position) => `Posición: ${POSITION_LABELS[position]}`,
  LIKELY: (position) => `Probable: ${POSITION_LABELS[position]}`,
  UNRESOLVED: () => "Rol por definir",
};

function heroName(heroId: number, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

interface NamedHeroProps {
  strategy: CoachStrategy;
  heroCatalog: Map<number, HeroMeta>;
}

// Sólo una acción a nivel de héroe nombra un héroe (early return -- sin ternario).
function NamedHero({ strategy, heroCatalog }: NamedHeroProps) {
  if (strategy.kind !== "REVEAL_HERO") return null;
  const meta = heroCatalog.get(strategy.heroId);
  return (
    <div className="flex items-center gap-2" data-testid="coach-named-hero" data-hero-id={strategy.heroId}>
      <HeroIcon imgUrl={meta?.imgUrl ?? ""} alt={heroName(strategy.heroId, heroCatalog)} size={40} />
      <span className="text-body font-semibold text-content-primary">{heroName(strategy.heroId, heroCatalog)}</span>
    </div>
  );
}

interface PrimaryActionProps {
  coach: CoachOutput;
  heroCatalog: Map<number, HeroMeta>;
}

function PrimaryAction({ coach, heroCatalog }: PrimaryActionProps) {
  const { strategy, label } = coach.primaryAction;
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-accent-primary bg-surface-overlay p-3"
      data-testid="coach-primary-action"
      data-strategy-kind={strategy.kind}
      data-revision={coach.meta.revision}
      data-trigger={coach.meta.trigger}
      data-state-identity={coach.meta.basedOn.stateIdentity}
    >
      <span className="text-caption font-semibold text-accent-primary">Qué hacer ahora</span>
      <span className="text-body font-semibold text-content-primary" data-testid="coach-primary-label">
        {label}
      </span>
      <NamedHero strategy={strategy} heroCatalog={heroCatalog} />
      <span className="text-caption text-content-secondary" data-testid="coach-primary-rationale">
        {strategy.rationale}
      </span>
      <span className="text-caption text-content-muted">
        {CONFIDENCE_LABELS[coach.meta.confidence]} · Es una sugerencia: podés elegir cualquier héroe legal.
      </span>
    </div>
  );
}

// Procedencia de la evidencia de counters: la única aprobada en V1 es la curada.
const CURATED_EVIDENCE_LABEL = "Evidencia curada";

// Ventana de core (Safe Core): informativa y separada de la acción primaria y de la shortlist.
function SafeCoreOpportunity({ coach, heroCatalog }: ShortlistProps) {
  const opportunity = coach.opportunity;
  if (!opportunity) return null;
  const meta = heroCatalog.get(opportunity.heroId);
  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-signal-positive bg-surface-overlay p-3"
      data-testid="coach-opportunity"
      data-subtype={opportunity.subtype}
      data-hero-id={opportunity.heroId}
      data-source-type={opportunity.counterEvidence.sourceType}
    >
      <span className="text-caption font-semibold text-signal-positive">Oportunidad</span>
      <div className="flex items-center gap-2">
        <HeroIcon imgUrl={meta?.imgUrl ?? ""} alt={heroName(opportunity.heroId, heroCatalog)} size={40} />
        <span className="text-body font-semibold text-content-primary">{heroName(opportunity.heroId, heroCatalog)}</span>
      </div>
      <span className="text-caption text-content-secondary" data-testid="coach-opportunity-label">
        {opportunity.label}
      </span>
      <span className="text-caption text-content-muted" data-testid="coach-opportunity-source">
        {CURATED_EVIDENCE_LABEL} · Es informativo: podés ignorarlo.
      </span>
    </div>
  );
}

interface BadgeListProps {
  badges: CoachBadge[];
}

function BadgeList({ badges }: BadgeListProps) {
  if (badges.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {badges.map((badge) => (
        <span key={badge} className="rounded-md border border-surface-border bg-surface-raised px-2 py-1 text-caption text-content-secondary" data-testid="coach-badge">
          {BADGE_LABELS[badge]}
        </span>
      ))}
    </div>
  );
}

interface HeroCardViewProps {
  card: CoachHeroCard;
  heroCatalog: Map<number, HeroMeta>;
}

function HeroCardView({ card, heroCatalog }: HeroCardViewProps) {
  const meta = heroCatalog.get(card.heroId);
  return (
    <li className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-overlay p-2" data-testid="coach-hero-card" data-hero-id={card.heroId}>
      <div className="flex items-center gap-2">
        <HeroIcon imgUrl={meta?.imgUrl ?? ""} alt={heroName(card.heroId, heroCatalog)} size={40} />
        <div className="flex flex-col">
          <span className="text-body font-semibold text-content-primary">{heroName(card.heroId, heroCatalog)}</span>
          <span className="text-caption text-content-muted">{ROLE_NOTES[card.roleStatus](card.position)}</span>
        </div>
      </div>
      <BadgeList badges={card.badges} />
      <span className="text-caption text-content-secondary">{card.rationale}</span>
    </li>
  );
}

interface ShortlistProps {
  coach: CoachOutput;
  heroCatalog: Map<number, HeroMeta>;
}

function PersonalHeroView({ coach, heroCatalog }: ShortlistProps) {
  const personal = coach.personalHeroView;
  if (!personal) return null;
  if (personal.seatCovered) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border border-accent-primary/50 bg-surface-overlay p-3" data-testid="coach-personal-hero-view">
        <span className="text-caption font-semibold text-accent-primary">{personal.positionLabel}</span>
        <span className="text-caption text-content-secondary" data-testid="coach-personal-seat-covered">Tu posición ya está cubierta</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-accent-primary/50 bg-surface-overlay p-3" data-testid="coach-personal-hero-view">
      <span className="text-caption font-semibold text-accent-primary">{personal.positionLabel}</span>
      <ul className="grid grid-cols-1 gap-1">
        {personal.heroes.map((hero) => <li key={hero.heroId} className="text-caption text-content-primary" data-hero-id={hero.heroId}>
          {hero.rank}. {heroName(hero.heroId, heroCatalog)}{hero.isFromPool ? " · Tu pool" : ""}
        </li>)}
      </ul>
    </div>
  );
}

type RoleBelief = NonNullable<CoachOutput["roleBeliefs"]>["own"][number];

interface RoleBeliefRowProps {
  belief: RoleBelief;
  label: string;
  heroCatalog: Map<number, HeroMeta>;
}

function EnemyRoleRow({ belief, label, heroCatalog }: RoleBeliefRowProps) {
  const flex = belief.status !== "CONFIRMED" && belief.positions.length > 1;
  const description = belief.status === "CONFIRMED"
    ? `Pos${belief.positions[0]}`
    : flex
      ? `Likely Pos${belief.positions[0]} / Possible Pos${belief.positions[1]}`
      : `Likely Pos${belief.positions[0]}`;
  return <div className="flex flex-wrap items-center gap-1 text-caption text-content-secondary" data-testid="coach-enemy-role">
    <span>{label}: {heroName(belief.heroId, heroCatalog)} — {description}</span>
  </div>;
}

interface OwnRoleRowProps extends RoleBeliefRowProps {
  onAssignOwnPosition?: (heroId: number, position: CoachPosition | null) => void;
}

// Own row: before an assignment the Player sees "<hero> · FLEX 3/2" with one "Asignar PosN" button
// per plausible position; after it, "<hero> · Asignado a PosN" with a single "Quitar asignación".
function OwnRoleRow({ belief, label, heroCatalog, onAssignOwnPosition }: OwnRoleRowProps) {
  const name = heroName(belief.heroId, heroCatalog);
  const assigned = belief.status === "CONFIRMED";
  const flex = !assigned && belief.positions.length > 1;
  const description = assigned
    ? `Asignado a Pos${belief.positions[0]}`
    : flex
      ? `FLEX ${belief.positions.join("/")}`
      : `Likely Pos${belief.positions[0]}`;
  const clearAssignment = () => onAssignOwnPosition?.(belief.heroId, null);
  return <div className="flex flex-wrap items-center gap-2 text-caption text-content-secondary" data-testid="coach-own-role">
    <span>{label}: {name} · {description}</span>
    {onAssignOwnPosition && !assigned && belief.positions.map((position) => <AssignPositionButton key={position} heroId={belief.heroId} position={position} onAssign={onAssignOwnPosition} />)}
    {onAssignOwnPosition && assigned && <button type="button" className={BUTTON_COMPACT} onClick={clearAssignment}>Quitar asignación</button>}
  </div>;
}

interface AssignPositionButtonProps {
  heroId: number;
  position: CoachPosition;
  onAssign: (heroId: number, position: CoachPosition | null) => void;
}

function AssignPositionButton({ heroId, position, onAssign }: AssignPositionButtonProps) {
  const assign = () => onAssign(heroId, position);
  return <button type="button" className={BUTTON_COMPACT} onClick={assign}>Asignar Pos{position}</button>;
}

function RoleBeliefs({ coach, heroCatalog, onAssignOwnPosition }: CoachPanelProps) {
  if (!coach.roleBeliefs) return null;
  const { own, enemy } = coach.roleBeliefs;
  if (own.length === 0 && enemy.length === 0) return null;
  return <div className="flex flex-col gap-2" data-testid="coach-role-beliefs">
    {own.map((belief) => <OwnRoleRow key={`own-${belief.heroId}`} belief={belief} label="Tu equipo" heroCatalog={heroCatalog} onAssignOwnPosition={onAssignOwnPosition} />)}
    {enemy.map((belief) => <EnemyRoleRow key={`enemy-${belief.heroId}`} belief={belief} label="Rival" heroCatalog={heroCatalog} />)}
  </div>;
}

function Shortlist({ coach, heroCatalog }: ShortlistProps) {
  if (coach.shortlist.length === 0) return null;
  return (
    <div className="flex flex-col gap-2" data-testid="coach-shortlist">
      <span className="text-caption font-semibold text-content-primary">{SHORTLIST_TITLES[coach.primaryAction.strategy.kind]}</span>
      <ul className="grid grid-cols-1 gap-2">
        {coach.shortlist.map((card) => (
          <HeroCardView key={card.heroId} card={card} heroCatalog={heroCatalog} />
        ))}
      </ul>
    </div>
  );
}

export interface CoachPanelProps {
  coach: CoachOutput;
  heroCatalog: Map<number, HeroMeta>;
  onAssignOwnPosition?: (heroId: number, position: CoachPosition | null) => void;
}

export function CoachPanel({ coach, heroCatalog, onAssignOwnPosition }: CoachPanelProps) {
  return (
    <div className="flex flex-col gap-3" data-testid="coach-panel">
      <PrimaryAction coach={coach} heroCatalog={heroCatalog} />
      <SafeCoreOpportunity coach={coach} heroCatalog={heroCatalog} />
      <PersonalHeroView coach={coach} heroCatalog={heroCatalog} />
      <Shortlist coach={coach} heroCatalog={heroCatalog} />
      <RoleBeliefs coach={coach} heroCatalog={heroCatalog} onAssignOwnPosition={onAssignOwnPosition} />
    </div>
  );
}
