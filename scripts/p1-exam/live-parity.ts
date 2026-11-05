#!/usr/bin/env bun
// Live Companion vs Simulator PARITY -- measurement tool (not a test, never imported from apps/). Same real-data driver as the P1 exam
// (scripts/wave5/driver.ts: real routes + Enemy Bot + V6 over the FROZEN snapshot + curated data).
//
//   bun scripts/p1-exam/live-parity.ts --out=docs/diagnostics/ENGINE_LIVE_PARITY_AFTER.json [--drafts=20] [--root=<other worktree>]
//   bun scripts/p1-exam/live-parity.ts --compare=<before.json>,<after.json> --out=docs/diagnostics/ENGINE_LIVE_PARITY.md
//
// For every own decision of N simulator drafts it builds a Live Companion TWIN (a `manual` session fed ONLY what the Player sees in the
// simulator: bans, own picks, revealed rivals) and asks the V3 Coach there. `--root` points the engine code at another checkout (the
// BEFORE run is the same script over the base commit), so both runs play the SAME drafts: the Player follows the board (V4/board code is
// untouched by the fix) and the picks are seeded.
//
// Artifacts are deterministic (no latency, no ids). Refuses nothing but writes only where --out says.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const rec = (v: unknown): any => (typeof v === "object" && v !== null ? v : {});
const POS = [1, 2, 3, 4, 5] as const;

// ---------------------------------------------------------------------------------------------------------------------------------------
// COMPARE mode: BEFORE vs AFTER over the same drafts -> Markdown.
// ---------------------------------------------------------------------------------------------------------------------------------------
function summarize(run: any) {
  const rows: any[] = run.rows;
  const c = (f: (r: any) => boolean) => rows.filter(f).length;
  const liveEmptyBoardHas = rows.filter((r) => r.live.v3Null && r.sim.boardAnyHero);
  return {
    states: rows.length,
    liveV3Null: c((r) => r.live.v3Null),
    liveNullWhileBoardShowsHeroes: liveEmptyBoardHas.length,
    liveNullWhileEligibleExist: c((r) => r.live.v3Null && r.live.eligibleExists === true),
    liveShowsLimitedList: c((r) => !r.live.v3Null && r.live.actionSupport === "LIMITED" && r.live.cards.length > 0),
    liveShowsPrimaryAction: c((r) => !r.live.v3Null && r.live.actionSupport !== "LIMITED"),
    primaryShownWithoutStrongCard: c((r) => !r.live.v3Null && r.live.actionSupport !== "LIMITED" && !r.live.cards.some((x: any) => x.strength === "STRONG")),
    limitedCardsMarkedWeakOnly: c((r) => !r.live.v3Null && r.live.actionSupport === "LIMITED" && r.live.cards.every((x: any) => x.strength === "WEAK")),
    occupiedPositionSuggested: c((r) => r.live.occupiedNamed.length > 0),
    occupiedPositionSuggestedAssigned: c((r) => r.live.assigned.occupiedNamed.length > 0),
    liveNullWithNoEligible: c((r) => r.live.v3Null && r.live.eligibleExists === false),
    firstPickStates: c((r) => r.own.length === 0),
    firstPickLiveNull: c((r) => r.own.length === 0 && r.live.v3Null),
    firstPickLiveShowsHeroes: c((r) => r.own.length === 0 && !r.live.v3Null && r.live.cards.length > 0),
    simBoardShowsHeroes: c((r) => r.sim.boardAnyHero),
  };
}

