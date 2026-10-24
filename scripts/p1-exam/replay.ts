// F2 / Decision Replay (minimum): freeze ONE pick moment so any engine version can be asked the SAME question.
//
//   bun scripts/p1-exam/replay.ts --capture --drafts=6 --out=eval/replay/pilot-v1.moments.json
//   bun scripts/p1-exam/replay.ts --replay --moments=eval/replay/pilot-v1.moments.json --out=<outputs.json>
//   bun scripts/p1-exam/replay.ts --compare=<outputsA.json>,<outputsB.json>
//
// Why a state and not a seed: the Enemy Bot and the Ally Bot choose through the engine's own scoring, so re-driving a draft from its seed with
// a changed scorer reaches a DIFFERENT state. A moment therefore stores the commands that rebuild the state (bans, the Player's seals with
// their assigned positions, the enemy's recorded seals) and replays them through the real protocol routes, never through a bot.
// What a version may SEE is the Player's perspective view; the enemy seals of the current round that are still hidden are needed only to
// rebuild the kernel state and are never part of the visible state (`visible`), which is what the fingerprint covers.
// Measurement tool, not a test; never imported from apps/ (invariantes.md).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ACCOUNT_A, ACCOUNT_B, SIDES, askCoach, createLab, jsonRequest, loadWorldData, muteLog, unmuteLog, visibleHeroes, type Lab, type WorldData } from "../wave5/driver";
import { choose, startSession, type BoardColumnJson } from "./session";

export const MOMENT_SCHEMA = "decision-moment/v1";
type Side = "radiant" | "dire";
type Pos = 1 | 2 | 3 | 4 | 5;
const POSITIONS: Pos[] = [1, 2, 3, 4, 5];
const ROOT = resolve(import.meta.dir, "../..");

export interface OwnSeal { round: 1 | 2 | 3; slotIndex: number; heroId: number; assignedPosition: Pos }
export interface EnemySeal { round: 1 | 2 | 3; slotIndex: number; heroId: number }
/** What a version is allowed to see at the moment (this plus the Hero Pool is what is fingerprinted). */
export interface VisibleState {
  round: 1 | 2 | 3;
  side: Side;
  bans: number[];
  ownPicks: { heroId: number; assignedPosition: Pos }[];
  revealedEnemy: number[];
  hiddenEnemySlots: number;
  actionablePositions: Pos[];
  humanPosition: Pos;
}
export interface DecisionMoment {
  schema: typeof MOMENT_SCHEMA;
  id: string;
  origin: { checkpoint: string; draftKey: string; stateIndex: number };
  session: { side: Side; humanPosition: Pos; simulatorSeed: string; account: "A" | "B"; patch: string };
  /** The Player's Hero Pool, by value (the account is a synthetic fixture, never a real Steam id). */
  pool: { hero: number; source: "manual" | "calculated"; personalWinrate: number | null; personalGames: number; updatedAt: string }[];
  visible: VisibleState;
  visibleFingerprint: string;
  /** Rebuild recipe. `enemySealed` of the CURRENT round is hidden from the Player: it exists only to rebuild the kernel state. */
  reconstruction: { bans: number[]; ownSealed: OwnSeal[]; enemySealed: EnemySeal[] };
}

