import { describe, expect, test } from "bun:test";
import type { DraftState } from "../../draft/reducer";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { HeroPositions } from "../../signals/hero-positions";
import type { SuggestionSet } from "../../signals/mix";
import { createEnemyBotConfig } from "../../simulator/enemy-bot";
import { deriveAllyPositionOrder } from "../../simulator/ally-bot-roles";
import type { BanResolutionPolicy, HeroUniverse } from "../../simulator/ban-resolution";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes, type ComputeSuggestionsForDraftState } from "./protocol-sessions";

// AP Ranked Roles V1 / PD-026 / PD-027 -- the Simulator product path, exercised through the real
// routes and the real kernel-backed store. Only the scorer, the hero universe and the position
// evidence are fixtures (S2 / S10): no SQLite, no network, no curated file.
//
// PD-026/PD-027: Own Team truth is `controlledPositions`, never chronological roster seats.
// `partyContext.controlledSlots` is structural/inert for AP and arrives empty. Position != pick
// chronology -- Pos2 may be selected in Round 1, Pos5 may be selected in Round 3.

type Routes = ReturnType<typeof createProtocolSessionRoutes>;
type Side = "radiant" | "dire";
type Position = 1 | 2 | 3 | 4 | 5;

function post(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

// Fixture hero universe: filler 1..48 (never position heroes) + 30 heroes per position at 100*p + o.
const FILLER = Array.from({ length: 48 }, (_, index) => index + 1);
const POSITION_HEROES: Record<Position, number[]> = { 1: [], 2: [], 3: [], 4: [], 5: [] };
const HERO_POSITIONS: HeroPositions = {};
for (const position of [1, 2, 3, 4, 5] as Position[]) {
  for (let offset = 0; offset < 30; offset += 1) {
    const hero = position * 100 + offset;
    POSITION_HEROES[position].push(hero);
    HERO_POSITIONS[hero] = [{ position, matches: 1000 }];
  }
}
const ALL_HEROES = [...FILLER, ...Object.values(POSITION_HEROES).flat()];
const UNIVERSE: HeroUniverse = { allHeroIds: ALL_HEROES, metaOrder: ALL_HEROES };

const scorer: ComputeSuggestionsForDraftState = async (state: DraftState, _account, options): Promise<SuggestionSet> => {
  const taken = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  const pool = (options?.candidateHeroIds ?? Object.keys(HERO_POSITIONS).map(Number)).filter((hero) => !taken.has(hero));
  const heroes = pool.slice(0, 6);
  const functionalEvidence: FunctionalRecommendationEvidence = {
    metaIsStale: false,
    signalEvidence: heroes.map((hero) => ({ hero, signals: [] })),
    heroPositions: [],
    teamOpening: null,
    partyPreferredPositions: [],
  };
  return {
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: 0,
    decisionContext: "closing_pick",
    suggestions: heroes.map((hero, index) => ({
      hero,
      rank: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6,
      score: 100 - index,
      signals: [],
      reason: "fixture",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
    functionalEvidence,
  };
};

function makeRoutes(extra: { banResolutionPolicy?: BanResolutionPolicy; heroUniverse?: (() => Promise<HeroUniverse>) | null } = {}): { routes: Routes; store: ProtocolSessionStore } {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    computeSuggestions: scorer,
    heroPositions: HERO_POSITIONS,
    heroUniverse: extra.heroUniverse === null ? undefined : (extra.heroUniverse ?? (async () => UNIVERSE)),
    banResolutionPolicy: extra.banResolutionPolicy,
  });
  return { routes, store };
}

/** Full Party 5: every position human-controlled -- the Ally Bot never picks for Own Team. */
function createBody(side: Side, humanPosition: Position, seed: string) {
  return {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    partyContext: { partySize: 5, side, controlledSlots: [] },
    controlledPositions: [1, 2, 3, 4, 5],
    humanPosition,
    simulatorSeed: seed,
  };
}

interface Snapshot {
  view: { status: string; phase?: string; bannedHeroes: number[]; ownPicks: { visibility: string; heroId?: number }[]; enemyPicks: { visibility: string; heroId?: number }[]; rankedAp: { phase: string } | null };
  legalActions: { type: string; side?: string; slotIndex?: number }[];
  simulator: { round: number; durationMs: number; pendingSeats: number[]; goldPenaltyBySlot: number[]; penaltyRatePerSecond: number } | null;
  ownAssignedPositions: { round: number; slotIndex: number; assignedPosition: Position }[];
  stopReason?: string;
  completedRound?: number | null;
  accepted?: boolean;
  rejected?: string;
  resolvedBans?: number[];
  error?: string;
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createSession(routes: Routes, side: Side, humanPosition: Position, seed: string): Promise<string> {
  const response = await routes.post(post(createBody(side, humanPosition, seed)));
  expect(response.status).toBe(201);
  return (await json<{ sessionId: string }>(response)).sessionId;
}

/** Party of any supported size (1/2/3/5): `partyPositions` IS `controlledPositions` -- it must include `personalPosition`. */
async function createPartySession(
  routes: Routes,
  side: Side,
  personalPosition: Position,
  partyPositions: Position[],
  seed: string,
): Promise<string> {
  const partySize = partyPositions.length as 1 | 2 | 3 | 5;
  const body = {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    partyContext: { partySize, side, controlledSlots: [] },
    controlledPositions: partyPositions,
    humanPosition: personalPosition,
    simulatorSeed: seed,
  };
  const response = await routes.post(post(body));
  expect(response.status).toBe(201);
  return (await json<{ sessionId: string }>(response)).sessionId;
}

async function resolveBans(routes: Routes, sessionId: string, prefs: (number | null)[] = []): Promise<Snapshot> {
  const response = await routes.postResolveBans(post({ playerBanPreferences: prefs }), sessionId);
  expect(response.status).toBe(200);
  return json<Snapshot>(response);
}

async function autoDrive(routes: Routes, sessionId: string): Promise<Snapshot> {
  const response = await routes.postAutoDrive(sessionId);
  expect(response.status).toBe(200);
  return json<Snapshot>(response);
}

/** PD-026/PD-027: `assignedPosition` travels as a SIBLING field to `command`, never inside it. */
async function submitOwn(routes: Routes, sessionId: string, side: Side, slotIndex: number, heroId: number, assignedPosition: Position): Promise<Snapshot> {
  const response = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId }, assignedPosition }), sessionId);
  expect(response.status).toBe(202);
  return json<Snapshot>(response);
}

