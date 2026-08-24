#!/usr/bin/env bun
// Ingesta INCREMENTAL del corpus de KNN (apps/engine/src/knn/pro-draft-corpus.json), por torneo
// Tier 1 (`league.tier === "premium"`, mismo mapeo Tier1/Tier2 que fetch-pro-drafts.ts ya
// documenta). Soft launch (Gobernanza 2.0): corre a mano en la máquina del desarrollador -- mismo
// estatus que fetch-pro-drafts.ts, "nunca programado, nunca automático". `bun run
// fetch:daily-pro-drafts` (package.json raíz) es un atajo para tipear el comando, no un cron.
//
// Diferencia real con fetch-pro-drafts.ts, no cosmética: ESE script sobrescribe el corpus entero
// desde cero en cada corrida (barrido completo de un parche). ESTE script MERGEA -- carga el
// corpus existente, nunca lo descarta, y solo agrega drafts nuevos. El objetivo (pedido explícito
// del usuario) es completar el historial del parche activo poco a poco, en corridas de ~5-10 min,
// no una corrida larga de una sola vez.
//
// [SUPUESTO, verificado contra la API real antes de escribir esto -- no asumido]: `/leagues` NO
// trae ninguna fecha (10108 ligas reales inspeccionadas, ningún campo `start_date`/`end_date`) --
// no hay forma de ordenar torneos "cronológicamente" desde ese endpoint solo. La orden de
// recencia real que usa este script viene de `/proMatches` (ya paginado más-reciente-primero por
// fetch-pro-drafts.ts): el leagueid de la PRIMERA partida encontrada al escanear hacia atrás es,
// por construcción, el torneo con actividad pro más reciente -- se usa el orden de PRIMERA
// APARICIÓN durante el escaneo como el ranking de recencia, documentado como aproximación (mide
// "actividad más reciente vista en la ventana escaneada", no la fecha real de inicio/fin del
// torneo, que OpenDota no expone).
//
// [DECISIÓN DE DISEÑO, más allá del pedido literal]: "máximo 2 torneos por corrida" se aplica
// sobre los torneos DESCUBIERTOS en la ventana escaneada (limitada por --max-pages, presupuesto
// de tiempo) -- nunca persigue un torneo completo across todo el histórico del parche en una sola
// corrida (un torneo real puede tener partidas esparcidas en decenas de páginas de /proMatches a
// lo largo de varias semanas). Esto es justamente el espíritu de "soft launch, poco a poco": cada
// corrida cubre el fragmento más reciente sin cubrir; corridas sucesivas, con el corpus ya
// creciendo, van completando más atrás con el tiempo.
//
// Deduplicación (pedido explícito #2): el Set de match_id ya en el corpus se construye ANTES de
// escanear nada, y CADA match_id se valida contra ese Set antes de pedir su detalle -- un
// match_id ya presente nunca dispara un fetch de red, ni siquiera uno descartado después.

import { OpenDotaClient } from "../apps/engine/src/meta/opendota-client";
import { loadDraftCorpus, parseDraftCorpus } from "../apps/engine/src/knn/corpus";
import type { DraftCandidate } from "../apps/engine/src/knn/corpus";
import { toDraftCandidate, type MatchDetail } from "./fetch-pro-drafts";

const OUTPUT_PATH = new URL("../apps/engine/src/knn/pro-draft-corpus.json", import.meta.url);
const TIER_1 = "premium"; // mismo mapeo que fetch-pro-drafts.ts: premium = Tier 1, professional = Tier 2

export interface LeagueSummary {
  readonly leagueid: number;
  readonly tier: string | null;
}

export interface DailyProMatchSummary {
  readonly match_id: number;
  readonly start_time: number;
  readonly leagueid: number;
  readonly league_name: string;
}