export interface MomentOutput {
  board: { recommendedPosition: number | null; recommendedHeroId: number | null; targetBasis: string | null; columns: { position: number; state: string; eligibleNow: boolean; top: { heroId: number; rank: number; reasons: string[] }[] }[] };
  v4: null | { kind: string; targetPosition: number | null; viewedPosition: number | null; targetBasis: string | null; state: string | null; cards: { heroId: number; rationale: string; basisKind: string | null; risks: { kind: string; detail: string; heroIds: number[] }[] }[] };
  v3: { primary: string; shortlist: { heroId: number; rationale: string }[] };
}

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Key-sorted JSON: the same value always hashes the same, whatever order the producer built it in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((k) => record[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown): string => createHash("sha256").update(canonicalJson(value)).digest("hex");

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isIdx = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0;
const isPos = (v: unknown): v is Pos => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
const isRound = (v: unknown): v is 1 | 2 | 3 => v === 1 || v === 2 || v === 3;

/** A moment file is input from disk: validate before it drives anything. Returns the reasons it is unusable (empty = usable). */
export function validateMoment(value: unknown): string[] {
  const m = asRecord(value);
  const problems: string[] = [];
  if (m.schema !== MOMENT_SCHEMA) problems.push("schema");
  const session = asRecord(m.session);
  if (session.side !== "radiant" && session.side !== "dire") problems.push("session.side");
  if (!isPos(session.humanPosition)) problems.push("session.humanPosition");
  if (typeof session.simulatorSeed !== "string" || session.simulatorSeed.length === 0) problems.push("session.simulatorSeed");
  if (session.account !== "A" && session.account !== "B") problems.push("session.account");
  const recon = asRecord(m.reconstruction);
  const bans = asArray(recon.bans);
  if (bans.length === 0 || !bans.every(isInt)) problems.push("reconstruction.bans");
  const own = asArray(recon.ownSealed).map(asRecord);
  const enemy = asArray(recon.enemySealed).map(asRecord);
  if (!own.every((s) => isRound(s.round) && isIdx(s.slotIndex) && isInt(s.heroId) && isPos(s.assignedPosition))) problems.push("reconstruction.ownSealed");
  if (!enemy.every((s) => isRound(s.round) && isIdx(s.slotIndex) && isInt(s.heroId))) problems.push("reconstruction.enemySealed");
  const visible = asRecord(m.visible);
  if (!isRound(visible.round)) problems.push("visible.round");
  if (!asArray(m.pool).map(asRecord).every((p) => isInt(p.hero))) problems.push("pool");
  const heroes = [...bans, ...own.map((s) => s.heroId), ...enemy.map((s) => s.heroId)];
  if (new Set(heroes).size !== heroes.length) problems.push("a hero appears twice in the recipe");
  if (typeof m.visibleFingerprint !== "string" || m.visibleFingerprint !== fingerprint({ visible, pool: m.pool })) problems.push("visibleFingerprint does not match visible state and pool");
  return problems;
}

export type ReplayCommand =
  | { kind: "enemy-seal"; round: number; slotIndex: number; heroId: number }
  | { kind: "own-seal"; round: number; slotIndex: number; heroId: number; assignedPosition: Pos };

/** The ordered commands that rebuild the moment: per round, enemy seals first (as the simulator does), then the Player's. Nothing after the moment's round. */
export function commandsFor(moment: DecisionMoment): ReplayCommand[] {
  const upTo = moment.visible.round;
  const commands: ReplayCommand[] = [];
  for (const round of [1, 2, 3] as const) {
    if (round > upTo) break;
    for (const s of moment.reconstruction.enemySealed.filter((x) => x.round === round)) commands.push({ kind: "enemy-seal", round, slotIndex: s.slotIndex, heroId: s.heroId });
    for (const s of moment.reconstruction.ownSealed.filter((x) => x.round === round)) commands.push({ kind: "own-seal", round, slotIndex: s.slotIndex, heroId: s.heroId, assignedPosition: s.assignedPosition });
  }
  return commands;
}

/** Deterministic spread: up to `perRound` moments from each round, evenly spaced over what was captured. */
export function selectRepresentative(moments: DecisionMoment[], perRound: number): DecisionMoment[] {
  const picked: DecisionMoment[] = [];
  for (const round of [1, 2, 3] as const) {
    const pool = moments.filter((m) => m.visible.round === round);
    const take = Math.min(perRound, pool.length);
    for (let i = 0; i < take; i += 1) picked.push(pool[Math.floor((i * pool.length) / take)]!);
  }
  return picked;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the visible state and the engine's answer from a live in-process session (the harness is the server; the engine sees a view).
// ---------------------------------------------------------------------------------------------------------------------------------

function readVisible(lab: Lab, sessionId: string, side: Side, humanPosition: Pos, actionable: Pos[]): VisibleState | null {
  const context = lab.store.perspectiveRecommendationContext(sessionId);
  const ranked = lab.store.get(sessionId)?.rankedAp;
  if (!context || !ranked?.round) return null;
  const view = context.view;
  const bindings = lab.store.ownAssignedPositions(sessionId) ?? [];
  const ownPicks = ranked.confirmedPicks.filter((p) => p.side === side).flatMap((p) => {
    const binding = bindings.find((b) => b.round === p.round && b.slotIndex === p.slotIndex);
    return binding ? [{ heroId: p.heroId, assignedPosition: binding.assignedPosition as Pos }] : [];
  });
  const sealedThisRound = ranked.round.sealed.filter((s) => s.side === side).flatMap((s) => {
    const binding = bindings.find((b) => b.round === ranked.round!.round && b.slotIndex === s.slotIndex);
    return binding ? [{ heroId: s.heroId, assignedPosition: binding.assignedPosition as Pos }] : [];
  });
  return {
    round: ranked.round.round, side, bans: [...view.bannedHeroes], ownPicks: [...ownPicks, ...sealedThisRound],
    revealedEnemy: visibleHeroes(view.enemyPicks, ["REVEALED"]), hiddenEnemySlots: view.enemyPicks.filter((slot) => slot.visibility === "HIDDEN").length,
    actionablePositions: [...actionable].sort(), humanPosition,
  };
}

/** The three surfaces the exam already reads, reduced to what is decided (heroes, order, reasons, risks), without timings or session ids. */
export async function askDecision(lab: Lab, sessionId: string, accountId: number): Promise<{ output: MomentOutput; actionable: Pos[] } | null> {
  const base = `http://127.0.0.1/api/session/protocol/${sessionId}`;
  const answer = await askCoach(lab, sessionId, accountId);
  const boardResponse = await lab.routes.getTeamRecommendations(sessionId, new URL(`${base}/team-recommendations`), accountId);
  const v4Response = await lab.routes.getRecommendations(sessionId, new URL(`${base}/recommendations?format=v4`), accountId);
  if (!answer?.output || boardResponse.status !== 200) return null;
  const board = asRecord(await boardResponse.json());
  const decision = asRecord(board.currentDecision);
  const v4Out = v4Response.status === 200 ? asRecord(asRecord(await v4Response.json()).output) : null;
  const v4Decision = asRecord(v4Out?.decision);
  const v4Candidates = asRecord(v4Decision.candidates);
  const output: MomentOutput = {
    board: {
      recommendedPosition: (decision.recommendedPosition ?? null) as number | null,
      recommendedHeroId: (decision.recommendedHeroId ?? null) as number | null,
      targetBasis: (decision.targetBasis ?? null) as string | null,
      columns: asArray(board.positions).map(asRecord).map((c) => ({
        position: Number(c.position), state: String(c.state), eligibleNow: c.eligibleNow === true,
        top: asArray(c.top).map(asRecord).map((t) => ({ heroId: Number(t.heroId), rank: Number(t.rank), reasons: asArray(t.reasons).map(String) })),
      })),
    },
    v4: v4Out === null ? null : {
      kind: String(v4Decision.kind), targetPosition: (v4Decision.targetPosition ?? null) as number | null, viewedPosition: (v4Decision.viewedPosition ?? null) as number | null,
      targetBasis: (v4Decision.targetBasis ?? null) as string | null, state: (v4Candidates.state ?? null) as string | null,
      cards: asArray(v4Candidates.cards).map(asRecord).map((c) => ({
        heroId: Number(c.heroId), rationale: String(c.rationale ?? ""), basisKind: c.basis === undefined ? null : String(asRecord(c.basis).kind),
        risks: asArray(c.risks).map(asRecord).map((r) => ({ kind: String(r.kind), detail: String(r.detail ?? ""), heroIds: asArray(r.heroIds).map(Number) })),
      })),
    },
    v3: { primary: answer.output.primaryAction.label, shortlist: answer.output.shortlist.map((card) => ({ heroId: card.heroId, rationale: card.rationale })) },
  };
  return { output, actionable: asArray(decision.actionablePositions).map(Number) as Pos[] };
}

const accountOf = (label: "A" | "B"): number => (label === "A" ? ACCOUNT_A : ACCOUNT_B);
const enemyOf = (side: Side): Side => (side === "radiant" ? "dire" : "radiant");

// ---------------------------------------------------------------------------------------------------------------------------------
// Capture: drive a few drafts exactly like the exam (follow-coach / varied / deviate), freezing a moment at every Player decision.
// ---------------------------------------------------------------------------------------------------------------------------------

export async function captureMoments(world: WorldData, draftCount: number): Promise<{ moments: DecisionMoment[]; skipped: string[] }> {
  const moments: DecisionMoment[] = [];
  const skipped: string[] = [];
  const policies = ["follow-coach", "varied", "deviate"] as const;
  let n = 0;
  for (let s = 1; n < draftCount; s += 1) {
    const seed = `AUDIT${String(s).padStart(3, "0")}`;
    for (const side of SIDES) {
      if (n >= draftCount) break;
      const policy = policies[n % policies.length]!;
      const humanPosition = POSITIONS[n % POSITIONS.length]!;
      const account: "A" | "B" = n % 2 === 0 ? "A" : "B";
      n += 1;
      const key = `${policy}:${seed}:${side}`;
      const lab = createLab(world);
      const sessionId = await startSession(lab, side, humanPosition, seed);
      if (!sessionId) { skipped.push(`${key}: could not start`); continue; }
      const initialBans = [...(lab.store.get(sessionId)?.rankedAp?.bannedHeroes ?? [])];
      const ownLog: OwnSeal[] = [];
      for (let guard = 0, stateIndex = 0; guard < 60; guard += 1) {
        const drive = await lab.routes.postAutoDrive(sessionId);
        const stop = ((await drive.json()) as { stopReason?: string }).stopReason;
        if (stop === "complete") break;
        if (stop !== "human_input") continue;
        const ranked = lab.store.get(sessionId)!.rankedAp!;
        if (ranked.bannedHeroes.length !== initialBans.length) { skipped.push(`${key}#${stateIndex}: a collision changed the bans`); break; }
        const asked = await askDecision(lab, sessionId, accountOf(account));
        const visible = asked ? readVisible(lab, sessionId, side, humanPosition, asked.actionable) : null;
        const context = lab.store.perspectiveRecommendationContext(sessionId);
        if (!asked || !visible || !context) { skipped.push(`${key}#${stateIndex}: no answer`); break; }
        const round = ranked.round!.round;
        const enemy = enemyOf(side);
        const enemySealed: EnemySeal[] = [
          ...ranked.confirmedPicks.filter((p) => p.side === enemy).map((p) => ({ round: p.round, slotIndex: p.slotIndex, heroId: p.heroId })),
          ...ranked.round!.sealed.filter((p) => p.side === enemy).map((p) => ({ round, slotIndex: p.slotIndex, heroId: p.heroId })),
        ];
        const pool = (world.pools[accountOf(account)] ?? []).map((entry) => ({ hero: entry.hero, source: entry.source, personalWinrate: entry.personalWinrate, personalGames: entry.personalGames, updatedAt: entry.updatedAt }));
        moments.push({
          schema: MOMENT_SCHEMA, id: `${key}#${stateIndex}`, origin: { checkpoint: "F1", draftKey: key, stateIndex },
          session: { side, humanPosition, simulatorSeed: seed, account, patch: "7.41e" },
          pool,
          visible, visibleFingerprint: fingerprint({ visible, pool }),
          reconstruction: { bans: initialBans, ownSealed: ownLog.map((x) => ({ ...x })), enemySealed },
        });

        // The Player acts as in the exam: picks a hero for a position and seals both.
        const columns: BoardColumnJson[] = asked.output.board.columns.map((c) => ({ position: c.position, state: c.state, eligibleNow: c.eligibleNow, top: c.top }));
        const decision = { recommendedPosition: asked.output.board.recommendedPosition, recommendedHeroId: asked.output.board.recommendedHeroId };
        const taken = new Set<number>([...visible.bans, ...visible.ownPicks.map((p) => p.heroId), ...visible.revealedEnemy]);
        const choice = choose(world, policy, key, stateIndex, decision, columns, asked.actionable, taken);
        const openOwn = context.openOwnSlots[0];
        if (!choice || !openOwn) { skipped.push(`${key}#${stateIndex}: no legal choice`); break; }
        const sealed = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: openOwn.slotIndex, heroId: choice.heroId }, assignedPosition: choice.position }), sessionId);
        if (sealed.status !== 200 && sealed.status !== 202) { skipped.push(`${key}#${stateIndex}: seal ${sealed.status}`); break; }
        ownLog.push({ round, slotIndex: openOwn.slotIndex, heroId: choice.heroId, assignedPosition: choice.position as Pos });
        stateIndex += 1;
      }
    }
  }
  return { moments, skipped };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Replay: rebuild the state through the real routes (no bot in the loop), prove it is the SAME state, then ask the engine.
