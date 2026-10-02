"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { ADVISORY_NOTE, DETERMINISTIC_DEFAULT_NOTE, PICK_NOW_LABEL, teamPositionName, teamPositionTitle } from "../constants";
import {
  BOARD_GRID,
  BOARD_SHELL,
  CANDIDATE_BUTTON,
  CANDIDATE_ROW,
  COLUMN_DEFAULT,
  COLUMN_HEADER,
  COLUMN_RECOMMENDED,
  COLUMN_SELECTED,
  DECISION_BANNER,
  PICK_NOW_BADGE,
  PLAN_BADGE,
} from "../styles";
import type { RequestStatus, TeamCoachBoardData, TeamCoachCandidate, TeamCoachColumn, TeamPosition } from "../types";

// <Dominio><Cosa>: el Team Coach Board -- UN componente compartido por /simulator y /live-draft.
//
// Muestra, contra el MISMO snapshot, el ranking de cada posición humana y marca con "★ PICK NOW" la
// posición que D2KIRO recomienda. La recomendación es consultiva: toda posición legal (eligibleNow)
// sigue seleccionable y cualquiera de sus héroes se puede elegir, en cualquier orden. Nada se puntúa
// ni se decide acá -- todo se lee verbatim del motor.

function heroName(heroId: number, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

interface HeroLabelProps {
  heroId: number;
  heroCatalog: Map<number, HeroMeta>;
  size: number;
}

function HeroLabel({ heroId, heroCatalog, size }: HeroLabelProps) {
  const name = heroName(heroId, heroCatalog);
  return (
    <span className="flex min-w-0 items-center gap-2">
      <HeroIcon imgUrl={heroCatalog.get(heroId)?.imgUrl ?? ""} alt={name} size={size} />
      <span className="truncate">{name}</span>
    </span>
  );
}

interface DecisionBannerProps {
  board: TeamCoachBoardData;
  heroCatalog: Map<number, HeroMeta>;
}

function DecisionBannerHero({ board, heroCatalog }: DecisionBannerProps) {
  const heroId = board.currentDecision.recommendedHeroId;
  if (heroId === null) return null;
  return <HeroLabel heroId={heroId} heroCatalog={heroCatalog} size={32} />;
}

function DefaultBasisNote({ board }: { board: TeamCoachBoardData }) {
  if (board.currentDecision.targetBasis !== "DETERMINISTIC_DEFAULT" || board.currentDecision.actionablePositions.length < 2) return null;
  return <span className="text-caption text-content-muted">{DETERMINISTIC_DEFAULT_NOTE}</span>;
}

function DecisionBanner({ board, heroCatalog }: DecisionBannerProps) {
  const position = board.currentDecision.recommendedPosition;
  if (position === null) {
    return (
      <div className="rounded-lg border border-surface-border bg-surface-overlay p-3 text-caption text-content-secondary" data-testid="team-coach-no-action">
        {board.currentDecision.reason}
      </div>
    );
  }
  return (
    <div className={DECISION_BANNER} data-testid="team-coach-decision" data-recommended-position={position}>
      <span className="text-caption font-semibold text-accent-primary">RECOMMENDED PICK NOW · {teamPositionName(position)}</span>
      <span className="text-body text-content-primary">
        <DecisionBannerHero board={board} heroCatalog={heroCatalog} />
      </span>
      <span className="text-caption text-content-secondary" data-testid="team-coach-reason">{board.currentDecision.reason}</span>
      <DefaultBasisNote board={board} />
      <span className="text-caption text-content-muted">{ADVISORY_NOTE}</span>
    </div>
  );
}

interface CandidateProps {
  position: TeamPosition;
  candidate: TeamCoachCandidate;
  heroCatalog: Map<number, HeroMeta>;
  onPickHero?: (position: TeamPosition, heroId: number) => void;
  canPick: boolean;
}

function PlanBadge({ candidate }: { candidate: TeamCoachCandidate }) {
  if (!candidate.isPrimary) return null;
  return <span className={PLAN_BADGE}>plan</span>;
}

function CandidateItem({ position, candidate, heroCatalog, onPickHero, canPick }: CandidateProps) {
  function handlePick() {
    onPickHero?.(position, candidate.heroId);
  }
  const reason = candidate.reasons[0] ?? "";
  const common = { "data-testid": "team-coach-candidate", "data-hero-id": candidate.heroId, "data-primary": candidate.isPrimary, title: reason };
  if (!canPick || !onPickHero) {
    return (
      <li className={CANDIDATE_ROW} {...common}>
        <span className="text-content-muted">{candidate.rank}.</span>
        <HeroLabel heroId={candidate.heroId} heroCatalog={heroCatalog} size={28} />
        <PlanBadge candidate={candidate} />
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={handlePick} className={CANDIDATE_BUTTON} aria-label={`Elegir ${heroName(candidate.heroId, heroCatalog)} como ${teamPositionName(position)}`} {...common}>
        <span className="text-content-muted">{candidate.rank}.</span>
        <HeroLabel heroId={candidate.heroId} heroCatalog={heroCatalog} size={28} />
        <PlanBadge candidate={candidate} />
      </button>
    </li>
  );
}

interface ColumnBodyProps {
  column: TeamCoachColumn;
  heroCatalog: Map<number, HeroMeta>;
  onPickHero?: (position: TeamPosition, heroId: number) => void;
}

function ColumnBody({ column, heroCatalog, onPickHero }: ColumnBodyProps) {
  if (column.state === "FILLED" && column.filledHeroId !== null) {
    return (
      <div className="flex flex-col gap-1 text-caption text-content-secondary" data-testid="team-coach-filled">
        <span className="text-content-muted">Elegido</span>
        <HeroLabel heroId={column.filledHeroId} heroCatalog={heroCatalog} size={36} />
      </div>
    );
  }
  if (column.top.length === 0) {
    return <span className="text-caption text-content-muted">{column.note ?? "Sin candidatos para esta posición ahora."}</span>;
  }
  return (
    <ol className="flex flex-col gap-1">
      {column.top.map((candidate) => (
        <CandidateItem key={candidate.heroId} position={column.position} candidate={candidate} heroCatalog={heroCatalog} onPickHero={onPickHero} canPick={column.eligibleNow} />
      ))}
    </ol>
  );
}

function PickNowBadge({ recommended }: { recommended: boolean }) {
  if (!recommended) return null;
  return <span className={PICK_NOW_BADGE} data-testid="team-coach-pick-now">{PICK_NOW_LABEL}</span>;
}

function UnrankedNote({ column }: { column: TeamCoachColumn }) {
  if (column.state !== "UNRANKED_POSITIONAL") return null;
  return <span className="text-caption text-signal-warning">Sin ranking confiable: héroes legales de la posición, sin orden de preferencia.</span>;
}

interface ColumnProps extends ColumnBodyProps {
  recommended: boolean;
  selected: boolean;
  onSelectPosition(position: TeamPosition): void;
}

function columnClassName(recommended: boolean, selected: boolean): string {
  if (recommended) return COLUMN_RECOMMENDED;
  if (selected) return COLUMN_SELECTED;
  return COLUMN_DEFAULT;
}

function Column({ column, heroCatalog, onPickHero, recommended, selected, onSelectPosition }: ColumnProps) {
  function handleSelect() {
    onSelectPosition(column.position);
  }
  return (
    <section
      className={columnClassName(recommended, selected)}
      data-testid={`team-coach-column-${column.position}`}
      data-state={column.state}
      data-eligible={column.eligibleNow}
      data-selected={selected}
      aria-label={teamPositionName(column.position)}
    >
      <button type="button" onClick={handleSelect} disabled={!column.eligibleNow} className={COLUMN_HEADER} data-testid={`team-coach-select-${column.position}`} aria-pressed={selected}>
        <PickNowBadge recommended={recommended} />
        <span className="text-caption font-semibold text-content-primary">{teamPositionTitle(column.position)}</span>
      </button>
      <UnrankedNote column={column} />
      <ColumnBody column={column} heroCatalog={heroCatalog} onPickHero={onPickHero} />
    </section>
  );
}

export interface TeamCoachBoardProps {
  board: TeamCoachBoardData | null;
  status: RequestStatus;
  heroCatalog: Map<number, HeroMeta>;
  /** The position the Player is looking at (simulator: the V4 viewed position; live: the manual-entry position). */
  selectedPosition: TeamPosition | null;
  onSelectPosition(position: TeamPosition): void;
  /** Absent -> the board is read-only (live mode while the game itself is the source of picks). */
  onPickHero?: (position: TeamPosition, heroId: number) => void;
  onRetry?: () => void;
}

function BoardPlaceholder({ status, onRetry }: { status: RequestStatus; onRetry?: () => void }) {
  if (status === "failed") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-caption text-signal-negative" role="alert" data-testid="team-coach-failed">
        <span>No se pudo calcular el Team Coach Board.</span>
        <RetryButton onRetry={onRetry} />
      </div>
    );
  }
  return <span className="text-caption text-content-muted" data-testid="team-coach-loading">Calculando recomendaciones para cada posición…</span>;
}

