import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAccessRequestHandlers, sanitizeRequestMessage } from "./access-request-handler";
import { applyAccessAction, accessRef, readAccessStore, REJECTED_COOLDOWN_MS } from "./beta-access-store";
import { createRateLimiter } from "./rate-limit";

const SECRET = "ref-" + "credential-for-tests-only-0123456789abcdef";
const ORIGIN = "https://coach.example";
const FRIEND = 2002;
let dir = "";
let file = "";
let clock = 1_000_000;

function handlers(options: { accountId?: number | undefined; ipLimit?: number } = {}) {
  const accountId = "accountId" in options ? options.accountId : FRIEND;
  return createAccessRequestHandlers({
    readNotice: async () => (accountId === undefined ? null : { accountId, personaName: "Amigo", avatarUrl: null, profileAvailable: true }),
    env: { BETA_ACCESS_FILE: file },
    publicOrigin: ORIGIN,
    now: () => clock,
    ipLimiter: createRateLimiter(options.ipLimit ?? 100, 60_000),
    accountLimiter: createRateLimiter(100, 60_000),
  });
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${ORIGIN}/api/auth/access-request`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-req-"));
  file = join(dir, "beta-access.json");
  clock = 1_000_000;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("solicitud de acceso con mensaje", () => {
  test("guarda la identidad verificada + el mensaje; el pedido queda pendiente", async () => {
    const response = await handlers().POST(post({ message: "Soy Ana, juego con Julio en el equipo" }));
    expect(response.status).toBe(201);
    const [entry] = readAccessStore(file).requests;
    expect(entry.steam32).toBe(FRIEND);
    expect(entry.message).toBe("Soy Ana, juego con Julio en el equipo");
    expect(entry.at).toBe(clock);
  });

  test("la identidad NO se puede falsificar desde el formulario: cuenta, nombre y avatar del cuerpo se ignoran", async () => {
    await handlers().POST(post({ message: "Mensaje de prueba válido", accountId: 1, steam32: 1, personaName: "El Admin", avatarUrl: "https://x.example/a.png" }));
    const [entry] = readAccessStore(file).requests;
    expect(entry.steam32).toBe(FRIEND);
    expect(entry.personaName).toBe("Amigo");
    expect(entry.avatarUrl).toBeNull();
    expect(readAccessStore(file).requests).toHaveLength(1);
  });

  test("sin identidad verificada (sin cookie sellada de Steam) → 401 y no se escribe nada", async () => {
    const response = await handlers({ accountId: undefined }).POST(post({ message: "Mensaje de prueba válido" }));
    expect(response.status).toBe(401);
    expect(existsSync(file)).toBe(false);
    expect((await handlers({ accountId: undefined }).GET()).status).toBe(401);
  });

  test("el mensaje es obligatorio: vacío, muy corto, muy largo o de otro tipo se rechaza", async () => {
    expect((await handlers().POST(post({ message: "" }))).status).toBe(400);
    expect((await handlers().POST(post({ message: "   hola   " }))).status).toBe(400);
    expect((await handlers().POST(post({ message: "x".repeat(501) }))).status).toBe(400);
    expect((await handlers().POST(post({ message: 42 }))).status).toBe(400);
    expect((await handlers().POST(post({}))).status).toBe(400);
    expect(existsSync(file)).toBe(false);
  });

  test("otro origen o un cuerpo que no es JSON se rechazan", async () => {
    expect((await handlers().POST(post({ message: "Mensaje de prueba válido" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await handlers().POST(new Request(`${ORIGIN}/api/auth/access-request`, { method: "POST", headers: { origin: ORIGIN, "content-type": "text/plain" }, body: "x" }))).status).toBe(400);
    expect((await handlers().POST(new Request(`${ORIGIN}/api/auth/access-request`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(403);
  });

  test("anti-spam: un solo pedido pendiente por cuenta; reenviar no duplica ni cambia el mensaje", async () => {
    await handlers().POST(post({ message: "Primer mensaje válido" }));
    const again = await handlers().POST(post({ message: "Segundo mensaje distinto" }));
    expect((await again.json()).already).toBe(true);
    const { requests } = readAccessStore(file);
    expect(requests).toHaveLength(1);
    expect(requests[0].message).toBe("Primer mensaje válido");
  });

  test("anti-spam: el límite por IP corta las ráfagas con 429", async () => {
    const limited = handlers({ ipLimit: 2 });
    const headers = { "x-forwarded-for": "203.0.113.9" };
    expect((await limited.POST(post({ message: "Mensaje de prueba válido" }, headers))).status).toBe(201);
    expect((await limited.POST(post({ message: "Mensaje de prueba válido" }, headers))).status).toBe(200);
    expect((await limited.POST(post({ message: "Mensaje de prueba válido" }, headers))).status).toBe(429);
  });

  test("anti-spam: el campo trampa invisible no registra nada pero responde como si funcionara", async () => {
    const response = await handlers().POST(post({ message: "Mensaje de prueba válido", website: "http://spam.example" }));
    expect(response.status).toBe(200);
    expect(existsSync(file)).toBe(false);
  });

  test("tras un rechazo hay enfriamiento de 24 h; pasado ese tiempo puede volver a pedir", async () => {
    await handlers().POST(post({ message: "Primer mensaje válido" }));
    const ref = accessRef(FRIEND, SECRET);
    expect(applyAccessAction(file, "reject", ref, SECRET, clock)).toBe(true);
    expect((await (await handlers().GET()).json()).status).toBe("rejected");
    const early = await handlers().POST(post({ message: "Otro intento válido" }));
    expect(early.status).toBe(429);
    expect((await early.json()).error).toBe("cooldown");
    clock += REJECTED_COOLDOWN_MS + 1;
    expect((await handlers().POST(post({ message: "Ahora con más contexto" }))).status).toBe(201);
    expect(readAccessStore(file).rejected).toHaveLength(0);
  });

  test("aprobar mueve a invitados y la persona lo ve en su estado", async () => {
    await handlers().POST(post({ message: "Primer mensaje válido" }));
    expect((await (await handlers().GET()).json()).status).toBe("pending");
    applyAccessAction(file, "approve", accessRef(FRIEND, SECRET), SECRET, clock);
    expect((await (await handlers().GET()).json()).status).toBe("invited");
  });

  test("un texto con caracteres de control se limpia", () => {
    expect(sanitizeRequestMessage("  Hola\u0000\u0007   mundo\n\n\n\nfin  ")).toBe("Hola mundo\n\nfin");
  });
});

describe("compatibilidad del archivo y respaldo", () => {
  test("un archivo anterior (sin `rejected` ni mensajes) se lee igual, y antes de la primera escritura queda un respaldo intacto", async () => {
    const legacy = JSON.stringify({ version: 1, invited: [{ steam32: 77, personaName: "Viejo", avatarUrl: null, at: 5 }], requests: [{ steam32: 88, personaName: "Pendiente", avatarUrl: null, at: 6 }] });
    writeFileSync(file, legacy);
    expect(readAccessStore(file).invited).toHaveLength(1);
    expect(readAccessStore(file).requests[0].message).toBeUndefined();
    await handlers().POST(post({ message: "Mensaje de prueba válido" }));
    expect(readFileSync(`${file}.bak-v1`, "utf8")).toBe(legacy);
    const after = readAccessStore(file);
    expect(after.invited).toHaveLength(1);
    expect(after.requests).toHaveLength(2);
  });
});
