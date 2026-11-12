import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBetaAdminHandlers } from "./beta-admin-handler";
import { recordAccessRequest } from "./beta-access-store";

const OWNER = 1001;
const FRIEND = 2002;
const REF_KEY = "admin-test-" + "credential-with-at-least-thirty-two-chars";
let dir = "";
let file = "";

function handlersFor(accountId: number | null) {
  return createBetaAdminHandlers({
    accountId: async () => accountId,
    env: { BETA_ALLOWED_STEAM_IDS: String(OWNER), BETA_ADMIN_STEAM_IDS: String(OWNER), BETA_ACCESS_FILE: file, SESSION_SECRET: REF_KEY },
    publicOrigin: "https://beta.example",
    now: () => 10,
  });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://beta.example/api/beta-admin", { method: "POST", headers: { "content-type": "application/json", origin: "https://beta.example", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-admin-"));
  file = join(dir, "beta-access.json");
  recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("administración de invitados", () => {
  test("sin sesión 401; con sesión que no es administradora 403 (también un invitado aprobado)", async () => {
    expect((await handlersFor(null).GET()).status).toBe(401);
    expect((await handlersFor(FRIEND).GET()).status).toBe(403);
    expect((await handlersFor(FRIEND).POST(post({ action: "approve", ref: "0".repeat(16) }))).status).toBe(403);
  });

  test("el propietario ve los pedidos con nombre y referencia opaca, sin Steam32, y el enlace para compartir", async () => {
    const response = await handlersFor(OWNER).GET();
    const text = await response.text();
    expect(response.status).toBe(200);
    expect(text).not.toContain(String(FRIEND));
    const body = JSON.parse(text) as { requests: { ref: string; personaName: string }[]; shareUrl: string; fixedCount: number };
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0]?.personaName).toBe("Amigo");
    expect(body.shareUrl).toBe("https://beta.example");
    expect(body.fixedCount).toBe(1);
  });

  test("aprobar mueve el pedido a invitados; retirar lo quita; una referencia inventada es 404", async () => {
    const owner = handlersFor(OWNER);
    const ref = ((await (await owner.GET()).json()) as { requests: { ref: string }[] }).requests[0]!.ref;
    expect((await owner.POST(post({ action: "approve", ref }))).status).toBe(200);
    const after = (await (await owner.GET()).json()) as { requests: unknown[]; invited: { ref: string }[] };
    expect(after.requests).toHaveLength(0);
    expect(after.invited).toHaveLength(1);
    expect((await owner.POST(post({ action: "revoke", ref }))).status).toBe(200);
    expect((await owner.POST(post({ action: "approve", ref: "f".repeat(16) }))).status).toBe(404);
  });

  test("entradas inválidas o desde otro origen o sin JSON se rechazan", async () => {
    const owner = handlersFor(OWNER);
    expect((await owner.POST(post({ action: "promote", ref: "0".repeat(16) }))).status).toBe(400);
    expect((await owner.POST(post({ action: "approve", ref: "../x" }))).status).toBe(400);
    expect((await owner.POST(post({ action: "approve", ref: "0".repeat(16) }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await owner.POST(post({ action: "approve", ref: "0".repeat(16) }, { "content-type": "text/plain" }))).status).toBe(400);
  });
});
