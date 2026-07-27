import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { heroes, heroMatchups, heroPatchStats, metaSync } from "../db/schema";
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
  `);
  const db = drizzle(sqlite, { schema: { heroes, heroMatchups, heroPatchStats, metaSync } });
  db.insert(heroes)
    .values({ id: 1, name: "h1", localizedName: "Hero Uno", imgUrl: "/h1.png", primaryAttr: "str", attackType: "Melee", roles: ["Carry"], updatedAt: "2026-07-27" })
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
});