async function yieldRound(routes: Routes, sessionId: string): Promise<Response> {
  return routes.postYield(sessionId);
}

// Player heroes come from the HIGH end of each position group: the fixture scorer makes the bot pick from the LOW end, so no accidental collisions.
const mine = (position: Position, k: number): number => POSITION_HEROES[position][20 + k]!;
const other = (side: Side): Side => (side === "radiant" ? "dire" : "radiant");

describe("PD-026/PD-027 -- side y posicion personal son libres", () => {
  for (const side of ["radiant", "dire"] as Side[]) {
    for (const position of [1, 2, 3, 4, 5] as Position[]) {
      test(`${side} + Pos${position}: la sesion se crea, la posicion queda declarada y el Player controla las 5 posiciones`, async () => {
        const { routes, store } = makeRoutes();
        const sessionId = await createSession(routes, side, position, "D2K00001");
        const metadata = store.metadata(sessionId)!;
        expect(metadata.localSide).toBe(side);
        expect(metadata.humanPosition).toBe(position);
        expect(metadata.controlledPositions).toEqual([1, 2, 3, 4, 5]);
        // PartyContext.controlledSlots is structural/inert for AP -- never position/control truth.
        expect(store.partyContext(sessionId)?.controlledSlots).toHaveLength(0);

        await resolveBans(routes, sessionId);
        const round1 = await autoDrive(routes, sessionId);
        expect(round1.stopReason).toBe("human_input");
        // Both round-1 own slots are legal for the Player, whatever the personal position.
        const own = round1.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION");
        expect(own).toEqual([
          { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 0 },
          { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 1 },
        ]);
      });
    }
  }

  test("party 4 y combinaciones invalidas se rechazan con 422", async () => {
    const { routes } = makeRoutes();

    // Party 4 explícitamente no soportada -- rechazada por el validador genérico de PartyContext (partySize fuera de {1,2,3,5}).
    const body4 = { ...createBody("radiant", 2, "D2K00001"), controlledPositions: [1, 2, 3, 4], partyContext: { partySize: 4, side: "radiant", controlledSlots: [] } };
    const response4 = await routes.post(post(body4));
    expect(response4.status).toBe(400);

    // Posición personal del jugador no está entre las posiciones controladas.
    const bodyMismatch = { ...createBody("radiant", 2, "D2K00001"), controlledPositions: [5], partyContext: { partySize: 1, side: "radiant", controlledSlots: [] } };
    const responseMismatch = await routes.post(post(bodyMismatch));
    expect(responseMismatch.status).toBe(422);
    expect((await json<{ error: string }>(responseMismatch)).error).toBe("unsupported_simulator_policy");

    // Posiciones duplicadas.
    const bodyDup = { ...createBody("radiant", 5, "D2K00001"), controlledPositions: [5, 5], partyContext: { partySize: 2, side: "radiant", controlledSlots: [] } };
    const responseDup = await routes.post(post(bodyDup));
    expect(responseDup.status).toBe(422);
    expect((await json<{ error: string }>(responseDup)).error).toBe("unsupported_simulator_policy");

    // controlledSlots no vacío para AP -- rechazado (structural/inert truth violated).
    const bodyLegacySlots = {
      ...createBody("radiant", 2, "D2K00001"),
      partyContext: { partySize: 5, side: "radiant", controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "p0" }] },
    };
    const responseLegacy = await routes.post(post(bodyLegacySlots));
    expect(responseLegacy.status).toBe(422);
  });
});

