// V7 PR-3A -- validación del piloto. 100% OFFLINE: lee selection.json, oracle.json y fixtures/.
// Ejecuta certifyProMatch / certifyProMatches SIN modificarlos y contrasta CADA resultado contra el
// original (fixture sanitizado + oráculo calculado sobre el crudo), nunca contra el propio adaptador.
//
//   bun docs/research/pr3a-pilot/run-pilot.ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDraftFormatTurnData } from "../../../apps/engine/src/draft/draft-format-turns";
import {
  DEFAULT_HERO_UNIVERSE,
  createArrayHistoryIndex,
  loadDraftHistoryFromText,
  validateDraftHistoryRecord,
  type DraftHistoryObservation,
  type DraftHistoryRecord,
} from "../../../apps/engine/src/draft-history";
import {
  buildLeagueCatalog,
  certifyProMatch,
  certifyProMatches,
  type CertifyContext,
  type CertifyResult,
} from "../../../scripts/pro/certify-history";

const DIR = import.meta.dir;
const read = (name: string) => JSON.parse(readFileSync(join(DIR, name), "utf8"));
const selection = read("selection.json");
const oracle = read("oracle.json") as Record<string, any>;
const table = loadDraftFormatTurnData().captainsMode;
if (table === null) throw new Error("la tabla de Captain's Mode no cargó");

const catalogBuilt = buildLeagueCatalog(selection.leaguesSubset);
const ids: string[] = selection.selected.map((s: any) => String(s.match_id));
const fixtures: Record<string, any> = Object.fromEntries(ids.map((id) => [id, read(`fixtures/${id}.json`)]));
// Verificación en rojo de los PROPIOS chequeos: PILOT_RED=1 muta los fixtures SIN tocar el oráculo;
// el resultado debe ser failedChecks > 0. Sin la variable, los fixtures son los reales.
if (process.env.PILOT_RED === "1") {
  fixtures[ids[0]!].radiant_win = !fixtures[ids[0]!].radiant_win;
  const pb = fixtures[ids[1]!].picks_bans.find((t: any) => t.is_pick);
  pb.hero_id = pb.hero_id === 1 ? 2 : 1;
}
const summaryOf = (id: string) => selection.selected.find((s: any) => String(s.match_id) === id);
const ctxFor = (id: string): CertifyContext => ({ catalog: catalogBuilt.catalog, captainsModeTable: table, fetchedAt: oracle[id].fetchedAt });
const asInput = (id: string) => ({ match: fixtures[id], summary: summaryOf(id) });

type Check = { name: string; ok: boolean; detail?: string };
const checksFor: Record<string, Check[]> = {};
const check = (id: string, name: string, ok: boolean, detail?: string) => (checksFor[id] ??= []).push({ name, ok, detail });

// --- Expectativa INDEPENDIENTE (sólo oráculo + catálogo crudo + tabla), antes de mirar el resultado ---
function expectedVerdict(id: string) {
  const o = oracle[id];
  const summaryLeague = summaryOf(id).leagueid;
  const ids3 = [summaryLeague, o.detailLeagueId, o.detailLeagueObjectId].filter((v) => v !== null && v !== undefined);
  const consistent = new Set(ids3).size === 1;
  const rows = selection.leaguesSubset.filter((r: any) => r.leagueid === summaryLeague);
  const catalogTier = rows.length === 1 ? rows[0].tier : null;
  const tierOk = catalogTier === "premium" || catalogTier === "professional";
  const tierAgrees = o.detailLeagueTier === null || o.detailLeagueTier === catalogTier;
  const first = o.sequence.split(" ")[0]![0]; // "R" | "D"
  const other = first === "R" ? "D" : "R";
  const tableSeq = table!.turns.map((t) => `${t.team === "first" ? first : other}${t.action === "pick" ? "p" : "b"}`).join(" ");
  const seqOk = o.sequence === tableSeq;
  const heroes = new Set<number>([...o.radiantPickHeroes, ...o.direPickHeroes]);
  const rawPb = fixtures[id].picks_bans as any[];
  for (const t of rawPb) heroes.add(t.hero_id);
  const universeOk = [...heroes].every((h) => DEFAULT_HERO_UNIVERSE.has(h));
  const certified = consistent && tierOk && tierAgrees && o.gameMode === 2 && o.ordersContiguous && o.heroIdsDistinct && seqOk && universeOk;
  return { certified, consistent, catalogTier, tierOk, seqOk, universeOk, tableSeq };
}

