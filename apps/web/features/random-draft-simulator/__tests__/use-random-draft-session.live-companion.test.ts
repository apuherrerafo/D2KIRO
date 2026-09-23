import "@/test-support/happy-dom";

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import type { HeroId, TeamSide } from "@/features/draft/types";
import { useRandomDraftSession } from "../use-random-draft-session";
import { useRandomDraftStore } from "../store";

// MVP P0.1 -- Live Companion. This fixture emulates the REAL kernel contract for a "manual"
// adapterKind session (apps/engine/src/server/protocol-session.ts + draft-protocol/perspective.ts):
// legalActions carries BOTH sides' open seats, SUBMIT_SEALED_SELECTION is accepted for either
// side, and -- same as any Ranked All Pick session, regardless of adapterKind -- a side's sealed
// pick in the CURRENT round stays HIDDEN to the opponent's projected view until the round closes.
// /auto-drive, /bot-selection and /resolve-bans are never expected to be called in this mode; the
// fixture answers them 403 so a hook regression that DID call them would fail loudly, not silently.

const HEROES = Array.from({ length: 40 }, (_, index) => ({ id: index + 1, localizedName: `Hero ${index + 1}`, roles: ["Carry"] }));
const ROUND_CAPACITY: Record<1 | 2 | 3, number> = { 1: 2, 2: 2, 3: 1 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function oppositeSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

class FakeManualProtocolEngine {
  readonly requests: { url: string; body: Record<string, unknown> }[] = [];
  readonly sessionId = "manual-browser-session";
  side: TeamSide = "radiant";
  bans: HeroId[] = [];
  picks: { radiant: HeroId[]; dire: HeroId[] } = { radiant: [], dire: [] };
  round: 0 | 1 | 2 | 3 | 4 = 0;
  sealedThisRound: { radiant: number[]; dire: number[] } = { radiant: [], dire: [] };
  private coachRevision = 0;

  private phaseName(): string {
    if (this.round === 0) return "BAN_RESOLUTION";
    if (this.round === 4) return "COMPLETE";
    return `PICK_ROUND_${this.round}`;
  }

  private openSlotsFor(side: TeamSide): number[] {
    if (this.round === 0 || this.round === 4) return [];
    const capacity = ROUND_CAPACITY[this.round];
    const sealed = this.sealedThisRound[side];
    return Array.from({ length: capacity }, (_, index) => index).filter((slotIndex) => !sealed.includes(slotIndex));
  }

  private legalActions() {
    const sides: TeamSide[] = ["radiant", "dire"];
    return sides.flatMap((side) => this.openSlotsFor(side).map((slotIndex) => ({ type: "SUBMIT_SEALED_SELECTION", side, slotIndex })));
  }

  private coachBody() {
    this.coachRevision += 1;
    return {
      output: {
        schema: "recommendation-output/v3",
        sessionId: this.sessionId,
        primaryAction: { strategy: { kind: "REVEAL_POSITION", position: 5, rationale: "fixture" }, label: `Sugerencia #${this.coachRevision}` },
        shortlist: [],
        meta: {
          round: this.round >= 1 && this.round <= 3 ? this.round : null,
          phase: this.phaseName(),
          ownPicksRemaining: 5 - this.picks[this.side].length,
          confidence: "media",
          decisionContext: this.picks[this.side].length === 0 ? "team_opening" : "blind_second_pick",
          trigger: this.picks[this.side].length === 0 ? "DRAFT_PICKS_STARTED" : "OWN_PICK_CONFIRMED",
          revision: this.coachRevision,
          basedOn: { stateIdentity: `state-${this.coachRevision}`, evidenceVersion: "v" },
        },
      },
      recommendationSet: {
        schema: "recommendation-set/v2",
        sessionId: this.sessionId,
        decision: { actor: this.side, actionKind: "PICK", controlledSlots: [], actionCount: 1 },
        recommendations: [],
        degradations: [],
        deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
        decisionContext: "team_opening",
      },
    };
  }

  // Mirrors perspective.ts EXACTLY: the viewer's own sealed-in-round pick is KNOWN immediately;
  // the opponent's sealed-in-round pick is HIDDEN until the round closes for both sides. This is
  // a real kernel invariant, not a simulator artifact -- it holds for adapterKind "manual" too.
  private snapshot() {
    const enemySide = oppositeSide(this.side);
    const enemyConfirmedCount = this.picks[enemySide].length - this.sealedThisRound[enemySide].length;
    return {
      view: {
        schema: "draft-protocol-perspective/v1",
        sessionId: this.sessionId,
        status: this.round === 4 ? "COMPLETE" : "ACTIVE",
        viewerSide: this.side,
        bannedHeroes: this.bans,
        // Own picks are never masked (perspective.ts: a viewer's own sealed-in-round pick is
        // KNOWN immediately). Only the opponent's still-sealed picks in the CURRENT round are
        // HIDDEN, until the round closes for both sides.
        ownPicks: this.picks[this.side].map((heroId) => ({ visibility: "KNOWN", heroId })),
        enemyPicks: this.picks[enemySide].map((heroId, index) => ({
          visibility: index < enemyConfirmedCount ? "REVEALED" : "HIDDEN",
          ...(index < enemyConfirmedCount ? { heroId } : {}),
        })),
        rankedAp: { phase: this.phaseName(), banResolutionComplete: this.round > 0 },
        captainsMode: null,
      },
      legalActions: this.legalActions(),
      simulator: null,
    };
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    this.requests.push({ url, body });
    if (url.endsWith("/api/heroes")) return json(HEROES);
    if (url.endsWith("/api/meta/hero-stats")) return json({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/session/protocol")) {
      this.side = body.localSide as TeamSide;
      return json({ sessionId: this.sessionId, ruleset: {}, status: "ACTIVE" }, 201);
    }
    if (url.endsWith(`/api/session/protocol/${this.sessionId}`)) return json(this.snapshot());
    if (url.endsWith("/auto-drive") || url.endsWith("/bot-selection") || url.endsWith("/resolve-bans")) {
      return json({ error: "ap_simulator_required" }, 403);
    }
    if (url.includes("/recommendations")) return json(this.coachBody());
    if (url.endsWith("/command")) {
      const command = body.command as { type: string; side?: TeamSide; slotIndex?: number; heroId?: HeroId; heroes?: HeroId[] };
      if (command.type === "RECORD_RESOLVED_BANS") {
        this.bans = [...this.bans, ...(command.heroes ?? [])];
        return json({ accepted: true, ...this.snapshot() }, 202);
      }
      if (command.type === "BAN_RESOLUTION_COMPLETE") {
        this.round = 1;
        return json({ accepted: true, ...this.snapshot() }, 202);
      }
      if (command.type === "SUBMIT_SEALED_SELECTION") {
        const side = command.side!;
        const heroId = command.heroId!;
        const alreadyTaken = this.bans.includes(heroId) || this.picks.radiant.includes(heroId) || this.picks.dire.includes(heroId);
        if (alreadyTaken) return json({ accepted: false, rejected: "HERO_ALREADY_TAKEN", ...this.snapshot() }, 202);
        if (!this.openSlotsFor(side).includes(command.slotIndex!)) return json({ accepted: false, rejected: "SLOT_NOT_OPEN", ...this.snapshot() }, 202);
        this.picks[side].push(heroId);
        this.sealedThisRound[side].push(command.slotIndex!);
        if (this.openSlotsFor("radiant").length === 0 && this.openSlotsFor("dire").length === 0) {
          this.round = this.round === 3 ? 4 : ((this.round + 1) as 1 | 2 | 3);
          this.sealedThisRound = { radiant: [], dire: [] };
        }
        return json({ accepted: true, ...this.snapshot() }, 202);
      }
      return json({ error: "action_forbidden" }, 403);
    }
    throw new Error(`fetch not mocked: ${url}`);
  };
}

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  useRandomDraftStore.getState().resetSession();
});

