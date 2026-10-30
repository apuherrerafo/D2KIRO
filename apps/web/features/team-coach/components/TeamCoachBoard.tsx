"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { ADVISORY_NOTE, BANNER_LABEL, DETERMINISTIC_DEFAULT_NOTE, LIVE_DRAFT_ENDED_NOTE, LIVE_DRAFT_ENDED_TITLE, PHASE_FALLBACK_NOTE, PICK_HINT, PICK_NOW_LABEL, WHY_LABEL, teamPositionName, teamPositionTitle } from "../constants";
import {
  BOARD_GRID,
  BOARD_SHELL,
  CANDIDATE_BUTTON,
  CANDIDATE_HEAD,
  CANDIDATE_OPENED,
  CANDIDATE_REASON,
  CANDIDATE_RISK,
  CANDIDATE_STILL_FREE,
  CANDIDATE_STRENGTH,
  CANDIDATE_ROW,
  COLUMN_DEFAULT,
  COLUMN_HEADER,
  COLUMN_RECOMMENDED,
  COLUMN_SELECTED,
  LIST_HEADING,
  DECISION_BANNER,
  PICK_NOW_BADGE,
  PLAN_BADGE,
  PRIMARY_BUTTON,
} from "../styles";
import type { RequestStatus, TeamCoachBoardData, TeamCoachCandidate, TeamCoachColumn, TeamCoachCounterNote, TeamCoachStrength, TeamPosition } from "../types";

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
  /** Ausente -> tablero de sólo lectura: no hay botón de elegir ni pista de "toca un héroe". */
  onPickHero?: (position: TeamPosition, heroId: number) => void;
}

function DecisionBannerHero({ board, heroCatalog }: DecisionBannerProps) {
  const heroId = board.currentDecision.recommendedHeroId;
  if (heroId === null) return null;
  return <HeroLabel heroId={heroId} heroCatalog={heroCatalog} size={32} />;
}

function DefaultBasisNote({ board }: { board: TeamCoachBoardData }) {
  if (board.currentDecision.actionablePositions.length < 2) return null;
  if (board.currentDecision.targetBasis === "PHASE_FALLBACK") return <span className="text-caption text-content-muted" data-testid="team-coach-phase-fallback">{PHASE_FALLBACK_NOTE}</span>;
  if (board.currentDecision.targetBasis !== "DETERMINISTIC_DEFAULT") return null;
  return <span className="text-caption text-content-muted">{DETERMINISTIC_DEFAULT_NOTE}</span>;
}

interface PickRecommendedButtonProps {
  position: TeamPosition;
  heroId: number;
  heroCatalog: Map<number, HeroMeta>;
  onPickHero(position: TeamPosition, heroId: number): void;
}

// La recomendación es una acción, no sólo un texto: un clic elige al héroe recomendado en su posición.
// El nombre accesible NO empieza con "Elegir " a propósito: ese prefijo lo usan los botones de cada
// candidato de las columnas (uno por héroe), y esta es la misma acción, no un candidato más.
function PickRecommendedButton({ position, heroId, heroCatalog, onPickHero }: PickRecommendedButtonProps) {
  function handlePick() {
    onPickHero(position, heroId);
  }
  const name = heroName(heroId, heroCatalog);
  return (
    <button type="button" onClick={handlePick} className={PRIMARY_BUTTON} aria-label={`Elige a ${name} como ${teamPositionName(position)}`} data-testid="team-coach-pick-recommended">
      Elige a {name}
    </button>
  );
}

function DecisionAction({ board, heroCatalog, onPickHero }: DecisionBannerProps) {
  const { recommendedPosition: position, recommendedHeroId: heroId } = board.currentDecision;
  const column = board.positions.find((entry) => entry.position === position);
  if (!onPickHero || position === null || heroId === null || column?.eligibleNow !== true) return null;
  return <PickRecommendedButton position={position} heroId={heroId} heroCatalog={heroCatalog} onPickHero={onPickHero} />;
}

function PickHint({ onPickHero }: { onPickHero: DecisionBannerProps["onPickHero"] }) {
  if (!onPickHero) return null;
  return <span className="text-caption text-content-muted">{PICK_HINT}</span>;
}

