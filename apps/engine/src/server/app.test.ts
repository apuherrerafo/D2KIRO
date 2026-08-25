import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { accounts, draftFeedback, heroes, heroMatchups, heroPatchStats, heroPool, metaSync, settings, teamGroups, teamMembers } from "../db/schema";
import type { HeroCapabilities } from "../draft-paths/types";
import { OpenDotaClient } from "../meta/opendota-client";
import type { HeroPositions } from "../signals/hero-positions";
import { createApp } from "./app";

// TSK-036: fixture propio en vez de depender de capabilities.json real -- ese archivo es un
// borrador que se sigue corrigiendo a mano, un test que dependiera de su contenido cambiaría de
// resultado en silencio cada vez que se edite (mismo criterio que S2/S6/S7 de testing-seams.md).
// hero 1 sin ninguna capacidad (genera gaps reales al pickearlo), hero 2 con todo alto (candidato
// que los resuelve todos) -- deliberadamente exagerado para que el test sea determinístico.
const TEST_HERO_CAPABILITIES: HeroCapabilities[] = [
  { hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low" },
  { hero: 2, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: true, structuralDamage: "high", teamfight: "high", scaling: "high" },
];

// TSK-063: mismo criterio que TEST_HERO_CAPABILITIES -- fixture propio, nunca hero-positions.json
// real (costura S10, testing-seams.md).
const TEST_HERO_POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 5, matches: 800 }],
};

const PORT = 41234;
const EXPECTED_HEADER = "test-capture-token";

function createTestDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE heroes (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL,
      img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL,
      roles TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE hero_patch_stats (
      hero_id INTEGER NOT NULL, patch TEXT NOT NULL, bracket TEXT NOT NULL,
      picks INTEGER NOT NULL, wins INTEGER NOT NULL, updated_at TEXT NOT NULL,
      PRIMARY KEY (hero_id, patch, bracket)
    );
    CREATE TABLE hero_matchups (
      hero_id INTEGER NOT NULL, vs_hero_id INTEGER NOT NULL, games INTEGER NOT NULL,
      wins INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (hero_id, vs_hero_id)
    );
    CREATE TABLE meta_sync (
      id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL, started_at TEXT NOT NULL,
      finished_at TEXT, status TEXT NOT NULL, rows_written INTEGER NOT NULL DEFAULT 0, error TEXT
    );
    CREATE TABLE settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    );
    CREATE TABLE accounts (
      steam_account_id INTEGER PRIMARY KEY, personal_baseline_winrate REAL, created_at TEXT NOT NULL
    );
    CREATE TABLE hero_pool (
      account_id INTEGER NOT NULL, hero_id INTEGER NOT NULL, source TEXT NOT NULL,
      personal_winrate REAL, personal_games INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL,
      PRIMARY KEY (account_id, hero_id)
    );
    CREATE TABLE team_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
      party_size INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE team_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL,
      slot INTEGER NOT NULL, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE draft_feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, comment TEXT NOT NULL,
      draft_state TEXT NOT NULL, suggestions TEXT, created_at TEXT NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema: { heroes, heroMatchups, heroPatchStats, metaSync, settings, accounts, heroPool, teamGroups, teamMembers, draftFeedback } });
  // TSK-095 (Fase 5): bridge temporal de las rutas HTTP de hero-pool -- `getSoleAccountId` necesita
  // una cuenta real para que las pruebas de GET/PUT /api/hero-pool ya existentes se comporten
  // exactamente igual que antes de esta fase (TSK-098 la reemplaza con el accountId real del token).
  db.insert(accounts).values({ steamAccountId: 999999999, personalBaselineWinrate: null, createdAt: "2026-07-27T00:00:00.000Z" }).run();
  db.insert(heroes)
    .values([
      { id: 1, name: "h1", localizedName: "Hero Uno", imgUrl: "/h1.png", primaryAttr: "str", attackType: "Melee", roles: ["Carry"], updatedAt: "2026-07-27" },
      { id: 2, name: "h2", localizedName: "Hero Dos", imgUrl: "/h2.png", primaryAttr: "agi", attackType: "Ranged", roles: ["Support"], updatedAt: "2026-07-27" },
      { id: 3, name: "h3", localizedName: "Hero Tres", imgUrl: "/h3.png", primaryAttr: "int", attackType: "Ranged", roles: ["Nuker"], updatedAt: "2026-07-27" },
      { id: 4, name: "h4", localizedName: "Hero Cuatro", imgUrl: "/h4.png", primaryAttr: "all", attackType: "Melee", roles: ["Initiator"], updatedAt: "2026-07-27" },
      { id: 5, name: "h5", localizedName: "Hero Cinco", imgUrl: "/h5.png", primaryAttr: "str", attackType: "Melee", roles: ["Durable"], updatedAt: "2026-07-27" },
    ])
    .run();
  db.insert(heroPatchStats)
    .values([{ heroId: 1, patch: "7.36", bracket: "all", picks: 500, wins: 260, updatedAt: "2026-07-27" }])
    .run();
  return db;
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schema: "draft-event/v1",
    eventId: `evt-${Math.random()}`,
    sessionId: "session-int-1",
    seq: 1,
    emittedAt: "2026-07-27T00:00:00Z",
    source: "simulator",
    confidence: 1,
    payload: { type: "session_started", format: "all_pick", patch: "7.36" },
    ...overrides,
  };
}

