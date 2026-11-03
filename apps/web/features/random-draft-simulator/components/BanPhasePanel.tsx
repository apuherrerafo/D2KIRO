import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { HeroId } from "../types";

export interface BanPhasePanelProps {
  resolvedBans: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
  /** Una sola fila de íconos chicos: pensada para quedarse fija arriba durante las rondas. */
  compact?: boolean;
}

const COMPACT_BAN_ICON_SIZE = 24;

interface CompactBanProps {
  heroId: HeroId;
  heroMeta: HeroMeta | undefined;
}

// Cada ban lleva su nombre como texto para lector de pantalla y como tooltip: en 24 px el ícono solo no alcanza.
function CompactBan({ heroId, heroMeta }: CompactBanProps) {
  const name = heroMeta?.localizedName ?? `Héroe ${heroId}`;
  return (
    <span title={name} className="flex-none opacity-60 grayscale">
      <HeroIcon imgUrl={heroMeta?.imgUrl ?? ""} alt={name} size={COMPACT_BAN_ICON_SIZE} />
      <span className="sr-only">{name}</span>
    </span>
  );
}

function CompactBanRow({ resolvedBans, heroCatalog }: BanPhasePanelProps) {
  return (
    <div className="flex flex-wrap items-center gap-1 bg-surface-raised px-4 py-1" data-testid="resolved-bans">
      <span className="mr-2 text-caption text-content-muted">Bans resueltos ({resolvedBans.length})</span>
      {resolvedBans.map((heroId) => (
        <CompactBan key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} />
      ))}
    </div>
  );
}

// <Dominio><Cosa>: vista de solo lectura de los bans resueltos. En Ranked All Pick los bans no
// pertenecen a un lado y su cantidad es variable (los resuelve la BanResolutionPolicy del motor a
// partir de las preferencias de los 10 participantes), así que se muestran juntos, sin asignarlos a
// Radiant/Dire. Puramente presentacional: la data llega del store ya resuelta.
export function BanPhasePanel({ resolvedBans, heroCatalog, compact = false }: BanPhasePanelProps) {
  if (compact) return <CompactBanRow resolvedBans={resolvedBans} heroCatalog={heroCatalog} />;
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