function RetryButton({ onRetry }: { onRetry?: () => void }) {
  if (!onRetry) return null;
  function handleRetry() {
    onRetry?.();
  }
  return (
    <button type="button" onClick={handleRetry} className="text-caption text-accent-primary hover:text-accent-primary-hover">
      Reintentar
    </button>
  );
}

export function TeamCoachBoard({ board, status, heroCatalog, selectedPosition, onSelectPosition, onPickHero, onRetry }: TeamCoachBoardProps) {
  return (
    <div className={BOARD_SHELL} data-testid="team-coach-board" data-state-identity={board?.stateIdentity ?? ""} data-status={status}>
      <span className="text-heading text-content-primary">Team Coach</span>
      <TeamCoachBoardContent board={board} status={status} heroCatalog={heroCatalog} selectedPosition={selectedPosition} onSelectPosition={onSelectPosition} onPickHero={onPickHero} onRetry={onRetry} />
    </div>
  );
}

function TeamCoachBoardContent({ board, status, heroCatalog, selectedPosition, onSelectPosition, onPickHero, onRetry }: TeamCoachBoardProps) {
  if (!board) return <BoardPlaceholder status={status} onRetry={onRetry} />;
  const recommended = board.currentDecision.recommendedPosition;
  return (
    <>
      <DecisionBanner board={board} heroCatalog={heroCatalog} />
      <div className={BOARD_GRID}>
        {board.positions.map((column) => (
          <Column
            key={column.position}
            column={column}
            heroCatalog={heroCatalog}
            onPickHero={onPickHero}
            recommended={column.position === recommended}
            selected={column.position === selectedPosition}
            onSelectPosition={onSelectPosition}
          />
        ))}
      </div>
    </>
  );
}
