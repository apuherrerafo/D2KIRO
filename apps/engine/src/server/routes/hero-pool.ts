import type { BunSQLiteDatabase } from "drizzle-orm/bun-sqlite";
import * as schema from "../../db/schema";
import { getHeroPool, replaceHeroPool, type HeroPoolWriteRow } from "../../db/queries";
import { calculateProposedPool, type HeroPoolInputRow } from "../../hero-pool/calculate-pool";
import { mapPlayerHero } from "../../meta/mappers";
import type { OpenDotaClient } from "../../meta/opendota-client";
import { invalidateMetaSnapshotCache } from "../../meta/provider";
import { isValidRawPlayerHero, isValidSteamAccountId } from "../../meta/validation";

// TSK-056: extraído de apps/engine/src/server/app.ts (hallazgo 2.1 de "Radiografía de
// dota2coach" -- app.ts había crecido a 669+ líneas mezclando 7+ responsabilidades). Mismo
// comportamiento exacto, ninguna ruta ni payload cambia -- verificado con la suite de
// integración existente de app.test.ts, sin necesidad de duplicarla acá.
export interface HeroPoolRouteDeps<TSchema extends Record<string, unknown>> {
  db: BunSQLiteDatabase<TSchema>;
  openDotaClient: OpenDotaClient;
}

// TSK-020 (fase 1b, S8): `hero` (no `heroId`) es el nombre de campo del contrato de dominio
// (SPEC.md §9.4/§9.5) -- se traduce a/desde `heroId` de la fila de SQLite solo en este borde.
interface HeroPoolEntry {
  hero: number;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
  updatedAt: string;
}

function toHeroPoolEntry(row: HeroPoolWriteRow): HeroPoolEntry {
  return { hero: row.heroId, source: row.source, personalWinrate: row.personalWinrate, personalGames: row.personalGames, updatedAt: row.updatedAt };
}

interface HeroPoolPutEntry {
  hero: number;
  source: "manual" | "calculated";
  personalWinrate: number | null;
  personalGames: number;
}

function isValidHeroPoolPutEntry(value: unknown): value is HeroPoolPutEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  if (typeof entry.hero !== "number") return false;
  if (entry.source !== "manual" && entry.source !== "calculated") return false;
  if (entry.personalWinrate !== null && (typeof entry.personalWinrate !== "number" || entry.personalWinrate < 0 || entry.personalWinrate > 1)) {
    return false;
  }
  if (typeof entry.personalGames !== "number" || !Number.isInteger(entry.personalGames) || entry.personalGames < 0) return false;
  return true;
}

function isValidHeroPoolPutBody(value: unknown): value is { entries: HeroPoolPutEntry[] } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.entries) && body.entries.every(isValidHeroPoolPutEntry);
}

export function createHeroPoolRoutes<TSchema extends Record<string, unknown>>(deps: HeroPoolRouteDeps<TSchema>) {
  // TSK-021: sin cola, sin reintento automático (§9.5) -- un flag por proceso alcanza para este
  // servidor local de un solo usuario. Un segundo POST mientras el primero sigue en vuelo se
  // rechaza de inmediato con 409, nunca se encola.
  let calculationInProgress = false;

  async function get(): Promise<Response> {
    return Response.json(getHeroPool(deps.db).map(toHeroPoolEntry));
  }

  // Reemplaza el pool completo en una sola transacción (S8). Todas las validaciones corren antes
  // de tocar la base de datos -- si algo falla, el pool guardado no se toca (§9.5).
  async function put(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    if (!isValidHeroPoolPutBody(body)) {
      return Response.json({ error: "invalid_body" }, { status: 400 });
    }
    if (body.entries.length > 5) {
      return Response.json({ error: "too_many_entries" }, { status: 400 });
    }
    const heroIds = body.entries.map((entry) => entry.hero);
    if (new Set(heroIds).size !== heroIds.length) {
      return Response.json({ error: "duplicate_hero" }, { status: 400 });
    }
    const knownHeroIds = new Set(deps.db.select({ id: schema.heroes.id }).from(schema.heroes).all().map((row) => row.id));
    if (heroIds.some((id) => !knownHeroIds.has(id))) {
      return Response.json({ error: "unknown_hero" }, { status: 400 });
    }

    // El servidor siempre estampa su propio reloj -- un cliente no dicta `updatedAt` (mismo
    // principio que `applyDraftEvent`: el reloj se inyecta desde el lado de confianza, nunca desde
    // input externo).
    const updatedAt = new Date().toISOString();
    const rows: HeroPoolWriteRow[] = body.entries.map((entry) => ({
      heroId: entry.hero,
      source: entry.source,
      personalWinrate: entry.personalWinrate,
      personalGames: entry.personalGames,
      updatedAt,
    }));
    replaceHeroPool(deps.db, rows);
    // TSK-059: hero_pool_fit lee a través del mismo MetaSnapshot cacheado -- sin esto, un pool
    // recién guardado seguiría invisible para las sugerencias hasta la próxima sincronización.
    invalidateMetaSnapshotCache();

    return Response.json(rows.map(toHeroPoolEntry), { status: 200 });
  }

  // TSK-021: único endpoint de 1b que toca la red. Conecta getPlayerHeroes (TSK-018) con el
  // cálculo puro (TSK-019, S7) -- nunca escribe en SQLite, solo propone (put, sigue siendo el
  // único camino de escritura). Reglas duras: el accountId nunca se ecoa en ningún error/log, y
  // esta llamada vive fuera del pipeline de buildSuggestions -- no toca el camino caliente.
  async function calculate(request: Request): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    const accountId = typeof body === "object" && body !== null ? (body as Record<string, unknown>).accountId : undefined;
    if (typeof accountId !== "string" || !isValidSteamAccountId(accountId)) {
      return Response.json({ error: "invalid_account_id" }, { status: 400 });
    }
    const rawDays = typeof body === "object" && body !== null ? (body as Record<string, unknown>).days : undefined;
    // Number.isFinite (no solo typeof number) descarta Infinity -- "rawDays > 0" por sí solo lo
    // dejaba pasar (Infinity > 0 es true), colando date=Infinity en la URL hacia OpenDota.
    const days = Number.isFinite(rawDays) && (rawDays as number) > 0 ? (rawDays as number) : 90;

    if (calculationInProgress) {
      return Response.json({ error: "calculation_in_progress" }, { status: 409 });
    }

    calculationInProgress = true;
    try {
      let raw: unknown;
      try {
        raw = await deps.openDotaClient.getPlayerHeroes(accountId, { days });
      } catch {
        raw = null;
      }
      if (!Array.isArray(raw)) {
        return Response.json(
          { error: "opendota_unavailable", message: "OpenDota no respondió. El pool guardado (si existe) sigue funcionando." },
          { status: 502 },
        );
      }

      // Bucle de filtrado (nota de @redteam de TSK-018, evt-20260729-007): las primitivas de una
      // fila (isValidRawPlayerHero/mapPlayerHero) no descartan nada por sí solas -- este es el
      // orquestador que itera el array crudo, igual que syncHeroes/syncMatchups en sync.ts.
      const heroRows: HeroPoolInputRow[] = [];
      for (const item of raw) {
        if (isValidRawPlayerHero(item)) heroRows.push(mapPlayerHero(item));
      }

      const result = calculateProposedPool(heroRows, () => new Date().toISOString());
      return Response.json({
        proposed: result.proposed,
        baselineWinrate: result.baselineWinrate,
        consideredHeroes: result.consideredHeroes,
        windowDays: days,
      });
    } finally {
      calculationInProgress = false;
    }
  }

  return { get, put, calculate };
}