async function startLiveCompanion(side: TeamSide) {
  const engine = new FakeManualProtocolEngine();
  globalThis.fetch = engine.fetch as typeof fetch;
  const hook = renderHook(() => useRandomDraftSession({ fetchImpl: engine.fetch as typeof fetch, revealPauseMs: 0 }));
  await act(async () => hook.result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: side, playerPosition: 4, personalBanList: [], partySize: 5 }, "live_companion"));
  return { engine, ...hook };
}

function commandsSentTo(engine: FakeManualProtocolEngine) {
  return engine.requests.filter((entry) => entry.url.endsWith("/command")).map((entry) => entry.body.command);
}

test("startDraft en modo live_companion crea la sesión con adapterKind manual y sin simulatorSeed", async () => {
  const { engine, unmount } = await startLiveCompanion("radiant");
  const create = engine.requests.find((entry) => entry.url.endsWith("/api/session/protocol"))!;
  expect(create.body.adapterKind).toBe("manual");
  expect(create.body.simulatorSeed).toBeUndefined();
  unmount();
});

test("arranca en live_ban_entry -- nunca llama a /resolve-bans", async () => {
  const { engine, result, unmount } = await startLiveCompanion("radiant");
  expect(result.current.state.phase).toMatchObject({ type: "live_ban_entry", observedBans: [] });
  expect(engine.requests.some((entry) => entry.url.endsWith("/resolve-bans"))).toBe(false);
  unmount();
});