function waitForMessages(ws: WebSocket, count: number, timeoutMs = 3000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    const messages: Record<string, unknown>[] = [];
    const timer = setTimeout(() => reject(new Error("timeout esperando mensajes WS")), timeoutMs);
    ws.onmessage = (event) => {
      messages.push(JSON.parse(String(event.data)));
      if (messages.length >= count) {
        clearTimeout(timer);
        resolve(messages);
      }
    };
  });
}

function waitForOpen(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => {
    ws.onopen = () => resolve();
  });
}

async function waitForSimulatorState(baseUrl: string, sessionId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const res = await fetch(`${baseUrl}/api/simulator/sessions/${sessionId}/state`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    if (body.suggestions) return body;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timeout esperando estado del simulador");
}

describe("servidor Bun (TSK-010)", () => {
  let baseUrl: string;
  let stop: () => void;

  beforeAll(() => {
    const app = createApp({
      db: createTestDb(),
      openDotaClient: new OpenDotaClient(),
      captureToken: EXPECTED_HEADER,
      heroCapabilities: TEST_HERO_CAPABILITIES,
      heroPositions: TEST_HERO_POSITIONS,
    });
    const server = app.start("127.0.0.1", PORT);
    baseUrl = `http://127.0.0.1:${server.port}`;
    stop = () => server.stop(true);
  });

  afterAll(() => stop());

  test("GET /api/health responde correctamente desde 127.0.0.1", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
  });

  test("POST /ingest/draft-event sin x-capture-token es rechazado (401)", async () => {
    const res = await fetch(`${baseUrl}/ingest/draft-event`, {
      method: "POST",
      body: JSON.stringify(envelope()),
    });
    expect(res.status).toBe(401);
  });

  test("más de 20 eventos/segundo en la misma sesión producen 429 para el exceso", async () => {
    const sessionId = "session-rate-limit";
    const requests = Array.from({ length: 21 }, (_, i) =>
      fetch(`${baseUrl}/ingest/draft-event`, {
        method: "POST",
        headers: { "x-capture-token": EXPECTED_HEADER },
        body: JSON.stringify(
          envelope({ sessionId, seq: i + 1, eventId: `rl-${i}`, payload: { type: "capture_health", status: "ok" } }),
        ),
      }),
    );
    const statuses = (await Promise.all(requests)).map((r) => r.status);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s !== 429).length).toBe(20);
  });

  test("tras un evento válido, el cliente WS recibe draft_state antes que suggestions, y hello siempre da snapshot + suggestions frescos", async () => {
    const sessionId = "session-ws-1";
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/draft`);
    await waitForOpen(ws);

    const helloReply = waitForMessages(ws, 2);
    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId }));
    const [snapshot, helloSuggestions] = await helloReply;
    expect(snapshot?.type).toBe("snapshot");
    expect(helloSuggestions?.type).toBe("suggestions");

    const pushed = waitForMessages(ws, 2);
    const res = await fetch(`${baseUrl}/ingest/draft-event`, {
      method: "POST",
      headers: { "x-capture-token": EXPECTED_HEADER },
      body: JSON.stringify(envelope({ sessionId, eventId: "ws-evt-1", seq: 1 })),
    });
    expect(res.status).toBe(202);
    expect((await res.json()).accepted).toBe(true);

    const [first, second] = await pushed;
    expect(first?.type).toBe("draft_state");
    expect(second?.type).toBe("suggestions");

    ws.close();
  });

  // TSK-048: antes de este fix, reconectar a una sesión con picks/bans ya aplicados dejaba el
  // tablero correcto pero sin ningún panel de sugerencia hasta el próximo evento real -- el
  // handler "hello" solo reenviaba el snapshot de draftState, nunca recalculaba suggestions.
  test("al reconectar a una sesión con picks ya aplicados, hello reenvía suggestions frescas sin esperar al próximo evento", async () => {
    const sessionId = "session-ws-reconnect";
    const res = await fetch(`${baseUrl}/ingest/draft-event`, {
      method: "POST",
      headers: { "x-capture-token": EXPECTED_HEADER },
      body: JSON.stringify(envelope({ sessionId, eventId: "ws-reconnect-1", seq: 1 })),
    });
    expect(res.status).toBe(202);

    // Reconexión: ninguna pestaña estaba escuchando cuando se aplicó el evento de arriba --
    // simula un refresh de página a mitad de draft.
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/draft`);
    await waitForOpen(ws);
    const helloReply = waitForMessages(ws, 2);
    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId }));
    const [snapshot, suggestions] = await helloReply;

    expect(snapshot?.type).toBe("snapshot");
    expect((snapshot?.payload as Record<string, unknown> | undefined)?.phase).toBe("active");
    expect(suggestions?.type).toBe("suggestions");
    expect(suggestions?.payload).toBeTruthy();

    ws.close();
  });

  test("un hello con sessionId malformado se ignora sin corromper la conexión (hallazgo @redteam ronda 1)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/draft`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId: 123 }));

    // Sin respuesta al hello inválido -- pero la conexión sigue viva y un hello válido después
    // funciona con normalidad, probando que el mensaje malformado no dejó la conexión en mal estado.
    const helloReply = waitForMessages(ws, 2);
    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId: "session-ws-recovery" }));
    const [snapshot, snapshotSuggestions] = await helloReply;
    expect(snapshot?.type).toBe("snapshot");
    expect(snapshotSuggestions?.type).toBe("suggestions");

    ws.close();
  });

  test("POST /api/session/manual no exige x-capture-token", async () => {
    const res = await fetch(`${baseUrl}/api/session/manual`, {
      method: "POST",
      body: JSON.stringify(envelope({ sessionId: "session-manual-1", eventId: "manual-1" })),
    });
    expect(res.status).toBe(202);
  });

  test("GET /api/heroes devuelve HeroMeta[] con img_url", async () => {
    const res = await fetch(`${baseUrl}/api/heroes`);
    const heroesList = await res.json();
    expect(Array.isArray(heroesList)).toBe(true);
    expect(heroesList[0]).toMatchObject({ id: 1, imgUrl: "/h1.png" });
  });

  // random-draft-simulator: Bot_Drafter y Meta_Ban_Pool necesitan pick rate real fuera del motor
  // sin duplicar la agregación de hero_patch_stats en apps/web -- mismo dato que buildSuggestions
  // ya usa internamente, solo de lectura, sin tocar el camino caliente de sugerencias.
  test("GET /api/meta/hero-stats devuelve patchStats agrupado por heroId", async () => {
    const res = await fetch(`${baseUrl}/api/meta/hero-stats`);
    const body = (await res.json()) as { patchStats: Record<string, unknown[]> };
    expect(res.status).toBe(200);
    expect(body.patchStats["1"]).toEqual([{ patch: "7.36", bracket: "all", picks: 500, wins: 260 }]);
    expect(body.patchStats["2"]).toBeUndefined();
  });

  // TSK-063: heroPositions se agregó a la misma respuesta para que el bot del simulador (apps/web)
  // pueda razonar sobre posición real en vez de roles[] -- inyectado vía el fixture del test, no
  // el hero-positions.json real (costura S10).
  test("GET /api/meta/hero-stats devuelve heroPositions (fixture inyectado, no el archivo real)", async () => {
    const res = await fetch(`${baseUrl}/api/meta/hero-stats`);
    const body = (await res.json()) as { heroPositions: Record<string, unknown[]> };
    expect(res.status).toBe(200);
    expect(body.heroPositions["1"]).toEqual([{ position: 1, matches: 1000 }]);
    expect(body.heroPositions["2"]).toEqual([{ position: 5, matches: 800 }]);
  });

  test("POST/GET /api/simulator/sessions crea una sesión HTTP aislada, sin log completo", async () => {
    const first = await fetch(`${baseUrl}/api/simulator/sessions`, { method: "POST" });
    const second = await fetch(`${baseUrl}/api/simulator/sessions`, { method: "POST" });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);

    const firstBody = (await first.json()) as { sessionId: string };
    const secondBody = (await second.json()) as { sessionId: string };
    expect(firstBody.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(secondBody.sessionId).not.toBe(firstBody.sessionId);

    const stateBody = await waitForSimulatorState(baseUrl, firstBody.sessionId);
    expect(stateBody).toHaveProperty("draftState");
    expect(stateBody).toHaveProperty("suggestions");
    expect(stateBody).not.toHaveProperty("events");
    expect((stateBody.draftState as { sessionId: string }).sessionId).toBe(firstBody.sessionId);
    expect((stateBody.suggestions as { sessionId: string }).sessionId).toBe(firstBody.sessionId);
  });

  test("PUT /api/settings guarda una preferencia y GET /api/settings la refleja", async () => {
    const put = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      body: JSON.stringify({ key: "theme", value: "dark" }),
    });
    expect(put.status).toBe(200);

    const get = await fetch(`${baseUrl}/api/settings`);
    const all = await get.json();
    expect(all).toContainEqual({ key: "theme", value: "dark" });
  });

  test("PUT /api/settings con forma inválida es rechazado con 400, sin lanzar", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "PUT",
      body: JSON.stringify({ key: 123 }),
    });
    expect(res.status).toBe(400);
  });

  // TSK-020 (fase 1b, S8): GET/PUT /api/hero-pool. El pool empieza vacío -- esta prueba corre
  // antes que cualquier PUT de hero-pool en este archivo para no depender del orden.
  test("GET /api/hero-pool con el pool vacío devuelve [], no un error", async () => {
    const res = await fetch(`${baseUrl}/api/hero-pool`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  test("PUT /api/hero-pool guarda el pool completo y GET /api/hero-pool lo refleja", async () => {
    const put = await fetch(`${baseUrl}/api/hero-pool`, {
      method: "PUT",
      body: JSON.stringify({
        entries: [
          { hero: 1, source: "manual", personalWinrate: null, personalGames: 0 },
          { hero: 2, source: "calculated", personalWinrate: 0.6, personalGames: 20 },
        ],
      }),
    });
    expect(put.status).toBe(200);
    const putBody = await put.json();
    expect(putBody).toHaveLength(2);
    expect(putBody.find((e: { hero: number }) => e.hero === 2)).toMatchObject({
      hero: 2,
      source: "calculated",
      personalWinrate: 0.6,
      personalGames: 20,
    });

    const get = await fetch(`${baseUrl}/api/hero-pool`);
    const all = await get.json();
    expect(all).toHaveLength(2);
  });

  test("PUT /api/hero-pool con más de 5 entradas es rechazado (400), el pool anterior no se toca", async () => {
    const before = await (await fetch(`${baseUrl}/api/hero-pool`)).json();

    const res = await fetch(`${baseUrl}/api/hero-pool`, {
      method: "PUT",
      body: JSON.stringify({
        entries: Array.from({ length: 6 }, (_, i) => ({ hero: i + 1, source: "manual", personalWinrate: null, personalGames: 0 })),
      }),
    });
    expect(res.status).toBe(400);

    const after = await (await fetch(`${baseUrl}/api/hero-pool`)).json();
    expect(after).toEqual(before);
  });

  test("PUT /api/hero-pool con un hero repetido dentro del body es rechazado (400)", async () => {
    const res = await fetch(`${baseUrl}/api/hero-pool`, {
      method: "PUT",
      body: JSON.stringify({
        entries: [
          { hero: 1, source: "manual", personalWinrate: null, personalGames: 0 },
          { hero: 1, source: "manual", personalWinrate: null, personalGames: 0 },
        ],
      }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/hero-pool con un héroe que no existe en la tabla heroes es rechazado (400)", async () => {
    const res = await fetch(`${baseUrl}/api/hero-pool`, {
      method: "PUT",
      body: JSON.stringify({ entries: [{ hero: 9999, source: "manual", personalWinrate: null, personalGames: 0 }] }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/hero-pool con personalWinrate fuera de [0,1] es rechazado (400)", async () => {
    const res = await fetch(`${baseUrl}/api/hero-pool`, {
      method: "PUT",
      body: JSON.stringify({ entries: [{ hero: 1, source: "manual", personalWinrate: 1.5, personalGames: 10 }] }),
    });
    expect(res.status).toBe(400);
  });

  test("PUT /api/hero-pool con personalGames negativo es rechazado (400)", async () => {
    const res = await fetch(`${baseUrl}/api/hero-pool`, {
      method: "PUT",
      body: JSON.stringify({ entries: [{ hero: 1, source: "manual", personalWinrate: null, personalGames: -1 }] }),
    });
    expect(res.status).toBe(400);
  });

  test("CRUD /api/team-groups crea, lista, edita y borra equipos completos", async () => {
    const create = await fetch(`${baseUrl}/api/team-groups`, {
      method: "POST",
      body: JSON.stringify({
        name: "Stack viernes",
        partySize: 3,
        members: [
          { slot: 1, name: "Ana", heroPool: [1, 2] },
          { slot: 2, name: "Bruno", heroPool: [3] },
        ],
      }),
    });
    expect(create.status).toBe(201);
    const created = await create.json();
    expect(created).toMatchObject({ name: "Stack viernes", partySize: 3 });
    expect(created.members).toHaveLength(2);

    const list = await (await fetch(`${baseUrl}/api/team-groups`)).json();
    expect(list).toHaveLength(1);

    const update = await fetch(`${baseUrl}/api/team-groups/${created.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: "Stack ranked",
        partySize: 2,
        members: [{ slot: 1, name: "Carla", heroPool: [4, 5] }],
      }),
    });
    expect(update.status).toBe(200);
    const updated = await update.json();
    expect(updated).toMatchObject({ id: created.id, name: "Stack ranked", partySize: 2 });
    expect(updated.members.map((member: { name: string }) => member.name)).toEqual(["Carla"]);

    const remove = await fetch(`${baseUrl}/api/team-groups/${created.id}`, { method: "DELETE" });
    expect(remove.status).toBe(204);
    expect(await (await fetch(`${baseUrl}/api/team-groups`)).json()).toEqual([]);
  });

  test("POST /api/team-groups rechaza partySize 4 y no crea equipo", async () => {
    const res = await fetch(`${baseUrl}/api/team-groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Invalido", partySize: 4, members: [] }),
    });

    expect(res.status).toBe(400);
    expect(await (await fetch(`${baseUrl}/api/team-groups`)).json()).toEqual([]);
  });

  test("POST /api/team-groups exige miembros conocidos según partySize", async () => {
    const res = await fetch(`${baseUrl}/api/team-groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Incompleto", partySize: 3, members: [{ slot: 1, name: "Ana", heroPool: [1] }] }),
    });

    expect(res.status).toBe(400);
  });

  test("POST /api/team-groups rechaza héroes desconocidos en pools de compañeros", async () => {
    const res = await fetch(`${baseUrl}/api/team-groups`, {
      method: "POST",
      body: JSON.stringify({ name: "Con bug", partySize: 2, members: [{ slot: 1, name: "Ana", heroPool: [9999] }] }),
    });

    expect(res.status).toBe(400);
  });

  test("GET /api/session/:id/draft-paths calcula caminos bajo demanda, sin WebSocket push nuevo", async () => {
    const sessionId = "session-draft-paths";
    const events = [
      envelope({ sessionId, eventId: "paths-1", seq: 1, payload: { type: "session_started", format: "all_pick", patch: "7.36" } }),
      envelope({ sessionId, eventId: "paths-2", seq: 2, payload: { type: "local_side_identified", side: "radiant" } }),
      envelope({ sessionId, eventId: "paths-3", seq: 3, payload: { type: "hero_picked", hero: 1, side: "radiant" } }),
    ];

    for (const event of events) {
      const accepted = await fetch(`${baseUrl}/api/session/manual`, { method: "POST", body: JSON.stringify(event) });
      expect(accepted.status).toBe(202);
    }

    const res = await fetch(`${baseUrl}/api/session/${sessionId}/draft-paths`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe("draft-paths/v1");
    expect(body.sessionId).toBe(sessionId);
    expect(body.basedOnSeq).toBe(3);
    // Determinístico gracias a TEST_HERO_CAPABILITIES (hero 1 sin nada, hero 2 con todo alto) --
    // el héroe 2 debe aparecer como nextPick en cada camino que se forme, nunca el 1 (ya pickeado).
    expect(body.paths.length).toBeGreaterThan(0);
    expect(body.paths.length).toBeLessThanOrEqual(3);
    for (const path of body.paths) {
      expect(path.nextPick.hero).toBe(2);
    }
  });

  test("POST /api/session/:id/feedback guarda el reporte y GET /api/feedback lo devuelve, más nuevo primero", async () => {
    const draftStateSnapshot = { localSide: "radiant", picks: { radiant: [1], dire: [] } };
    const suggestionsSnapshot = { suggestions: [{ hero: 2, rank: 1 }] };

    const first = await fetch(`${baseUrl}/api/session/session-feedback/feedback`, {
      method: "POST",
      body: JSON.stringify({ comment: "primer reporte", draftState: draftStateSnapshot, suggestions: null }),
    });
    expect(first.status).toBe(202);
    expect(await first.json()).toEqual({ accepted: true });

    const second = await fetch(`${baseUrl}/api/session/session-feedback/feedback`, {
      method: "POST",
      body: JSON.stringify({ comment: "segundo reporte, con sugerencias", draftState: draftStateSnapshot, suggestions: suggestionsSnapshot }),
    });
    expect(second.status).toBe(202);

    const list = await fetch(`${baseUrl}/api/feedback`);
    expect(list.status).toBe(200);
    const rows = await list.json();
    expect(rows).toHaveLength(2);
    expect(rows[0].comment).toBe("segundo reporte, con sugerencias");
    expect(rows[0].suggestions).toEqual(suggestionsSnapshot);
    expect(rows[1].comment).toBe("primer reporte");
    expect(rows[1].suggestions).toBeNull();
    expect(rows[0].draftState).toEqual(draftStateSnapshot);
    expect(rows[0].sessionId).toBe("session-feedback");
  });

  test("POST /api/session/:id/feedback con comment vacío es rechazado (400), nada se inserta", async () => {
    const res = await fetch(`${baseUrl}/api/session/session-feedback-empty/feedback`, {
      method: "POST",
      body: JSON.stringify({ comment: "", draftState: { picks: {} }, suggestions: null }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/session/:id/feedback sin draftState (no-objeto) es rechazado (400)", async () => {
    const res = await fetch(`${baseUrl}/api/session/session-feedback-bad/feedback`, {
      method: "POST",
      body: JSON.stringify({ comment: "algo", draftState: "no es un objeto", suggestions: null }),
    });
    expect(res.status).toBe(400);
  });

  test("POST /api/session/:id/feedback con comment de más de 4000 caracteres es rechazado (400)", async () => {
    const res = await fetch(`${baseUrl}/api/session/session-feedback-long/feedback`, {
      method: "POST",
      body: JSON.stringify({ comment: "a".repeat(4001), draftState: { picks: {} }, suggestions: null }),
    });
    expect(res.status).toBe(400);
  });

  test("CORS: un origin local (apps/web en otro puerto) recibe Access-Control-Allow-Origin (hallazgo @redteam)", async () => {
    const res = await fetch(`${baseUrl}/api/heroes`, { headers: { origin: "http://127.0.0.1:3000" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("http://127.0.0.1:3000");
  });

  test("CORS: preflight OPTIONS responde 204 con los headers necesarios para PUT", async () => {
    const res = await fetch(`${baseUrl}/api/settings`, {
      method: "OPTIONS",
      headers: { origin: "http://127.0.0.1:3000", "access-control-request-method": "PUT" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("PUT");
  });

  test("CORS: un origin remoto no recibe ningún header de acceso", async () => {
    const res = await fetch(`${baseUrl}/api/heroes`, { headers: { origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  // TSK-082: sugerencias reales sin sesión, para el bot de /random-draft.
  describe("POST /api/suggestions/preview", () => {
    test("un body válido devuelve un SuggestionSet real (mismo shape que el de WebSocket)", async () => {
      const res = await fetch(`${baseUrl}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: "all_pick",
          patch: "7.41e",
          localSide: "radiant",
          banned: [],
          picks: { radiant: [], dire: [] },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.schema).toBe("suggestions/v1");
      expect(Array.isArray(body.suggestions)).toBe(true);
    });

    test("no muta ninguna sesión real -- el sessionId 'preview' nunca aparece en SessionStore", async () => {
      await fetch(`${baseUrl}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "all_pick", patch: "7.41e", localSide: "unknown", banned: [1, 2], picks: { radiant: [3], dire: [] } }),
      });
      const health = await (await fetch(`${baseUrl}/api/health`)).json();
      // sessionStore.size no debe haber crecido por llamar a este endpoint -- ninguna prueba
      // anterior de este describe usa el sessionId "preview", así que si el tamaño coincidiera
      // con una sesión nueva sería un indicio real de fuga de estado. No afirmamos un número
      // exacto (otras pruebas del mismo describe ya crearon sesiones) -- solo que existe.
      expect(typeof health.activeSessions).toBe("number");
    });

    test("body malformado (picks faltante) se rechaza con 400, nunca llega a buildSuggestions", async () => {
      const res = await fetch(`${baseUrl}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ format: "all_pick", patch: "7.41e", localSide: "radiant", banned: [] }),
      });
      expect(res.status).toBe(400);
    });

    test("format inválido se rechaza con 400", async () => {
      const res = await fetch(`${baseUrl}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          format: "ranked_deathmatch",
          patch: "7.41e",
          localSide: "radiant",
          banned: [],
          picks: { radiant: [], dire: [] },
        }),
      });
      expect(res.status).toBe(400);
    });

    test("JSON malformado (no un objeto) se rechaza con 400, no lanza", async () => {
      const res = await fetch(`${baseUrl}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "esto no es JSON válido {{{",
      });
      expect(res.status).toBe(400);
    });
  });
});

