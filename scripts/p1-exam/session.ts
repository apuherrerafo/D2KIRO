// F1 / TSK-250 -- drives complete Party-5 simulator drafts through the CURRENT protocol contract and captures, at every decision point,
// what the real simulator path shows: the Team Coach Board, `?format=v4` and the V3 list.
//
// Why this file exists instead of `scripts/wave5/driver.ts#playDraft`: that driver predates PD-026/PD-027 (a Party-5 simulator session now
// needs `controlledPositions`, and every own seal must carry a sibling `assignedPosition`), so it can no longer even create a session on this
// base. Everything else is reused from it (world data, the in-process lab, the Coach route helper). Measurement tool, not a test, and never
// imported from apps/.
import { isCandidateAdmittedForPosition } from "../../apps/engine/src/signals/hero-positions";
import { selectLivePositionPriority } from "../../apps/engine/src/coach/live-position-priority";
import { credibleHeroesForPosition } from "../../apps/engine/src/coach/hero-card";
import { buildRecommendationSetFromPerspective } from "../../apps/engine/src/recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../../apps/engine/src/recommendation/perspective-context";
import { buildSuggestions } from "../../apps/engine/src/signals/mix";
import { ACCOUNT_A, ACCOUNT_B, SIDES, askCoach, createLab, jsonRequest, seededIndex, visibleHeroes, type Lab, type Policy, type WorldData } from "../wave5/driver";
import { varianceShare, type ExamState, type FieldCandidate, type Pos } from "./checks";

export const POLICIES: Policy[] = ["follow-coach", "varied", "deviate"];
const POSITIONS: Pos[] = [1, 2, 3, 4, 5];
const asRecord = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export interface Run { states: ExamState[]; failures: string[]; badStatuses: string[]; completed: number; drafts: number; boardMs: number[]; v4Ms: number[]; v3Ms: number[] }

async function startSession(lab: Lab, side: (typeof SIDES)[number], humanPosition: Pos, seed: string): Promise<string | null> {
  const created = await lab.routes.post(jsonRequest({
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    humanPosition,
    simulatorSeed: seed,
    partyContext: { partySize: 5, side, controlledSlots: [] },
    controlledPositions: POSITIONS,
  }));
  if (created.status !== 201) { lab.badStatuses.push(`create:${created.status}`); return null; }
  const { sessionId } = (await created.json()) as { sessionId: string };
  const resolved = await lab.routes.postResolveBans(jsonRequest({ playerBanPreferences: [] }), sessionId);
  if (resolved.status !== 200) { lab.badStatuses.push(`resolve-bans:${resolved.status}`); return null; }
  return sessionId;
}

interface BoardColumnJson { position: number; state: string; eligibleNow: boolean; top: { heroId: number; rank: number; reasons: string[] }[] }

/**
 * The LPP counterfactual: what LivePositionPriorityV1 declares over the board's own columns (it only runs in live today).
 * Its pool and occupancy inputs are the SESSION's own (`context.playerPoolsByPosition` / `ownPositionOccupancy`) -- the same facts the
 * board is given, read from state, not from the code under test. The lab saves no team pools, so POOL_SCARCITY cannot fire here.
 * (R1 of this exam approximated pools with the Player's PERSONAL pool at their personal position; that invented scarcity the real
 * session does not have and produced 6 false "divergences" in T2. Found in the TSK-251 T2 run.)
 */
function precedence(world: WorldData, context: PerspectiveRecommendationContext, columns: BoardColumnJson[], actionable: Pos[], phase: unknown, s: { banned: number[]; ownPicks: number[]; revealedEnemy: number[] }): ExamState["lpp"] {
  if (actionable.length === 0) return null;
  const ranked = columns.filter((c) => c.top.length > 0).map((c) => ({ position: c.position as Pos, heroIds: [...c.top].sort((a, b) => a.rank - b.rank).map((t) => t.heroId) }));
  const priority = selectLivePositionPriority({
    actionablePositions: actionable, phase: phase as never, columns: ranked, revealedEnemies: s.revealedEnemy, heroCounters: world.heroCounters,
    playerPoolsByPosition: context.playerPoolsByPosition, unavailable: new Set([...s.banned, ...s.ownPicks, ...s.revealedEnemy]), occupancy: context.ownPositionOccupancy,
  });
  return { position: priority.targetPosition as Pos, basis: priority.targetBasis, signal: priority.signal };
}


