import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { HeroId } from "../types";

export interface BanPhasePanelProps {
  resolvedBans: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

// <Dominio><Cosa>: vista de solo lectura de los bans resueltos. En Ranked All Pick los bans no
// pertenecen a un lado y su cantidad es variable (los resuelve la BanResolutionPolicy del motor a
// partir de las preferencias de los 10 participantes), así que se muestran juntos, sin asignarlos a
// Radiant/Dire. Puramente presentacional: la data llega del store ya resuelta.
export function BanPhasePanel({ resolvedBans, heroCatalog }: BanPhasePanelProps) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4" data-testid="resolved-bans">
      <span className="text-heading text-content-primary">Bans resueltos ({resolvedBans.length})</span>
      <div className="flex flex-wrap gap-2">
        {resolvedBans.map((heroId) => (
          <DraftHeroSlot key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} variant="ban" />
        ))}
      </div>
    </div>
  );
}
