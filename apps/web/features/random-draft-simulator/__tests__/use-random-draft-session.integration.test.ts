// Integración de use-random-draft-session.ts: la secuencia completa de una Draft_Session real
// (inicio -> ronda 1 -> revelación -> ronda 2 -> ronda 3 -> último pick -> complete), renderizando
// el hook de verdad (efectos, refs, timers) en vez de solo sus funciones puras exportadas.
//
// Hasta este archivo, la única cobertura de este hook eran sus funciones puras
// (use-random-draft-session.test.ts) -- el resto (refs, setInterval, WebSocket, fetch) quedaba
// documentado como "se verifica en un navegador real" (tarea 16.2). Ese punto ciego es exactamente
// donde vivió el bug real de TSK-112 (el bot recalculaba contra el tablero vacío en vez del
// recién revelado) y la regresión encontrada en TSK-116 (previewStatus nunca implementado):
// ninguna prueba automatizada los habría atrapado sin renderizar el hook completo.
//
// Nueva costura de prueba, no documentada todavía en testing-seams.md como S14 (pendiente,
// ver TSK-117): el hook completo vía `renderHook` (@testing-library/react) + DOM real
// (happy-dom, registrado global solo para este proceso de prueba) + FakeSocket (S5, ya existente)
// + fetch reemplazado por un "motor falso" mínimo en memoria que aplica los eventos que
// use-random-draft-session.ts ya emite por HTTP (POST /api/session/manual) y empuja el
// draft_state resultante por el mismo FakeSocket -- nunca el motor real de apps/engine.

import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { FakeSocket } from "@/features/draft/fake-socket";
import type { DraftConnection, DraftState as EngineDraftState, HeroId as EngineHeroId, ServerMessage, SuggestionSet, TeamSide } from "@/features/draft/types";
import { useRandomDraftSession, type StartDraftConfig } from "../use-random-draft-session";

// ---------------------------------------------------------------------------
// Motor falso: aplica los mismos DraftEvent que emite el hook (session_started,
// local_side_identified, hero_banned, hero_picked, session_ended) sobre un DraftState en memoria
// y lo empuja por el FakeSocket -- igual que haría apps/engine real, sin reimplementar su
// reductor completo (S1/S4 ya lo cubren en el motor; acá solo se necesita lo suficiente para que
// el hook reciba el mismo tipo de mensajes que produciría el motor real).
// ---------------------------------------------------------------------------

const RESERVED_BOT_HERO_START = 900; // fuera del catálogo fixture (1-40): nunca colisiona con bans/picks del usuario.

class FakeEngine {
  private state: EngineDraftState;
  private seq = 0;
  private nextBotHeroId = RESERVED_BOT_HERO_START;
  readonly copilotPreviewRequests: { picks: EngineDraftState["picks"]; banned: EngineHeroId[] }[] = [];

  constructor(private readonly socket: FakeSocket) {
    this.state = {
      sessionId: "",
      schema: "draft-state/v1",
      format: "unknown",
      patch: "",
      localSide: "unknown",
      phase: "idle",
      banned: [],
      picks: { radiant: [], dire: [] },
      lastSeq: 0,
      appliedEventIds: [],
      quality: { unconfirmed: [], captureStatus: "ok" },
      updatedAt: new Date(0).toISOString(),
      firstPickSide: null,
      turnStartedAt: null,
      reserveRemainingMs: null,
      turn: null,
    };
  }

  // El push por WebSocket se difiere un tick real (setTimeout, no microtask) a propósito: en
  // producción, la respuesta HTTP de POST /api/session/manual y la llegada del draft_state por
  // WS no son la misma cosa -- el motor responde al POST y transmite por WS por canales
  // independientes. Si el push fuera síncrono con el fetch, esta prueba nunca podría reproducir
  // la ventana de carrera real que isPreviewReadyForRound existe para cerrar (TSK-112).
  private push(): void {
    this.seq += 1;
    this.state = { ...this.state, lastSeq: this.seq, updatedAt: new Date().toISOString() };
    const message: ServerMessage = {
      schema: "draft-ws/v1",
      type: "draft_state",
      seq: this.seq,
      sentAt: new Date().toISOString(),
      payload: this.state,
    };
    setTimeout(() => this.socket.emit(message), 20);
  }

