#!/usr/bin/env bun
// Ingesta manual del corpus de KNN (apps/engine/src/knn/pro-draft-corpus.json), Fase 5
// (pro-drafter-spec-v1.md §2.1). Corre a mano en la máquina del desarrollador -- MISMO estatus
// que el regenerador de hero-positions.json (Fase 3) y que el propio doc de investigación pide
// para este archivo: "nunca programado, nunca automático". `bun run corpus:sync` (package.json
// raíz) es un atajo para tipear el comando, no un cron -- nada en este repo lo invoca solo.
//
// Fuente: solo OpenDota (pública, sin API key, sin costo) -- NUNCA STRATZ. STRATZ exige un API
// key nuevo (secreto nuevo) y es una dependencia condicional documentada desde Fase 1b como "nunca
// priorizada, necesita su propia evaluación de costo/beneficio" -- adoptarla exige pasar por
// /gear-up primero, decisión explícita del usuario (2026-08-24), no de este script.
//
// [SUPUESTO, confirmado con el usuario]: el filtro "High MMR Leaderboard (Immortal 8k+)" pedido
// originalmente se DESCARTA -- OpenDota no expone drafts de pubs de alto MMR (solo partidas
// profesionales con liga real), mismo tipo de hueco que el problema de GSI/Overwolf ya documentado
// en architecture.md (Valve no expone ese dato públicamente). "Tier 1/Tier 2" se aproxima con
// `league.tier` real de OpenDota (`"premium"`/`"professional"`) -- no son los mismos nombres que
// usa la escena competitiva, pero es el dato real más cercano sin inventar una taxonomía propia.
//
// [SUPUESTO]: OpenDota solo trackea parches MAYORES en `constants/patch` (ej. "7.41", nunca
// "7.41e") -- un match individual no puede etiquetarse con la letra del sub-parche porque OpenDota
// no expone ese dato. El corpus queda taggeado con el parche mayor real, más preciso que inventar
// una letra.
//
// Volumen real: el rango de 2,000-5,000 drafts pedido originalmente asumía esa cantidad de
// partidas profesionales Tier 1/2 en UN SOLO parche activo -- en la práctica, un solo parche
// suele tener unos pocos cientos (confirmado: patch 7.41 solo dio 175). Gobernanza 2.0
// (ampliación de corpus, evt-107): `--patches=N` (default 1, preserva el comportamiento
// original) barre los últimos N parches de `constants/patch` en una sola pasada de paginación en
// vez de N pasadas separadas -- el corpus resultante mezcla parches (cada `DraftCandidate` sigue
// llevando su propio campo `patch`, el KNN nunca filtra ni pondera por él, verificado contra
// knn/draft-index.ts y knn/jaccard.ts antes de este cambio). Este script escribe TODAS las que
// encuentre (hasta --max-drafts), nunca rellena con datos falsos para llegar a un número.
//
// Reintentos: reutiliza OpenDotaClient (apps/engine/src/meta/opendota-client.ts) -- mismo
// mecanismo ya probado que usa la sincronización real del motor (429 -> espera creciente 1s/4s/
// 16s, máximo 3 reintentos). La primera versión de este script tenía su propio fetch sin
// reintento y un 429 real de OpenDota lo tumbó a mitad de una corrida -- corregido reutilizando
// el cliente existente en vez de reimplementar el mismo mecanismo peor. Ese contrato (1s/4s/16s,
// 3 reintentos) es de `apps/engine` -- fijo en engine.md/security.md, NUNCA se toca acá.
// Gobernanza 2.0 agrega una capa de resiliencia propia del SCRIPT (nunca del cliente
// compartido): tras varios fallos consecutivos (una racha de 429 sostenidos que ya agotaron los
// 3 reintentos del cliente cada uno), el script hace una pausa larga antes de seguir -- un 429
// sostenido por varios minutos necesita más que el backoff de una sola petición.

import { OpenDotaClient } from "../apps/engine/src/meta/opendota-client";
import { parseDraftCorpus } from "../apps/engine/src/knn/corpus";
import type { DraftCandidate } from "../apps/engine/src/knn/corpus";

const ACCEPTED_TIERS = new Set(["premium", "professional"]);
const REQUIRED_PICKS_PER_SIDE = 5;
const OUTPUT_PATH = new URL("../apps/engine/src/knn/pro-draft-corpus.json", import.meta.url);
const CONSECUTIVE_FAILURES_BEFORE_COOLDOWN = 5;
const COOLDOWN_MS = 60_000;

interface Args {
  readonly patchOverride?: string;
  readonly patchCount: number;
  readonly maxDrafts: number;
  readonly delayMs: number;
  readonly maxPages: number;
}

