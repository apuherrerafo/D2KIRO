"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { ActionPrimary } from "@/design/canonical/primitives/ActionPrimary";
import { BUTTON_GHOST, BUTTON_SECONDARY } from "@/features/draft/styles";
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
    <li className="ap-row">
      <div className="ap-row-main">
        <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={hero?.localizedName ?? `Héroe ${entry.hero}`} size={40} />
        <div className="ap-row-text">
          <span className="ap-row-name">{hero?.localizedName ?? `Héroe ${entry.hero}`}</span>
          <span className="ap-row-meta">{stats}</span>
        </div>
      </div>
    </li>
  );
}

// TSK-025 (§9.6): mensajes de los estados de "calcular", uno por rama -- early return, nunca un
// ternario eligiendo entre bloques de JSX distintos (regla dura de web.md).
export function CalculateStatusMessage({ status }: { status: CalculateStatus }) {
  if (status.kind === "idle") {
    return <p className="ap-hint">Aún no calculaste nada.</p>;
  }
  if (status.kind === "loading") {
    return (
      <p className="ap-loading" role="status">
        Calculando…
      </p>
    );
  }
  if (status.kind === "empty") {
    return (
      <AppNotice tone="info" title="Sin héroes suficientes">
        <p>Ningún héroe de tu historial reciente pasó el mínimo de partidas. Prueba ampliar la ventana o añadir a mano.</p>
      </AppNotice>
    );
  }
  if (status.kind === "invalid_account") {
    return (
      <AppNotice tone="error" title="No pudimos leer tu cuenta">
        <p>Cierra sesión y vuelve a entrar con Steam para reintentar.</p>
      </AppNotice>
    );
  }
  if (status.kind === "in_progress") {
    return (
      <AppNotice tone="warning" title="Ya hay un cálculo en curso">
        <p>Espera a que termine e intenta de nuevo.</p>
      </AppNotice>
    );
  }
  if (status.kind === "unavailable") {
    return (
      <AppNotice tone="error" title="OpenDota no respondió">
        <p>Tu pool guardado (si existe) sigue funcionando. Puedes intentar de nuevo más tarde.</p>
      </AppNotice>
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
    <section className="ap-block" aria-label="Propuesta de pool" data-testid="pool-proposal">
      <h3 className="ap-h3">
        Propuesta de {result.proposed.length} héroe(s), de {result.consideredHeroes} jugados en los últimos {result.windowDays} días
      </h3>

      <ul className="ap-list">
        {result.proposed.map((entry) => (
          <ProposedHeroRow key={entry.hero} entry={entry} hero={findHero(heroes, entry.hero)} />
        ))}
      </ul>

      <div className="ap-actions">
        <ActionPrimary onPress={onConfirm} status={isConfirming ? "busy" : "idle"} busyLabel="Guardando…">
          Confirmar tal cual
        </ActionPrimary>
        <button type="button" onClick={onEdit} className={BUTTON_SECONDARY}>
          Editar antes de confirmar
        </button>
        <button type="button" onClick={onDiscard} className={BUTTON_GHOST}>
          Descartar
        </button>
      </div>
    </section>
  );
}