function expectedPositions(id: string) {
  const f = fixtures[id];
  const out: { heroId: number; side: string; position: number }[] = [];
  for (const [side, isRad, team] of [["radiant", true, 0], ["dire", false, 1]] as const) {
    const ps = f.players.filter((p: any) => p.isRadiant === isRad);
    const picks = f.picks_bans.filter((t: any) => t.is_pick && t.team === team).map((t: any) => t.hero_id).sort((a: number, b: number) => a - b);
    const heroes = ps.map((p: any) => p.hero_id).sort((a: number, b: number) => a - b);
    const perm = JSON.stringify(ps.map((p: any) => p.position_est).sort()) === "[1,2,3,4,5]";
    if (perm && JSON.stringify(picks) === JSON.stringify(heroes)) for (const p of ps) out.push({ heroId: p.hero_id, side, position: p.position_est });
  }
  return out.sort((a, b) => a.heroId - b.heroId);
}

const FORBIDDEN_KEYS = ["account_id", "personaname", "steamid", "raw_json", "avatar", "player_slot", "name", "leagueid", "league_name"];
function collectKeys(v: unknown, acc = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => collectKeys(x, acc));
  else if (typeof v === "object" && v !== null) for (const [k, x] of Object.entries(v)) (acc.add(k), collectKeys(x, acc));
  return acc;
}

// --- Ejecución individual ---
const results: Record<string, CertifyResult> = {};
for (const id of ids) results[id] = certifyProMatch(asInput(id), ctxFor(id));