// ---------------------------------------------------------------------------------------------------------------------------------

export interface ReplayResult { id: string; stateReproduced: boolean; visibleFingerprint: string; outputFingerprint: string | null; output: MomentOutput | null; problem?: string }

export async function replayMoment(world: WorldData, moment: DecisionMoment): Promise<ReplayResult> {
  const fail = (problem: string): ReplayResult => ({ id: moment.id, stateReproduced: false, visibleFingerprint: "", outputFingerprint: null, output: null, problem });
  const invalid = validateMoment(moment);
  if (invalid.length > 0) return fail(`invalid moment: ${invalid.join(", ")}`);
  const account = accountOf(moment.session.account);
  const lab = createLab({ ...world, pools: { ...world.pools, [account]: moment.pool.map((entry) => ({ ...entry })) } });
  const created = await lab.routes.post(jsonRequest({
    rulesetId: "dota2/ranked-all-pick", patch: moment.session.patch, localSide: moment.session.side, adapterKind: "simulator", humanPosition: moment.session.humanPosition,
    simulatorSeed: moment.session.simulatorSeed, partyContext: { partySize: 5, side: moment.session.side, controlledSlots: [] }, controlledPositions: POSITIONS,
  }));
  if (created.status !== 201) return fail(`create ${created.status}`);
  const { sessionId } = (await created.json()) as { sessionId: string };
  const banned = lab.store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [...moment.reconstruction.bans] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  if (!banned?.ok) return fail("bans rejected");
  const enemy = enemyOf(moment.session.side);
  for (const command of commandsFor(moment)) {
    if (command.kind === "enemy-seal") {
      const r = lab.store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: enemy, slotIndex: command.slotIndex, heroId: command.heroId });
      if (!r || r.rejected) return fail(`enemy seal rejected (${r?.rejected ?? "?"}) at round ${command.round}`);
    } else {
      const response = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: moment.session.side, slotIndex: command.slotIndex, heroId: command.heroId }, assignedPosition: command.assignedPosition }), sessionId);
      const body = (await response.json()) as { accepted?: boolean; rejected?: string };
      if ((response.status !== 200 && response.status !== 202) || body.accepted !== true) return fail(`own seal rejected (${body.rejected ?? response.status}) at round ${command.round}`);
    }
  }
  const asked = await askDecision(lab, sessionId, account);
  const visible = asked ? readVisible(lab, sessionId, moment.session.side, moment.session.humanPosition, asked.actionable) : null;
  if (!asked || !visible) return fail("no answer after rebuilding");
  const visibleFingerprint = fingerprint({ visible, pool: moment.pool });
  return { id: moment.id, stateReproduced: visibleFingerprint === moment.visibleFingerprint, visibleFingerprint, outputFingerprint: fingerprint(asked.output), output: asked.output };
}