type RankingInput = Parameters<typeof buildRecommendationSetFromPerspective>[0];

/**
 * I5: rebuilds the board's own ranking for one position (same context, same computeSuggestions wiring as the route) and returns, per
 * candidate it keeps, V6's score and the weighted `position_fit` contribution. NOTE: V6 itself truncates to TOP_N before anything here can
 * see the list, so this is the spread among the candidates the product can SHOW, not over the whole credible field (that needs an engine hook).
 */
async function fullColumnRanking(world: WorldData, context: PerspectiveRecommendationContext, position: Pos, ownerAccountId: number | null): Promise<{ score: number[]; positionFit: number[]; saturated: number[] }> {
  const computeSuggestions: RankingInput["computeSuggestions"] = async (draft, _ignored, options) => {
    const meta = ownerAccountId === null ? world.meta : { ...world.meta, heroPool: world.pools[ownerAccountId] ?? [], personalBaselineWinrate: null };
    return buildSuggestions(draft, meta, { metaIsStale: true, heroPositions: world.heroPositions, ...options });
  };
  const set = await buildRecommendationSetFromPerspective({
    context, computeSuggestions, heroPositions: world.heroPositions, targetPosition: position,
    candidateHeroIds: credibleHeroesForPosition(position, world.heroPositions), teamOpening: false, singleSlotEvaluation: true, outputLimit: 50,
  });
  const score: number[] = [];
  const positionFit: number[] = [];
  const saturated: number[] = [];
  for (const rec of set.recommendations) {
    const hero = rec.actions[0]?.hero;
    const pf = hero === undefined ? undefined : rec.signalsByHero[hero]?.find((signal) => signal.signal === "position_fit");
    if (pf === undefined) continue;
    score.push(rec.score);
    positionFit.push(pf.weighted);
    saturated.push(pf.raw !== null && pf.raw >= 1 ? 1 : 0);
  }
  return { score, positionFit, saturated };
}

/**
 * TSK-252: the WHOLE credible field of one column, scored by V6 in this state. `buildSuggestions` returns at most TOP_N (6) per call, so the field
 * is peeled: ask, set the returned heroes aside, ask again over the rest, until nothing is left. The options of every call are the ones the
 * product sends (`buildRecommendationSetFromPerspective` builds them; only the candidate universe is narrowed by the peel), so `mode: "product"`
 * measures whatever `position_fit` rule the Coach uses today; "volume" / "credible-median" force one rule to compare both on the same state. The first call is exactly the product's, so the first six are the real ones; later calls
 * only differ in the state mean V6 uses to fill a missing signal, which does not touch a candidate that has data -- every credible hero has
 * `position_fit` evidence at its own position.
 */