const report: any[] = [];
for (const id of ids) {
  const r = results[id]!;
  const exp = expectedVerdict(id);
  const o = oracle[id];
  const f = fixtures[id];

  // 1-2. veredicto vs expectativa independiente
  check(id, "veredicto == expectativa independiente", (r.status === "certified") === exp.certified, `actual=${r.status}${r.status === "certified" ? "" : ":" + r.code} esperado=${exp.certified ? "certified" : "no certificada"}`);
  check(id, "tier real de la liga (catálogo crudo) elegible", exp.tierOk, `catalogTier=${exp.catalogTier}`);
  check(id, "tres leagueid coinciden (resumen/detalle/detail.league)", exp.consistent);
  check(id, "secuencia cruda == tabla CM (desde el primer actor)", exp.seqOk);
  if (r.status !== "certified") {
    report.push({ id, status: r.status, code: r.code, exp });
    continue;
  }
  const rec = r.record as any;
  // 3. identidad y tier
  check(id, "matchId == match_id original", rec.provenance.sourceMatchId === String(o.detailMatchId) && r.certification.matchId === String(o.detailMatchId));
  check(id, "certificación: leagueId/tier == originales", r.certification.leagueId === o.detailLeagueId && r.certification.tier === exp.catalogTier && r.certification.tier === o.detailLeagueTier);
  check(id, "procedencia opendota_league + clase professional", rec.provenance.source === "opendota_league" && rec.evidenceClass === "professional");
  check(id, "fetchedAt == momento real de la obtención", rec.provenance.fetchedAt === o.fetchedAt && r.certification.verifiedAt === o.fetchedAt);
  // 4. formato / game mode
  check(id, "game_mode crudo 2 -> captains_mode, sourceGameMode 2", o.gameMode === 2 && rec.format === "captains_mode" && rec.sourceGameMode === 2);
  // 5. picks y bans, acción por acción contra el crudo
  const raw = [...f.picks_bans].sort((a: any, b: any) => a.order - b.order);
  const actionsMatch =
    rec.actions.length === raw.length &&
    rec.actions.every((a: any, i: number) => a.order === raw[i].order && a.heroId === raw[i].hero_id && a.action === (raw[i].is_pick ? "pick" : "ban") && a.side === (raw[i].team === 0 ? "radiant" : "dire"));
  check(id, "24 acciones == picks_bans crudo (orden, héroe, acción, bando)", actionsMatch, `n=${rec.actions.length}`);
  check(id, "conteos 10 picks / 14 bans == oráculo", rec.actions.filter((a: any) => a.action === "pick").length === o.pickCount && rec.actions.filter((a: any) => a.action === "ban").length === o.banCount);
  const recPicks = (side: string) => rec.actions.filter((a: any) => a.action === "pick" && a.side === side).map((a: any) => a.heroId).sort((a: number, b: number) => a - b);
  check(id, "héroes pickeados por bando == oráculo del crudo (y == héroes de los jugadores)", JSON.stringify(recPicks("radiant")) === JSON.stringify(o.radiantPickHeroes) && JSON.stringify(recPicks("dire")) === JSON.stringify(o.direPickHeroes) && JSON.stringify(o.radiantPickHeroes) === JSON.stringify(o.radiantPlayerHeroes) && JSON.stringify(o.direPickHeroes) === JSON.stringify(o.direPlayerHeroes));
  check(id, "firstActionSide == bando del order 0 crudo", rec.firstActionSide === (raw[0].team === 0 ? "radiant" : "dire"));
  check(id, "completitud 'complete' sólo porque 24 == tabla", rec.completeness === (o.turnCount === table!.turns.length ? "complete" : "prefix"));
  // 6. ganador
  const expOutcome = o.radiantWinRaw === true ? { status: "known", winner: "radiant" } : o.radiantWinRaw === false ? { status: "known", winner: "dire" } : { status: "unknown" };
  check(id, "ganador == radiant_win crudo (sin fabricar)", JSON.stringify(rec.outcome) === JSON.stringify(expOutcome), JSON.stringify(rec.outcome));
  // 7. parche
  check(id, "parche numérico -> source_id_only (jamás exact)", typeof o.patchRaw === "number" ? JSON.stringify(rec.patch) === JSON.stringify({ state: "source_id_only", sourceId: String(o.patchRaw) }) : rec.patch.state === "unknown", JSON.stringify(rec.patch));
  // 8. posiciones
  const expPos = expectedPositions(id);
  const gotPos = rec.positions.map((p: any) => ({ heroId: p.heroId, side: p.side, position: p.position })).sort((a: any, b: any) => a.heroId - b.heroId);
  check(id, "posiciones == position_est cruda por jugador/bando", JSON.stringify(gotPos) === JSON.stringify(expPos), `n=${gotPos.length}`);
  check(id, "toda posición etiquetada source_estimated", rec.positions.every((p: any) => p.basis === "source_estimated"));
  check(id, "cada posición apunta a un héroe pickeado por ese bando", rec.positions.every((p: any) => rec.actions.some((a: any) => a.action === "pick" && a.heroId === p.heroId && a.side === p.side)));
  // 9. PII / campos ajenos al esquema
  const keys = collectKeys(r);
  const leaked = FORBIDDEN_KEYS.filter((k) => keys.has(k));
  const text = JSON.stringify(r);
  check(id, "salida sin account_id/nombres/player_slot/raw_json/league name", leaked.length === 0 && !text.includes("EPL") && !/account|persona|steam/i.test(text), leaked.join(","));
  // 10. PR #49 (validador, con la tabla y el universo REALES), tras un viaje JSON
  const revalidated = validateDraftHistoryRecord(JSON.parse(JSON.stringify(rec)), { captainsModeTable: table! });
  check(id, "PR #49: revalida tras JSON roundtrip", revalidated.ok === true);
  report.push({ id, status: "certified", completeness: rec.completeness, outcome: rec.outcome, patch: rec.patch, positions: rec.positions.length });
}

