import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { createGsiLinkTestDb, gsiPayload } from "../live/gsi.fixtures";
import { OpenDotaClient } from "../meta/opendota-client";
import { createApp } from "./app";

// TSK-219 -- the GSI routes wired into the REAL app over real HTTP: account-authenticated link
// management, link-authenticated ingest, and the live session's ownership on the existing routes.

const HMAC_KEY = "test-hmac-key-for-tsk-219-gsi-123456";
const CAPTURE_HEADER_VALUE = "test-capture-header";
const ACCOUNT_TIME = 1_790_000_000_000;
let nonce = 0;

function account(accountId: number): Record<string, string> {
  const payload = `${accountId}.${ACCOUNT_TIME}.${(nonce++).toString(16).padStart(32, "0")}`;
  const signature = createHmac("sha256", HMAC_KEY).update(`d2k-account-token/v1|${payload}`).digest("hex");
  return { "x-account-token": `${payload}.${signature}` };
}

describe("GSI routes in the engine app (TSK-219)", () => {
  let baseUrl: string;
  let stop: () => Promise<void>;

  beforeAll(() => {
    const app = createApp({
      db: createGsiLinkTestDb().db,
      openDotaClient: new OpenDotaClient(),
      captureToken: CAPTURE_HEADER_VALUE,
      internalAuthSecret: HMAC_KEY,
      accountTokenNow: () => ACCOUNT_TIME,
    });
    const server = app.start("127.0.0.1", 0);
    baseUrl = `http://127.0.0.1:${server.port}`;
    stop = () => server.stop(true);
  });

  afterAll(async () => {
    await stop();
  });

  test("link management needs an account token", async () => {
    expect((await fetch(`${baseUrl}/api/live/gsi-link`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/live/gsi-link/issue`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/live/gsi-link`, { method: "DELETE" })).status).toBe(401);
  });

  test("issue -> Dota ingest -> the owner sees it live; another account is refused the session", async () => {
    const issued = await fetch(`${baseUrl}/api/live/gsi-link/issue`, { method: "POST", headers: account(101) });
    expect(issued.status).toBe(201);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    const { liveId, token, sessionId } = (await issued.json()) as { liveId: string; token: string; sessionId: string };

    const ingest = await fetch(`${baseUrl}/api/live/gsi/${liveId}`, { method: "POST", body: JSON.stringify(gsiPayload({ token, teamName: "radiant", heroId: 30, draft: "empty" })) });
    expect(ingest.status).toBe(200);

    const mine = await fetch(`${baseUrl}/api/session/protocol/${sessionId}/live-status`, { headers: account(101) });
    expect(mine.status).toBe(200);
    expect(await mine.json()).toMatchObject({ connection: "connected", draftPhase: "hero_selection", localSide: "radiant", picks: 1 });
    expect((await fetch(`${baseUrl}/api/session/protocol/${sessionId}/live-status`, { headers: account(202) })).status).toBe(403);
    expect((await fetch(`${baseUrl}/api/session/protocol/${sessionId}/team-recommendations`, { headers: account(202) })).status).toBe(403);

    const link = (await (await fetch(`${baseUrl}/api/live/gsi-link`, { headers: account(101) })).json()) as { link: { sessionId: string } };
    expect(link.link.sessionId).toBe(sessionId);

    expect((await fetch(`${baseUrl}/api/live/gsi-link`, { method: "DELETE", headers: account(101) })).status).toBe(200);
    expect((await fetch(`${baseUrl}/api/live/gsi/${liveId}`, { method: "POST", body: JSON.stringify(gsiPayload({ token })) })).status).toBe(401);
  });

  test("ingest without a valid link credential is refused; GET on the ingest path is not a route", async () => {
    expect((await fetch(`${baseUrl}/api/live/gsi/${"A".repeat(43)}`, { method: "POST", body: JSON.stringify(gsiPayload({ token: "a".repeat(64) })) })).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/live/gsi/${"A".repeat(43)}`)).status).toBe(404);
  });
});