interface Args {
  readonly patchOverride?: string;
  readonly maxTournaments: number;
  readonly maxNewDrafts: number;
  readonly maxPages: number;
  readonly delayMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const flag = (name: string): string | undefined => argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  return {
    patchOverride: flag("patch"),
    maxTournaments: Number(flag("max-tournaments") ?? 2),
    maxNewDrafts: Number(flag("max-new-drafts") ?? 50),
    maxPages: Number(flag("max-pages") ?? 40), // ~40 páginas * 3s de cortesía ≈ 2 min de escaneo, deja margen bajo el objetivo de 5-10 min
    delayMs: Number(flag("delay-ms") ?? 3000),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Filtrado por Tier 1 (requisito #1) -- función pura, probada con fixtures, nunca contra /leagues
// real (10108 entradas reales, se regenera solo, un test atado a su contenido se rompería en
// silencio, mismo criterio que capabilities.json/hero-positions.json).
export function filterTier1LeagueIds(leagues: readonly LeagueSummary[]): Set<number> {
  return new Set(leagues.filter((l) => l.tier === TIER_1).map((l) => l.leagueid));
}

export interface TournamentScan {
  readonly leagueOrder: readonly number[]; // orden de primera aparición = ranking de recencia
  readonly leagueNames: ReadonlyMap<number, string>;
  readonly matchesByLeague: ReadonlyMap<number, readonly DailyProMatchSummary[]>;
}

// Agrupa partidas de /proMatches por torneo Tier 1, dentro de la ventana del parche activo --
// función pura, cubre requisito #1 (filtrado) y la mitad "descubrimiento" de la incrementalidad.
export function scanTier1Tournaments(
  pages: readonly (readonly DailyProMatchSummary[])[],
  tier1LeagueIds: ReadonlySet<number>,
  oldestPatchDate: number,
): TournamentScan {
  const leagueOrder: number[] = [];
  const leagueNames = new Map<number, string>();
  const matchesByLeague = new Map<number, DailyProMatchSummary[]>();

  for (const page of pages) {
    for (const m of page) {
      if (m.start_time < oldestPatchDate) continue;
      if (!tier1LeagueIds.has(m.leagueid)) continue;

      if (!matchesByLeague.has(m.leagueid)) {
        leagueOrder.push(m.leagueid);
        leagueNames.set(m.leagueid, m.league_name);
        matchesByLeague.set(m.leagueid, []);
      }
      matchesByLeague.get(m.leagueid)!.push(m);
    }
  }

  return { leagueOrder, leagueNames, matchesByLeague };
}

// Deduplicación por match_id (requisito #2) + tope de torneos/drafts (requisito #3) -- función
// pura, nunca toca la red: decide QUÉ pedir, no lo pide. `existingMatchIds` ya trae los match_id
// del corpus actual como string (mismo tipo que DraftCandidate.draftId).
export function selectNewMatchesToFetch(
  scan: TournamentScan,
  existingMatchIds: ReadonlySet<string>,
  maxTournaments: number,
  maxNewDrafts: number,
): DailyProMatchSummary[] {
  const targetLeagues = scan.leagueOrder.slice(0, maxTournaments);
  const selected: DailyProMatchSummary[] = [];

  for (const leagueId of targetLeagues) {
    for (const match of scan.matchesByLeague.get(leagueId) ?? []) {
      if (selected.length >= maxNewDrafts) return selected;
      if (existingMatchIds.has(String(match.match_id))) continue; // ya en el corpus -- cero fetch de red
      selected.push(match);
    }
  }

  return selected;
}

interface PatchConstant {
  readonly id: number;
  readonly name: string;
  readonly date: string;
}

async function resolveCurrentPatch(client: OpenDotaClient, override: string | undefined): Promise<PatchConstant> {
  const patches = (await client.getPatchConstants()) as PatchConstant[];
  if (override) {
    const found = patches.find((p) => p.name === override);
    if (!found) throw new Error(`Parche "${override}" no existe en constants/patch de OpenDota`);
    return found;
  }
  const latest = patches.at(-1);
  if (!latest) throw new Error("constants/patch de OpenDota devolvió una lista vacía");
  return latest;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = new OpenDotaClient();

  const existingCorpus = loadDraftCorpus();
  const existingMatchIds = new Set(existingCorpus.map((d) => d.draftId));
  console.log(`Corpus existente: ${existingCorpus.length} drafts (${existingMatchIds.size} match_id ya registrados)`);

  const patch = await resolveCurrentPatch(client, args.patchOverride);
  const oldestPatchDate = new Date(patch.date).getTime() / 1000;
  console.log(`Parche objetivo: ${patch.name} (id=${patch.id}, vigente desde ${patch.date})`);

  const leagues = (await client.getLeagues()) as LeagueSummary[];
  const tier1LeagueIds = filterTier1LeagueIds(leagues);
  console.log(`Ligas Tier 1 (premium) en /leagues: ${tier1LeagueIds.size} de ${leagues.length} totales`);

  const pages: DailyProMatchSummary[][] = [];
  let cursor: number | undefined;
  let pagesScanned = 0;
  pageLoop: while (pagesScanned < args.maxPages) {
    await sleep(args.delayMs);
    let page: DailyProMatchSummary[];
    try {
      page = (await client.getProMatches(cursor)) as DailyProMatchSummary[];
    } catch (err) {
      console.warn(`Página de proMatches falló tras reintentos, se corta el escaneo acá: ${(err as Error).message}`);
      break pageLoop;
    }
    pagesScanned++;
    if (page.length === 0) break pageLoop;

    const inPatchWindow = page.filter((m) => m.start_time >= oldestPatchDate);
    pages.push(inPatchWindow);
    if (inPatchWindow.length === 0) break pageLoop; // toda la página es más vieja que el parche -- fin

    cursor = page.at(-1)?.match_id;
    if (!cursor) break pageLoop;
  }
  console.log(`Escaneadas ${pagesScanned} páginas de proMatches dentro de la ventana del parche ${patch.name}`);

  const scan = scanTier1Tournaments(pages, tier1LeagueIds, oldestPatchDate);
  console.log(`Torneos Tier 1 descubiertos en la ventana escaneada: ${scan.leagueOrder.length}`);
  for (const leagueId of scan.leagueOrder) {
    console.log(`  - ${scan.leagueNames.get(leagueId)} (leagueid=${leagueId}): ${scan.matchesByLeague.get(leagueId)?.length ?? 0} partidas en la ventana`);
  }

  const toFetch = selectNewMatchesToFetch(scan, existingMatchIds, args.maxTournaments, args.maxNewDrafts);
  console.log(`Match_id nuevos a pedir detalle (tope ${args.maxNewDrafts}, hasta ${args.maxTournaments} torneos): ${toFetch.length}`);

  const newCandidates: DraftCandidate[] = [];
  const newByLeague = new Map<number, number>();
  for (const match of toFetch) {
    await sleep(args.delayMs);
    let detail: MatchDetail;
    try {
      detail = (await client.getMatchDetail(match.match_id)) as MatchDetail;
    } catch (err) {
      console.warn(`  match ${match.match_id}: fetch falló, se omite (${(err as Error).message})`);
      continue;
    }
    const candidate = toDraftCandidate(match.match_id, detail, patch.name);
    if (!candidate) continue;
    newCandidates.push(candidate);
    newByLeague.set(match.leagueid, (newByLeague.get(match.leagueid) ?? 0) + 1);
  }

  const merged = parseDraftCorpus([...existingCorpus, ...newCandidates]); // dedup real, primera aparición gana
  await Bun.write(OUTPUT_PATH, `${JSON.stringify(merged, null, 2)}\n`);

  console.log(`\nDrafts nuevos consolidados: ${newCandidates.length}`);
  for (const [leagueId, count] of newByLeague) {
    console.log(`  - ${scan.leagueNames.get(leagueId)}: ${count} drafts nuevos`);
  }
  console.log(`Corpus total tras el merge: ${merged.length} drafts -> ${OUTPUT_PATH.pathname}`);
}

// Guard real, no cosmético: `fetch-daily-pro-drafts.test.ts` importa las funciones puras de acá
// arriba -- sin `import.meta.main`, ese import por sí solo dispara `main()` (red real,
// potencialmente escritura real del corpus) cada vez que corre `bun test`. Hallazgo encontrado
// al escribir el test, no anticipado: la primera corrida de `bun test` de este archivo hizo un
// fetch real a OpenDota antes de que este guard existiera.
if (import.meta.main) {
  main().catch((err) => {
    console.error("fetch-daily-pro-drafts falló:", err);
    process.exit(1);
  });
}