async function peeledColumnField(world: WorldData, context: PerspectiveRecommendationContext, position: Pos, ownerAccountId: number | null, mode: "product" | "volume" | "credible-median", needs: "product" | "flat" | "closing" = "product"): Promise<FieldCandidate[]> {
  const meta = ownerAccountId === null ? world.meta : { ...world.meta, heroPool: world.pools[ownerAccountId] ?? [], personalBaselineWinrate: null };
  const ownPicksLeft = Math.max(5 - visibleHeroes(context.view.ownPicks, ["KNOWN", "REVEALED"]).length, 0);
  const field: FieldCandidate[] = [];
  const computeSuggestions: RankingInput["computeSuggestions"] = async (draft, _ignored, options) => {
    let remaining = [...(options?.candidateHeroIds ?? [])];
    let first: Awaited<ReturnType<typeof buildSuggestions>> | null = null;
    for (let guard = 0; guard < 20 && remaining.length > 0; guard += 1) {
      // TSK-253: `flat` forces the legacy `team_synergy` (key removed), `closing` forces the stage-aware one (picks left from the state), `product` leaves whatever the Coach asks.
      const needsOverride = needs === "product" ? {} : { teamNeedsOwnPicksRemaining: needs === "closing" ? ownPicksLeft : undefined };
      const set = await buildSuggestions(draft, meta, { metaIsStale: true, heroPositions: world.heroPositions, ...options, ...(mode === "product" ? {} : { positionFitSaturation: mode }), ...needsOverride, candidateHeroIds: remaining });
      first ??= set;
      if (set.suggestions.length === 0) break;
      for (const suggestion of set.suggestions) {
        const pf = suggestion.signals.find((signal) => signal.signal === "position_fit");
        const matches = (world.heroPositions[suggestion.hero] ?? []).find((share) => share.position === position)?.matches;
        const counter = suggestion.signals.find((signal) => signal.signal === "counter");
        if (pf !== undefined && matches !== undefined) {
          field.push({
            heroId: suggestion.hero, score: suggestion.score, positionFit: pf.weighted, matches,
            counter: counter === undefined ? null : { raw: counter.raw, weighted: counter.weighted, sampleSize: counter.sampleSize, vsRevealed: counter.hasRevealedEnemyCounterEvidence === true },
          });
        }
      }
      const taken = new Set(set.suggestions.map((s) => s.hero));
      remaining = remaining.filter((hero) => !taken.has(hero));
    }
    return first ?? buildSuggestions(draft, meta, { metaIsStale: true, heroPositions: world.heroPositions, ...options });
  };
  await buildRecommendationSetFromPerspective({
    context, computeSuggestions, heroPositions: world.heroPositions, targetPosition: position,
    candidateHeroIds: credibleHeroesForPosition(position, world.heroPositions), teamOpening: false, singleSlotEvaluation: true, outputLimit: 50,
  });
  return field;
}

