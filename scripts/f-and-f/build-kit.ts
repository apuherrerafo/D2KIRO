#!/usr/bin/env bun
// FRIENDS_FAMILY_READY — kit de evaluación humana. Genera, de forma DETERMINISTA, 15 situaciones de draft
// con el motor ACTUAL (Coach real del simulador) para que 2-3 personas las juzguen por separado.
//
//   bun scripts/f-and-f/build-kit.ts --check   ->  verifica que el kit versionado se reproduce byte a byte (y 0 recomendaciones ilegales)
//   bun scripts/f-and-f/build-kit.ts   ->  qa/friends-family/{situaciones.json, manifest.json (no versionado)}
//                                          qa/friends-family/paquete-evaluadores/situaciones.html
//
// - Los estados salen de drafts reproducibles del simulador (semilla + política). La semilla y la "etiqueta de
//   cobertura" van SOLO al manifest (para los organizadores). El HTML/JSON de evaluación NO las trae: ni semilla,
//   ni héroes rivales sellados, ni posiciones privadas del bot, ni etiquetas o resultados del Golden antiguo.
// - Este script no juzga nada: no codifica ninguna respuesta esperada. Elige por criterios de cobertura.
// - Verifica la legalidad de cada top-5 (ni baneado, ni ya elegido). Una recomendación ilegal ABORTA la generación.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SIDES, createLab, loadWorldData, muteLog, playDraft, unmuteLog, type Policy, type Position, type StateRecord, type WorldData } from "../wave5/driver";

const ROOT = join(import.meta.dir, "../..");
const OUT = join(ROOT, "qa/friends-family");
const PACKAGE = join(OUT, "paquete-evaluadores");
const SEEDS = Array.from({ length: 100 }, (_, i) => `FF${String(i + 1).padStart(3, "0")}`);
const POSITIONS: readonly Position[] = [1, 2, 3, 4, 5];

const POSITION_NAME: Record<number, string> = { 1: "Carry (pos 1)", 2: "Mid (pos 2)", 3: "Offlane (pos 3)", 4: "Support (pos 4)", 5: "Hard support (pos 5)" };

interface CoachCard { heroId: number; position: number; roleStatus: string; confidence: string; badges: string[]; rationale: string }
interface CoachJson {
  primaryAction: { strategy: { kind: string; position?: number; possiblePositions?: number[]; rationale: string }; label: string };
  shortlist: CoachCard[];
  meta: { round: number | null; confidence: string };
}

const coachOf = (state: StateRecord): CoachJson => (JSON.parse(state.raw ?? "null") as { output: CoachJson }).output;
const cards = (state: StateRecord): CoachCard[] => coachOf(state).shortlist.slice(0, 5);
const coversPosition = (state: StateRecord, position: number): boolean => state.ownBeliefs.some((b) => b.positions.includes(position));

interface Slot {
  id: string;
  /** Cobertura (solo para organizadores). */
  coverage: string;
  suspect?: string;
  policy: Policy;
  pick: (states: readonly StateRecord[]) => number;
}

const first = (states: readonly StateRecord[], test: (s: StateRecord) => boolean): number => states.findIndex((s) => s.shortlist.length >= 5 && s.raw !== undefined && test(s));
const supportsOnly = (s: StateRecord): boolean => cards(s).every((c) => c.position === 4 || c.position === 5);
const carryHeavy = (s: StateRecord): boolean => cards(s).filter((c) => c.position === 1).length >= 3;