// --- Lote: duplicados y trazabilidad ---
const ctxBatch: CertifyContext = { catalog: catalogBuilt.catalog, captainsModeTable: table, fetchedAt: oracle[ids[ids.length - 1]!].fetchedAt };
const batchIdentity = (id: string) => ({ match: fixtures[id], summary: summaryOf(id) });
const batch = certifyProMatches([...ids.map(batchIdentity), batchIdentity(ids[0]!)], ctxBatch);
const expectedCertCount = ids.filter((id) => expectedVerdict(id).certified).length;
const batchChecks: Check[] = [
  { name: "lote: 5 originales + 1 repetida idéntica -> certificadas == esperadas, 1 duplicado descartado, 0 conflictos", ok: batch.certified.length === expectedCertCount && batch.duplicatesDropped === 1 && batch.conflictingDuplicates.length === 0, detail: `cert=${batch.certified.length} dup=${batch.duplicatesDropped} conf=${batch.conflictingDuplicates.length} notCert=${batch.notCertified.length}` },
  { name: "lote: cada certificada trazable (certification.matchId == provenance.sourceMatchId)", ok: batch.certified.every((c) => c.certification.matchId === c.record.provenance.sourceMatchId) },
  { name: "lote: ids certificados == ids esperados", ok: JSON.stringify(batch.certified.map((c) => c.record.provenance.sourceMatchId).sort()) === JSON.stringify(ids.filter((id) => expectedVerdict(id).certified).sort()) },
];
const tampered = structuredClone(fixtures[ids[0]!]);
tampered.radiant_win = !tampered.radiant_win;
const conflictBatch = certifyProMatches([batchIdentity(ids[0]!), { match: tampered, summary: summaryOf(ids[0]!) }], ctxBatch);
batchChecks.push({ name: "lote: misma partida con contenido distinto -> descartada entera (conflicto), no se elige una", ok: conflictBatch.certified.length === 0 && conflictBatch.conflictingDuplicates.length === 1 });

// --- PR #49 loader + PR #50 búsqueda sobre los certificados REALES ---
const records: DraftHistoryRecord[] = batch.certified.map((c) => c.record);
const loaded = loadDraftHistoryFromText(JSON.stringify({ schemaVersion: 1, records }), { captainsModeTable: table! });
const index = createArrayHistoryIndex(records);
const first = records[0] as any;
const radiantPicks = first.actions.filter((a: any) => a.action === "pick" && a.side === "radiant").map((a: any) => a.heroId);
const observation: DraftHistoryObservation = { schemaVersion: 1, perspective: "radiant", format: "captains_mode", patch: { state: "unknown" }, allyHeroIds: radiantPicks.slice(0, 2), revealedEnemyHeroIds: [], bans: { status: "unknown" } };
const search = index.search(observation);
const hitIds = [...search.examples.wins, ...search.examples.losses, ...search.examples.unknown].map((h: any) => JSON.stringify(h)).join("|");
const integration: Check[] = [
  { name: "PR #49 loader: todos los certificados cargan, 0 rechazados", ok: loaded.status === "ok" && loaded.records.length === records.length && loaded.rejectedCount === 0, detail: `status=${loaded.status} n=${loaded.records.length} rej=${loaded.rejectedCount}` },
  { name: "PR #50: todos los certificados son elegibles (procedencia verificable), 0 excluidos", ok: search.population.eligibleRecords === records.length && search.population.excludedUnverifiedProvenance === 0 && search.population.excludedByEvidenceClass === 0, detail: JSON.stringify(search.population) },
  { name: "PR #50: la búsqueda por 2 aliados de un registro lo recupera", ok: search.status === "ok" && search.population.matchedRecords >= 1 && hitIds.includes(first.provenance.sourceMatchId), detail: `status=${search.status} matched=${search.population.matchedRecords}` },
];

