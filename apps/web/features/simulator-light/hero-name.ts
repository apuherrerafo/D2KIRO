import { getCanonicalHero } from "@/design/canonical/hero-media";

export function heroName(heroId: number): string {
  return getCanonicalHero(heroId)?.localizedName ?? `Héroe ${heroId}`;
}

export function heroNames(heroIds: readonly number[]): string {
  return heroIds.map(heroName).join(", ");
}