export const SLOTS: Slot[] = [
  { id: "E1", coverage: "early/primer pick", suspect: "supports-en-primeros-picks", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 1 && s.ownSealedInRound === 0 && supportsOnly(s)) },
  { id: "E2", coverage: "early/primer pick", suspect: "supports-en-primeros-picks", policy: "varied", pick: (st) => first(st, (s) => s.round === 1 && s.ownSealedInRound === 0 && supportsOnly(s)) },
  { id: "E3", coverage: "early/segundo pick de la ronda", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 1 && s.ownSealedInRound === 1) },
  { id: "C1", coverage: "respuesta a counters", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 2 && s.revealedEnemy.length >= 2 && s.cardBadges.includes("COUNTER")) },
  { id: "C2", coverage: "respuesta a counters", policy: "varied", pick: (st) => first(st, (s) => s.round === 2 && s.revealedEnemy.length >= 2 && s.cardBadges.includes("COUNTER")) },
  { id: "C3", coverage: "respuesta a counters/3 rivales revelados", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 2 && s.revealedEnemy.length >= 3 && s.cardBadges.includes("COUNTER")) },
  { id: "N1", coverage: "necesidades de composición", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 2 && s.ownPicks.length >= 2 && s.cardBadges.includes("SYNERGY")) },
  { id: "N2", coverage: "necesidades de composición", policy: "varied", pick: (st) => first(st, (s) => s.round === 2 && s.ownPicks.length >= 2 && s.cardBadges.includes("SYNERGY")) },
  { id: "R1", coverage: "rol faltante: mid", suspect: "carries-sin-mid", policy: "follow-coach", pick: (st) => first(st, (s) => s.ownPicks.length >= 2 && !coversPosition(s, 2) && carryHeavy(s)) },
  { id: "R2", coverage: "rol faltante: mid", suspect: "carries-sin-mid", policy: "varied", pick: (st) => first(st, (s) => s.ownPicks.length >= 2 && !coversPosition(s, 2) && carryHeavy(s)) },
  { id: "R3", coverage: "rol faltante: hard support", policy: "follow-coach", pick: (st) => first(st, (s) => s.round !== 1 && s.ownPicks.length >= 3 && !coversPosition(s, 5)) },
  { id: "L1", coverage: "late draft", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 3) },
  { id: "L2", coverage: "late draft", policy: "varied", pick: (st) => first(st, (s) => s.round === 3) },
  { id: "L3", coverage: "late draft/4 picks propios", policy: "follow-coach", pick: (st) => first(st, (s) => s.round === 3 && s.ownPicks.length >= 4) },
  { id: "L4", coverage: "late draft/rivales casi completos", policy: "varied", pick: (st) => first(st, (s) => s.round === 3 && s.revealedEnemy.length >= 4 && s.cardBadges.includes("COUNTER")) },
];

export interface EvalHero { rank: number; heroId: number; name: string; positionShown: string; confidence: string; badges: string[]; explanation: string }
export interface EvalScenario {
  id: string; // "S01".."S15" — orden barajado; no revela la cobertura
  side: "Radiant" | "Dire";
  momento: string;
  bans: string[];
  ownPicks: string[];
  revealedEnemy: string[];
  sealedEnemySeats: number;
  coachAdvice: { label: string; rationale: string; positionsNamed: string[] };
  top5: EvalHero[];
}

/** Una recomendación ilegal invalida el kit entero (gate 1: cero picks ilegales). */
export function assertLegal(state: StateRecord): void {
  const taken = new Set<number>([...state.banned, ...state.ownPicks, ...state.revealedEnemy]);
  for (const c of cards(state)) if (taken.has(c.heroId)) throw new Error(`recomendación ILEGAL en el estado ${state.index}: héroe ${c.heroId} ya baneado o elegido`);
  if (new Set(cards(state).map((c) => c.heroId)).size !== cards(state).length) throw new Error(`héroe repetido en el top-5 del estado ${state.index}`);
}

const MOMENTO: Record<number, string> = { 1: "Primera ronda de picks (a ciegas)", 2: "Segunda ronda de picks (a ciegas)", 3: "Tercera ronda de picks (cierre)" };

function toEval(data: WorldData, state: StateRecord, id: string, side: "radiant" | "dire"): EvalScenario {
  const coach = coachOf(state);
  const nm = (h: number): string => data.name(h);
  const strat = coach.primaryAction.strategy;
  return {
    id,
    side: side === "radiant" ? "Radiant" : "Dire",
    momento: MOMENTO[state.round ?? 1] ?? "Ronda de picks",
    bans: state.banned.map(nm),
    // Cada pick propio con el rol que el coach le atribuye (igual que la pantalla real); sin rol, solo el nombre.
    ownPicks: state.ownPicks.map((h) => {
      const belief = state.ownBeliefs.find((b) => b.heroId === h);
      return belief && belief.positions.length > 0 ? `${nm(h)} (${belief.positions.map((p) => `pos ${p}`).join(" / ")})` : nm(h);
    }),
    revealedEnemy: state.revealedEnemy.map(nm),
    sealedEnemySeats: state.hiddenEnemySlots,
    coachAdvice: {
      label: coach.primaryAction.label,
      rationale: strat.rationale,
      positionsNamed: (strat.position !== undefined ? [strat.position] : strat.possiblePositions ?? []).map((p) => POSITION_NAME[p] ?? `pos ${p}`),
    },
    top5: cards(state).map((c, i) => ({
      rank: i + 1,
      heroId: c.heroId,
      name: nm(c.heroId),
      // Igual que la pantalla real: si el motor no resolvió la posición, dice "Rol por definir".
      positionShown: c.roleStatus === "UNRESOLVED" ? "Rol por definir" : `${c.roleStatus === "LIKELY" ? "Probable: " : ""}${POSITION_NAME[c.position] ?? `pos ${c.position}`}`,
      confidence: c.confidence,
      badges: c.badges,
      explanation: c.rationale,
    })),
  };
}