test("bans observados: recordObservedBans registra exactamente los héroes escritos y pasa a live_pending Ronda 1", async () => {
  const { result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([21, 22, 23]));
  expect(result.current.state.draftState?.banned).toEqual([21, 22, 23]);
  expect(result.current.state.phase).toMatchObject({ type: "live_pending", round: 1 });
  if (result.current.state.phase.type === "live_pending") {
    expect(result.current.state.phase.openSlots).toEqual([
      { side: "radiant", slotIndex: 0 },
      { side: "radiant", slotIndex: 1 },
      { side: "dire", slotIndex: 0 },
      { side: "dire", slotIndex: 1 },
    ]);
  }
  unmount();
});

test("nunca invoca al Enemy Bot: /auto-drive, /bot-selection y /resolve-bans jamás se llaman en todo un draft completo", async () => {
  const { engine, result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([]));
  for (const heroId of [1, 2]) await act(async () => result.current.actions.submitLiveSelection("radiant", heroId));
  for (const heroId of [10, 11]) await act(async () => result.current.actions.submitLiveSelection("dire", heroId));
  for (const heroId of [3, 4]) await act(async () => result.current.actions.submitLiveSelection("radiant", heroId));
  for (const heroId of [12, 13]) await act(async () => result.current.actions.submitLiveSelection("dire", heroId));
  await act(async () => result.current.actions.submitLiveSelection("radiant", 5));
  await act(async () => result.current.actions.submitLiveSelection("dire", 14));

  expect(result.current.state.phase.type).toBe("complete");
  expect(engine.requests.some((entry) => entry.url.endsWith("/auto-drive"))).toBe(false);
  expect(engine.requests.some((entry) => entry.url.endsWith("/bot-selection"))).toBe(false);
  expect(engine.requests.some((entry) => entry.url.endsWith("/resolve-bans"))).toBe(false);
  unmount();
});

test("manual ally pick entra al protocolo con el side propio y el asiento correcto", async () => {
  const { engine, result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([]));
  await act(async () => result.current.actions.submitLiveSelection("radiant", 7));
  expect(result.current.state.draftState?.picks.radiant).toEqual([7]);
  const sent = commandsSentTo(engine).at(-1) as { type: string; side: string; slotIndex: number; heroId: number };
  expect(sent).toEqual({ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 7 });
  unmount();
});

test("manual enemy pick entra al protocolo con side='dire' -- espera la selección enemiga manual, nunca la infiere", async () => {
  const { engine, result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([]));
  await act(async () => result.current.actions.submitLiveSelection("dire", 40));
  const sent = commandsSentTo(engine).at(-1) as { type: string; side: string; slotIndex: number; heroId: number };
  expect(sent).toEqual({ type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 40 });
  // "waits for manual enemy selection": la ronda sigue abierta -- el propio equipo aún no reportó
  // nada (sus 2 asientos siguen abiertos) y al rival todavía le falta su 2do asiento.
  expect(result.current.state.phase).toMatchObject({ type: "live_pending", round: 1 });
  if (result.current.state.phase.type === "live_pending") {
    expect(result.current.state.phase.openSlots).toEqual([
      { side: "radiant", slotIndex: 0 },
      { side: "radiant", slotIndex: 1 },
      { side: "dire", slotIndex: 1 },
    ]);
  }
  unmount();
});

