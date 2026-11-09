"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { BUTTON_GHOST } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { EvidenceLimitedMark } from "@/features/team-coach/components/EvidenceLimitedMark";
import type { PreviewStatus } from "../use-captains-mode-session";
import type { CaptainsModeBanCard, CaptainsModeOutput } from "../cm-client";
import { HeroCardView } from "../../random-draft-simulator/components/CoachPanel";

// Contrato de elegibilidad en Captains Mode (dueño del producto, 2026-11-04). Este panel solo pinta lo que el MOTOR ya filtró (`format=cm`):
// héroes con un fundamento verificable, cada uno con su fuerza. No hay cuerpo V2 crudo (ni "posición y momento del pick", ni confianza de V6, ni
// duplas/columnas), ni lista de relleno, ni mensaje de "sin candidatos": sin elegibles, el panel no muestra héroes. Solo el héroe que el motor marca
// como recomendado (evidencia FUERTE) se destaca; la evidencia débil aparece con "Evidencia limitada" y nunca como la acción principal.

function heroName(heroId: number, heroCatalog: Map<number, HeroMeta>): string {
  return heroCatalog.get(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

const CARD_BASE = "flex flex-col gap-1 rounded-lg border p-2";
const CARD_PRIMARY = `${CARD_BASE} border-accent-primary bg-surface-raised`;
const CARD_REGULAR = `${CARD_BASE} border-surface-border bg-surface-overlay`;
const REASON = "text-caption text-content-secondary";

interface PreviewNoticeProps {
  previewStatus: PreviewStatus;
  onRetry: () => void;
}

// Nunca "Calculando…" para siempre: solo mientras de verdad se calcula. Con la respuesta ya lista (aunque no traiga ningún héroe) no hay aviso.
function PreviewNotice({ previewStatus, onRetry }: PreviewNoticeProps) {
  if (previewStatus === "failed") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-signal-negative bg-surface-raised p-3">
        <span className="text-caption text-signal-negative">No se pudo calcular la recomendación.</span>
        <button type="button" onClick={onRetry} className={BUTTON_GHOST}>
          Reintentar
        </button>
      </div>
    );
  }
  if (previewStatus === "loading") return <span className="text-caption text-content-muted">Calculando recomendación...</span>;
  return null;
}

interface BanCardViewProps {
  card: CaptainsModeBanCard;
  heroCatalog: Map<number, HeroMeta>;
  isPrimary: boolean;
}

function BanReasons({ card, heroCatalog }: { card: CaptainsModeBanCard; heroCatalog: Map<number, HeroMeta> }) {
  return (
    <>
      {card.beatsYourPicks.map((entry) => (
        <span key={`beats-${entry.vsHeroId}`} className={REASON} data-testid="cm-ban-beats">
          Le gana a tu {heroName(entry.vsHeroId, heroCatalog)}: {entry.why}
        </span>
      ))}
      {card.pairsWithTheirPicks.map((entry) => (
        <span key={`pair-${entry.withHeroId}`} className={REASON} data-testid="cm-ban-pair">
          Hace pareja con el {heroName(entry.withHeroId, heroCatalog)} del rival: {entry.why}
        </span>
      ))}
    </>
  );
}

function RecommendedMark({ isPrimary }: { isPrimary: boolean }) {
  if (!isPrimary) return null;
  return <span className="text-caption font-semibold text-accent-primary" data-testid="recommended-mark">Ban recomendado</span>;
}

function BanCardView({ card, heroCatalog, isPrimary }: BanCardViewProps) {
  const meta = heroCatalog.get(card.heroId);
  return (
    <li className={isPrimary ? CARD_PRIMARY : CARD_REGULAR} data-testid="cm-ban-card" data-hero-id={card.heroId}>
      <RecommendedMark isPrimary={isPrimary} />
      <div className="flex items-center gap-2">
        <HeroIcon imgUrl={meta?.imgUrl ?? ""} alt={heroName(card.heroId, heroCatalog)} size={40} />
        <span className="text-body font-semibold text-content-primary">{heroName(card.heroId, heroCatalog)}</span>
      </div>
      <EvidenceLimitedMark strength={card.evidenceStrength} />
      <BanReasons card={card} heroCatalog={heroCatalog} />
    </li>
  );
}

function BanList({ output, heroCatalog }: { output: CaptainsModeOutput; heroCatalog: Map<number, HeroMeta> }) {
  if (output.actionKind !== "BAN" || output.bans.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-2" data-testid="cm-ban-list">
      {output.bans.map((card) => (
        <BanCardView key={card.heroId} card={card} heroCatalog={heroCatalog} isPrimary={card.heroId === output.primaryHeroId} />
      ))}
    </ul>
  );
}

function PickList({ output, heroCatalog }: { output: CaptainsModeOutput; heroCatalog: Map<number, HeroMeta> }) {
  if (output.actionKind !== "PICK" || output.picks.length === 0) return null;
  return (
    <ul className="grid grid-cols-1 gap-2" data-testid="cm-pick-list">
      {output.picks.map((card) => (
        <HeroCardView key={card.heroId} card={card} heroCatalog={heroCatalog} isPrimary={card.heroId === output.primaryHeroId} />
      ))}
    </ul>
  );
}

export interface CaptainsModeCopilotProps {
  output: CaptainsModeOutput | null;
  heroCatalog: Map<number, HeroMeta>;
  previewStatus: PreviewStatus;
  onRetry: () => void;
}

export function CaptainsModeCopilot({ output, heroCatalog, previewStatus, onRetry }: CaptainsModeCopilotProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4" data-testid="copilot-panel">
      <span className="text-heading text-content-primary">Copilot</span>
      <PreviewNotice previewStatus={previewStatus} onRetry={onRetry} />
      {output && <BanList output={output} heroCatalog={heroCatalog} />}
      {output && <PickList output={output} heroCatalog={heroCatalog} />}
    </div>
  );
}