/** Same moments, two runs: which ones differ, and where (position choice, ranking, or only the reasons). */
export function compareRuns(a: ReplayResult[], b: ReplayResult[]): { same: number; different: { id: string; what: string[] }[]; stateMismatches: string[] } {
  const byId = new Map(b.map((r) => [r.id, r]));
  const different: { id: string; what: string[] }[] = [];
  const stateMismatches: string[] = [];
  let same = 0;
  for (const left of a) {
    const right = byId.get(left.id);
    if (!right || !left.stateReproduced || !right.stateReproduced) { stateMismatches.push(left.id); continue; }
    if (left.outputFingerprint === right.outputFingerprint) { same += 1; continue; }
    const what: string[] = [];
    const l = left.output!, r = right.output!;
    if (l.board.recommendedPosition !== r.board.recommendedPosition) what.push("recommended position");
    if (fingerprint(l.board.columns.map((c) => c.top.map((t) => t.heroId))) !== fingerprint(r.board.columns.map((c) => c.top.map((t) => t.heroId)))) what.push("board ranking");
    if (fingerprint(l.v4?.cards.map((c) => c.heroId)) !== fingerprint(r.v4?.cards.map((c) => c.heroId))) what.push("v4 cards");
    if (what.length === 0) what.push("reasons or risks only");
    different.push({ id: left.id, what });
  }
  return { same, different, stateMismatches };
}