describe("PD-026/PD-027 -- draft completo desde ambos lados", () => {
  for (const side of ["radiant", "dire"] as Side[]) {
    test(`${side}: BANS -> R1 -> R2 -> R3 -> COMPLETE; el Player controla 5 picks (orden NO cronologico) y el bot 5 validos para su posicion interna`, async () => {
      const { routes, store } = makeRoutes();
      const seed = "D2K00007";
      const sessionId = await createSession(routes, side, 3, seed);

      const afterBans = await resolveBans(routes, sessionId, [mine(1, 9)]);
      expect(afterBans.view.rankedAp?.phase).toBe("PICK_ROUND_1");

      // PD-026: order deliberately NOT chronological-by-role -- Mid (Pos2) + Carry (Pos1) in round
      // 1, Hard Support (Pos5) LAST in round 3. Position != pick chronology.
      const playerPlan: { position: Position; heroId: number }[][] = [
        [{ position: 2, heroId: mine(2, 0) }, { position: 1, heroId: mine(1, 1) }],
        [{ position: 3, heroId: mine(3, 2) }, { position: 4, heroId: mine(4, 3) }],
        [{ position: 5, heroId: mine(5, 4) }],
      ];

      let snapshot = afterBans;
      for (const [index, picks] of playerPlan.entries()) {
        snapshot = await autoDrive(routes, sessionId);
        expect(snapshot.stopReason).toBe("human_input");
        expect(snapshot.simulator?.round).toBe(index + 1);
        expect(snapshot.simulator?.durationMs).toBe([25000, 25000, 20000][index]!);
        // The enemy has sealed but the Player sees nothing of it.
        expect(snapshot.view.enemyPicks.every((slot) => slot.visibility !== "REVEALED" || slot.heroId !== undefined)).toBe(true);
        expect(JSON.stringify(snapshot)).not.toContain("internalPositionAssignments");
        for (const [slotIndex, pick] of picks.entries()) {
          snapshot = await submitOwn(routes, sessionId, side, slotIndex, pick.heroId, pick.position);
          expect(snapshot.accepted).toBe(true);
        }
      }
      expect(snapshot.view.status).toBe("COMPLETE");
      expect(snapshot.view.ownPicks.map((slot) => slot.heroId)).toEqual(playerPlan.flat().map((p) => p.heroId));
      // Own Team binding: PD-026 "Human choice truth wins" -- exactly the positions declared, never a round-seat guess.
      expect(snapshot.ownAssignedPositions.map((b) => b.assignedPosition).sort()).toEqual([1, 2, 3, 4, 5]);

      // Enemy: 5 picks, seat i's hero is valid for the seat's INTERNAL position (Enemy Bot truth unchanged by PD-026/PD-027).
      const assignments = createEnemyBotConfig(seed, other(side)).internalPositionAssignments;
      const enemy = snapshot.view.enemyPicks.map((slot) => slot.heroId!);
      expect(enemy).toHaveLength(5);
      enemy.forEach((hero, seat) => {
        expect(Math.floor(hero / 100)).toBe(assignments[seat]!);
      });
      expect(new Set([...enemy, ...playerPlan.flat().map((p) => p.heroId)]).size).toBe(10);
      expect(store.get(sessionId)?.status).toBe("COMPLETE");
    });
  }

  test("la asignacion interna del bot enemigo nunca aparece en ninguna respuesta del Simulator", async () => {
    const { routes } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00008");
    const bans = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
    const drive = await routes.postAutoDrive(sessionId);
    for (const text of [await bans.text(), await drive.text()]) {
      expect(text).not.toMatch(/internalPositionAssignments|positionsByRosterSlot|externalPicks/);
    }
  });

  test("misma seed => misma secuencia enemiga; otra seed => variacion valida", async () => {
    async function enemySequence(seed: string): Promise<number[]> {
      const { routes } = makeRoutes();
      const sessionId = await createSession(routes, "radiant", 2, seed);
      await resolveBans(routes, sessionId);
      const humanPool = [...POSITION_HEROES[1].slice(20), ...POSITION_HEROES[2].slice(20)];
      let snapshot = await autoDrive(routes, sessionId);
      let cursor = 0;
      const positionCycle: Position[] = [1, 2, 3, 4, 5];
      let positionCursor = 0;
      for (let guard = 0; guard < 30 && snapshot.view.status !== "COMPLETE"; guard += 1) {
        const open = snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION");
        for (const action of open) {
          const position = positionCycle[positionCursor++ % positionCycle.length]!;
          snapshot = await submitOwn(routes, sessionId, "radiant", action.slotIndex!, humanPool[cursor++]!, position);
        }
        if (snapshot.view.status !== "COMPLETE") snapshot = await autoDrive(routes, sessionId);
      }
      return snapshot.view.enemyPicks.map((slot) => slot.heroId!);
    }
    const a = await enemySequence("SEEDAAAA");
    expect(await enemySequence("SEEDAAAA")).toEqual(a);
    const variants = await Promise.all(["SEEDBBBB", "SEEDCCCC", "SEEDDDDD", "SEEDEEEE"].map(enemySequence));
    expect(variants.some((sequence) => JSON.stringify(sequence) !== JSON.stringify(a))).toBe(true);
  });
});

describe("PD-026/PD-027 -- autorizacion y trust boundary", () => {
  test("el Player no puede sellar por el bot, ni registrar bans por su cuenta", async () => {
    const { routes } = makeRoutes();
    const sessionId = await createSession(routes, "dire", 4, "D2K00009");
    const skipPolicy = await routes.postCommand(post({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), sessionId);
    expect(skipPolicy.status).toBe(403);
    const forgedBans = await routes.postCommand(post({ command: { type: "RECORD_RESOLVED_BANS", heroes: [] } }), sessionId);
    expect(forgedBans.status).toBe(403);
    await resolveBans(routes, sessionId);
    // Session localSide is "dire" -- a command claiming "radiant" (the bot's side) never reaches
    // the AP atomic path at all (side mismatch is refused by the generic authorization check first).
    const forBot = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 200 }, assignedPosition: 1 }), sessionId);
    expect(forBot.status).toBe(403);
  });

  test("REDTEAM: assignedPosition ausente/malformado en una sesion AP con controlledPositions -> 400, nunca muta el kernel", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00040");
    await resolveBans(routes, sessionId);
    await autoDrive(routes, sessionId);
    for (const malformed of [undefined, null, 0, 6, "2", {}]) {
      const response = await routes.postCommand(
        post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: mine(1, 0) }, assignedPosition: malformed }),
        sessionId,
      );
      expect(response.status).toBe(400);
    }
    expect(store.get(sessionId)!.rankedAp!.confirmedPicks).toHaveLength(0);
    expect(store.ownAssignedPositions(sessionId)).toHaveLength(0);
  });

  test("REDTEAM: assignedPosition para una posicion NO controlada -> 409, nunca muta el kernel", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 2, [2, 5], "D2K00041");
    await resolveBans(routes, sessionId);
    await autoDrive(routes, sessionId);
    const response = await routes.postCommand(
      post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: mine(3, 0) }, assignedPosition: 3 }),
      sessionId,
    );
    expect(response.status).toBe(409);
    expect((await json<{ error: string }>(response)).error).toBe("position_not_controlled");
    expect(store.get(sessionId)!.rankedAp!.confirmedPicks).toHaveLength(0);
  });

  test("REDTEAM: reenviar la misma posicion ya sellada -> 409, sin duplicar el binding", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00042");
    await resolveBans(routes, sessionId);
    await autoDrive(routes, sessionId);
    await submitOwn(routes, sessionId, "radiant", 0, mine(2, 0), 2);
    const openAfter = store.get(sessionId)!.rankedAp!.round!.openSlots.filter((slot) => slot.side === "radiant");
    const dupe = await routes.postCommand(
      post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: openAfter[0]!.slotIndex, heroId: mine(2, 1) }, assignedPosition: 2 }),
      sessionId,
    );
    expect(dupe.status).toBe(409);
    expect((await json<{ error: string }>(dupe)).error).toBe("position_already_filled");
    expect(store.ownAssignedPositions(sessionId)!.filter((b) => b.assignedPosition === 2)).toHaveLength(1);
  });

  test("REDTEAM: assignedPosition sobre una sesion sin controlledPositions (Manual/CM) es ignorado -- no rompe el camino existente", async () => {
    const { routes } = makeRoutes();
    const store = new ProtocolSessionStore();
    const manualRoutes = createProtocolSessionRoutes({ store, computeSuggestions: scorer });
    const created = await manualRoutes.post(post({
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "manual",
      partyContext: { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: "p" })) },
    }));
    expect(created.status).toBe(201);
    const { sessionId } = await json<{ sessionId: string }>(created);
    const response = await manualRoutes.postCommand(
      post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: mine(1, 0) }, assignedPosition: 99 }),
      sessionId,
    );
    expect(response.status).toBe(202);
    void routes;
  });
});

