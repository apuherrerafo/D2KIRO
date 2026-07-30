import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import type { DraftTeamGroup } from "@/features/team-groups/types";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface PartyPoolPanelProps {
  partyContext: DraftTeamGroup | null;
  draftState: DraftState;
  heroCatalog: Map<number, HeroMeta>;
}

function heroLabel(hero: HeroMeta | undefined, heroId: number): string {
  if (hero) return hero.localizedName;
  return `Héroe ${heroId}`;
}

export function PartyPoolPanel({ partyContext, draftState, heroCatalog }: PartyPoolPanelProps) {
  if (!partyContext || partyContext.members.length === 0) return null;

  const banned = new Set(draftState.banned);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface-raised p-4">
      <span className="text-body text-content-primary">{partyContext.name || "Party actual"}</span>
      {partyContext.members.map((member) => (
        <div key={member.slot} className="flex flex-col gap-2">
          <span className="text-caption text-content-secondary">{member.name || `Compañero ${member.slot}`}</span>
          <div className="flex flex-wrap gap-2">
            {member.heroPool.map((heroId) => {
              const hero = heroCatalog.get(heroId);
              const isBanned = banned.has(heroId);
              const stateClass = isBanned ? "border-signal-negative text-signal-negative opacity-60" : "border-surface-border text-content-primary";
              return (
                <div key={heroId} className={`flex items-center gap-2 rounded-md border bg-surface-overlay px-2 py-1 text-caption ${stateClass}`}>
                  <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={heroLabel(hero, heroId)} size={28} />
                  {heroLabel(hero, heroId)}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
