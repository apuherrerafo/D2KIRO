import { HeroIcon } from "@/components/hero-icon/HeroIcon";
import { GAP_LABELS } from "@/features/draft-paths/constants";
import type { DraftPath, DraftPathStep } from "@/features/draft-paths/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface DraftPathCardProps {
  path: DraftPath;
  heroCatalog: Map<number, HeroMeta>;
  isActive: boolean;
}

function heroName(hero: HeroMeta | undefined, heroId: number): string {
  if (hero) return hero.localizedName;
  return `Héroe ${heroId}`;
}

interface PathHeroProps {
  step: DraftPathStep;
  heroCatalog: Map<number, HeroMeta>;
  label: string;
}

function PathHero({ step, heroCatalog, label }: PathHeroProps) {
  const hero = heroCatalog.get(step.hero);

  return (
    <div className="flex items-center gap-2 rounded-md border border-surface-border bg-surface-overlay p-2">
      <HeroIcon imgUrl={hero?.imgUrl ?? ""} alt={heroName(hero, step.hero)} size={36} />
      <div className="flex flex-col">
        <span className="text-caption text-content-muted">{label}</span>
        <span className="text-body text-content-primary">{heroName(hero, step.hero)}</span>
      </div>
    </div>
  );
}

function cardClassName(isActive: boolean): string {
  if (isActive) return "min-w-72 flex-1 border-accent-primary opacity-100";
  return "hidden min-w-56 flex-1 border-surface-border opacity-70 md:flex";
}

export function DraftPathCard({ path, heroCatalog, isActive }: DraftPathCardProps) {
  return (
    <div className={`flex flex-col gap-3 rounded-lg border bg-surface-raised p-4 ${cardClassName(isActive)}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-heading text-content-primary">{path.label}</span>
        <span className="text-caption text-content-muted">Score {path.score}</span>
      </div>
      <p className="text-body text-content-secondary">{path.reason}</p>
      <div className="flex flex-col gap-2">
        <PathHero step={path.nextPick} heroCatalog={heroCatalog} label="Próximo pick" />
        {path.followUps.map((step) => (
          <PathHero key={step.hero} step={step} heroCatalog={heroCatalog} label="Follow-up" />
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        {path.missing.map((gap) => (
          <span key={gap} className="rounded-md border border-surface-border bg-surface-overlay px-2 py-1 text-caption text-content-secondary">
            {GAP_LABELS[gap]}
          </span>
        ))}
      </div>
    </div>
  );
}
