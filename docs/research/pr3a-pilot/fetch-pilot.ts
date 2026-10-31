// V7 PR-3A -- piloto real controlado. Script de DESARROLLADOR, manual, NUNCA importado desde apps/.
// Presupuesto duro: 7 solicitudes en total (1 /leagues + 1 /proMatches + hasta 5 /matches/{id}).
// Sin reintentos, sin paginación. Cualquier respuesta != 200 aborta y se reporta.
//
//   bun docs/research/pr3a-pilot/fetch-pilot.ts select    -> 2 solicitudes; fija la muestra (selection.json)
//   bun docs/research/pr3a-pilot/fetch-pilot.ts details   -> hasta 5 solicitudes; lee SOLO selection.json
//
// Las respuestas crudas NO se guardan (traen account_id y nombres de jugadores). Se persiste:
// el sha256 + tamaño de cada cuerpo, un fixture SANITIZADO y un "oráculo" calculado en memoria con
// lógica propia, independiente del adaptador (se compara luego contra el original, no contra el
// adaptador).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "https://api.opendota.com/api";
const DIR = import.meta.dir;
const SELECTION = join(DIR, "selection.json");
const REQUEST_BUDGET = 7;
const DELAY_MS = 1500;

type Json = Record<string, unknown>;
const requestLog: { path: string; status: number; bytes: number; sha256: string; at: string }[] = [];

