import { describe, expect, test } from "bun:test";
import type { DraftState } from "../../draft/reducer";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { HeroPositions } from "../../signals/hero-positions";
import type { SuggestionSet } from "../../signals/mix";
import { createEnemyBotConfig } from "../../simulator/enemy-bot";
import { ROSTER_SEAT_FOR_POSITION } from "../../simulator/ap-simulator-policy";
import type { BanResolutionPolicy, HeroUniverse } from "../../simulator/ban-resolution";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes, type ComputeSuggestionsForDraftState } from "./protocol-sessions";

// AP Ranked Roles V1 / Wave 1 -- the Simulator product path, exercised through the real routes
// and the real kernel-backed store. Only the scorer, the hero universe and the position evidence
// are fixtures (S2 / S10): no SQLite, no network, no curated file.

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

function createBody(side: Side, position: Position, seed: string) {
  return {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    partyContext: {
      partySize: 5,
      side,
      controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side, slotIndex, controllerId: "player" })),
    },
    humanPosition: position,
    simulatorSeed: seed,
  };
}

interface Snapshot {
  view: { status: string; phase?: string; bannedHeroes: number[]; ownPicks: { visibility: string; heroId?: number }[]; enemyPicks: { visibility: string; heroId?: number }[]; rankedAp: { phase: string } | null };
  legalActions: { type: string; side?: string; slotIndex?: number }[];
  simulator: { round: number; durationMs: number; pendingSeats: number[]; goldPenaltyBySlot: number[]; penaltyRatePerSecond: number } | null;
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

async function createSession(routes: Routes, side: Side, position: Position, seed: string): Promise<string> {
  const response = await routes.post(post(createBody(side, position, seed)));
  expect(response.status).toBe(201);
  return (await json<{ sessionId: string }>(response)).sessionId;
}

async function createPartySession(
  routes: Routes,
  side: Side,
  personalPosition: Position,
  partyPositions: Position[],
  seed: string,
): Promise<string> {
  const partySize = partyPositions.length as 1 | 2 | 3 | 5;
  const controlledSlots = partyPositions.map((p) => ({
    side,
    slotIndex: ROSTER_SEAT_FOR_POSITION[p],
    controllerId: `player-${p}`,
  }));
  const body = {
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: side,
    adapterKind: "simulator",
    partyContext: { partySize, side, controlledSlots },
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

async function submitOwn(routes: Routes, sessionId: string, side: Side, slotIndex: number, heroId: number): Promise<Snapshot> {
  const response = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId } }), sessionId);
  expect(response.status).toBe(202);
  return json<Snapshot>(response);
}

// Player heroes come from the HIGH end of each position group: the fixture scorer makes the bot pick from the LOW end, so no accidental collisions.
const mine = (position: Position, k: number): number => POSITION_HEROES[position][20 + k]!;
const other = (side: Side): Side => (side === "radiant" ? "dire" : "radiant");

