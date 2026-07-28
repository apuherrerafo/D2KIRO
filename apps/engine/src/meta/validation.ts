export interface RawHero {
  id: number;
  name: string;
  localized_name: string;
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

// OpenDota dejó de exponer `img` en /heroes (verificado en vivo el 2026-07-28: la respuesta real
// ya no trae ese campo, aunque el fixture grabado de las pruebas sí lo tenía). El ícono ahora se
// deriva de `name` en mappers.ts, así que el riesgo de host-injection que TSK-003 cerró sobre
// `img` (URLs tipo "@evil.example/x") se mueve a `name`: validarlo aquí contra el patrón fijo de
// Valve (solo minúsculas/dígitos/guion bajo tras el prefijo) garantiza que la ruta de imagen
// construida después nunca pueda contener "/", "@" ni "://".
const VALVE_HERO_NAME_PATTERN = /^npc_dota_hero_[a-z0-9_]+$/;

const HERO_STATS_TIER_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8];

// Todo input externo (respuestas de OpenDota) se valida en el borde antes de tocar la DB.
export function isValidRawHero(value: unknown): value is RawHero {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    VALVE_HERO_NAME_PATTERN.test(value.name) &&
    typeof value.localized_name === "string" &&
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