function arg(name: string): string | undefined { return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3); }
const writeJson = (path: string, value: unknown): void => { const full = resolve(ROOT, path); mkdirSync(dirname(full), { recursive: true }); writeFileSync(full, `${JSON.stringify(value, null, 2)}\n`); };

async function main(): Promise<void> {
  if (process.argv.includes("--compare") || arg("compare")) {
    const [pa, pb] = (arg("compare") ?? "").split(",");
    if (!pa || !pb) throw new Error("--compare=<a.json>,<b.json>");
    const load = (p: string): ReplayResult[] => (JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as { results: ReplayResult[] }).results;
    console.log(JSON.stringify(compareRuns(load(pa), load(pb)), null, 2));
    return;
  }
  muteLog();
  try {
    const world = loadWorldData();
    if (process.argv.includes("--capture")) {
      const { moments, skipped } = await captureMoments(world, Number(arg("drafts") ?? 6));
      const chosen = selectRepresentative(moments, Number(arg("per-round") ?? 6));
      writeJson(arg("out") ?? "eval/replay/pilot-v1.moments.json", { schema: "decision-moments/v1", snapshot: world.snapshot.id, captured: moments.length, skipped, moments: chosen });
      unmuteLog();
      console.log(`captured ${moments.length} moments, kept ${chosen.length}, skipped ${skipped.length}`);
      return;
    }
    if (process.argv.includes("--replay")) {
      const file = JSON.parse(readFileSync(resolve(ROOT, arg("moments") ?? "eval/replay/pilot-v1.moments.json"), "utf8")) as { moments: DecisionMoment[] };
      const results: ReplayResult[] = [];
      for (const moment of file.moments) results.push(await replayMoment(world, moment));
      writeJson(arg("out") ?? "eval/replay/pilot-v1.replay.json", { schema: "decision-replay/v1", snapshot: world.snapshot.id, results });
      unmuteLog();
      console.log(`replayed ${results.length}: state reproduced ${results.filter((r) => r.stateReproduced).length}, problems ${results.filter((r) => r.problem).length}`);
      return;
    }
    throw new Error("use --capture, --replay or --compare");
  } finally {
    unmuteLog();
  }
}

if (import.meta.main) await main();
