import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { BUTTON_PRIMARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { DraftSummary, HeroId } from "../types";

interface HeroRowProps {
  heroIds: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
  // TSK-217: ancla estable para el E2E. Sin esto, la prueba tendría que deducir qué fila es de
  // quién por su posición en el grid -- se rompería con cualquier retoque de maquetado y dejaría
  // de proteger lo que importa.
  testId?: string;
}

function HeroRow({ heroIds, heroCatalog, testId }: HeroRowProps) {
  return (
    <div className="flex flex-wrap gap-2" data-testid={testId}>
      {heroIds.map((heroId) => (
        <DraftHeroSlot key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} variant="pick" />
      ))}
    </div>
  );
}

interface RoundRowProps {
  round: number;
  userPicks: HeroId[];
  botPicks: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

function RoundRow({ round, userPicks, botPicks, heroCatalog }: RoundRowProps) {
  return (
    <div className="grid gap-3 rounded-md border border-surface-border bg-surface-overlay p-3 sm:grid-cols-[auto_1fr_1fr]">
      <span className="text-caption text-content-secondary">Ronda {round}</span>
      <HeroRow heroIds={userPicks} heroCatalog={heroCatalog} testId="summary-user-picks" />
      <HeroRow heroIds={botPicks} heroCatalog={heroCatalog} testId="summary-bot-picks" />
    </div>
  );
}

export interface SessionSummaryPanelProps {
  summary: DraftSummary;
  heroCatalog: Map<number, HeroMeta>;
  onNewDraft: () => void;
}

// <Dominio><Cosa>: resumen final de la Draft_Session (Req. 8.2) -- el draftSeed queda visible
// hasta que el usuario arranca una sesión nueva, tabla de picks por ronda (usuario vs. bot) y
// bans resueltos.
export function SessionSummaryPanel({ summary, heroCatalog, onNewDraft }: SessionSummaryPanelProps) {
  return (
    <div className="flex flex-col gap-4 rounded-lg border border-surface-border bg-surface-raised p-4">
      <div className="flex items-center justify-between">
        <span className="text-heading text-content-primary">Draft completo</span>
        <span className="rounded-md bg-surface-overlay px-3 py-1 font-mono text-caption tabular-nums text-content-primary">
          Seed: {summary.draftSeed}
        </span>
      </div>

      <div className="flex flex-col gap-2">
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_1fr] text-caption text-content-muted">
          <span />
          <span>Vos ({summary.userSide})</span>
          <span>Bot</span>
        </div>
        {summary.picksByRound.map((round, index) => (
          <RoundRow key={index} round={index + 1} userPicks={round.userPicks} botPicks={round.botPicks} heroCatalog={heroCatalog} />
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-caption text-content-secondary">Bans resueltos</span>
        <HeroRow heroIds={summary.resolvedBans} heroCatalog={heroCatalog} />
      </div>

      <button type="button" onClick={onNewDraft} className={`self-start ${BUTTON_PRIMARY}`}>
        Nuevo draft
      </button>
    </div>
  );
}
