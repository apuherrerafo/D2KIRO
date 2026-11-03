import type { DraftConfig } from "@/features/random-draft-simulator/types";

// Pools efectivos por posición, derivados EN EL NAVEGADOR con la misma regla que la pantalla de configuración
// (`countActivePools`): el dueño juega con su pool personal; los demás, con el pool que su persona guardó PARA ESA
// posición. Es una derivación de diagnóstico, no la autoridad -- el motor decide de verdad, y lo que aplicó queda
// grabado aparte (`poolState`/`poolOwner`/`poolMembership` de cada decisión V4).
// Tipos angostos a propósito: sólo ids y héroes. Nombres de integrantes, winrates y cuentas nunca entran.

export type PoolSource = "personal_pool" | "team_member_position_pool" | "no_pool";

export interface EffectivePool {
  position: number;
  source: PoolSource;
  heroIds: number[];
}

export interface PoolGroupMember {
  id: number;
  positionPools: { position: number; heroPool: number[] }[];
}

export interface PoolGroup {
  id: number;
  members: PoolGroupMember[];
}

export interface PoolInputs {
  config: DraftConfig;
  groups: readonly PoolGroup[];
  /** Héroes del pool personal del dueño (sólo ids; nunca winrate ni partidas). */
  personalPool: readonly number[];
}

const SEATS: readonly number[] = [1, 2, 3, 4, 5];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHeroId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function parseMember(value: unknown): PoolGroupMember | null {
  if (!isRecord(value) || typeof value.id !== "number" || !Array.isArray(value.positionPools)) return null;
  const positionPools = value.positionPools.flatMap((pool) =>
    isRecord(pool) && typeof pool.position === "number" && Array.isArray(pool.heroPool) ? [{ position: pool.position, heroPool: pool.heroPool.filter(isHeroId) }] : [],
  );
  return { id: value.id, positionPools };
}

/** Respuesta de `GET /api/team-groups` reducida a lo que importa; algo que no encaja se ignora, nunca lanza. */
export function parsePoolGroups(value: unknown): PoolGroup[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((group) => {
    if (!isRecord(group) || typeof group.id !== "number" || !Array.isArray(group.members)) return [];
    return [{ id: group.id, members: group.members.flatMap((member) => parseMember(member) ?? []) }];
  });
}

/** Respuesta de `GET /api/hero-pool`: sólo los ids de héroe. */
export function parsePersonalPool(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((entry) => (isRecord(entry) && isHeroId(entry.hero) ? [entry.hero] : []));
}

function personalPoolFor(position: number, inputs: PoolInputs): EffectivePool {
  return { position, source: "personal_pool", heroIds: [...inputs.personalPool] };
}

function teamPoolFor(position: number, memberId: number, group: PoolGroup | undefined): EffectivePool {
  const member = group?.members.find((candidate) => candidate.id === memberId);
  const pool = member?.positionPools.find((candidate) => candidate.position === position);
  if (!pool || pool.heroPool.length === 0) return { position, source: "no_pool", heroIds: [] };
  return { position, source: "team_member_position_pool", heroIds: [...pool.heroPool] };
}

export function deriveEffectivePools(inputs: PoolInputs): EffectivePool[] {
  const { config } = inputs;
  const group = config.teamGroupId === undefined || config.teamGroupId === null ? undefined : inputs.groups.find((candidate) => candidate.id === config.teamGroupId);
  const assignment = config.teamAssignment ?? {};
  return SEATS.map((position) => {
    if (position === config.playerPosition) return personalPoolFor(position, inputs);
    const memberKey = Object.keys(assignment).find((key) => assignment[key] === position);
    if (memberKey === undefined) return { position, source: "no_pool", heroIds: [] };
    return teamPoolFor(position, Number(memberKey), group);
  });
}
