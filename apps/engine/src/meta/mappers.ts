import type { RawHero, RawMatchup, RawHeroStatsRow } from "./validation";

const HERO_IMG_BASE_URL = "https://cdn.cloudflare.steamstatic.com";

// `raw.name` ya viene validado contra VALVE_HERO_NAME_PATTERN (validation.ts) antes de llegar
// aquí, así que quitarle el prefijo fijo de Valve deja solo [a-z0-9_]+ -- una ruta segura por
// construcción, sin necesitar una segunda pasada de sanitización.
const HERO_NAME_PREFIX = "npc_dota_hero_";

function heroImgPath(rawName: string): string {
  const slug = rawName.slice(HERO_NAME_PREFIX.length);
  return `/apps/dota2/images/dota_react/heroes/${slug}.png`;
}

// Los 8 brackets de MMR que expone OpenDota en /heroStats (columnas `<tier>_pick`/`<tier>_win`).
// No hay taxonomía "bajo/medio/pro" oficial — se deja la granularidad completa; la señal
// patch_meta (ticket aparte) decide cuáles promediar para "MMR bajo/medio".
export const BRACKETS = [
  "herald",
  "guardian",
  "crusader",
  "archon",
  "legend",
  "ancient",
  "divine",
  "immortal",
] as const;
export type Bracket = (typeof BRACKETS)[number];

const BRACKET_TIER_NUMBER: Record<Bracket, number> = {
  herald: 1,
  guardian: 2,
  crusader: 3,
  archon: 4,
  legend: 5,
  ancient: 6,
  divine: 7,
  immortal: 8,
};

export interface HeroRow {
  id: number;
  name: string;
  localizedName: string;
  imgUrl: string;
  primaryAttr: string;
  attackType: string;
  roles: string[];
  updatedAt: string;
}

export function mapHero(raw: RawHero, updatedAt: string): HeroRow {
  return {
    id: raw.id,
    name: raw.name,
    localizedName: raw.localized_name,
    imgUrl: `${HERO_IMG_BASE_URL}${heroImgPath(raw.name)}`,
    primaryAttr: raw.primary_attr,
    attackType: raw.attack_type,
    roles: raw.roles,
    updatedAt,
  };
}

export interface HeroMatchupRow {
  heroId: number;
  vsHeroId: number;
  games: number;
  wins: number;
  updatedAt: string;
}

export function mapMatchup(heroId: number, raw: RawMatchup, updatedAt: string): HeroMatchupRow {
  return {
    heroId,
    vsHeroId: raw.hero_id,
    games: raw.games_played,
    wins: raw.wins,
    updatedAt,
  };
}

export interface HeroPatchStatRow {
  heroId: number;
  patch: string;
  bracket: Bracket;
  picks: number;
  wins: number;
  updatedAt: string;
}

export function mapHeroStatsRow(raw: RawHeroStatsRow, patch: string, updatedAt: string): HeroPatchStatRow[] {
  return BRACKETS.map((bracket) => {
    const tier = BRACKET_TIER_NUMBER[bracket];
    const picks = Number(raw[`${tier}_pick`] ?? 0);
    const wins = Number(raw[`${tier}_win`] ?? 0);
    return { heroId: raw.id, patch, bracket, picks, wins, updatedAt };
  });
}
