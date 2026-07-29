import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, heroPool, metaSync, settings } from "../db/schema";
import { OpenDotaClient } from "../meta/opendota-client";
import { createApp } from "./app";

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
    CREATE TABLE hero_pool (
      hero_id INTEGER PRIMARY KEY, source TEXT NOT NULL, personal_winrate REAL,
      personal_games INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
    );
  `);
  const db = drizzle(sqlite, { schema: { heroes, heroMatchups, heroPatchStats, metaSync, settings, heroPool } });
  db.insert(heroes)
    .values([
      { id: 1, name: "h1", localizedName: "Hero Uno", imgUrl: "/h1.png", primaryAttr: "str", attackType: "Melee", roles: ["Carry"], updatedAt: "2026-07-27" },
      { id: 2, name: "h2", localizedName: "Hero Dos", imgUrl: "/h2.png", primaryAttr: "agi", attackType: "Ranged", roles: ["Support"], updatedAt: "2026-07-27" },
    ])
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

describe("servidor Bun (TSK-010)", () => {
  let baseUrl: string;
  let stop: () => void;

  beforeAll(() => {
    const app = createApp({ db: createTestDb(), openDotaClient: new OpenDotaClient(), captureToken: EXPECTED_HEADER });
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

  test("tras un evento válido, el cliente WS recibe draft_state antes que suggestions, y hello siempre da un snapshot completo", async () => {
    const sessionId = "session-ws-1";
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/draft`);
    await waitForOpen(ws);

    const helloReply = waitForMessages(ws, 1);
    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId }));
    const [snapshot] = await helloReply;
    expect(snapshot?.type).toBe("snapshot");

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

  test("un hello con sessionId malformado se ignora sin corromper la conexión (hallazgo @redteam ronda 1)", async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws/draft`);
    await waitForOpen(ws);

    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId: 123 }));

    // Sin respuesta al hello inválido -- pero la conexión sigue viva y un hello válido después
    // funciona con normalidad, probando que el mensaje malformado no dejó la conexión en mal estado.
    const helloReply = waitForMessages(ws, 1);
    ws.send(JSON.stringify({ schema: "draft-ws/v1", type: "hello", sessionId: "session-ws-recovery" }));
    const [snapshot] = await helloReply;
    expect(snapshot?.type).toBe("snapshot");

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
