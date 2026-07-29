import { SIGNAL_LABELS } from "@/components/signal-breakdown/SignalBreakdown";
import type { SuggestionComparison } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

interface ComparisonNoteProps {
  comparison: SuggestionComparison;
  heroMeta: HeroMeta | undefined;
}

// <Dominio><Cosa>: por qué el pick #1 le gana al #2 -- no solo la explicación independiente de
// cada sugerencia (TSK-032, feedback real de producto: "no veo la explicación de porque es bueno
// el draft frente al otro"). El motor solo conoce HeroId; el nombre se resuelve acá, mismo patrón
// que SuggestionCard.
export function ComparisonNote({ comparison, heroMeta }: ComparisonNoteProps) {
  const vsHeroName = heroMeta?.localizedName ?? `Héroe ${comparison.vsHero}`;

  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-surface-border bg-surface-overlay p-3">
      <span className="text-caption text-content-secondary">
        Le gana a {vsHeroName} principalmente por {SIGNAL_LABELS[comparison.signal]}.
      </span>
    </div>
  );
}