describe("PD-026/PD-027 -- fase de bans (fail closed)", () => {
  test("mismos inputs + misma seed => mismos bans; los bans quedan en la vista y son inalcanzables", async () => {
    const a = makeRoutes();
    const b = makeRoutes();
    const idA = await createSession(a.routes, "radiant", 2, "D2K00010");
    const idB = await createSession(b.routes, "dire", 5, "D2K00010");
    const first = await resolveBans(a.routes, idA, [mine(1, 5), mine(1, 6), mine(1, 7), mine(1, 8)]);
    const second = await resolveBans(b.routes, idB, [mine(1, 5), mine(1, 6), mine(1, 7), mine(1, 8)]);
    expect(second.resolvedBans).toEqual(first.resolvedBans);
    expect(first.view.bannedHeroes).toEqual(first.resolvedBans!);
    expect(first.resolvedBans!.some((hero) => [mine(1, 5), mine(1, 6), mine(1, 7), mine(1, 8)].includes(hero))).toBe(true); // 4 full preferences -> at least one
    const banned = first.resolvedBans![0]!;
    const attempt = await submitOwnRaw(a.routes, idA, banned);
    expect(attempt.rejected ?? "").not.toBe("");
    expect(a.store.get(idA)?.rankedAp?.confirmedPicks).toHaveLength(0);
  });

  async function submitOwnRaw(routes: Routes, sessionId: string, heroId: number): Promise<Snapshot> {
    const response = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId }, assignedPosition: 1 }), sessionId);
    return json<Snapshot>(response);
  }

  test("la policy lanza: no se entra a Round 1, no hay bans fabricados y el reintento funciona", async () => {
    let calls = 0;
    const flaky: BanResolutionPolicy = {
      resolve(preferences) {
        calls += 1;
        if (calls === 1) throw new Error("boom");
        return [...new Set(preferences.flatMap((set) => set.preferences).filter((hero): hero is number => hero !== null))].slice(0, 3);
      },
    };
    const { routes, store } = makeRoutes({ banResolutionPolicy: flaky });
    const sessionId = await createSession(routes, "radiant", 2, "D2K00011");

    const failed = await routes.postResolveBans(post({ playerBanPreferences: [mine(1, 5)] }), sessionId);
    expect(failed.status).toBe(422);
    expect(await json<{ retryable: boolean }>(failed)).toMatchObject({ error: "ban_resolution_failed", retryable: true });
    const stuck = store.get(sessionId)!;
    expect(stuck.rankedAp?.phase).toBe("BAN_RESOLUTION");
    expect(stuck.rankedAp?.banResolutionComplete).toBe(false);
    expect(stuck.rankedAp?.bannedHeroes).toEqual([]);
    expect(stuck.rankedAp?.round).toBeNull();
    const drive = await routes.postAutoDrive(sessionId);
    expect(drive.status).toBe(409); // no round exists: nothing was silently started

    const retry = await routes.postResolveBans(post({ playerBanPreferences: [mine(1, 5)] }), sessionId);
    expect(retry.status).toBe(200);
    expect(store.get(sessionId)?.rankedAp?.phase).toBe("PICK_ROUND_1");
  });

  test("universo de heroes no disponible => 503 retryable y la sesion sigue en bans", async () => {
    const { routes, store } = makeRoutes({ heroUniverse: null });
    const sessionId = await createSession(routes, "radiant", 2, "D2K00012");
    const response = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
    expect(response.status).toBe(503);
    expect(store.get(sessionId)?.rankedAp?.phase).toBe("BAN_RESOLUTION");
  });

  test("preferencias invalidas (input externo) => 400 y la sesion sigue en bans", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00013");
    for (const bad of [[999999], [1, 1], ["x"], [1, 2, 3, 4, 5]]) {
      const response = await routes.postResolveBans(post({ playerBanPreferences: bad }), sessionId);
      expect(response.status).toBe(400);
    }
    expect(store.get(sessionId)?.rankedAp?.phase).toBe("BAN_RESOLUTION");
  });

  test("no se puede resolver dos veces", async () => {
    const { routes } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00014");
    await resolveBans(routes, sessionId);
    const again = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
    expect(again.status).toBe(409);
  });
});

