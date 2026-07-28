"use client";

import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { useDraftStore } from "@/features/draft/store";
import { BUTTON_GHOST } from "@/features/draft/styles";
import type { TeamSide } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface DraftHeroSlotProps {
  heroId: number;
  heroMeta: HeroMeta | undefined;
  variant: "pick" | "ban";
  side?: TeamSide; // requerido para corregir un pick -- los bans no llevan side en DraftState
  unconfirmed?: boolean;
}

interface CorrectButtonProps {
  heroId: number;
  side: TeamSide;
}

// Acción táctil para corregir un pick/ban de confianza baja (regla dura del ticket) -- usa
// pick_reverted vía el store, disponible aquí sin pasar el handler por props.
function CorrectButton({ heroId, side }: CorrectButtonProps) {
  const correctHero = useDraftStore((s) => s.correctHero);

  function handleClick() {
    void correctHero(heroId, side);
  }

  return (
    <button type="button" onClick={handleClick} className={BUTTON_GHOST}>
      Corregir
    </button>
  );
}

function DraftHeroSlotUnknown({ heroId, variant }: { heroId: number; variant: "pick" | "ban" }) {
  return (
    <div className={slotClassName(variant, false)}>
      <div
        role="img"
        aria-label={`Héroe ${heroId} (sin datos de catálogo)`}
        className="flex h-14 w-14 items-center justify-center rounded-md border border-surface-border bg-surface-overlay text-content-muted text-caption"
      >
        #{heroId}
      </div>
      <span className="text-caption text-content-muted">Sin datos</span>
    </div>
  );
}

function slotClassName(variant: "pick" | "ban", unconfirmed: boolean): string {
  const base = "flex flex-col items-center gap-1 rounded-lg p-2";
  const variantClass = variant === "ban" ? "opacity-60 grayscale" : "";
  const unconfirmedClass = unconfirmed ? "ring-2 ring-signal-warning" : "";
  return [base, variantClass, unconfirmedClass].filter(Boolean).join(" ");
}

// <Dominio><Cosa>: un slot de héroe en el tablero de draft (pick o ban), marcado si viene sin
// confirmar de la captura (confianza baja) -- nunca se calla esa información (SPEC §S1).
export function DraftHeroSlot({ heroId, heroMeta, variant, side = "radiant", unconfirmed = false }: DraftHeroSlotProps) {
  if (!heroMeta) {
    return <DraftHeroSlotUnknown heroId={heroId} variant={variant} />;
  }
  return (
    <div className={slotClassName(variant, unconfirmed)}>
      <HeroIcon imgUrl={heroMeta.imgUrl} alt={heroMeta.localizedName} size={56} />
      <span className="text-caption text-content-secondary">{heroMeta.localizedName}</span>
      {unconfirmed && <CorrectButton heroId={heroId} side={side} />}
    </div>
  );
}
