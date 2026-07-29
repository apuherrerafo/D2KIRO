"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { BUTTON_GHOST, BUTTON_PRIMARY, BUTTON_SECONDARY } from "@/features/draft/styles";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { CalculatePoolResult, CalculateStatus, HeroPoolEntry } from "./types";

function findHero(heroes: HeroMeta[], id: number): HeroMeta | undefined {
  return heroes.find((hero) => hero.id === id);
}

interface ProposedHeroRowProps {
  entry: HeroPoolEntry;
  hero: HeroMeta | undefined;
}

function ProposedHeroRow({ entry, hero }: ProposedHeroRowProps) {
  const stats =
    entry.personalWinrate === null
      ? "Sin winrate registrado"
      : `${(entry.personalWinrate * 100).toFixed(0)}% en ${entry.personalGames} partidas`;

  return (
    <div className="flex items-center gap-3 rounded-lg border border-surface-border bg-surface-overlay p-3">
      <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${entry.hero}`} size={40} />
      <div className="flex flex-col">
        <span className="text-body text-content-primary">{hero?.localizedName ?? `Héroe ${entry.hero}`}</span>
        <span className="text-caption text-content-muted">{stats}</span>
      </div>
    </div>
  );
}

// TSK-025 (§9.6): mensajes de los estados de "calcular", uno por rama -- early return, nunca un
// ternario eligiendo entre bloques de JSX distintos (regla dura de web.md).
export function CalculateStatusMessage({ status }: { status: CalculateStatus }) {
  if (status.kind === "idle") {
    return <span className="text-caption text-content-muted">Aún no calculaste nada.</span>;
  }
  if (status.kind === "loading") {
    return <span className="text-caption text-content-muted">Calculando...</span>;
  }
  if (status.kind === "empty") {
    return (
      <span className="text-caption text-content-muted">
        Ningún héroe de tu historial reciente pasó el mínimo de partidas -- probá ampliar la ventana o añadir a mano.
      </span>
    );
  }
  if (status.kind === "invalid_account") {
    return <span className="text-caption text-signal-negative">Ese account_id no parece válido -- revisá que sean solo números.</span>;
  }
  if (status.kind === "in_progress") {
    return <span className="text-caption text-signal-warning">Ya hay un cálculo en curso -- esperá a que termine e intentá de nuevo.</span>;
  }
  if (status.kind === "unavailable") {
    return (
      <span className="text-caption text-signal-negative">
        OpenDota no respondió. Tu pool guardado (si existe) sigue funcionando -- podés intentar de nuevo más tarde.
      </span>
    );
  }
  return null; // "proposal": HeroPoolProposalReview la reemplaza por completo, ver abajo.
}

interface HeroPoolProposalReviewProps {
  result: CalculatePoolResult;
  heroes: HeroMeta[];
  onConfirm: () => void;
  onEdit: () => void;
  onDiscard: () => void;
  isConfirming: boolean;
}

// <Dominio><Cosa>: revisión de la propuesta calculada (TSK-025, §9.6). Tres acciones explícitas,
// ninguna implícita -- la propuesta nunca se auto-aplica. "Descartar" no llama a ningún endpoint,
// el pool guardado queda exactamente como estaba.
export function HeroPoolProposalReview({ result, heroes, onConfirm, onEdit, onDiscard, isConfirming }: HeroPoolProposalReviewProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-accent-primary bg-surface-raised p-4">
      <span className="text-body text-content-primary">
        Propuesta de {result.proposed.length} héroe(s) -- de {result.consideredHeroes} jugados en los últimos {result.windowDays} días.
      </span>

      <div className="flex flex-col gap-2">
        {result.proposed.map((entry) => (
          <ProposedHeroRow key={entry.hero} entry={entry} hero={findHero(heroes, entry.hero)} />
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onConfirm} disabled={isConfirming} className={BUTTON_PRIMARY}>
          Confirmar tal cual
        </button>
        <button type="button" onClick={onEdit} className={BUTTON_SECONDARY}>
          Editar antes de confirmar
        </button>
        <button type="button" onClick={onDiscard} className={BUTTON_GHOST}>
          Descartar
        </button>
      </div>
    </div>
  );
}
