export interface RawHero {
  id: number;
  name: string;
  localized_name: string;
  img: string;
  primary_attr: string;
  attack_type: string;
  roles: string[];
}

export interface RawMatchup {
  hero_id: number;
  games_played: number;
  wins: number;
}

export interface RawHeroStatsRow {
  id: number;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// `img` se concatena luego con un host fijo para formar una URL (mappers.ts). Debe ser una ruta
// relativa segura: un solo "/" inicial (nunca "//..." — protocol-relative), sin "@" ni "://" —
// esos dos caracteres son justo los que permiten el truco de host-injection "userinfo@host" en
// URLs (ej. "@evil.example/x" haría que un parser real resuelva el host a evil.example).
const SAFE_RELATIVE_IMG_PATH = /^\/(?!\/)[\w\-./?=&]+$/;

const HERO_STATS_TIER_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8];

// Todo input externo (respuestas de OpenDota) se valida en el borde antes de tocar la DB.
export function isValidRawHero(value: unknown): value is RawHero {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    typeof value.localized_name === "string" &&
    typeof value.img === "string" &&
    SAFE_RELATIVE_IMG_PATH.test(value.img) &&
    typeof value.primary_attr === "string" &&
    typeof value.attack_type === "string" &&
    Array.isArray(value.roles) &&
    value.roles.every((role) => typeof role === "string")
  );
}

export function isValidRawMatchup(value: unknown): value is RawMatchup {
  if (!isRecord(value)) return false;
  return (
    typeof value.hero_id === "number" &&
    typeof value.games_played === "number" &&
    typeof value.wins === "number"
  );
}

export function isValidRawHeroStatsRow(value: unknown): value is RawHeroStatsRow {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "number") return false;
  return HERO_STATS_TIER_NUMBERS.every(
    (tier) => typeof value[`${tier}_pick`] === "number" && typeof value[`${tier}_win`] === "number",
  );
}