function compareMode(spec: string, out: string | undefined) {
  const [beforePath, afterPath] = spec.split(",").map((p) => resolve(p!));
  const before = JSON.parse(readFileSync(beforePath!, "utf8"));
  const after = JSON.parse(readFileSync(afterPath!, "utf8"));
  const keyOf = (r: any) => `${r.key}#${r.index}`;
  const sameDrafts = before.rows.length === after.rows.length && before.rows.every((r: any, i: number) => keyOf(r) === keyOf(after.rows[i]) && JSON.stringify([r.banned, r.own, r.enemyRev]) === JSON.stringify([after.rows[i].banned, after.rows[i].own, after.rows[i].enemyRev]));
  const b = summarize(before);
  const a = summarize(after);
  const labels: Record<string, string> = {
    states: "Estados (decisiones propias)",
    simBoardShowsHeroes: "El tablero del simulador muestra héroes",
    liveV3Null: "Live Companion SIN ninguna recomendación",
    liveNullWhileBoardShowsHeroes: "...mientras el tablero sí muestra héroes",
    liveNullWhileEligibleExist: "...habiendo héroes elegibles (evidencia limitada)",
    liveNullWithNoEligible: "...sin ningún héroe con fundamento (vacío legítimo)",
    liveShowsLimitedList: "Live muestra lista con «Evidencia limitada» y SIN acción principal",
    liveShowsPrimaryAction: "Live muestra acción principal («Qué hacer ahora»)",
    primaryShownWithoutStrongCard: "Acción principal mostrada SIN ningún héroe fuerte (debe ser 0)",
    limitedCardsMarkedWeakOnly: "Listas limitadas con TODAS las tarjetas marcadas débiles (coherencia)",
    occupiedPositionSuggested: "Live sugiere una posición YA OCUPADA (sin asignaciones del Player)",
    occupiedPositionSuggestedAssigned: "Live sugiere una posición YA OCUPADA (con las asignaciones del Player)",
    firstPickStates: "Primer pick: estados",
    firstPickLiveNull: "Primer pick: Live vacío",
    firstPickLiveShowsHeroes: "Primer pick: Live muestra héroes",
  };
  const lines = [
    "# Live Companion vs Simulador — antes / después (mismos drafts)",
    "",
    `Snapshot: ${after.snapshot}. Drafts idénticos antes y después (mismos bans, picks propios y rivales revelados en cada decisión): **${sameDrafts ? "sí" : "NO — la comparación no es válida"}**.`,
    "Antes = base del PR #112 (0c6eb571). Después = esta rama. El simulador (V4/tablero) no cambia: es el punto de referencia.",
    "",
    "| Medida | Antes | Después |",
    "|---|---:|---:|",
    ...Object.entries(labels).map(([k, label]) => `| ${label} | ${(b as any)[k]} | ${(a as any)[k]} |`),
    "",
  ];
  const text = lines.join("\n");
  if (out) writeFileSync(resolve(out), text);
  console.log(text);
  if (!sameDrafts) process.exitCode = 2;
}

const compare = arg("compare");
if (compare) {
  compareMode(compare, arg("out"));
  process.exit();
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// MEASURE mode
// ---------------------------------------------------------------------------------------------------------------------------------------
const root = resolve(arg("root") ?? resolve(import.meta.dir, "../.."));
const DRAFTS = Number(arg("drafts") ?? 20);
const OUT = arg("out");
if (!OUT) throw new Error("--out is required");
const imp = (path: string) => import(`${root}/${path}`);
const { loadWorldData, createLab, jsonRequest, askCoach, muteLog, SIDES, seededIndex, visibleHeroes } = await imp("scripts/wave5/driver.ts");
const { isCandidateAdmittedForPosition } = await imp("apps/engine/src/signals/hero-positions.ts");
const { buildCoachObservableState } = await imp("apps/engine/src/coach/observable-state.ts");
const { deriveDecisionContextFromView } = await imp("apps/engine/src/drafter/decision-context.ts");
const { extractHeroCandidates, demoteRevealedHardCountered, revealedEnemyHeroes } = await imp("apps/engine/src/coach/hero-card.ts");
const { evaluateEligibility } = await imp("apps/engine/src/coach/recommendation-eligibility.ts");
const { eligibilityInputOf } = await imp("apps/engine/src/coach/eligibility-input.ts");
const { buildRecommendationSetFromPerspective } = await imp("apps/engine/src/recommendation/build-from-perspective.ts");
const { AP_RECOMMENDATION_OUTPUT_LIMIT } = await imp("apps/engine/src/recommendation/construct.ts");
const { buildSuggestions } = await imp("apps/engine/src/signals/mix.ts");
const { loadHeroSynergies } = await imp("apps/engine/src/signals/hero-synergies.ts");
const { loadHeroCapabilities } = await imp("apps/engine/src/draft-paths/capabilities.ts");

const world = loadWorldData();
const synergies = loadHeroSynergies();
const capabilities = loadHeroCapabilities();
muteLog();

async function simSession(lab: any, side: string, humanPosition: number, seed: string) {
  const created = await lab.routes.post(jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: side, adapterKind: "simulator", humanPosition, simulatorSeed: seed, partyContext: { partySize: 5, side, controlledSlots: [] }, controlledPositions: POS }));
  if (created.status !== 201) return null;
  const { sessionId } = (await created.json()) as any;
  const r = await lab.routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);
  return r.status === 200 ? sessionId : null;
}