export async function runExam(world: WorldData, draftCount: number): Promise<Run> {
  const run: Run = { states: [], failures: [], badStatuses: [], completed: 0, drafts: 0, boardMs: [], v4Ms: [], v3Ms: [] };
  const seeds = Array.from({ length: Math.ceil(draftCount / SIDES.length) }, (_, i) => `AUDIT${String(i + 1).padStart(3, "0")}`);
  let n = 0;
  for (const seed of seeds) {
    for (const side of SIDES) {
      if (n >= draftCount) break;
      // Deterministic matrix: policy, personal position and account rotate so every combination is exercised.
      const policy = POLICIES[n % POLICIES.length]!;
      const humanPosition = POSITIONS[n % POSITIONS.length]!;
      const accountId = n % 2 === 0 ? ACCOUNT_A : ACCOUNT_B;
      n += 1;
      run.drafts += 1;
      const key = `${policy}:${seed}:${side}`;
      const lab = createLab(world);
      const fail = (message: string): void => { run.failures.push(`${key}: ${message}`); };
      const sessionId = await startSession(lab, side, humanPosition, seed);
      if (!sessionId) { fail("could not start / resolve bans"); run.badStatuses.push(...lab.badStatuses.map((s) => `${key}:${s}`)); continue; }

      let complete = false;
      let stateIndex = 0;
      for (let guard = 0; guard < 60 && !complete; guard += 1) {
        const drive = await lab.routes.postAutoDrive(sessionId);
        if (drive.status !== 200) { fail(`auto-drive ${drive.status}`); break; }
        const stop = ((await drive.json()) as { stopReason?: string }).stopReason;
        if (stop === "complete") { complete = true; break; }
        if (stop !== "human_input") continue;

        const answer = await askCoach(lab, sessionId, accountId);
        const context = lab.store.perspectiveRecommendationContext(sessionId);
        if (!answer || !answer.output || !context) { fail(`no Coach output at state #${stateIndex}`); break; }
        const base = `http://127.0.0.1/api/session/protocol/${sessionId}`;
        const t0 = performance.now();
        const boardResponse = await lab.routes.getTeamRecommendations(sessionId, new URL(`${base}/team-recommendations`), accountId);
        const t1 = performance.now();
        const v4Response = await lab.routes.getRecommendations(sessionId, new URL(`${base}/recommendations?format=v4`), accountId);
        const t2 = performance.now();
        if (boardResponse.status !== 200) { fail(`board ${boardResponse.status} at state #${stateIndex}`); break; }
        const boardJson = asRecord(await boardResponse.json());
        const v4Out = v4Response.status === 200 ? asRecord(asRecord(await v4Response.json()).output) : null;

        const view = context.view;
        const output = answer.output;
        const banned = [...view.bannedHeroes];
        const ownPicks = visibleHeroes(view.ownPicks, ["KNOWN", "REVEALED"]);
        const revealedEnemy = visibleHeroes(view.enemyPicks, ["REVEALED"]);
        const decision = asRecord(boardJson.currentDecision);
        const columns: BoardColumnJson[] = asArray(boardJson.positions).map(asRecord).map((c) => ({
          position: Number(c.position), state: String(c.state), eligibleNow: c.eligibleNow === true,
          top: asArray(c.top).map(asRecord).map((t) => ({ heroId: Number(t.heroId), rank: Number(t.rank), reasons: asArray(t.reasons).map(String) })),
        }));
        const actionable = asArray(decision.actionablePositions).map(Number) as Pos[];

        // I5 over the FULL credible field of the column the board recommends right now.
        const target = ((decision.recommendedPosition ?? actionable[0]) ?? null) as Pos | null;
        const field = target === null ? { score: [], positionFit: [], saturated: [] } : await fullColumnRanking(world, context, target, target === humanPosition ? accountId : null);
        const scores = field.score;
        const positionFit = field.positionFit;
        const levelShares = scores.flatMap((score, i) => (score > 0 ? [positionFit[i]! / score] : []));

        const v4Decision = asRecord(v4Out?.decision);
        const v4Candidates = asRecord(v4Decision.candidates);
        const exam: ExamState = {
          draftKey: key, index: stateIndex, round: output.meta.round, ownPicksRemaining: output.meta.ownPicksRemaining, banned, ownPicks, revealedEnemy,
          v3: output.shortlist.map((card) => ({ heroId: card.heroId, rationale: card.rationale })),
          v3PrimaryRationale: output.primaryAction.label,
          board: {
            recommendedPosition: (decision.recommendedPosition ?? null) as Pos | null,
            targetBasis: (decision.targetBasis ?? null) as string | null,
            columns: columns.map((c) => ({ position: c.position as Pos, state: c.state, eligibleNow: c.eligibleNow, top: c.top.map((t) => ({ heroId: t.heroId, reason: t.reasons[0] ?? "" })) })),
          },
          v4: v4Out === null ? null : {
            kind: String(v4Decision.kind), targetPosition: (v4Decision.targetPosition ?? null) as Pos | null, viewedPosition: (v4Decision.viewedPosition ?? null) as Pos | null, targetBasis: (v4Decision.targetBasis ?? null) as string | null,
            state: (v4Candidates.state ?? null) as string | null, cards: asArray(v4Candidates.cards).map(asRecord).map((c) => ({
              heroId: Number(c.heroId), rationale: String(c.rationale ?? ""),
              basis: c.basis === undefined ? null : { kind: String(asRecord(c.basis).kind), sources: asArray(asRecord(c.basis).sources).map(asRecord).map((src) => ({ kind: String(src.kind), sampleSize: typeof src.sampleSize === "number" ? src.sampleSize : null })) },
              risks: asArray(c.risks).map(asRecord).map((risk) => ({ kind: String(risk.kind), detail: String(risk.detail ?? ""), heroIds: asArray(risk.heroIds).map(Number) })),
            })),
          },
          lpp: precedence(world, context, columns, actionable, asRecord(v4Out?.meta).phase ?? null, { banned, ownPicks, revealedEnemy }),
          positionFitSaturated: field.saturated.length === 0 ? null : field.saturated.reduce((a, b) => a + b, 0) / field.saturated.length,
          positionFitShare: varianceShare(positionFit, scores),
          positionFitLevelShare: levelShares.length === 0 ? null : levelShares.reduce((a, b) => a + b, 0) / levelShares.length,
          candidateCount: scores.length,
          positionFitField: target === null ? null : await peeledColumnField(world, context, target, target === humanPosition ? accountId : null, "product"),
          positionFitPaired: target === null ? null : {
            volume: await peeledColumnField(world, context, target, target === humanPosition ? accountId : null, "volume"),
            credibleMedian: await peeledColumnField(world, context, target, target === humanPosition ? accountId : null, "credible-median"),
          },
          // TSK-253: the same column, `credible-median` in both, differing ONLY in how `team_synergy` weighs what the team lacks.
          teamNeedsPaired: target === null ? null : {
            flat: await peeledColumnField(world, context, target, target === humanPosition ? accountId : null, "credible-median", "flat"),
            closing: await peeledColumnField(world, context, target, target === humanPosition ? accountId : null, "credible-median", "closing"),
          },
        };
        run.states.push(exam);
        run.v3Ms.push(answer.ms);
        run.boardMs.push(t1 - t0);
        run.v4Ms.push(t2 - t1);

        // The Player acts like the real simulator UI: picks a hero FOR a position and seals both together.
        const choice = choose(world, policy, key, stateIndex, decision, columns, actionable, new Set([...banned, ...ownPicks, ...revealedEnemy]));
        const openOwn = context.openOwnSlots[0];
        if (!choice || !openOwn) { fail(`no legal choice / open seat at state #${stateIndex}`); break; }
        const sealed = await lab.routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: openOwn.slotIndex, heroId: choice.heroId }, assignedPosition: choice.position }), sessionId);
        const sealBody = (await sealed.json()) as { accepted?: boolean; rejected?: string };
        if (sealed.status !== 202 && sealed.status !== 200) { fail(`seal ${sealed.status} at state #${stateIndex}`); break; }
        if (sealBody.accepted !== true) lab.badStatuses.push(`seal-rejected:${sealBody.rejected ?? "?"}`);
        stateIndex += 1;
      }

      if (complete) {
        run.completed += 1;
        const ranked = lab.store.get(sessionId)?.rankedAp;
        const enemySide = side === "radiant" ? "dire" : "radiant";
        const own = ranked?.confirmedPicks.filter((p) => p.side === side).map((p) => p.heroId) ?? [];
        const enemy = ranked?.confirmedPicks.filter((p) => p.side === enemySide).map((p) => p.heroId) ?? [];
        const all = [...own, ...enemy];
        if (own.length !== 5 || enemy.length !== 5) fail(`unexpected team sizes ${own.length}/${enemy.length}`);
        if (new Set(all).size !== all.length) fail("a hero was drafted twice");
        if (all.some((hero) => ranked?.bannedHeroes.includes(hero))) fail("a banned hero ended up on a team");
      } else if (run.failures.every((f) => !f.startsWith(key))) {
        fail("did not reach COMPLETE within the guard");
      }
      run.badStatuses.push(...lab.badStatuses.map((s) => `${key}:${s}`));
    }
  }
  return run;
}