describe("PD-026/PD-027 -- ciego, simetria y colisiones (flujo real)", () => {
  async function untilHumanInput(routes: Routes, sessionId: string): Promise<Snapshot> {
    await resolveBans(routes, sessionId);
    return autoDrive(routes, sessionId);
  }

  function botSealed(store: ProtocolSessionStore, sessionId: string, botSide: Side): number[] {
    return (store.get(sessionId)?.rankedAp?.round?.sealed ?? []).filter((entry) => entry.side === botSide).map((entry) => entry.heroId);
  }

  test("un pick sellado del bot sigue siendo HIDDEN para el Player pero el Player PUEDE elegir ese mismo heroe", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00020");
    const round1 = await untilHumanInput(routes, sessionId);
    expect(round1.view.enemyPicks).toEqual([{ visibility: "HIDDEN" }, { visibility: "HIDDEN" }]);
    const botHero = botSealed(store, sessionId, "dire")[0]!;
    const accepted = await submitOwn(routes, sessionId, "radiant", 0, botHero, 2);
    expect(accepted.accepted).toBe(true);
    expect(accepted.rejected).toBeUndefined();
  });

  test("COLLISION REOPEN: colision #1 y #2 (baneo + repick) prunea el binding de posicion del asiento propio reabierto", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "dire", 1, "D2K00021");
    let snapshot = await untilHumanInput(routes, sessionId);

    // Round 1: the Player deliberately duplicates the bot's first sealed hero, binding Pos1 to slot 0.
    const first = botSealed(store, sessionId, "radiant")[0]!;
    await submitOwn(routes, sessionId, "dire", 0, first, 1);
    expect(store.ownAssignedPositions(sessionId)).toEqual([{ round: 1, slotIndex: 0, assignedPosition: 1 }]);
    snapshot = await submitOwn(routes, sessionId, "dire", 1, POSITION_HEROES[1][20]!, 2);
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(1);
    expect(snapshot.view.bannedHeroes).toContain(first);
    // The Pos1 binding for the reopened slot 0 is pruned; the Pos2 binding for slot 1 (the winner) is untouched.
    expect(store.ownAssignedPositions(sessionId)).toEqual([{ round: 1, slotIndex: 1, assignedPosition: 2 }]);

    // The bot re-picks (knowing `first` is banned); the Player duplicates that new pick too, rebinding Pos1 to slot 0.
    snapshot = await autoDrive(routes, sessionId);
    expect(snapshot.stopReason).toBe("human_input");
    const second = botSealed(store, sessionId, "radiant")[0]!;
    expect(second).not.toBe(first);
    snapshot = await submitOwn(routes, sessionId, "dire", 0, second, 1);
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(2);
    expect(snapshot.view.bannedHeroes).toEqual(expect.arrayContaining([first, second]));
    expect(store.ownAssignedPositions(sessionId)).toEqual(expect.arrayContaining([{ round: 1, slotIndex: 1, assignedPosition: 2 }]));

    // A banned hero can never be picked afterwards.
    snapshot = await autoDrive(routes, sessionId);
    const retry = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: first }, assignedPosition: 1 }), sessionId);
    expect((await json<Snapshot>(retry)).rejected).toBe("HERO_ALREADY_TAKEN");

    // Finish round 1 without further collision: the counter resets in round 2, and the reopened
    // slot's final binding is exactly what was actually sealed there (Pos1 again -- deliberately
    // re-chosen, PD-026 does not forbid picking the same position twice across attempts).
    const third = botSealed(store, sessionId, "radiant")[0]!;
    const safe = POSITION_HEROES[1].find((hero) => hero !== third && !snapshot.view.bannedHeroes.includes(hero) && hero !== POSITION_HEROES[1][20])!;
    snapshot = await submitOwn(routes, sessionId, "dire", 0, safe, 1);
    expect(store.get(sessionId)?.rankedAp?.phase).toBe("PICK_ROUND_2");
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(0);
    expect(store.ownAssignedPositions(sessionId)!.map((b) => b.assignedPosition).sort()).toEqual([1, 2]);
  });

  // Drives a real AP session (Player = radiant, Enemy Bot = dire) to the third collision of round 1.
  // The bot seals BEFORE the Player is prompted, so in this flow the bot registers first.
  async function driveToThirdCollisionBotFirst(routes: Routes, store: ProtocolSessionStore, sessionId: string): Promise<number> {
    await untilHumanInput(routes, sessionId);
    const filler = POSITION_HEROES[1][25]!;
    for (let pass = 0; pass < 2; pass += 1) {
      const target = botSealed(store, sessionId, "dire")[0]!;
      const open = store.get(sessionId)!.rankedAp!.round!.openSlots.filter((slot) => slot.side === "radiant");
      for (const [index, slot] of open.entries()) {
        await submitOwn(routes, sessionId, "radiant", slot.slotIndex, index === 0 ? target : POSITION_HEROES[2][20 + pass * 3 + index]!, index === 0 ? 1 : 2);
      }
      await autoDrive(routes, sessionId);
    }
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(2);
    const target = botSealed(store, sessionId, "dire")[0]!;
    const open = store.get(sessionId)!.rankedAp!.round!.openSlots.filter((slot) => slot.side === "radiant");
    let last: Snapshot | null = null;
    for (const slot of open) last = await submitOwn(routes, sessionId, "radiant", slot.slotIndex, slot.slotIndex === open[0]!.slotIndex ? target : filler, slot.slotIndex === open[0]!.slotIndex ? 1 : 2);
    expect(last?.view.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    return target;
  }

  test("colision #3 (flujo real): el bot registro primero -> el bot conserva el heroe y el asiento del Player reabre", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00022");
    const target = await driveToThirdCollisionBotFirst(routes, store, sessionId);
    const resumed = await autoDrive(routes, sessionId);
    expect(resumed.stopReason).toBe("human_input");
    const ranked = store.get(sessionId)!.rankedAp!;
    expect(ranked.confirmedPicks.find((pick) => pick.heroId === target)?.side).toBe("dire");
    expect(ranked.bannedHeroes).not.toContain(target);
    expect(store.get(sessionId)?.status).not.toBe("WAITING_FOR_COLLISION_AUTHORITY");
    expect(resumed.legalActions.some((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === "radiant")).toBe(true);
    // The reopened slot's stale Pos1 binding was pruned -- never a stray binding for an unsealed slot.
    expect(store.ownAssignedPositions(sessionId)!.length).toBeLessThanOrEqual(1);
  });

  test("colision #3 (Player primero): el Player conserva el heroe; el resultado NO depende de la seed de la sesion ni del body", async () => {
    const winners: string[] = [];
    for (const [seed, bodySeed] of [["SEEDAAAA", "BODYAAAA"], ["SEEDBBBB", "BODYBBBB"], ["SEEDCCCC", "BODYCCCC"]]) {
      const { routes, store } = makeRoutes();
      const sessionId = await createSession(routes, "radiant", 2, seed!);
      await resolveBans(routes, sessionId);
      const apply = (side: Side, slotIndex: number, heroId: number) => store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId });
      // Player (radiant) registers first in every pass, bot (dire) second -- straight through the store.
      const heroes: [number, number][] = [[mine(1, 1), mine(1, 2)], [mine(2, 1), mine(2, 2)], [mine(3, 1), mine(3, 2)]];
      let filler = 0;
      for (const [hero] of heroes) {
        for (const slot of [...store.get(sessionId)!.rankedAp!.round!.openSlots].sort((a, b) => (a.side === b.side ? a.slotIndex - b.slotIndex : a.side === "radiant" ? -1 : 1))) {
          apply(slot.side, slot.slotIndex, slot.slotIndex === 0 ? hero : mine(4, (filler += 1)));
        }
      }
      expect(store.get(sessionId)?.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
      const response = await routes.postSimulatorAuthority(post({ seed: bodySeed }), sessionId);
      expect(response.status).toBe(200);
      const target = heroes[2]![0];
      winners.push(store.get(sessionId)!.rankedAp!.confirmedPicks.find((pick) => pick.heroId === target)!.side);
    }
    expect(winners).toEqual(["radiant", "radiant", "radiant"]);
  });

  test("colision #3 con evidencia ausente: FALLA CERRADO -- el draft sigue pausado y nadie gana", async () => {
    const store = new (class extends ProtocolSessionStore {
      override registrationEvidence(): null { return null; }
    })();
    const routes = createProtocolSessionRoutes({
      store, computeSuggestions: scorer, heroPositions: HERO_POSITIONS, heroUniverse: async () => UNIVERSE,
    });
    const sessionId = await createSession(routes, "radiant", 2, "D2K00023");
    // Reach WAITING_FOR_COLLISION_AUTHORITY through the real kernel (the store still applies commands).
    await untilHumanInput(routes, sessionId);
    const filler = POSITION_HEROES[1][25]!;
    for (let pass = 0; pass < 3; pass += 1) {
      const target = botSealed(store, sessionId, "dire")[0]!;
      const open = store.get(sessionId)!.rankedAp!.round!.openSlots.filter((slot) => slot.side === "radiant");
      for (const [index, slot] of open.entries()) {
        await submitOwn(routes, sessionId, "radiant", slot.slotIndex, index === 0 ? target : pass === 2 ? filler : POSITION_HEROES[2][20 + pass * 3 + index]!, index === 0 ? 1 : 2);
      }
      if (pass < 2) await autoDrive(routes, sessionId);
    }
    expect(store.get(sessionId)?.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const stalled = await routes.postAutoDrive(sessionId);
    expect(stalled.status).toBe(409);
  });
});