/** Live Companion twin: a manual session fed ONLY what the Player can see in the simulator at this state. No humanPosition (the manual create route refuses it). */
async function twinSession(lab: any, side: string, banned: number[], own: number[], enemyRevealed: number[]) {
  const created = await lab.routes.post(jsonRequest({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: side, adapterKind: "manual", partyContext: { partySize: 5, side, controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side, slotIndex, controllerId: "player" })) } }));
  if (created.status !== 201) return null;
  const { sessionId } = (await created.json()) as any;
  if (!lab.store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: banned }, { type: "BAN_RESOLUTION_COMPLETE" }])?.ok) return null;
  const ownQ = [...own];
  const enemyQ = [...enemyRevealed];
  for (let guard = 0; guard < 8; guard += 1) {
    const seats = (lab.store.authorizedLegalActions(sessionId) ?? []).filter((a: any) => a.type === "SUBMIT_SEALED_SELECTION");
    const ownSeats = seats.filter((s: any) => s.side === side);
    const enemySeats = seats.filter((s: any) => s.side !== side);
    if (seats.length === 0) break;
    const revealRound = enemySeats.length > 0 && enemyQ.length >= enemySeats.length && ownQ.length >= ownSeats.length;
    let progressed = false;
    for (const seat of ownSeats) {
      const hero = ownQ.shift();
      if (hero === undefined) break;
      const r = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: seat.slotIndex, heroId: hero } }), sessionId);
      if (r.status !== 200 && r.status !== 202) return null;
      progressed = true;
    }
    if (revealRound) {
      for (const seat of enemySeats) {
        const hero = enemyQ.shift();
        if (hero === undefined) break;
        const r = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: seat.side, slotIndex: seat.slotIndex, heroId: hero } }), sessionId);
        if (r.status !== 200 && r.status !== 202) return null;
        progressed = true;
      }
    }
    if (!progressed) break;
  }
  return sessionId as string;
}

const cardsOf = (output: any) => arr(output?.shortlist).map((c: any) => ({ heroId: c.heroId, strength: c.evidenceStrength ?? null }));

/** Positions the V3 action NAMES (REVEAL_POSITION / DEFER / FLEX); only counted when the UI would show it (actionSupport !== LIMITED). */
function namedPositions(output: any): number[] {
  if (!output || output.actionSupport === "LIMITED") return [];
  const s = rec(output.primaryAction).strategy;
  if (!s) return [];
  if (s.kind === "REVEAL_FLEX") return arr(s.possiblePositions);
  return s.position === undefined ? [] : [s.position];
}

/** Does ANY hero with a verifiable ground exist for the state (what the board could show)? Mirrors the engine's own eligibility, over the team set. */
async function eligibleExists(lab: any, sessionId: string) {
  const context = lab.store.perspectiveRecommendationContext(sessionId);
  const view = context.view;
  const computeForTeam = async (draft: any, _a: any, options: any) => buildSuggestions(draft, world.meta, { metaIsStale: true, heroPositions: world.heroPositions, ...options });
  const teamSet = await buildRecommendationSetFromPerspective({ context, computeSuggestions: computeForTeam, heroPositions: world.heroPositions, outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT });
  const data = { heroCounters: world.heroCounters, heroSynergies: synergies, heroPositions: world.heroPositions, heroCapabilities: capabilities };
  const revealed = revealedEnemyHeroes(view);
  const judged = demoteRevealedHardCountered(extractHeroCandidates(teamSet, world.heroPositions), revealed, world.heroCounters)
    .filter((c: any) => evaluateEligibility(c, eligibilityInputOf(view, data, c.position)).grounds.length > 0);
  void buildCoachObservableState; void deriveDecisionContextFromView;
  return judged.length > 0;
}