// La teoría del motor ("conviene revelar primero lo que menos información le da al rival…") sigue
// disponible, pero detrás de "¿Por qué?": lo primero que se lee es qué hacer, no el porqué.
function DecisionWhy({ board }: { board: TeamCoachBoardData }) {
  return (
    <details className="text-caption text-content-secondary" data-testid="team-coach-why">
      <summary className="w-fit text-content-muted hover:text-content-primary">{WHY_LABEL}</summary>
      <div className="flex flex-col gap-1 pt-1">
        <span data-testid="team-coach-reason">{board.currentDecision.reason}</span>
        <DefaultBasisNote board={board} />
        <span className="text-content-muted">{ADVISORY_NOTE}</span>
      </div>
    </details>
  );
}

function DecisionBanner({ board, heroCatalog, onPickHero }: DecisionBannerProps) {
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-caption font-semibold text-accent-primary">{BANNER_LABEL} · {teamPositionName(position)}</span>
        <span className="text-body text-content-primary">
          <DecisionBannerHero board={board} heroCatalog={heroCatalog} />
        </span>
        <DecisionAction board={board} heroCatalog={heroCatalog} onPickHero={onPickHero} />
      </div>
      <PickHint onPickHero={onPickHero} />
      <DecisionWhy board={board} />
    </div>
  );
}

interface CandidateProps {
  position: TeamPosition;
  candidate: TeamCoachCandidate;
  heroCatalog: Map<number, HeroMeta>;
  onPickHero?: (position: TeamPosition, heroId: number) => void;
  canPick: boolean;
  /** La razón por héroe solo se muestra cuando el ranking es propio de cada uno (columna RANKED). */
  showReason: boolean;
  /** testid del ítem: la lista del pool usa el suyo para que la auditoría (Flight Recorder) compare solo la general. */
  testId?: string;
}

interface CandidateDetailProps {
  candidate: TeamCoachCandidate;
  heroCatalog: Map<number, HeroMeta>;
  showReason: boolean;
}

function visibleReason(candidate: TeamCoachCandidate, showReason: boolean): string {
  if (!showReason) return "";
  return candidate.reasons[0] ?? "";
}

function CandidateReason({ text }: { text: string }) {
  if (text === "") return null;
  return <span className={CANDIDATE_REASON} data-testid="team-coach-candidate-reason">{text}</span>;
}

function CandidateRisks({ candidate, heroCatalog }: { candidate: TeamCoachCandidate; heroCatalog: Map<number, HeroMeta> }) {
  const risks = candidate.risks ?? [];
  return (
    <>
      {risks.map((risk) => (
        <span key={risk.vsHeroId} className={CANDIDATE_RISK} data-testid="team-coach-candidate-risk">
          Riesgo ({heroName(risk.vsHeroId, heroCatalog)} te counterea): {risk.why}
        </span>
      ))}
    </>
  );
}

const STRENGTH_LABELS: Record<TeamCoachStrength["level"], string> = { hard: "Fuerte contra", medium: "Ventaja posible contra" };

// "Axe", "Axe y Lion", "Axe, Lion y Ancient Apparition".
function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

function namesOf(notes: readonly TeamCoachCounterNote[], heroCatalog: Map<number, HeroMeta>): string {
  return joinNames(notes.map((note) => heroName(note.heroId, heroCatalog)));
}

// A quién de lo que el rival YA tiene le gana este héroe. Solo hechos del draft: nunca se supone lo que va a sacar.
function CandidateStrengths({ candidate, heroCatalog }: { candidate: TeamCoachCandidate; heroCatalog: Map<number, HeroMeta> }) {
  const [first] = candidate.strengths ?? [];
  if (!first) return null;
  return (
    <span className={CANDIDATE_STRENGTH} data-testid="team-coach-candidate-strength">
      {STRENGTH_LABELS[first.level]} {heroName(first.vsHeroId, heroCatalog)} (ya está en el rival): {first.why}
    </span>
  );
}

function pluralize(count: number, one: string, many: string): string {
  if (count === 1) return one;
  return many;
}

// Lo que los bans visibles abrieron para este héroe (sus counters baneados) y el riesgo que queda a ciegas (los que siguen
// libres). Se muestra solo si algo se abrió: sin counters baneados no hay nada que decir.
function CandidateOpening({ candidate, heroCatalog }: { candidate: TeamCoachCandidate; heroCatalog: Map<number, HeroMeta> }) {
  const opening = candidate.opening;
  if (!opening) return null;
  if (opening.openedBy.length === 0) return <HardCounterStillFree opening={opening} heroCatalog={heroCatalog} />;
  return (
    <>
      <span className={CANDIDATE_OPENED} data-testid="team-coach-candidate-opened">
        Se abre: {namesOf(opening.openedBy, heroCatalog)}, que lo {pluralize(opening.openedBy.length, "counterea", "counterean")}, {pluralize(opening.openedBy.length, "está baneado", "están baneados")}.
      </span>
      {opening.stillFree.length > 0 && (
        <span className={CANDIDATE_STILL_FREE} data-testid="team-coach-candidate-still-free">
          Ojo: {namesOf(opening.stillFree, heroCatalog)} {pluralize(opening.stillFree.length, "también lo counterea y sigue libre", "también lo counterean y siguen libres")}.
        </span>
      )}
    </>
  );
}