function parseArgs(argv: readonly string[]): Args {
  const flag = (name: string): string | undefined =>
    argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];

  return {
    patchOverride: flag("patch"),
    patchCount: Number(flag("patches") ?? 1), // 1 = comportamiento original, un solo parche
    maxDrafts: Number(flag("max-drafts") ?? 5000),
    delayMs: Number(flag("delay-ms") ?? 3000), // cortesía proactiva -- además del reintento del cliente
    maxPages: Number(flag("max-pages") ?? 300), // safety cap -- nunca pagina sin límite
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface PatchConstant {
  readonly id: number;
  readonly name: string;
  readonly date: string;
}

// Devuelve los N parches objetivo, más viejo primero (mismo orden que ya entrega
// constants/patch). `override` fija un único parche exacto -- un pedido explícito de parche no
// se expande en silencio a una ventana de N, aunque `--patches` esté presente.
async function resolveTargetPatches(client: OpenDotaClient, override: string | undefined, count: number): Promise<PatchConstant[]> {
  const patches = (await client.getPatchConstants()) as PatchConstant[];
  if (override) {
    const found = patches.find((p) => p.name === override);
    if (!found) throw new Error(`Parche "${override}" no existe en constants/patch de OpenDota`);
    return [found];
  }
  const window = patches.slice(-Math.max(1, count));
  if (window.length === 0) throw new Error("constants/patch de OpenDota devolvió una lista vacía");
  return window;
}

interface ProMatchSummary {
  readonly match_id: number;
  readonly start_time: number;
}

interface MatchDetail {
  readonly patch: number;
  readonly radiant_win: boolean;
  readonly league?: { readonly tier?: string };
  readonly picks_bans?: readonly { readonly is_pick: boolean; readonly hero_id: number; readonly team: 0 | 1 }[];
}

function toDraftCandidate(matchId: number, detail: MatchDetail, patchName: string): DraftCandidate | null {
  if (!detail.picks_bans) return null;
  if (!detail.league?.tier || !ACCEPTED_TIERS.has(detail.league.tier)) return null;

  const radiantHeroes = detail.picks_bans.filter((pb) => pb.is_pick && pb.team === 0).map((pb) => pb.hero_id);
  const direHeroes = detail.picks_bans.filter((pb) => pb.is_pick && pb.team === 1).map((pb) => pb.hero_id);
  if (radiantHeroes.length !== REQUIRED_PICKS_PER_SIDE || direHeroes.length !== REQUIRED_PICKS_PER_SIDE) return null;

  return {
    draftId: String(matchId),
    patch: patchName,
    radiantHeroes,
    direHeroes,
    winningSide: detail.radiant_win ? "radiant" : "dire",
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const client = new OpenDotaClient();
  const patches = await resolveTargetPatches(client, args.patchOverride, args.patchCount);
  const patchNameById = new Map(patches.map((p) => [p.id, p.name] as const));
  const oldestPatchDate = Math.min(...patches.map((p) => new Date(p.date).getTime() / 1000)); // segundos epoch

  console.log(`Parches objetivo: ${patches.map((p) => `${p.name} (id=${p.id}, desde ${p.date})`).join(", ")}`);
  console.log(`Tiers aceptados: ${[...ACCEPTED_TIERS].join(", ")}`);

  const collected: DraftCandidate[] = [];
  let cursor: number | undefined;
  let pagesScanned = 0;
  let matchesInspected = 0;
  let consecutiveFailures = 0;

  pageLoop: while (pagesScanned < args.maxPages && collected.length < args.maxDrafts) {
    await sleep(args.delayMs);

    let page: ProMatchSummary[];
    try {
      page = (await client.getProMatches(cursor)) as ProMatchSummary[];
    } catch (err) {
      // OpenDota agotó los 3 reintentos del cliente (429/500 sostenido) -- se corta la paginación
      // acá, nunca se crashea: se escribe lo que ya se juntó, nunca se fabrica el resto.
      console.warn(`Página de proMatches falló tras reintentos, se corta acá: ${(err as Error).message}`);
      break;
    }
    pagesScanned++;
    if (page.length === 0) break;

    const candidatesInPage = page.filter((m) => m.start_time >= oldestPatchDate);
    if (candidatesInPage.length === 0) break; // toda la página es más vieja que el parche más viejo -- fin

    for (const summary of candidatesInPage) {
      if (collected.length >= args.maxDrafts) break pageLoop;
      matchesInspected++;
      await sleep(args.delayMs);

      let detail: MatchDetail;
      try {
        detail = (await client.getMatchDetail(summary.match_id)) as MatchDetail;
        consecutiveFailures = 0;
      } catch (err) {
        console.warn(`  match ${summary.match_id}: fetch falló, se omite (${(err as Error).message})`);
        consecutiveFailures++;
        // Los 3 reintentos del cliente (1s/4s/16s, contrato fijo de apps/engine) ya se agotaron
        // para llegar hasta acá -- una racha de fallos consecutivos es un 429 sostenido por más
        // de esos ~21s, no una falla puntual. Pausa larga adicional, propia del script, antes de
        // seguir -- nunca se toca OpenDotaClient para esto.
        if (consecutiveFailures >= CONSECUTIVE_FAILURES_BEFORE_COOLDOWN) {
          console.warn(`  ${consecutiveFailures} fallos seguidos -- pausa de ${COOLDOWN_MS / 1000}s antes de seguir`);
          await sleep(COOLDOWN_MS);
          consecutiveFailures = 0;
        }
        continue;
      }

      const patchName = patchNameById.get(detail.patch);
      if (!patchName) continue; // start_time es un prefiltro barato, el patch real manda
      const candidate = toDraftCandidate(summary.match_id, detail, patchName);
      if (candidate) collected.push(candidate);
    }

    cursor = page.at(-1)?.match_id;
    if (!cursor) break;
  }

  const validated = parseDraftCorpus(collected); // misma validación que usa el motor -- nunca duplicada

  await Bun.write(OUTPUT_PATH, `${JSON.stringify(validated, null, 2)}\n`);

  console.log(`Partidas inspeccionadas: ${matchesInspected} (${pagesScanned} páginas de proMatches)`);
  console.log(`Drafts válidos escritos: ${validated.length} -> ${OUTPUT_PATH.pathname}`);
  if (validated.length < 1000) {
    console.log(
      `Nota: por debajo del objetivo de ~1000-1500 -- volumen real disponible en OpenDota para ` +
        `${patches.map((p) => p.name).join(", ")} con tier premium/professional. No se rellenó con datos falsos.`,
    );
  }
}

main().catch((err) => {
  console.error("fetch-pro-drafts falló:", err);
  process.exit(1);
});