const rows: any[] = [];
const failures: string[] = [];
const seeds = Array.from({ length: Math.ceil(DRAFTS / 2) }, (_, i) => `AUDIT${String(i + 1).padStart(3, "0")}`);
let n = 0;
for (const seed of seeds) for (const side of SIDES) {
  if (n >= DRAFTS) break;
  const humanPosition = POS[n % 5]!;
  n += 1;
  const key = `${seed}:${side}`;
  const lab = createLab(world);
  const sid = await simSession(lab, side, humanPosition, seed);
  if (!sid) { failures.push(`${key}: sim start`); continue; }
  let idx = 0;
  for (let guard = 0; guard < 60; guard += 1) {
    const drive = await lab.routes.postAutoDrive(sid);
    if (drive.status !== 200) { failures.push(`${key}: drive ${drive.status}`); break; }
    const stop = ((await drive.json()) as any).stopReason;
    if (stop === "complete") break;
    if (stop !== "human_input") continue;
    const context = lab.store.perspectiveRecommendationContext(sid);
    const view = context.view;
    const base = `http://127.0.0.1/api/session/protocol/${sid}`;
    const simAns = await askCoach(lab, sid, null);
    const boardRes = await lab.routes.getTeamRecommendations(sid, new URL(`${base}/team-recommendations`), null);
    const board = rec(await boardRes.json());
    const banned = [...view.bannedHeroes];
    const own = visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"]);
    const enemyRev = visibleHeroes(view.enemyPicks, ["REVEALED"]);
    const bound: [number, number][] = [...(context.ownAssignedPositions ?? [])];
    const occupiedBySim = new Set(bound.map(([, p]) => p));

    const twinId = await twinSession(lab, side, banned, own, enemyRev);
    let live: any = { built: false };
    if (twinId) {
      const tv = lab.store.perspectiveRecommendationContext(twinId).view;
      const sameView = JSON.stringify([...tv.bannedHeroes].sort()) === JSON.stringify([...banned].sort())
        && JSON.stringify(visibleHeroes(tv.ownPicks, ["KNOWN", "REVEALED"]).sort()) === JSON.stringify([...own].sort())
        && JSON.stringify(visibleHeroes(tv.enemyPicks, ["REVEALED"]).sort()) === JSON.stringify([...enemyRev].sort());
      const liveAns = await askCoach(lab, twinId, null);
      const out = liveAns?.output ?? null;
      const eligible = await eligibleExists(lab, twinId);
      // Same twin, but the Player also assigned the positions the simulator had bound (the Live UI's own "Asignar PosN" buttons).
      for (const [hero, pos] of bound) await lab.routes.postPositionAssignment(jsonRequest({ heroId: hero, position: pos }), twinId, null);
      const ansB = await askCoach(lab, twinId, null);
      const outB = ansB?.output ?? null;
      live = {
        built: true, sameView, v3Null: out === null, actionSupport: out?.actionSupport ?? (out ? "STRONG(legacy)" : null), cards: cardsOf(out), label: out?.primaryAction?.label ?? null,
        eligibleExists: eligible,
        occupiedNamed: namedPositions(out).filter((p) => occupiedBySim.has(p)),
        assigned: { v3Null: outB === null, actionSupport: outB?.actionSupport ?? null, cards: cardsOf(outB), occupiedNamed: namedPositions(outB).filter((p) => occupiedBySim.has(p)) },
      };
    }
    const cols = arr(board.positions).map((c: any) => ({ position: c.position, state: c.state, top: arr(c.top).map((t: any) => ({ heroId: t.heroId, strength: t.evidenceStrength ?? null })) }));
    const decision = rec(board.currentDecision);
    rows.push({
      key, index: idx, banned, own, enemyRev, phase: view.rankedAp?.phase ?? null,
      sim: { v3Null: simAns?.output == null, v3Cards: cardsOf(simAns?.output), boardAnyHero: cols.some((c: any) => c.top.length > 0), boardAnyStrong: cols.some((c: any) => c.top.some((t: any) => t.strength === "STRONG")), boardRecommendedHero: decision.recommendedHeroId ?? null },
      live,
    });
    idx += 1;
    // The Player follows the board like the real simulator UI (pick FOR a position); independent of the V3 code under test.
    const recPos = decision.recommendedPosition ?? arr(decision.actionablePositions)[0] ?? null;
    const col = cols.find((c: any) => c.position === recPos);
    const taken = new Set([...banned, ...own, ...enemyRev]);
    let heroId = decision.recommendedHeroId ?? col?.top?.[0]?.heroId ?? null;
    let pos = recPos;
    if (heroId === null || pos === null) {
      pos = pos ?? 1;
      const legal = world.heroIds.filter((id: number) => !taken.has(id) && isCandidateAdmittedForPosition(id, pos, world.heroPositions));
      heroId = legal[seededIndex(`${key}:${idx}`, legal.length)] ?? null;
    }
    const openOwn = context.openOwnSlots[0];
    if (heroId === null || !openOwn) { failures.push(`${key}: no choice`); break; }
    const sealed = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: openOwn.slotIndex, heroId }, assignedPosition: pos }), sid);
    if (sealed.status !== 200 && sealed.status !== 202) { failures.push(`${key}: seal ${sealed.status}`); break; }
  }
}
// One row per line: reviewable in a diff and small.
const header = `{"schema":"engine-live-parity/v1","snapshot":${JSON.stringify(world.snapshot.id)},"drafts":${DRAFTS},"failures":${JSON.stringify(failures)},"rows":[`;
const NL = String.fromCharCode(10);
writeFileSync(resolve(OUT), [header, rows.map((r) => JSON.stringify(r)).join("," + NL), "]}", ""].join(NL));
console.error(`states=${rows.length} failures=${failures.length} twins=${rows.filter((r) => r.live.built && r.live.sameView).length}`);
