import { DraftHeroSlot } from "@/components/draft-hero-slot/DraftHeroSlot";
import type { DraftState, HeroId } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface TeamColumnProps {
  title: string;
  heroIds: HeroId[];
  heroCatalog: Map<number, HeroMeta>;
  unconfirmedIds: Set<HeroId>;
}

function TeamColumn({ title, heroIds, heroCatalog, unconfirmedIds }: TeamColumnProps) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-heading text-content-primary">{title}</span>
      <div className="flex flex-wrap gap-2">
        {heroIds.map((heroId) => (
          <DraftHeroSlot
            key={heroId}
            heroId={heroId}
            heroMeta={heroCatalog.get(heroId)}
            variant="pick"
            unconfirmed={unconfirmedIds.has(heroId)}
          />
        ))}
      </div>
    </div>
  );
}

interface DraftBoardProps {
  draftState: DraftState;
  heroCatalog: Map<number, HeroMeta>;
}

// <Dominio><Cosa>: tablero completo de picks/bans con íconos oficiales — siempre visible en los
// estados `activo`/`degradado`/`completo`.
export function DraftBoard({ draftState, heroCatalog }: DraftBoardProps) {
  const unconfirmedIds = new Set(draftState.quality.unconfirmed);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="text-heading text-content-primary">Bans</span>
        <div className="flex flex-wrap gap-2">
          {draftState.banned.map((heroId) => (
            <DraftHeroSlot key={heroId} heroId={heroId} heroMeta={heroCatalog.get(heroId)} variant="ban" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-6">
        <TeamColumn title="Radiant" heroIds={draftState.picks.radiant} heroCatalog={heroCatalog} unconfirmedIds={unconfirmedIds} />
        <TeamColumn title="Dire" heroIds={draftState.picks.dire} heroCatalog={heroCatalog} unconfirmedIds={unconfirmedIds} />
      </div>
    </div>
  );
}