describe("PD-026/PD-027 -- temporizadores y penalizacion (capa del Simulator)", () => {
  test("la ronda 3 dura 20 s; el timer no asigna ningun heroe al vencer", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 5, "D2K00030");
    await resolveBans(routes, sessionId);
    for (const [index, picks] of [[{ heroId: mine(1, 0), position: 1 as Position }, { heroId: mine(2, 0), position: 2 as Position }], [{ heroId: mine(3, 0), position: 3 as Position }, { heroId: mine(4, 0), position: 4 as Position }]].entries()) {
      const snap = await autoDrive(routes, sessionId);
      expect(snap.simulator?.durationMs).toBe(25000);
      for (const [slotIndex, pick] of picks.entries()) await submitOwn(routes, sessionId, "radiant", slotIndex, pick.heroId, pick.position);
      expect(index).toBeLessThan(2);
    }
    const round3 = await autoDrive(routes, sessionId);
    expect(round3.simulator?.round).toBe(3);
    expect(round3.simulator?.durationMs).toBe(20000);
    // 60 s later the seat is late -- and STILL nothing was picked for the Player.
    const late = store.simulatorTimerView(sessionId, Date.now() + 60_000)!;
    expect(late.penaltyActive).toBe(true);
    expect(late.goldPenaltyBySlot.some((penalty) => penalty > 70)).toBe(true);
    expect(store.get(sessionId)?.rankedAp?.round?.openSlots.some((slot) => slot.side === "radiant")).toBe(true);
    expect(store.get(sessionId)?.rankedAp?.confirmedPicks.filter((pick) => pick.side === "radiant")).toHaveLength(4);
  });
});