/** follow-coach = the board's own recommendation; varied = a seeded hero from the recommended column; deviate = a seeded legal hero the board did NOT show. */
function choose(world: WorldData, policy: Policy, key: string, index: number, decision: Record<string, unknown>, columns: BoardColumnJson[], actionable: Pos[], taken: Set<number>): { heroId: number; position: Pos } | null {
  const recommended = (decision.recommendedPosition ?? null) as Pos | null;
  const recommendedHero = (decision.recommendedHeroId ?? null) as number | null;
  const column = (position: Pos): BoardColumnJson | undefined => columns.find((c) => c.position === position);
  const legalFor = (position: Pos): number[] => world.heroIds.filter((id) => !taken.has(id) && isCandidateAdmittedForPosition(id, position, world.heroPositions));
  const target = recommended ?? actionable[0] ?? null;
  if (target === null) return null;
  if (policy === "follow-coach") {
    if (recommendedHero !== null) return { heroId: recommendedHero, position: target };
    const first = column(target)?.top[0]?.heroId ?? legalFor(target)[0];
    return first === undefined ? null : { heroId: first, position: target };
  }
  if (policy === "varied") {
    const top = column(target)?.top ?? [];
    const pick = top.length > 0 ? top[seededIndex(`${key}:${index}`, top.length)]!.heroId : legalFor(target)[0];
    return pick === undefined ? null : { heroId: pick, position: target };
  }
  const position = actionable.length > 0 ? actionable[seededIndex(`${key}:${index}:pos`, actionable.length)]! : target;
  const shown = new Set(column(position)?.top.map((t) => t.heroId) ?? []);
  const outside = legalFor(position).filter((id) => !shown.has(id));
  const pool = outside.length > 0 ? outside : legalFor(position);
  const pick = pool[seededIndex(`${key}:${index}`, pool.length)];
  return pick === undefined ? null : { heroId: pick, position };
}