  handleManualEvent(body: unknown): { accepted: true } {
    const envelope = body as { sessionId: string; payload: { type: string; [key: string]: unknown } };
    this.state.sessionId = envelope.sessionId;
    const payload = envelope.payload;

    if (payload.type === "session_started") {
      this.state.format = payload.format as EngineDraftState["format"];
      this.state.patch = payload.patch as string;
      this.state.phase = "active";
    } else if (payload.type === "local_side_identified") {
      this.state.localSide = payload.side as TeamSide;
    } else if (payload.type === "hero_banned") {
      const hero = payload.hero as EngineHeroId;
      if (!this.state.banned.includes(hero)) this.state.banned = [...this.state.banned, hero];
    } else if (payload.type === "hero_picked") {
      const hero = payload.hero as EngineHeroId;
      const side = payload.side as TeamSide;
      this.state.picks = { ...this.state.picks, [side]: [...this.state.picks[side], hero] };
    } else if (payload.type === "session_ended") {
      this.state.phase = "complete";
    }

    this.push();
    return { accepted: true };
  }

  // Responde tanto al preview del Copilot (use-random-draft-session.ts) como a la recomendación
  // interna del bot (botPickHeroFromEngine, bot-drafter.ts) -- se distinguen por `diversitySeed`,
  // presente únicamente en el pedido del Copilot. Cada llamada devuelve un héroe reservado nuevo:
  // el bot nunca repite ni colisiona con lo que el usuario ya escogió.
  handleSuggestionsPreview(body: unknown): SuggestionSet {
    const request = body as { picks: EngineDraftState["picks"]; banned: EngineHeroId[]; diversitySeed?: string };
    if (request.diversitySeed !== undefined) {
      this.copilotPreviewRequests.push({ picks: request.picks, banned: request.banned });
    }

    const hero = this.nextBotHeroId;
    this.nextBotHeroId += 1;
    return {
      schema: "suggestions/v1",
      sessionId: this.state.sessionId,
      basedOnSeq: this.state.lastSeq,
      decisionContext: "blind_second_pick",
      suggestions: [
        { hero, rank: 1, score: 1, signals: [], reason: "fixture", confidence: "alta" },
      ],
      comparison: null,
      degraded: [],
      computedInMs: 1,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixtures de meta (GET /api/heroes, GET /api/meta/hero-stats -- loadMetaSnapshot)
// ---------------------------------------------------------------------------

const FIXTURE_HERO_COUNT = 40;
const FIXTURE_HEROES = Array.from({ length: FIXTURE_HERO_COUNT }, (_, i) => ({
  id: i + 1,
  localizedName: `Hero ${i + 1}`,
  roles: ["Carry"],
}));

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function installFetchMock(engine: FakeEngine): void {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);

    if (url.endsWith("/api/heroes")) return jsonResponse(FIXTURE_HEROES);
    if (url.endsWith("/api/meta/hero-stats")) return jsonResponse({ patchStats: {}, heroPositions: {} });
    if (url.endsWith("/api/session/manual")) {
      const body = JSON.parse(String(init?.body));
      return jsonResponse(engine.handleManualEvent(body));
    }
    if (url.endsWith("/api/suggestions/preview")) {
      const body = JSON.parse(String(init?.body));
      return jsonResponse(engine.handleSuggestionsPreview(body));
    }

    throw new Error(`[test] fetch no mockeado: ${url}`);
  }) as typeof fetch;
}

function fakeSocketFactory(fakeSocket: FakeSocket) {
  return async function factory(): Promise<DraftConnection> {
    // Valor corto a propósito -- el gate de secretos del repo marca cualquier literal largo junto
    // a un campo con "token" en el nombre; acá no hay nada que verificar del lado del fake.
    return { socket: fakeSocket, accountToken: "fake" };
  };
}

// ---------------------------------------------------------------------------
// Prueba
// ---------------------------------------------------------------------------

