import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { HeroId } from "../types";

interface BanColumnProps {
  title: string;
  bans: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

function BanColumn({ title, bans, heroCatalog }: BanColumnProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption text-content-secondary">{title}</span>
      <div className="flex flex-wrap gap-2">
        {bans.map((heroId) => (
          <DraftHeroSlot key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} variant="ban" />
        ))}
      </div>
    </div>
  );
}

export interface BanPhasePanelProps {
  resolvedBans: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
}

// <Dominio><Cosa>: vista de solo lectura de los 16 bans resueltos (Req. 2.1), agrupados por
// lado -- el lado alterna por índice (0 -> Radiant, 1 -> Dire, ...), mismo orden en que se
// emitieron al motor (Req. 2.4). Puramente presentacional: la data llega del store ya resuelta.
export function BanPhasePanel({ resolvedBans, heroCatalog }: BanPhasePanelProps) {
  const radiantBans = resolvedBans.filter((_, index) => index % 2 === 0);
  const direBans = resolvedBans.filter((_, index) => index % 2 === 1);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-heading text-content-primary">Bans resueltos</span>
      <div className="grid gap-4 sm:grid-cols-2">
        <BanColumn title="Radiant" bans={radiantBans} heroCatalog={heroCatalog} />
        <BanColumn title="Dire" bans={direBans} heroCatalog={heroCatalog} />
      </div>
    </div>
  );
}