// --- Controles negativos sobre forma REAL (no cuentan como partidas del piloto) ---
const base = ids[0]!;
const mutate = (fn: (m: any) => void, catalogRows?: any[]) => {
  const m = structuredClone(fixtures[base]);
  fn(m);
  const catalog = catalogRows ? buildLeagueCatalog(catalogRows).catalog : catalogBuilt.catalog;
  return certifyProMatch({ match: m, summary: summaryOf(base) }, { ...ctxFor(base), catalog });
};
const code = (r: CertifyResult) => (r.status === "certified" ? "certified" : `${r.status}:${r.code}`);
const controls = [
  ["liga fuera del catálogo", mutate(() => {}, [{ leagueid: 1, tier: "premium" }]), "quarantined:LEAGUE_NOT_IN_CATALOG"],
  ["liga amateur en catálogo", mutate(() => {}, [{ leagueid: selection.selectedLeagues.l1, tier: "amateur" }]), "rejected:LEAGUE_TIER_NOT_ELIGIBLE"],
  ["tier del payload contradice al catálogo", mutate((m) => (m.league.tier = "premium")), "quarantined:LEAGUE_TIER_CONTRADICTION"],
  ["detail.leagueid distinto del resumen", mutate((m) => (m.leagueid = 123)), "quarantined:LEAGUE_ID_CONTRADICTION"],
  ["game_mode != 2", mutate((m) => (m.game_mode = 22)), "rejected:GAME_MODE_NOT_CAPTAINS_MODE"],
  ["secuencia con un turno intercambiado de bando", mutate((m) => (m.picks_bans[0].team = 1 - m.picks_bans[0].team)), "quarantined:RECORD_VALIDATION_FAILED"],
  ["héroe repetido", mutate((m) => (m.picks_bans[1].hero_id = m.picks_bans[0].hero_id)), "quarantined:RECORD_VALIDATION_FAILED"],
  ["hueco en order", mutate((m) => (m.picks_bans[5].order = 99)), "quarantined:CM_SEQUENCE_INVALID"],
  ["sin picks_bans", mutate((m) => delete m.picks_bans), "quarantined:PICKS_BANS_MISSING"],
] as const;
const controlChecks: Check[] = controls.map(([name, got, want]) => ({ name: `control: ${name}`, ok: code(got) === want, detail: `got=${code(got)} want=${want}` }));
const noWinner = mutate((m) => delete m.radiant_win);
controlChecks.push({ name: "control: sin radiant_win -> unknown (no Dire por defecto)", ok: noWinner.status === "certified" && (noWinner.record as any).outcome.status === "unknown" });
const noPatch = mutate((m) => (m.patch = "7.41e"));
controlChecks.push({ name: "control: parche string no se acepta como exact", ok: noPatch.status === "certified" && (noPatch.record as any).patch.state === "unknown" });
const dupPos = mutate((m) => { const p = m.players.filter((x: any) => x.isRadiant === true); p[1].position_est = p[0].position_est; });
controlChecks.push({ name: "control: position_est duplicada en un bando -> ese bando sin posiciones", ok: dupPos.status === "certified" && (dupPos.record as any).positions.every((p: any) => p.side === "dire") && (dupPos.record as any).positions.length === 5 });

// --- Resumen ---
const all = ids.flatMap((id) => checksFor[id] ?? []);
const failed = [...all, ...batchChecks, ...integration, ...controlChecks].filter((c) => !c.ok);
const falseCertified = ids.filter((id) => results[id]!.status === "certified" && !expectedVerdict(id).certified);
const falseRejected = ids.filter((id) => results[id]!.status !== "certified" && expectedVerdict(id).certified);
const out = {
  perMatch: ids.map((id) => ({ id, status: results[id]!.status, code: (results[id] as any).code ?? null, checks: checksFor[id]!.length, failed: checksFor[id]!.filter((c) => !c.ok) })),
  batchChecks, integration, controlChecks,
  totals: { evaluated: ids.length, certified: ids.filter((id) => results[id]!.status === "certified").length, falseCertified, falseRejected, failedChecks: failed.length },
  failed,
};
writeFileSync(join(DIR, "results.json"), JSON.stringify(out, null, 2));
for (const m of out.perMatch) console.log(m.id, m.status, m.code ?? "", `${m.checks - m.failed.length}/${m.checks} checks`, m.failed.map((f) => f.name + " [" + (f.detail ?? "") + "]").join("; "));
for (const c of [...batchChecks, ...integration, ...controlChecks]) console.log(c.ok ? "PASS" : "FAIL", c.name, c.ok ? "" : c.detail ?? "");
console.log(JSON.stringify(out.totals));