const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Orden de presentación barajado y estable (no deja ver la cobertura por la numeración). */
export function shuffledOrder(ids: readonly string[]): string[] {
  return [...ids].sort((a, b) => sha(`ff-order:${a}`).localeCompare(sha(`ff-order:${b}`)));
}

async function main(): Promise<void> {
  const data = loadWorldData();
  muteLog();
  const used = new Set<string>();
  const found: { slot: Slot; seed: string; side: "radiant" | "dire"; position: Position; state: StateRecord; draftKey: string }[] = [];
  const unmatched: string[] = [];
  for (const slot of SLOTS) {
    let hit = false;
    for (let n = 0; n < SEEDS.length && !hit; n += 1) {
      const seed = SEEDS[(n + found.length * 7) % SEEDS.length]!;
      const side = SIDES[(n + found.length) % 2]!;
      const position = POSITIONS[(n + found.length) % POSITIONS.length]!;
      const draftKey = `${slot.policy}:${seed}:${side}`;
      if (used.has(draftKey)) continue;
      const record = await playDraft(createLab(data), { policy: slot.policy, seed, side, humanPosition: position, accountId: null, keepRaw: true });
      if (!record.completed) continue;
      const index = slot.pick(record.states);
      if (index < 0) continue;
      const state = record.states[index]!;
      assertLegal(state);
      used.add(draftKey);
      found.push({ slot, seed, side, position, state, draftKey });
      hit = true;
    }
    if (!hit) unmatched.push(slot.id);
  }
  unmuteLog();
  if (found.length < 15) throw new Error(`solo ${found.length}/15 situaciones; sin cobertura para: ${unmatched.join(", ")}`);
  const chosen = found.slice(0, 15); // L4 queda de reserva si todas las demás se cubrieron

  const order = shuffledOrder(chosen.map((f) => f.slot.id));
  const idOf = new Map(order.map((slotId, i) => [slotId, `S${String(i + 1).padStart(2, "0")}`]));
  const scenarios = chosen
    .map((f) => ({ f, ev: toEval(data, f.state, idOf.get(f.slot.id)!, f.side) }))
    .sort((a, b) => a.ev.id.localeCompare(b.ev.id));

  const evalDoc = { schema: "ff-scenarios/v1", count: scenarios.length, scenarios: scenarios.map((s) => s.ev) };
  const evalJson = JSON.stringify(evalDoc, null, 2);
  const manifest = {
    schema: "ff-manifest/v1",
    aviso: "SOLO ORGANIZADORES. No compartir con evaluadores: contiene semillas y etiquetas de cobertura.",
    scenariosSha256: sha(evalJson),
    snapshot: data.snapshot.id,
    patch: "7.41e",
    unusedReserveSlots: found.slice(15).map((f) => f.slot.id),
    scenarios: scenarios.map(({ f, ev }) => ({ id: ev.id, slot: f.slot.id, coverage: f.slot.coverage, suspect: f.slot.suspect ?? null, policy: f.slot.policy, seed: f.seed, side: f.side, humanPosition: f.position, draftKey: f.draftKey, stateIndex: f.state.index })),
    reproduce: ["bun scripts/eval/freeze-empirical-snapshot.ts --verify=W5-EMP-001", "bun scripts/f-and-f/build-kit.ts"],
  };

  const template = readFileSync(join(import.meta.dir, "template.html"), "utf8");
  const html = template.replace("/*__DATA__*/null", () => evalJson.replace(/</g, "\\u003c")).replace("__SCENARIOS_SHA__", manifest.scenariosSha256);
  const files = [
    { path: join(OUT, "situaciones.json"), content: evalJson + "\n" },
    { path: join(PACKAGE, "situaciones.html"), content: html },
  ];
  // --check: reproducibilidad. Regenera en memoria y exige que el kit versionado sea byte-idéntico (mismo motor + snapshot).
  if (process.argv.includes("--check")) {
    const stale = files.filter((f) => !existsSync(f.path) || readFileSync(f.path, "utf8") !== f.content).map((f) => f.path);
    if (stale.length > 0) {
      process.stderr.write(`KIT NO REPRODUCIBLE: difiere de lo versionado (¿cambió el motor, el snapshot o la plantilla?):\n${stale.map((x) => `  - ${x}`).join("\n")}\n`);
      process.exit(1);
    }
    process.stdout.write(`kit reproducible: ${scenarios.length} situaciones, sha ${manifest.scenariosSha256.slice(0, 12)}, 0 recomendaciones ilegales\n`);
    return;
  }
  mkdirSync(PACKAGE, { recursive: true });
  for (const f of files) writeFileSync(f.path, f.content);
  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  process.stdout.write(`kit generado: ${scenarios.length} situaciones en ${OUT} (HTML en ${PACKAGE})\nsin cobertura: ${unmatched.length ? unmatched.join(", ") : "(ninguna)"}\n`);
}

if (import.meta.main) await main();