async function get(path: string): Promise<{ body: unknown; sha256: string; bytes: number }> {
  if (requestLog.length >= REQUEST_BUDGET) throw new Error("presupuesto de solicitudes agotado");
  const response = await fetch(`${BASE}${path}`);
  const text = await response.text();
  const sha256 = createHash("sha256").update(text).digest("hex");
  requestLog.push({ path, status: response.status, bytes: text.length, sha256, at: new Date().toISOString() });
  if (response.status !== 200) throw new Error(`GET ${path} -> ${response.status} (sin reintento)`);
  return { body: JSON.parse(text), sha256, bytes: text.length };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------------------------
// FASE select
// ---------------------------------------------------------------------------------------------
async function select(): Promise<void> {
  if (existsSync(SELECTION)) throw new Error("selection.json ya existe: la muestra está fijada y no se regenera");
  const leagues = await get("/leagues");
  const proMatches = await get("/proMatches");
  if (!Array.isArray(leagues.body) || !Array.isArray(proMatches.body)) throw new Error("forma inesperada");

  const tierRows = new Map<number, Json[]>();
  const tierDistribution: Record<string, number> = {};
  for (const row of leagues.body) {
    if (!isObj(row) || typeof row.leagueid !== "number") continue;
    (tierRows.get(row.leagueid) ?? tierRows.set(row.leagueid, []).get(row.leagueid)!).push(row);
    const t = typeof row.tier === "string" ? row.tier : "null";
    tierDistribution[t] = (tierDistribution[t] ?? 0) + 1;
  }
  const tierOf = (id: number): string | null => {
    const rows = tierRows.get(id);
    if (rows === undefined || rows.length !== 1) return null; // ausente o ambiguo: no elegible para la muestra
    return typeof rows[0]!.tier === "string" ? (rows[0]!.tier as string) : null;
  };

  // REGLA (fijada antes de ver ningún detalle de partida):
  //  1. Filas de /proMatches con leagueid > 0 cuyo tier en /leagues es premium|professional (fila única).
  //  2. L1 = liga con más filas en la página (empate -> mayor leagueid). Se toman sus 4 partidas más nuevas.
  //  3. L2 = liga con más filas del OTRO tier elegible (mismo desempate). Se toma su partida más nueva.
  //     Si no existe L2, se completan 5 partidas de L1.
  //  "Más nueva" = mayor match_id. NINGÚN criterio usa el resultado de certifyProMatch ni el game_mode.
  const rows = proMatches.body.filter(isObj).filter((r) => typeof r.leagueid === "number" && (r.leagueid as number) > 0);
  const eligible = rows.filter((r) => ["premium", "professional"].includes(tierOf(r.leagueid as number) ?? ""));
  const byLeague = new Map<number, Json[]>();
  for (const r of eligible) (byLeague.get(r.leagueid as number) ?? byLeague.set(r.leagueid as number, []).get(r.leagueid as number)!).push(r);
  const ranked = (leagueIds: number[]) =>
    leagueIds.sort((a, b) => byLeague.get(b)!.length - byLeague.get(a)!.length || b - a);
  const newest = (id: number, n: number) => byLeague.get(id)!.slice().sort((a, b) => (b.match_id as number) - (a.match_id as number)).slice(0, n);

  const all = ranked([...byLeague.keys()]);
  if (all.length === 0) throw new Error("ninguna liga elegible en la página: evidencia insuficiente");
  const l1 = all[0]!;
  const t1 = tierOf(l1)!;
  const otherTier = ranked(all.filter((id) => tierOf(id) !== t1));
  const l2 = otherTier[0];
  const chosen = l2 === undefined ? newest(l1, 5) : [...newest(l1, 4), ...newest(l2, 1)];

  const leagueSubset = [...new Set(rows.map((r) => r.leagueid as number))].flatMap((id) => tierRows.get(id) ?? []).map((r) => ({
    leagueid: r.leagueid,
    tier: r.tier ?? null,
    name: r.name ?? null,
  }));

  writeFileSync(
    SELECTION,
    JSON.stringify(
      {
        purpose: "V7 PR-3A pilot -- muestra fijada ANTES de evaluar con certifyProMatch",
        rule: "L1 = liga elegible con más filas en /proMatches (empate: mayor leagueid) -> 4 más nuevas; L2 = liga más poblada del otro tier elegible -> 1 más nueva; si no hay L2, 5 de L1. Más nueva = mayor match_id.",
        fetchedAt: leagues.body.length > 0 ? requestLog[0]!.at : null,
        requests: requestLog,
        leaguesTotalRows: leagues.body.length,
        leaguesTierDistribution: tierDistribution,
        proMatchesRows: proMatches.body.length,
        candidateLeagues: all.map((id) => ({ leagueid: id, tier: tierOf(id), rowsInPage: byLeague.get(id)!.length })),
        selectedLeagues: { l1, l1Tier: t1, l2: l2 ?? null, l2Tier: l2 === undefined ? null : tierOf(l2) },
        selected: chosen.map((r) => ({
          match_id: r.match_id,
          leagueid: r.leagueid,
          league_name: r.league_name ?? null,
          start_time: r.start_time ?? null,
          start_time_iso: typeof r.start_time === "number" ? new Date(r.start_time * 1000).toISOString() : null,
          radiant_win: r.radiant_win ?? null,
        })),
        leaguesSubset: leagueSubset,
      },
      null,
      2,
    ),
  );
  console.log(`selection.json escrito. Solicitudes usadas: ${requestLog.length}/${REQUEST_BUDGET}`);
}

// ---------------------------------------------------------------------------------------------
// FASE details
// ---------------------------------------------------------------------------------------------
async function details(): Promise<void> {
  const selection = JSON.parse(readFileSync(SELECTION, "utf8")) as {
    requests: unknown[];
    selected: { match_id: number; leagueid: number }[];
  };
  const used = selection.requests.length;
  if (used + selection.selected.length > REQUEST_BUDGET) throw new Error("excede el presupuesto");
  mkdirSync(join(DIR, "fixtures"), { recursive: true });
  const manifestEntries: unknown[] = [];
  const oracle: Record<string, unknown> = {};

  for (const [index, pick] of selection.selected.entries()) {
    if (index > 0) await sleep(DELAY_MS);
    const { body, sha256, bytes } = await get(`/matches/${pick.match_id}`);
    if (!isObj(body)) throw new Error(`detalle ${pick.match_id} no es objeto`);
    const fetchedAt = new Date().toISOString();

    const picksBans = Array.isArray(body.picks_bans) ? body.picks_bans.filter(isObj) : [];
    const players = Array.isArray(body.players) ? body.players.filter(isObj) : [];
    const league = isObj(body.league) ? body.league : null;

    // FIXTURE SANITIZADO: sólo los campos que el adaptador lee. Sin account_id, nombres ni raw_json.
    const fixture = {
      match_id: body.match_id,
      leagueid: body.leagueid ?? null,
      league: league === null ? null : { leagueid: league.leagueid ?? null, tier: league.tier ?? null, name: league.name ?? null },
      game_mode: body.game_mode ?? null,
      radiant_win: body.radiant_win ?? null,
      patch: body.patch ?? null,
      start_time: body.start_time ?? null,
      picks_bans: picksBans.map((t) => ({ is_pick: t.is_pick, hero_id: t.hero_id, team: t.team, order: t.order })),
      players: players.map((p) => ({
        hero_id: p.hero_id,
        isRadiant: p.isRadiant,
        player_slot: p.player_slot,
        position_est: p.position_est ?? null,
      })),
    };
    writeFileSync(join(DIR, "fixtures", `${pick.match_id}.json`), JSON.stringify(fixture, null, 2));

    // ORÁCULO: hechos calculados sobre el crudo, con lógica propia (no usa certify-history.ts).
    const orders = picksBans.map((t) => t.order as number).sort((a, b) => a - b);
    const bySide = (side: boolean) => players.filter((p) => p.isRadiant === side);
    const posPerm = (list: Json[]) => {
      const ps = list.map((p) => p.position_est).sort();
      return JSON.stringify(ps) === JSON.stringify([1, 2, 3, 4, 5]);
    };
    const pickHeroes = (team: number) => picksBans.filter((t) => t.is_pick === true && t.team === team).map((t) => t.hero_id as number).sort((a, b) => a - b);
    const playerHeroes = (list: Json[]) => list.map((p) => p.hero_id as number).sort((a, b) => a - b);
    oracle[String(pick.match_id)] = {
      rawBodySha256: sha256,
      rawBodyBytes: bytes,
      fetchedAt,
      detailMatchId: body.match_id,
      detailLeagueId: body.leagueid ?? null,
      detailLeagueObjectId: league?.leagueid ?? null,
      detailLeagueTier: league?.tier ?? null,
      gameMode: body.game_mode ?? null,
      radiantWinRaw: body.radiant_win ?? null,
      patchRaw: body.patch ?? null,
      startTime: body.start_time ?? null,
      turnCount: picksBans.length,
      ordersContiguous: orders.every((o, i) => o === i),
      pickCount: picksBans.filter((t) => t.is_pick === true).length,
      banCount: picksBans.filter((t) => t.is_pick === false).length,
      // secuencia "R"/"D" + "p"/"b" por orden, para contrastar contra la tabla de CM
      sequence: picksBans
        .slice()
        .sort((a, b) => (a.order as number) - (b.order as number))
        .map((t) => `${t.team === 0 ? "R" : "D"}${t.is_pick ? "p" : "b"}`)
        .join(" "),
      heroIdsDistinct: new Set(picksBans.map((t) => t.hero_id)).size === picksBans.length,
      radiantPickHeroes: pickHeroes(0),
      direPickHeroes: pickHeroes(1),
      radiantPlayerHeroes: playerHeroes(bySide(true)),
      direPlayerHeroes: playerHeroes(bySide(false)),
      radiantPositionEstIsPermutation: posPerm(bySide(true)),
      direPositionEstIsPermutation: posPerm(bySide(false)),
      playerCount: players.length,
    };
    manifestEntries.push({
      match_id: pick.match_id,
      leagueid: pick.leagueid,
      fetchedAt,
      rawBodySha256: sha256,
      rawBodyBytes: bytes,
      fixture: `fixtures/${pick.match_id}.json`,
    });
  }

  writeFileSync(join(DIR, "oracle.json"), JSON.stringify(oracle, null, 2));
  writeFileSync(
    join(DIR, "manifest.json"),
    JSON.stringify(
      {
        source: "OpenDota public API (https://api.opendota.com/api)",
        requestBudget: REQUEST_BUDGET,
        requestsUsed: used + requestLog.length,
        requestsDetails: requestLog,
        selectionFile: "selection.json",
        matches: manifestEntries,
        note: "Respuestas crudas NO almacenadas (contienen account_id). Fixtures sanitizados + sha256 del cuerpo original.",
      },
      null,
      2,
    ),
  );
  console.log(`detalles escritos. Solicitudes de esta fase: ${requestLog.length}; total acumulado: ${used + requestLog.length}/${REQUEST_BUDGET}`);
}

const phase = process.argv[2];
if (phase === "select") await select();
else if (phase === "details") await details();
else throw new Error("uso: fetch-pilot.ts select|details");