describe("AP Ranked Roles V1 -- side y posicion personal son libres", () => {
  for (const side of ["radiant", "dire"] as Side[]) {
    for (const position of [1, 2, 3, 4, 5] as Position[]) {
      test(`${side} + Pos${position}: la sesion se crea, la posicion queda declarada y el Player controla los 5 asientos`, async () => {
        const { routes, store } = makeRoutes();
        const sessionId = await createSession(routes, side, position, "D2K00001");
        const metadata = store.metadata(sessionId)!;
        expect(metadata.localSide).toBe(side);
        expect(metadata.humanPosition).toBe(position);
        expect(store.partyContext(sessionId)?.controlledSlots).toHaveLength(5);

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

  test("party 4 y combinaciones invalidas de party/posicion se rechazan con 422", async () => {
    const { routes } = makeRoutes();

    // Party 4 explícitamente no soportada
    const body4 = createBody("radiant", 2, "D2K00001");
    body4.partyContext = {
      partySize: 4 as unknown as 5,
      side: "radiant",
      controlledSlots: [
        { side: "radiant", slotIndex: 0, controllerId: "p0" },
        { side: "radiant", slotIndex: 1, controllerId: "p1" },
        { side: "radiant", slotIndex: 2, controllerId: "p2" },
        { side: "radiant", slotIndex: 4, controllerId: "p4" },
      ],
    };
    const response4 = await routes.post(post(body4));
    expect(response4.status).toBe(400);
    expect((await json<{ error: string }>(response4)).error).toBe("invalid_body");

    // Posición personal del jugador no está en los slots controlados
    const bodyMismatch = createBody("radiant", 2, "D2K00001"); // Pos 2 -> slot 4
    bodyMismatch.partyContext = {
      partySize: 1,
      side: "radiant",
      controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "p0" }], // slot 0 -> Pos 5
    };
    const responseMismatch = await routes.post(post(bodyMismatch));
    expect(responseMismatch.status).toBe(422);
    expect((await json<{ error: string }>(responseMismatch)).error).toBe("unsupported_simulator_policy");

    // Asientos duplicados
    const bodyDup = createBody("radiant", 5, "D2K00001");
    bodyDup.partyContext = {
      partySize: 2,
      side: "radiant",
      controlledSlots: [
        { side: "radiant", slotIndex: 0, controllerId: "p0" },
        { side: "radiant", slotIndex: 0, controllerId: "p1" },
      ],
    };
    const responseDup = await routes.post(post(bodyDup));
    expect(responseDup.status).toBe(422);
    expect((await json<{ error: string }>(responseDup)).error).toBe("unsupported_simulator_policy");
  });
});

describe("AP Ranked Roles V1 -- draft completo desde ambos lados", () => {
  for (const side of ["radiant", "dire"] as Side[]) {
    test(`${side}: BANS -> R1 -> R2 -> R3 -> COMPLETE; el Player controla 5 picks y el bot 5 (cada uno valido para su posicion interna)`, async () => {
      const { routes, store } = makeRoutes();
      const seed = "D2K00007";
      const sessionId = await createSession(routes, side, 3, seed);

      const afterBans = await resolveBans(routes, sessionId, [mine(1, 9)]);
      expect(afterBans.view.rankedAp?.phase).toBe("PICK_ROUND_1");

      // Player order deliberately NOT chronological-by-role: Mid + Carry in round 1, support last.
      const playerPlan: number[][] = [
        [mine(2, 0), mine(1, 1)], // round 1: Mid + Carry
        [mine(3, 2), mine(4, 3)], // round 2
        [mine(5, 4)], // round 3: hard support LAST
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
        for (const [slotIndex, heroId] of picks.entries()) {
          snapshot = await submitOwn(routes, sessionId, side, slotIndex, heroId);
          expect(snapshot.accepted).toBe(true);
        }
      }
      expect(snapshot.view.status).toBe("COMPLETE");
      expect(snapshot.view.ownPicks.map((slot) => slot.heroId)).toEqual(playerPlan.flat());

      // Enemy: 5 picks, seat i's hero is valid for the seat's INTERNAL position.
      const assignments = createEnemyBotConfig(seed, other(side)).internalPositionAssignments;
      const enemy = snapshot.view.enemyPicks.map((slot) => slot.heroId!);
      expect(enemy).toHaveLength(5);
      enemy.forEach((hero, seat) => {
        expect(Math.floor(hero / 100)).toBe(assignments[seat]!);
      });
      expect(new Set([...enemy, ...playerPlan.flat()]).size).toBe(10);
      expect(store.get(sessionId)?.status).toBe("COMPLETE");
    });
  }

  test("la asignacion interna del bot nunca aparece en ninguna respuesta del Simulator", async () => {
    const { routes } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 2, "D2K00008");
    const bans = await routes.postResolveBans(post({ playerBanPreferences: [] }), sessionId);
    const drive = await routes.postAutoDrive(sessionId);
    for (const text of [await bans.text(), await drive.text()]) {
      expect(text).not.toMatch(/internalPositionAssignments|positionsByRosterSlot|externalPicks|"position"/);
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
      for (let guard = 0; guard < 30 && snapshot.view.status !== "COMPLETE"; guard += 1) {
        const open = snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION");
        for (const action of open) {
          snapshot = await submitOwn(routes, sessionId, "radiant", action.slotIndex!, humanPool[cursor++]!);
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

describe("AP Ranked Roles V1 -- autorizacion", () => {
  test("el Player no puede sellar por el bot, ni registrar bans por su cuenta", async () => {
    const { routes } = makeRoutes();
    const sessionId = await createSession(routes, "dire", 4, "D2K00009");
    const skipPolicy = await routes.postCommand(post({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), sessionId);
    expect(skipPolicy.status).toBe(403);
    const forgedBans = await routes.postCommand(post({ command: { type: "RECORD_RESOLVED_BANS", heroes: [] } }), sessionId);
    expect(forgedBans.status).toBe(403);
    await resolveBans(routes, sessionId);
    const forBot = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 200 } }), sessionId);
    expect(forBot.status).toBe(403);
  });
});

describe("AP Ranked Roles V1 -- fase de bans (fail closed)", () => {
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
    const response = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId } }), sessionId);
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

describe("AP Ranked Roles V1 -- ciego, simetria y colisiones (flujo real)", () => {
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
    const accepted = await submitOwn(routes, sessionId, "radiant", 0, botHero);
    expect(accepted.accepted).toBe(true);
    expect(accepted.rejected).toBeUndefined();
  });

  test("colision #1 y #2 (baneo + repick), el contador es por ronda y el heroe baneado no vuelve", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "dire", 1, "D2K00021");
    let snapshot = await untilHumanInput(routes, sessionId);

    // Round 1: the Player deliberately duplicates the bot's first sealed hero.
    const first = botSealed(store, sessionId, "radiant")[0]!;
    await submitOwn(routes, sessionId, "dire", 0, first);
    snapshot = await submitOwn(routes, sessionId, "dire", 1, POSITION_HEROES[1][20]!);
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(1);
    expect(snapshot.view.bannedHeroes).toContain(first);

    // The bot re-picks (knowing `first` is banned); the Player duplicates that new pick too.
    snapshot = await autoDrive(routes, sessionId);
    expect(snapshot.stopReason).toBe("human_input");
    const second = botSealed(store, sessionId, "radiant")[0]!;
    expect(second).not.toBe(first);
    snapshot = await submitOwn(routes, sessionId, "dire", 0, second);
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(2);
    expect(snapshot.view.bannedHeroes).toEqual(expect.arrayContaining([first, second]));

    // A banned hero can never be picked afterwards.
    snapshot = await autoDrive(routes, sessionId);
    const retry = await routes.postCommand(post({ command: { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: first } }), sessionId);
    expect((await json<Snapshot>(retry)).rejected).toBe("HERO_ALREADY_TAKEN");

    // Finish round 1 without further collision: the counter resets in round 2.
    const third = botSealed(store, sessionId, "radiant")[0]!;
    const safe = POSITION_HEROES[1].find((hero) => hero !== third && !snapshot.view.bannedHeroes.includes(hero) && hero !== POSITION_HEROES[1][20])!;
    snapshot = await submitOwn(routes, sessionId, "dire", 0, safe);
    expect(store.get(sessionId)?.rankedAp?.phase).toBe("PICK_ROUND_2");
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(0);
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
        await submitOwn(routes, sessionId, "radiant", slot.slotIndex, index === 0 ? target : POSITION_HEROES[2][20 + pass * 3 + index]!);
      }
      await autoDrive(routes, sessionId);
    }
    expect(store.get(sessionId)?.rankedAp?.round?.collisionsResolved).toBe(2);
    const target = botSealed(store, sessionId, "dire")[0]!;
    const open = store.get(sessionId)!.rankedAp!.round!.openSlots.filter((slot) => slot.side === "radiant");
    let last: Snapshot | null = null;
    for (const slot of open) last = await submitOwn(routes, sessionId, "radiant", slot.slotIndex, slot.slotIndex === open[0]!.slotIndex ? target : filler);
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
        await submitOwn(routes, sessionId, "radiant", slot.slotIndex, index === 0 ? target : pass === 2 ? filler : POSITION_HEROES[2][20 + pass * 3 + index]!);
      }
      if (pass < 2) await autoDrive(routes, sessionId);
    }
    expect(store.get(sessionId)?.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const stalled = await routes.postAutoDrive(sessionId);
    expect(stalled.status).toBe(409);
  });
});