let originalFetch: typeof fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("secuencia completa: inicio -> ronda 1 -> revelación -> ronda 2 -> ronda 3 -> último pick", async () => {
  const fakeSocket = new FakeSocket();
  const engine = new FakeEngine(fakeSocket);
  installFetchMock(engine);

  const { result, unmount } = renderHook(() => useRandomDraftSession({ socketFactory: fakeSocketFactory(fakeSocket) }));

  const config: StartDraftConfig = {
    draftSeed: "ABCDEFGH",
    userSide: "radiant",
    personalBanList: [],
  };

  await act(async () => {
    await result.current.startDraft(config);
  });

  // Ban_Phase resuelta, ronda 1 arrancada -- Req. 2.1.
  expect(result.current.state.phase.type).toBe("blind_round");
  await waitFor(() => expect(result.current.state.draftState?.banned.length).toBe(16));
  const banned = new Set(result.current.state.draftState?.banned ?? []);

  function pickAvailableHeroes(count: number, alreadyUsed: Set<number>): number[] {
    const picks: number[] = [];
    for (let candidate = 1; candidate <= FIXTURE_HERO_COUNT && picks.length < count; candidate++) {
      if (banned.has(candidate) || alreadyUsed.has(candidate)) continue;
      picks.push(candidate);
      alreadyUsed.add(candidate);
    }
    return picks;
  }

  const usedByUser = new Set<number>();

  // -------------------------------------------------------------------------
  // Ronda 1: selección a ciegas del usuario, sin picks rivales visibles todavía.
  // -------------------------------------------------------------------------
  const round1Picks = pickAvailableHeroes(2, usedByUser);
  for (const heroId of round1Picks) {
    await act(async () => {
      result.current.actions.confirmPick(heroId);
    });
  }
  await waitFor(() => expect(result.current.state.previewStatus).toBe("ready"));

  // El pedido de preview de la ronda 1 nunca incluye picks rivales (no hay ninguno revelado).
  const round1Requests = engine.copilotPreviewRequests.length;
  expect(round1Requests).toBeGreaterThan(0);
  for (const request of engine.copilotPreviewRequests) {
    expect(request.picks.dire).toEqual([]); // lado rival (bot): nada revelado todavía en ronda 1
  }

  await act(async () => {
    await result.current.confirmRound(); // revela ronda 1 y avanza a ronda 2
  });

  expect(result.current.state.phase.type).toBe("blind_round");
  expect(result.current.state.phase.type === "blind_round" && result.current.state.phase.round).toBe(2);

  // -------------------------------------------------------------------------
  // Regresión TSK-112/TSK-116: el primer pedido de preview de la ronda 2 debe reflejar el
  // tablero YA revelado de la ronda 1 (2 picks propios + 2 del bot) -- nunca el tablero vacío
  // con el que arrancó la sesión.
  // -------------------------------------------------------------------------
  await waitFor(() => expect(engine.copilotPreviewRequests.length).toBeGreaterThan(round1Requests));
  const firstRound2Request = engine.copilotPreviewRequests[round1Requests];
  expect(firstRound2Request.picks.radiant.length + firstRound2Request.picks.dire.length).toBeGreaterThanOrEqual(4);

  // -------------------------------------------------------------------------
  // Ronda 2: mismo patrón, ahora con picks rivales de la ronda 1 ya visibles.
  // -------------------------------------------------------------------------
  const round2Picks = pickAvailableHeroes(2, usedByUser);
  for (const heroId of round2Picks) {
    await act(async () => {
      result.current.actions.confirmPick(heroId);
    });
  }
  await waitFor(() => expect(result.current.state.previewStatus).toBe("ready"));

  await act(async () => {
    await result.current.confirmRound();
  });

  expect(result.current.state.phase.type === "blind_round" && result.current.state.phase.round).toBe(3);

  // -------------------------------------------------------------------------
  // Ronda 3: último pick -- cierra la sesión completa.
  // -------------------------------------------------------------------------
  const round3Picks = pickAvailableHeroes(1, usedByUser);
  for (const heroId of round3Picks) {
    await act(async () => {
      result.current.actions.confirmPick(heroId);
    });
  }
  await waitFor(() => expect(result.current.state.previewStatus).toBe("ready"));

  // Una sola llamada del lado de la UI hace reveal + avance (revealAndAdvance corre dentro del
  // mismo confirmRound expuesto por el hook) -- mismo patrón que BlindRoundActive dispara una
  // sola vez al completar los picks de la ronda.
  await act(async () => {
    await result.current.confirmRound(); // revela ronda 3 y cierra la sesión (complete)
  });

  expect(result.current.state.phase.type).toBe("complete");
  if (result.current.state.phase.type === "complete") {
    expect(result.current.state.phase.summary.picksByRound.length).toBe(3);
    expect(result.current.state.phase.summary.picksByRound[0].userPicks).toEqual(round1Picks);
    expect(result.current.state.phase.summary.picksByRound[1].userPicks).toEqual(round2Picks);
    expect(result.current.state.phase.summary.picksByRound[2].userPicks).toEqual(round3Picks);
  }

  unmount();
}, 20000);

test("un fetch fallido del preview termina en previewStatus:'failed', nunca en 'actualizando' infinito", async () => {
  const fakeSocket = new FakeSocket();
  const engine = new FakeEngine(fakeSocket);
  installFetchMock(engine);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/suggestions/preview")) throw new Error("network down");
    return realFetch(input, init);
  }) as typeof fetch;

  const { result, unmount } = renderHook(() => useRandomDraftSession({ socketFactory: fakeSocketFactory(fakeSocket) }));

  await act(async () => {
    await result.current.startDraft({ draftSeed: "ABCDEFGH", userSide: "radiant", personalBanList: [] });
  });

  await waitFor(() => expect(result.current.state.previewStatus).toBe("failed"));

  unmount();
}, 10000);
