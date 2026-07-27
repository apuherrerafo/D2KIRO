import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface DraftHeroSlotProps {
  heroId: number;
  heroMeta: HeroMeta | undefined;
  variant: "pick" | "ban";
  unconfirmed?: boolean;
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
export function DraftHeroSlot({ heroId, heroMeta, variant, unconfirmed = false }: DraftHeroSlotProps) {
  if (!heroMeta) {
    return <DraftHeroSlotUnknown heroId={heroId} variant={variant} />;
  }
  return (
    <div className={slotClassName(variant, unconfirmed)}>
      <HeroIcon imgUrl={heroMeta.imgUrl} alt={heroMeta.localizedName} size={56} />
      <span className="text-caption text-content-secondary">{heroMeta.localizedName}</span>
    </div>
  );
}