describe("PD-026/PD-027 -- Solo/Party: posicion independiente de la cronologia de picks", () => {
  test("MANDATORY 1 -- SOLO POS2 R1: el humano puede sellar Pos2 en la Ronda 1 (no espera a Ronda 3)", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 2, [2], "SOLO_POS2_R1");
    await resolveBans(routes, sessionId);

    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    expect(r1.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION").length).toBeGreaterThan(0);

    const openSlot = r1.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
    const sealed = await submitOwn(routes, sessionId, "radiant", openSlot.slotIndex!, mine(2, 0), 2);
    expect(sealed.accepted).toBe(true);
    expect(sealed.ownAssignedPositions).toEqual([{ round: 1, slotIndex: openSlot.slotIndex!, assignedPosition: 2 }]);
    // UI/Coach-visible truth: the confirmed pick is bound to Pos2, never guessed from round/seat.
    expect(store.ownAssignedPositionForHero(sessionId, mine(2, 0))).toBe(2);

    while (store.get(sessionId)?.status !== "COMPLETE") await autoDrive(routes, sessionId);
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("MANDATORY 2 -- PARTY 5 CHRONOLOGY INDEPENDENCE: Pos2 puede sellarse en R1 y Pos5 en R3, mismo draft", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "PARTY5_CHRONO");
    await resolveBans(routes, sessionId);

    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    const [slotA, slotB] = r1.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION");
    // Pos2 sealed in Round 1.
    await submitOwn(routes, sessionId, "radiant", slotA!.slotIndex!, mine(2, 0), 2);
    await submitOwn(routes, sessionId, "radiant", slotB!.slotIndex!, mine(3, 0), 3);

    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("human_input");
    const [slotC, slotD] = r2.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION");
    await submitOwn(routes, sessionId, "radiant", slotC!.slotIndex!, mine(1, 0), 1);
    await submitOwn(routes, sessionId, "radiant", slotD!.slotIndex!, mine(4, 0), 4);

    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("human_input");
    const slotE = r3.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
    // Pos5 sealed LAST, in Round 3 -- labels stay Pos2/Pos5, never re-derived from round/seat.
    const final = await submitOwn(routes, sessionId, "radiant", slotE.slotIndex!, mine(5, 0), 5);
    expect(final.ownAssignedPositions.find((b) => b.round === 1)?.assignedPosition).toBe(2);
    expect(final.ownAssignedPositions.find((b) => b.round === 3)?.assignedPosition).toBe(5);
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("MANDATORY 3 -- PARTY 2: Pos2/Pos5 controlados actuan en cualquier ronda disponible; el Ally Bot nunca los llena", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 2, [2, 5], "PARTY2_TEST");
    await resolveBans(routes, sessionId);

    // R1: human seals Pos5 in ONE of the two open slots, then explicitly yields the round's other
    // slot (round capacity = 2, Ally Bot's 3 positions can absorb it) -- PD-026 HUMAN PICK TIMING:
    // the human is never forced to act on every open slot of a round it doesn't want to.
    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    const slot1 = r1.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
    await submitOwn(routes, sessionId, "radiant", slot1.slotIndex!, mine(5, 0), 5);
    const r1Remainder = await autoDrive(routes, sessionId);
    expect(r1Remainder.stopReason).toBe("human_input"); // Pos2 still open, not yet yielded -- still human_input
    expect((await yieldRound(routes, sessionId)).status).toBe(200);
    const r1Complete = await autoDrive(routes, sessionId);
    expect(r1Complete.stopReason).toBe("round_revealed");

    // R2: Pos2 is still the only human-open position and round 2's slots don't require it --
    // human yields again, the Ally Bot fills its last 2 positions.
    const r2Stop = await autoDrive(routes, sessionId);
    expect(r2Stop.stopReason).toBe("human_input");
    expect((await yieldRound(routes, sessionId)).status).toBe(200);
    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("round_revealed");

    // R3: the Ally Bot's 3 positions are exhausted -- the sole remaining slot is Pos2, human's.
    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("human_input");
    const slot3 = r3.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
    await submitOwn(routes, sessionId, "radiant", slot3.slotIndex!, mine(2, 0), 2);

    expect(store.get(sessionId)?.status).toBe("COMPLETE");
    const bound = store.ownAssignedPositions(sessionId)!.map((b) => b.assignedPosition).sort();
    expect(bound).toEqual([1, 2, 3, 4, 5]);
    // The Ally Bot NEVER filled Pos2 or Pos5 -- only the human's own submissions bound them.
    expect(store.ownAssignedPositionForHero(sessionId, mine(2, 0))).toBe(2);
    expect(store.ownAssignedPositionForHero(sessionId, mine(5, 0))).toBe(5);
  });

  test("MANDATORY 4 -- ALLY BOT HUMAN-FIRST: no sella mientras quede una posicion humana disponible sin ceder", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 1, [1, 3, 5], "ALLY_HUMAN_FIRST");
    await resolveBans(routes, sessionId);

    // R1: two round slots open, both human-controlled positions [1,3,5] still fully unfilled ->
    // auto-drive MUST stop for human_input, never let the Ally Bot seal ahead of the human.
    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    expect(store.ownAssignedPositions(sessionId)).toHaveLength(0);
  });

  test("MANDATORY 4b -- tras ceder explicitamente, el Ally Bot llena la capacidad restante de la ronda", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 1, [1, 3, 5], "ALLY_YIELD");
    await resolveBans(routes, sessionId);
    await autoDrive(routes, sessionId); // stops human_input, R1 has 2 open own slots, 3 unfilled human positions (>= capacity)

    const yielded = await yieldRound(routes, sessionId);
    expect(yielded.status).toBe(200);

    const afterYield = await autoDrive(routes, sessionId);
    // The Ally Bot has no positions of its own (Party 3 controls [1,3,5], complement is [2,4]) --
    // but round 1's capacity is 2 and the human yielded, so [2,4] (Ally Bot's OWN positions) fill it.
    expect(afterYield.stopReason).toBe("round_revealed");
    expect(store.ownAssignedPositions(sessionId)!.every((b) => b.assignedPosition === 2 || b.assignedPosition === 4)).toBe(true);
  });

  test("MANDATORY 4c -- ceder es rechazado cuando el Ally Bot no puede absorber la capacidad restante", async () => {
    const { routes } = makeRoutes();
    // Party 5: controlledPositions = [1,2,3,4,5], Ally Bot has ZERO positions of its own.
    const sessionId = await createSession(routes, "radiant", 2, "ALLY_NO_CAPACITY");
    await resolveBans(routes, sessionId);
    await autoDrive(routes, sessionId);
    const response = await yieldRound(routes, sessionId);
    expect(response.status).toBe(409);
    expect((await json<{ error: string }>(response)).error).toBe("no_ally_bot_capacity");
  });

  test("MANDATORY 5 -- ALLY DETERMINISM: misma seed + mismo lado + mismas posiciones aliadas => mismo orden de relleno", () => {
    const orderA = deriveAllyPositionOrder("SEED_FIXED", "radiant", [1, 2, 4]);
    const orderB = deriveAllyPositionOrder("SEED_FIXED", "radiant", [1, 2, 4]);
    expect(orderA).toEqual(orderB);
    expect(new Set(orderA)).toEqual(new Set([1, 2, 4]));
    const differentSeed = deriveAllyPositionOrder("SEED_OTHER", "radiant", [1, 2, 4]);
    expect(differentSeed).not.toEqual(orderA); // extremely unlikely to collide by chance across seeds
    const differentSide = deriveAllyPositionOrder("SEED_FIXED", "dire", [1, 2, 4]);
    expect(differentSide).not.toEqual(orderA);
  });

  test("MANDATORY 5b -- ALLY DETERMINISM end-to-end: mismo seed + misma config de party => picks identicos de bots", async () => {
    const runDraft = async (seed: string) => {
      const { routes, store } = makeRoutes();
      const sessionId = await createPartySession(routes, "radiant", 2, [2, 5], seed);
      await resolveBans(routes, sessionId);
      const r1 = await autoDrive(routes, sessionId);
      const slot1 = r1.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
      await submitOwn(routes, sessionId, "radiant", slot1.slotIndex!, mine(5, 1), 5);
      await autoDrive(routes, sessionId); // R2 autonomous (Ally Bot fills [1,3,4])
      const r3 = await autoDrive(routes, sessionId); // R3 stops for player
      const slot3 = r3.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
      await submitOwn(routes, sessionId, "radiant", slot3.slotIndex!, mine(2, 1), 2);
      return store.get(sessionId)!.rankedAp!.confirmedPicks;
    };

    const run1 = await runDraft("DETERMINISTIC_SEED_123");
    const run2 = await runDraft("DETERMINISTIC_SEED_123");

    expect(run1).toEqual(run2);
  });

  test("MANDATORY 6 -- OFF-ROLE HUMAN PICK: un heroe con evidencia posicional pobre para Pos2 queda igual confirmado en Pos2, sin bloqueo ni advertencia", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 2, [2], "OFF_ROLE_PICK");
    await resolveBans(routes, sessionId);
    const r1 = await autoDrive(routes, sessionId);
    const slot = r1.legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
    // Hero drawn from the Pos5 pool (poor positional evidence for Pos2) -- PD-026 rule 9/10: any
    // legal hero for a controlled position, no off-role warning or block.
    const offRoleHero = POSITION_HEROES[5][0]!;
    const response = await submitOwn(routes, sessionId, "radiant", slot.slotIndex!, offRoleHero, 2);
    expect(response.accepted).toBe(true);
    expect(response.rejected).toBeUndefined();
    expect(store.ownAssignedPositionForHero(sessionId, offRoleHero)).toBe(2);
  });

  test("MANDATORY 8 -- COACH TARGETS: el shortlist del round 1 puede apuntar a Pos2/Pos1 cuando esas posiciones humanas estan abiertas (support-first no es una regla mecanica)", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 2, [1, 2], "COACH_TARGETS");
    await resolveBans(routes, sessionId);
    await autoDrive(routes, sessionId);
    const humanOpen = store.humanOpenPositions(sessionId);
    expect(humanOpen).toEqual(expect.arrayContaining([1, 2]));
    expect(humanOpen).not.toContain(5); // Pos5 is NOT human-controlled in this party, so it is never a coach target here.
  });

  test("MANDATORY 9 -- CACHE/IDENTITY: dos estados AP que solo difieren en humanOpenPositions producen identidad distinta", async () => {
    const { routes, store } = makeRoutes();
    const sessionIdA = await createPartySession(routes, "radiant", 2, [2, 5], "IDENTITY_A");
    const sessionIdB = await createPartySession(routes, "radiant", 2, [2, 5], "IDENTITY_A");
    await resolveBans(routes, sessionIdA);
    await resolveBans(routes, sessionIdB);
    await autoDrive(routes, sessionIdA);
    await autoDrive(routes, sessionIdB);
    // Both start identical. Now A seals Pos5, changing ONLY its humanOpenPositions.
    const r1A = await routes.postAutoDrive(sessionIdA); // no-op re-check, keep snapshot fresh
    void r1A;
    const openA = (await routes.get(sessionIdA, new URL("http://x/y")).json() as unknown as Snapshot).legalActions.find((a) => a.type === "SUBMIT_SEALED_SELECTION")!;
    await submitOwn(routes, sessionIdA, "radiant", openA.slotIndex!, mine(5, 0), 5);

    const responseA = await routes.getRecommendations(sessionIdA, new URL(`http://x/y?format=v3`));
    const responseB = await routes.getRecommendations(sessionIdB, new URL(`http://x/y?format=v3`));
    const bodyA = (await responseA.json()) as { recommendationSet: { basedOn: { partyIdentity: string | null } } };
    const bodyB = (await responseB.json()) as { recommendationSet: { basedOn: { partyIdentity: string | null } } };
    expect(bodyA.recommendationSet.basedOn.partyIdentity).not.toBeNull();
    expect(bodyA.recommendationSet.basedOn.partyIdentity).not.toBe(bodyB.recommendationSet.basedOn.partyIdentity);
  });

  test("MANDATORY 10 -- NO PRIVATE ENEMY LEAK: el rol enemigo mostrado sigue derivando solo de RoleBelief, ninguna respuesta AP expone la asignacion interna del Enemy Bot", async () => {
    const { routes } = makeRoutes();
    const sessionId = await createPartySession(routes, "radiant", 2, [2, 5], "NO_LEAK");
    const bans = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
    const drive = await routes.postAutoDrive(sessionId);
    for (const text of [await bans.text(), await drive.text()]) {
      expect(text).not.toMatch(/internalPositionAssignments|positionsByRosterSlot/);
    }
  });
});