// Los bans tocaron sus counters, pero le queda uno FUERTE libre: lo primero que tienes que saber antes de pickearlo a ciegas.
function HardCounterStillFree({ opening, heroCatalog }: { opening: NonNullable<TeamCoachCandidate["opening"]>; heroCatalog: Map<number, HeroMeta> }) {
  if (opening.stillFree.length === 0) return null;
  return (
    <span className={CANDIDATE_STILL_FREE} data-testid="team-coach-candidate-still-free">
      Ojo: {namesOf(opening.stillFree, heroCatalog)} {pluralize(opening.stillFree.length, "lo counterea fuerte y sigue libre", "lo counterean fuerte y siguen libres")}.
    </span>
  );
}

// Parejas con aliados que YA elegiste (nunca con uno hipotético).
function CandidateSynergies({ candidate, heroCatalog }: { candidate: TeamCoachCandidate; heroCatalog: Map<number, HeroMeta> }) {
  const [first] = candidate.synergies ?? [];
  if (!first) return null;
  // El motivo del motor ya puede ser "Sinergia con X: ..."; la misma pareja no se dice dos veces en la tarjeta.
  if ((candidate.reasons[0] ?? "").startsWith(`Sinergia con ${heroName(first.withHeroId, heroCatalog)}`)) return null;
  return (
    <span className={CANDIDATE_STRENGTH} data-testid="team-coach-candidate-synergy">
      Combina con tu {heroName(first.withHeroId, heroCatalog)}: {first.why}
    </span>
  );
}

// El porqué de cada héroe, contra quién gana y los rivales que lo counterean, a la vista (antes solo en un tooltip).
function CandidateDetail({ candidate, heroCatalog, showReason }: CandidateDetailProps) {
  return (
    <>
      <CandidateReason text={visibleReason(candidate, showReason)} />
      <CandidateOpening candidate={candidate} heroCatalog={heroCatalog} />
      <CandidateStrengths candidate={candidate} heroCatalog={heroCatalog} />
      <CandidateSynergies candidate={candidate} heroCatalog={heroCatalog} />
      <CandidateRisks candidate={candidate} heroCatalog={heroCatalog} />
    </>
  );
}

function CandidateHead({ candidate, heroCatalog }: { candidate: TeamCoachCandidate; heroCatalog: Map<number, HeroMeta> }) {
  return (
    <span className={CANDIDATE_HEAD}>
      <span className="text-content-muted">{candidate.rank}.</span>
      <HeroLabel heroId={candidate.heroId} heroCatalog={heroCatalog} size={28} />
      <PlanBadge candidate={candidate} />
    </span>
  );
}

function PlanBadge({ candidate }: { candidate: TeamCoachCandidate }) {
  if (!candidate.isPrimary) return null;
  return <span className={PLAN_BADGE}>plan</span>;
}

function CandidateItem({ position, candidate, heroCatalog, onPickHero, canPick, showReason, testId = "team-coach-candidate" }: CandidateProps) {
  function handlePick() {
    onPickHero?.(position, candidate.heroId);
  }
  const reason = candidate.reasons[0] ?? "";
  const common = { "data-testid": testId, "data-hero-id": candidate.heroId, "data-primary": candidate.isPrimary, title: reason };
  if (!canPick || !onPickHero) {
    return (
      <li className={CANDIDATE_ROW} {...common}>
        <CandidateHead candidate={candidate} heroCatalog={heroCatalog} />
        <CandidateDetail candidate={candidate} heroCatalog={heroCatalog} showReason={showReason} />
      </li>
    );
  }
  return (
    <li>
      <button type="button" onClick={handlePick} className={CANDIDATE_BUTTON} aria-label={`Elegir ${heroName(candidate.heroId, heroCatalog)} como ${teamPositionName(position)}`} {...common}>
        <CandidateHead candidate={candidate} heroCatalog={heroCatalog} />
        <CandidateDetail candidate={candidate} heroCatalog={heroCatalog} showReason={showReason} />
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
    <>
      <PoolList column={column} heroCatalog={heroCatalog} onPickHero={onPickHero} />
      <GeneralHeading column={column} />
      <CandidateList column={column} candidates={column.top} heroCatalog={heroCatalog} onPickHero={onPickHero} />
    </>
  );
}

