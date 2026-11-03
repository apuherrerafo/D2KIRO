import { HeroIcon } from "@/design/canonical/hero-media/HeroIcon";
import type { HeroId } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

// A hero in a pool: the official icon, the name, and one obvious way to take it out. The icon host is validated against
// the Valve CDN allowlist inside the canonical HeroIcon.

interface PoolHeroChipProps {
  heroId: HeroId;
  hero: HeroMeta | undefined;
  onRemove: (hero: HeroId) => void;
}

export function PoolHeroChip({ heroId, hero, onRemove }: PoolHeroChipProps) {
  const name = hero?.localizedName ?? `Héroe ${heroId}`;

  function handleRemove() {
    onRemove(heroId);
  }

  return (
    <button type="button" className="tg-hero" onClick={handleRemove} aria-label={`Quitar ${name} del pool`}>
      <HeroIcon heroId={heroId} imgUrl={hero?.imgUrl} name={name} size="sm" />
      <span>{name}</span>
      <span aria-hidden="true" className="tg-hero-x">
        ×
      </span>
    </button>
  );
}

// The picker row icon for the canonical look. Passed into the shared HeroPicker so that component never imports the design system.
export function renderCanonicalPickerIcon(hero: HeroMeta) {
  return <HeroIcon heroId={hero.id} imgUrl={hero.imgUrl} name={hero.localizedName} size="sm" />;
}