describe("AP Ranked Roles V1 -- temporizadores y penalizacion (capa del Simulator)", () => {
  test("la ronda 3 dura 20 s; el timer no asigna ningun heroe al vencer", async () => {
    const { routes, store } = makeRoutes();
    const sessionId = await createSession(routes, "radiant", 5, "D2K00030");
    await resolveBans(routes, sessionId);
    for (const [index, picks] of [[mine(1, 0), mine(2, 0)], [mine(3, 0), mine(4, 0)]].entries()) {
      const snap = await autoDrive(routes, sessionId);
      expect(snap.simulator?.durationMs).toBe(25000);
      for (const [slotIndex, hero] of picks.entries()) await submitOwn(routes, sessionId, "radiant", slotIndex, hero);
      expect(index).toBeLessThan(2);
    }
    const round3 = await autoDrive(routes, sessionId);
    expect(round3.simulator?.round).toBe(3);
    expect(round3.simulator?.durationMs).toBe(20000);
    // 60 s later the seat is late -- and STILL nothing was picked for the Player.
    const late = store.simulatorTimerView(sessionId, Date.now() + 60_000)!;
    expect(late.penaltyActive).toBe(true);
    expect(late.goldPenaltyBySlot[4]).toBeGreaterThan(70);
    expect(store.get(sessionId)?.rankedAp?.round?.openSlots.some((slot) => slot.side === "radiant")).toBe(true);
    expect(store.get(sessionId)?.rankedAp?.confirmedPicks.filter((pick) => pick.side === "radiant")).toHaveLength(4);
  });
});