interface CandidateListProps extends ColumnBodyProps {
  candidates: TeamCoachCandidate[];
  itemTestId?: string;
}

function CandidateList({ column, candidates, heroCatalog, onPickHero, itemTestId }: CandidateListProps) {
  return (
    <ol className="flex flex-col gap-1">
      {candidates.map((candidate) => (
        <CandidateItem key={candidate.heroId} position={column.position} candidate={candidate} heroCatalog={heroCatalog} onPickHero={onPickHero} canPick={column.eligibleNow} showReason={column.state === "RANKED"} testId={itemTestId} />
      ))}
    </ol>
  );
}

// La lista del pool de la posición (el tuyo o el de tu compañero) va aparte de la general: puede repetir héroes que también salen abajo, y no se mezclan.
function PoolList({ column, heroCatalog, onPickHero }: ColumnBodyProps) {
  const pool = column.poolTop ?? [];
  if (pool.length === 0) return null;
  return (
    <div className="flex flex-col gap-1" data-testid="team-coach-pool-list">
      <span className={LIST_HEADING}>Del pool</span>
      <CandidateList column={column} candidates={pool} heroCatalog={heroCatalog} onPickHero={onPickHero} itemTestId="team-coach-pool-candidate" />
    </div>
  );
}

// El encabezado "En general" solo aparece cuando hay lista de pool encima: sin pool, la columna queda como siempre.
function GeneralHeading({ column }: { column: TeamCoachColumn }) {
  if ((column.poolTop ?? []).length === 0) return null;
  return <span className={LIST_HEADING}>En general</span>;
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
  /**
   * Live Dota: the draft is over (the game left hero selection). The board keeps the last reading as
   * REFERENCE only: no "PICK NOW", no recommended position, nothing pickable -- there is no pick to make.
   */
  draftEnded?: boolean;
}

function DraftEndedBanner() {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-surface-border bg-surface-overlay p-3" role="status" data-testid="team-coach-draft-ended">
      <span className="text-caption font-semibold text-content-secondary">{LIVE_DRAFT_ENDED_TITLE}</span>
      <span className="text-caption text-content-muted">{LIVE_DRAFT_ENDED_NOTE}</span>
    </div>
  );
}

function BoardBanner({ board, heroCatalog, draftEnded, onPickHero }: DecisionBannerProps & { draftEnded: boolean }) {
  if (draftEnded) return <DraftEndedBanner />;
  return <DecisionBanner board={board} heroCatalog={heroCatalog} onPickHero={onPickHero} />;
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

export function TeamCoachBoard({ board, status, heroCatalog, selectedPosition, onSelectPosition, onPickHero, onRetry, draftEnded = false }: TeamCoachBoardProps) {
  return (
    <div className={BOARD_SHELL} data-testid="team-coach-board" data-state-identity={board?.stateIdentity ?? ""} data-status={status}>
      <span className="text-heading text-content-primary">Team Coach</span>
      <TeamCoachBoardContent board={board} status={status} heroCatalog={heroCatalog} selectedPosition={selectedPosition} onSelectPosition={onSelectPosition} onPickHero={onPickHero} onRetry={onRetry} draftEnded={draftEnded} />
    </div>
  );
}

function TeamCoachBoardContent({ board, status, heroCatalog, selectedPosition, onSelectPosition, onPickHero, onRetry, draftEnded }: TeamCoachBoardProps) {
  if (draftEnded && !board) return <DraftEndedBanner />;
  if (!board) return <BoardPlaceholder status={status} onRetry={onRetry} />;
  // Draft over: the last reading stays as reference, with no recommended position and nothing to pick.
  const recommended = draftEnded ? null : board.currentDecision.recommendedPosition;
  const pickHero = draftEnded ? undefined : onPickHero;
  return (
    <>
      <BoardBanner board={board} heroCatalog={heroCatalog} draftEnded={draftEnded === true} onPickHero={pickHero} />
      <div className={BOARD_GRID}>
        {board.positions.map((column) => (
          <Column
            key={column.position}
            column={column}
            heroCatalog={heroCatalog}
            onPickHero={pickHero}
            recommended={column.position === recommended}
            selected={column.position === selectedPosition}
            onSelectPosition={onSelectPosition}
          />
        ))}
      </div>
    </>
  );
}