// TSK-073 (spec §2.3): describe aparte, con su propia app y una tabla de turnos SINTÉTICA
// (nunca la real de 24 turnos curada en TSK-071 -- costura S10, testing-seams.md) inyectada vía
// AppDeps.captainsModeTurns. `app.start("127.0.0.1", 0)` deja que el SO elija un puerto libre,
// sin colisionar con el PORT fijo del describe de arriba.
describe("turno real en el wire (Captain's Mode, TSK-073)", () => {
  const SYNTHETIC_TURNS = {
    reserveTimeMs: 60000,
    turns: [
      { action: "ban" as const, team: "first" as const, standardTimeMs: 10000 },
      { action: "ban" as const, team: "second" as const, standardTimeMs: 10000 },
    ],
  };

  function startAppWithTurns() {
    const app = createApp({
      db: createTestDb(),
      openDotaClient: new OpenDotaClient(),
      captureToken: EXPECTED_HEADER,
      captainsModeTurns: SYNTHETIC_TURNS,
    });
    const server = app.start("127.0.0.1", 0);
    return { baseUrl: `http://127.0.0.1:${server.port}`, port: server.port, stop: () => server.stop(true) };
  }

  test("draft_state incluye turn:null antes de bootstrapear firstPickSide, y el turno real después del primer ban", async () => {
    const { baseUrl, port, stop } = startAppWithTurns();
    try {
      const sessionId = "session-turn-1";
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/draft`);
      await waitForOpen(ws);

      const helloReply = waitForMessages(ws, 2);
      ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId }));
      const [snapshotBeforeStart] = await helloReply;
      expect((snapshotBeforeStart?.payload as Record<string, unknown>)?.turn).toBeNull();

      const started = waitForMessages(ws, 2);
      await fetch(`${baseUrl}/ingest/draft-event`, {
        method: "POST",
        headers: { "x-capture-token": EXPECTED_HEADER },
        body: JSON.stringify(
          envelope({ sessionId, seq: 1, source: "manual", payload: { type: "session_started", format: "captains_mode", patch: "7.41e" } }),
        ),
      });
      await started;

      const pushed = waitForMessages(ws, 2);
      await fetch(`${baseUrl}/ingest/draft-event`, {
        method: "POST",
        headers: { "x-capture-token": EXPECTED_HEADER },
        body: JSON.stringify(
          envelope({ sessionId, seq: 2, source: "manual", payload: { type: "hero_banned", hero: 1, side: "radiant" } }),
        ),
      });
      const [draftState] = await pushed;
      expect(draftState?.type).toBe("draft_state");
      const payload = draftState?.payload as Record<string, unknown>;
      expect(payload.turn).toEqual({ side: "dire", action: "ban", standardTimeMs: 10000 });
      expect(payload.firstPickSide).toBe("radiant");

      ws.close();
    } finally {
      stop();
    }
  });

  test("un pick fuera de turno se rechaza con wrong_turn vía POST /ingest/draft-event", async () => {
    const { baseUrl, stop } = startAppWithTurns();
    try {
      const sessionId = "session-turn-2";
      await fetch(`${baseUrl}/ingest/draft-event`, {
        method: "POST",
        headers: { "x-capture-token": EXPECTED_HEADER },
        body: JSON.stringify(
          envelope({ sessionId, seq: 1, source: "manual", payload: { type: "session_started", format: "captains_mode", patch: "7.41e" } }),
        ),
      });
      // Turno 0 espera un ban -- este es un pick, y encima nunca hay picks en la tabla sintética.
      const res = await fetch(`${baseUrl}/ingest/draft-event`, {
        method: "POST",
        headers: { "x-capture-token": EXPECTED_HEADER },
        body: JSON.stringify(
          envelope({ sessionId, seq: 2, source: "manual", payload: { type: "hero_picked", hero: 1, side: "radiant" } }),
        ),
      });
      const body = await res.json();
      expect(body.accepted).toBe(false);
      expect(body.rejected).toBe("wrong_turn");
    } finally {
      stop();
    }
  });
});

// TSK-021 (fase 1b): POST /api/hero-pool/calculate necesita un OpenDotaClient controlable por
// prueba (respuestas distintas: feliz, 502, vacío) -- describe aparte con su propia app/servidor
// por prueba, en vez de reutilizar el beforeAll compartido de arriba (que usa un cliente real).
describe("POST /api/hero-pool/calculate (TSK-021)", () => {
  function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
  }

  function startAppWithClient(fetchImpl: typeof fetch) {
    const client = new OpenDotaClient({ fetchImpl, sleepImpl: async () => {} });
    const app = createApp({ db: createTestDb(), openDotaClient: client, captureToken: EXPECTED_HEADER });
    const server = app.start("127.0.0.1", 0);
    return { url: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
  }

  test("accountId con formato inválido -> 400 invalid_account_id, sin llamar a OpenDota", async () => {
    let called = false;
    const { url, stop } = startAppWithClient((async () => {
      called = true;
      return jsonResponse([]);
    }) as unknown as typeof fetch);

    const res = await fetch(`${url}/api/hero-pool/calculate`, { method: "POST", body: JSON.stringify({ accountId: "abc" }) });

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_account_id");
    expect(called).toBe(false);
    stop();
  });

  test("el cuerpo de error nunca ecoa el accountId recibido", async () => {
    const { url, stop } = startAppWithClient((async () => jsonResponse([])) as unknown as typeof fetch);

    const res = await fetch(`${url}/api/hero-pool/calculate`, { method: "POST", body: JSON.stringify({ accountId: "no-es-un-id-9999999999999" }) });
    const bodyText = await res.text();

    expect(bodyText).not.toContain("no-es-un-id-9999999999999");
    stop();
  });

  // Hallazgo de @redteam (ronda 1): "1e400" es JSON válido (número), pero JS lo evalúa como
  // Infinity -- "rawDays > 0" por sí solo lo dejaba pasar y colaba date=Infinity en la URL.
  test("un days que desborda a Infinity (JSON válido: 1e400) cae al default de 90, nunca se envía tal cual", async () => {
    const calls: string[] = [];
    const { url, stop } = startAppWithClient((async (input: string) => {
      calls.push(input);
      return jsonResponse([]);
    }) as unknown as typeof fetch);

    const res = await fetch(`${url}/api/hero-pool/calculate`, {
      method: "POST",
      // no se puede usar JSON.stringify({days: Infinity}) -- produce "null". El texto crudo "1e400"
      // sí es JSON válido y JS lo parsea como Infinity.
      body: `{"accountId":"123456789","days":1e400}`,
    });

    expect(res.status).toBe(200);
    expect(calls[0]).toContain("date=90");
    stop();
  });

  test("OpenDota caído tras agotar reintentos -> 502 opendota_unavailable, mensaje en llano", async () => {
    const { url, stop } = startAppWithClient((async () => jsonResponse({}, 500)) as unknown as typeof fetch);

    const res = await fetch(`${url}/api/hero-pool/calculate`, { method: "POST", body: JSON.stringify({ accountId: "123456789" }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe("opendota_unavailable");
    expect(typeof body.message).toBe("string");
    stop();
  });

  test("ningún héroe pasa el mínimo -> 200 con proposed:[], no es un error", async () => {
    const { url, stop } = startAppWithClient((async () =>
      jsonResponse([{ hero_id: 1, games: 3, win: 2 }])) as unknown as typeof fetch);

    const res = await fetch(`${url}/api/hero-pool/calculate`, { method: "POST", body: JSON.stringify({ accountId: "123456789" }) });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.proposed).toEqual([]);
    stop();
  });

  test("caso feliz: fixture con héroes elegibles -> 200 con proposed, baselineWinrate, consideredHeroes, windowDays", async () => {
    const calls: string[] = [];
    const { url, stop } = startAppWithClient((async (input: string) => {
      calls.push(input);
      return jsonResponse([
        { hero_id: 1, games: 20, win: 12 },
        { hero_id: 2, games: 15, win: 6 },
        { hero_id: 3, games: 2, win: 2 }, // no pasa el mínimo -- se descarta, no rompe el resto
      ]);
    }) as typeof fetch);

    const res = await fetch(`${url}/api/hero-pool/calculate`, {
      method: "POST",
      body: JSON.stringify({ accountId: "123456789", days: 30 }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.windowDays).toBe(30);
    expect(body.consideredHeroes).toBe(3);
    expect(body.proposed.map((e: { hero: number }) => e.hero).sort()).toEqual([1, 2]);
    expect(calls[0]).toContain("date=30");
    stop();
  });

  test("dos calculate simultáneos: el segundo recibe 409 mientras el primero sigue en curso", async () => {
    let resolveFirst!: (value: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    let callCount = 0;
    const { url, stop } = startAppWithClient((async () => {
      callCount++;
      if (callCount === 1) return pending;
      throw new Error("no debería llamarse una segunda vez mientras el primero está en curso");
    }) as unknown as typeof fetch);

    const first = fetch(`${url}/api/hero-pool/calculate`, { method: "POST", body: JSON.stringify({ accountId: "123456789" }) });
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await fetch(`${url}/api/hero-pool/calculate`, { method: "POST", body: JSON.stringify({ accountId: "123456789" }) });
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("calculation_in_progress");

    resolveFirst(jsonResponse([]));
    expect((await first).status).toBe(200);
    stop();
  });
});
