import { ALLOWED_HERO_IMG_HOSTS } from "@/features/draft/constants";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import rawHeroes from "./canonical-heroes.json";

export { ALLOWED_HERO_IMG_HOSTS };

export type PrimaryAttribute = "str" | "agi" | "int" | "all";

export interface CanonicalHero {
  id: number;
  name: string;
  localizedName: string;
  imgUrl: string;
  primaryAttr: PrimaryAttribute;
  attackType: "Melee" | "Ranged";
  roles: string[];
}

/**
 * Validates that the provided URL belongs to Valve's official CDN allowlist.
 * Reuses the existing ALLOWED_HERO_IMG_HOSTS security policy from features/draft/constants.
 */
export function isAllowedHeroImgHost(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return ALLOWED_HERO_IMG_HOSTS.includes(parsed.host);
  } catch {
    return false;
  }
}

export const CANONICAL_HEROES: readonly CanonicalHero[] = (rawHeroes as CanonicalHero[]).filter(
  (hero) => isAllowedHeroImgHost(hero.imgUrl),
);

const HERO_BY_ID = new Map<number, CanonicalHero>(
  CANONICAL_HEROES.map((h) => [h.id, h]),
);

const HERO_BY_KEY = new Map<string, CanonicalHero>();

for (const hero of CANONICAL_HEROES) {
  HERO_BY_KEY.set(hero.localizedName.toLowerCase(), hero);
  HERO_BY_KEY.set(hero.name.toLowerCase(), hero);
  const slug = hero.name.replace(/^npc_dota_hero_/, "").toLowerCase();
  HERO_BY_KEY.set(slug, hero);
}

/**
 * Resolves a hero to canonical metadata by ID, name, slug, or HeroMeta object.
 * Returns null if not found or if the image host violates the Valve CDN policy.
 */
export function getCanonicalHero(
  target: number | string | HeroMeta | CanonicalHero | null | undefined,
): CanonicalHero | null {
  if (target === null || target === undefined) return null;

  if (typeof target === "number") {
    return HERO_BY_ID.get(target) ?? null;
  }

  if (typeof target === "string") {
    const trimmed = target.trim().toLowerCase();
    const byKey = HERO_BY_KEY.get(trimmed);
    if (byKey) return byKey;

    const parsedNum = Number(target);
    if (!Number.isNaN(parsedNum) && HERO_BY_ID.has(parsedNum)) {
      return HERO_BY_ID.get(parsedNum) ?? null;
    }
    return null;
  }

  // Target is an object (HeroMeta or CanonicalHero)
  if (typeof target === "object" && "localizedName" in target) {
    if (isAllowedHeroImgHost(target.imgUrl)) {
      const canonical = HERO_BY_ID.get(target.id);
      return {
        id: target.id,
        name: target.name,
        localizedName: target.localizedName,
        imgUrl: target.imgUrl,
        primaryAttr: (canonical?.primaryAttr ?? target.primaryAttr ?? "all") as PrimaryAttribute,
        attackType: (canonical?.attackType ?? target.attackType ?? "Melee") as "Melee" | "Ranged",
        roles: target.roles ?? canonical?.roles ?? [],
      };
    }
  }

  return null;
}

export interface AttributeColor {
  accent: string;
  accentSecondary: string;
  name: string;
}

export function getAttributeColor(attr: PrimaryAttribute | string | undefined): AttributeColor {
  switch (attr) {
    case "str":
      return { accent: "#d4553c", accentSecondary: "#d4553c", name: "Strength" };
    case "agi":
      return { accent: "#52b04f", accentSecondary: "#52b04f", name: "Agility" };
    case "int":
      return { accent: "#3f8ae6", accentSecondary: "#3f8ae6", name: "Intelligence" };
    case "all":
    case "uni":
    default:
      return { accent: "#8b5cf6", accentSecondary: "#d4553c", name: "Universal" };
  }
}