test("la información enemiga sellada-no-revelada nunca aparece: sigue oculta hasta que la ronda cierra para ambos lados", async () => {
  const { result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([]));
  await act(async () => result.current.actions.submitLiveSelection("dire", 40));
  // El propio equipo NO reportó nada todavía y el rival sólo selló 1/2 -- la ronda no cerró.
  expect(result.current.state.draftState?.picks.dire).toEqual([]);
  await act(async () => result.current.actions.submitLiveSelection("radiant", 1));
  expect(result.current.state.draftState?.picks.dire).toEqual([]); // todavía falta el 2do asiento rival
  await act(async () => result.current.actions.submitLiveSelection("radiant", 2));
  await act(async () => result.current.actions.submitLiveSelection("dire", 41));
  // Ahora sí: ronda cerrada para los dos lados -> visible.
  expect(result.current.state.draftState?.picks.dire.sort()).toEqual([40, 41]);
  unmount();
});

test("héroe duplicado (ya pickeado) rechazado: HERO_ALREADY_TAKEN, sin mutar el estado", async () => {
  const { result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([]));
  await act(async () => result.current.actions.submitLiveSelection("radiant", 9));
  await act(async () => result.current.actions.submitLiveSelection("dire", 9));
  expect(result.current.state.draftState?.picks.radiant).toEqual([9]);
  expect(result.current.state.draftState?.picks.dire).toEqual([]);
  expect(result.current.state.phase).toMatchObject({ type: "live_pending", notice: expect.stringContaining("ya está baneado o pickeado") });
  unmount();
});

test("héroe baneado rechazado al intentar pickearlo", async () => {
  const { result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([99]));
  await act(async () => result.current.actions.submitLiveSelection("radiant", 99));
  expect(result.current.state.draftState?.picks.radiant).toEqual([]);
  expect(result.current.state.phase).toMatchObject({ type: "live_pending", notice: expect.stringContaining("ya está baneado o pickeado") });
  unmount();
});

test("las recomendaciones se refrescan después de cada evento aceptado (bans y cada pick)", async () => {
  const { result, unmount } = await startLiveCompanion("radiant");
  await act(async () => result.current.actions.recordObservedBans([]));
  await waitFor(() => expect(result.current.state.coach?.meta.revision).toBe(1));
  await act(async () => result.current.actions.submitLiveSelection("radiant", 1));
  await waitFor(() => expect(result.current.state.coach?.meta.revision).toBe(2));
  await act(async () => result.current.actions.submitLiveSelection("dire", 40));
  await waitFor(() => expect(result.current.state.coach?.meta.revision).toBe(3));
  unmount();
});

test("el draft llega a completo íntegramente a mano (bans + 5 rondas de ambos lados)", async () => {
  const { result, unmount } = await startLiveCompanion("dire");
  await act(async () => result.current.actions.recordObservedBans([50, 51]));
  const ownPicks = [1, 2, 3, 4, 5];
  const enemyPicks = [10, 11, 12, 13, 14];
  for (let index = 0; index < 5; index += 1) {
    await act(async () => result.current.actions.submitLiveSelection("dire", ownPicks[index]!));
    await act(async () => result.current.actions.submitLiveSelection("radiant", enemyPicks[index]!));
  }
  expect(result.current.state.phase.type).toBe("complete");
  expect(result.current.state.draftState?.picks.dire.sort((a, b) => a - b)).toEqual(ownPicks);
  expect(result.current.state.draftState?.picks.radiant.sort((a, b) => a - b)).toEqual(enemyPicks);
  if (result.current.state.phase.type === "complete") {
    expect(result.current.state.phase.summary.picksByRound.map((round) => round.userPicks.length + round.botPicks.length)).toEqual([4, 4, 2]);
  }
  unmount();
});