describe("AP Realistic Party Simulator -- Solo (Pos 1..5), Party 2, Party 3, Party 5", () => {
  test("Solo Pos 1: R1 es 100% simulada por Ally Bot, R2 espera al jugador para Pos1, R3 es simulada", async () => {
    const { routes, store } = makeRoutes();
    const seed = "SOLO_POS1_A";
    const sessionId = await createPartySession(routes, "radiant", 1, [1], seed);

    await resolveBans(routes, sessionId);

    // Round 1 has no controlled seats -> autoDrive completes Round 1 with Ally Bot + Enemy Bot
    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("round_revealed");
    expect(r1.completedRound).toBe(1);

    // Next autoDrive enters Round 2: Ally Bot seals Pos 3 (slot 0), human controls Pos 1 (slot 1)
    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("human_input");
    expect(r2.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1 },
    ]);

    // Human submits Pos 1 pick
    await submitOwn(routes, sessionId, "radiant", 1, mine(1, 0));

    // Next autoDrive completes Round 3 (Pos 2 simulated by Ally Bot) and reaches COMPLETE
    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("round_revealed");
    expect(r3.completedRound).toBe(3);
    expect(r3.view.status).toBe("COMPLETE");
    expect(store.get(sessionId)?.status).toBe("COMPLETE");

    // All 5 radiant positions picked and confirmed
    const radiantPicks = store.get(sessionId)!.rankedAp!.confirmedPicks.filter((p) => p.side === "radiant");
    expect(radiantPicks).toHaveLength(5);
  });

  test("Solo Pos 2: R1 y R2 son simuladas por Ally Bot, R3 espera al jugador para Pos2", async () => {
    const { routes, store } = makeRoutes();
    const seed = "SOLO_POS2_A";
    const sessionId = await createPartySession(routes, "radiant", 2, [2], seed);

    await resolveBans(routes, sessionId);

    // R1 completes autonomously
    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("round_revealed");
    expect(r1.completedRound).toBe(1);

    // R2 completes autonomously
    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("round_revealed");
    expect(r2.completedRound).toBe(2);

    // R3 has Pos 2 (slot 0) controlled by human
    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("human_input");
    expect(r3.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 },
    ]);

    // Human picks Pos 2
    await submitOwn(routes, sessionId, "radiant", 0, mine(2, 0));
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("Solo Pos 3: R1 simulada, R2 espera Pos 3, R3 simulada", async () => {
    const { routes, store } = makeRoutes();
    const seed = "SOLO_POS3_A";
    const sessionId = await createPartySession(routes, "radiant", 3, [3], seed);
    await resolveBans(routes, sessionId);

    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("round_revealed");

    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("human_input");
    expect(r2.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 },
    ]);
    await submitOwn(routes, sessionId, "radiant", 0, mine(3, 0));

    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("round_revealed");
    expect(r3.completedRound).toBe(3);
    expect(r3.view.status).toBe("COMPLETE");
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("Solo Pos 4: R1 espera Pos 4, R2 y R3 simuladas", async () => {
    const { routes, store } = makeRoutes();
    const seed = "SOLO_POS4_A";
    const sessionId = await createPartySession(routes, "radiant", 4, [4], seed);
    await resolveBans(routes, sessionId);

    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    expect(r1.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1 },
    ]);
    await submitOwn(routes, sessionId, "radiant", 1, mine(4, 0));

    // Drive until completion (just as advance() does in client loop)
    while (store.get(sessionId)?.status !== "COMPLETE") {
      await autoDrive(routes, sessionId);
    }
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
    const radiantPicks = store.get(sessionId)!.rankedAp!.confirmedPicks.filter((p) => p.side === "radiant");
    expect(radiantPicks).toHaveLength(5);
  });

  test("Solo Pos 5: R1 espera Pos 5, R2 y R3 simuladas", async () => {
    const { routes, store } = makeRoutes();
    const seed = "SOLO_POS5_A";
    const sessionId = await createPartySession(routes, "radiant", 5, [5], seed);
    await resolveBans(routes, sessionId);

    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    expect(r1.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 },
    ]);
    await submitOwn(routes, sessionId, "radiant", 0, mine(5, 0));

    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("round_revealed");

    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("round_revealed");
    expect(r3.completedRound).toBe(3);
    expect(r3.view.status).toBe("COMPLETE");
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("Party 2 (Pos 2 + Pos 5): R1 espera Pos 5, R2 es simulada, R3 espera Pos 2", async () => {
    const { routes, store } = makeRoutes();
    const seed = "PARTY_2_TEST";
    const sessionId = await createPartySession(routes, "radiant", 2, [2, 5], seed);
    await resolveBans(routes, sessionId);

    // R1: Ally Bot seals Pos 4 (slot 1), player controls Pos 5 (slot 0)
    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    expect(r1.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 },
    ]);
    await submitOwn(routes, sessionId, "radiant", 0, mine(5, 0));

    // R2: Ally Bot seals both Pos 3 (slot 0) and Pos 1 (slot 1) -> round revealed
    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("round_revealed");

    // R3: player controls Pos 2 (slot 0)
    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("human_input");
    expect(r3.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 },
    ]);
    await submitOwn(routes, sessionId, "radiant", 0, mine(2, 0));
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("Party 3 (Pos 1 + Pos 3 + Pos 5): R1 espera Pos 5, R2 espera Pos 3 y Pos 1, R3 simulada", async () => {
    const { routes, store } = makeRoutes();
    const seed = "PARTY_3_TEST";
    const sessionId = await createPartySession(routes, "radiant", 1, [1, 3, 5], seed);
    await resolveBans(routes, sessionId);

    // R1: Pos 4 is simulated by Ally Bot; Pos 5 is controlled by human party
    const r1 = await autoDrive(routes, sessionId);
    expect(r1.stopReason).toBe("human_input");
    expect(r1.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toEqual([
      { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 },
    ]);
    await submitOwn(routes, sessionId, "radiant", 0, mine(5, 0));

    // R2: both slots (Pos 3 slot 0 and Pos 1 slot 1) controlled by human party
    const r2 = await autoDrive(routes, sessionId);
    expect(r2.stopReason).toBe("human_input");
    expect(r2.legalActions.filter((a) => a.type === "SUBMIT_SEALED_SELECTION")).toHaveLength(2);

    await submitOwn(routes, sessionId, "radiant", 0, mine(3, 0));
    await submitOwn(routes, sessionId, "radiant", 1, mine(1, 0));

    // R3: Pos 2 is simulated by Ally Bot -> complete
    const r3 = await autoDrive(routes, sessionId);
    expect(r3.stopReason).toBe("round_revealed");
    expect(r3.completedRound).toBe(3);
    expect(r3.view.status).toBe("COMPLETE");
    expect(store.get(sessionId)?.status).toBe("COMPLETE");
  });

  test("Replay determinista: misma semilla + misma config de party => picks idénticos de bots", async () => {
    const runDraft = async (seed: string) => {
      const { routes, store } = makeRoutes();
      const sessionId = await createPartySession(routes, "radiant", 2, [2, 5], seed);
      await resolveBans(routes, sessionId);
      await autoDrive(routes, sessionId);
      await submitOwn(routes, sessionId, "radiant", 0, mine(5, 1));
      await autoDrive(routes, sessionId); // R2 autonomous
      await autoDrive(routes, sessionId); // R3 stops for player
      await submitOwn(routes, sessionId, "radiant", 0, mine(2, 1));
      return store.get(sessionId)!.rankedAp!.confirmedPicks;
    };

    const run1 = await runDraft("DETERMINISTIC_SEED_123");
    const run2 = await runDraft("DETERMINISTIC_SEED_123");

    expect(run1).toEqual(run2);
  });
});
