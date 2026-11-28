import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRateLimiter } from "./rate-limit";
import { createWaitlistHandlers, normalizeEmail, type WaitlistDependencies } from "./waitlist-handler";
import type { OutgoingEmail } from "./waitlist-mailer";
import { MAX_ENTRIES, MAX_SENDS_PER_DAY, SEND_COOLDOWN_MS, TOKEN_TTL_MS, UNVERIFIED_RETENTION_MS, verifiedWaitlistMembers, waitlistFilePath } from "./waitlist-store";

// Ningún correo real: el remitente es una lista en memoria. Ningún dato real: archivo en una carpeta temporal.

const ORIGIN = "https://beta.example";
const EMAIL = "player@example.com";
const DAY = 24 * 60 * 60 * 1000;
let dir = "";
let file = "";
let clock = 0;
let outbox: OutgoingEmail[] = [];
let mailFails = false;

function handlers(overrides: Partial<WaitlistDependencies> = {}) {
  return createWaitlistHandlers({
    env: { WAITLIST_FILE: file },
    publicOrigin: ORIGIN,
    now: () => clock,
    mailer: {
      send: async (email) => {
        if (mailFails) throw new Error("provider_down");
        outbox.push(email);
      },
    },
    mailboxLimiter: createRateLimiter(1000, 1000),
    ipLimiter: createRateLimiter(1000, 1000),
    globalLimiter: createRateLimiter(1000, 1000),
    confirmLimiter: createRateLimiter(1000, 1000),
    ...overrides,
  });
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/api/waitlist`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const signup = (email: unknown = EMAIL) => handlers().signup(post({ email }));
const confirm = (value: unknown) => handlers().confirm(post({ token: value }));
const stored = () => JSON.parse(readFileSync(file, "utf8")).entries as Array<Record<string, unknown>>;

function tokenIn(email: OutgoingEmail | undefined): string {
  const found = email?.text.match(/\/waitlist\/confirm#token=([A-Za-z0-9_-]{43})/);
  if (!found) throw new Error("no confirmation link in the email");
  return found[1];
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-waitlist-"));
  file = join(dir, "waitlist.json");
  clock = 1_800_000_000_000;
  outbox = [];
  mailFails = false;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("registro", () => {
  test("guarda el correo normalizado y manda un solo enlace; en disco queda el hash, nunca el token", async () => {
    const response = await signup("  Player@Example.COM ");
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "check_inbox" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(outbox.map((email) => email.to)).toEqual([EMAIL]);
    expect(stored()).toHaveLength(1);
    expect(stored()[0]).toMatchObject({ email: EMAIL, status: "pending_verification", tokens: [{ expiresAt: clock + TOKEN_TTL_MS }] });
    expect(readFileSync(file, "utf8")).not.toContain(tokenIn(outbox[0]));
    expect(verifiedWaitlistMembers(file)).toEqual([]);
  });

  test("rechaza lo que no es un correo, sin guardar ni enviar", async () => {
    for (const bad of ["", "player", "a@b", "a b@example.com", "x@example.com\nbcc@evil.com", "<x>@example.com", `${"a".repeat(65)}@example.com`, 42, null]) {
      expect((await signup(bad)).status).toBe(400);
    }
    expect(outbox).toEqual([]);
    expect(existsSync(file)).toBe(false);
    expect(normalizeEmail("a.b+tag@sub.example.co")).toBe("a.b+tag@sub.example.co");
  });

  test("otro origen, sin origen, sin JSON o con cuerpo enorme: rechazado", async () => {
    const api = handlers();
    expect((await api.signup(post({ email: EMAIL }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await api.signup(new Request(`${ORIGIN}/api/waitlist`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }))).status).toBe(403);
    expect((await api.signup(post({ email: EMAIL }, { "content-type": "text/plain" }))).status).toBe(400);
    expect((await api.signup(post("{no json"))).status).toBe(400);
    expect((await api.signup(post({ email: EMAIL, extra: "x".repeat(5000) }))).status).toBe(400);
    expect((await handlers({ publicOrigin: null }).signup(post({ email: EMAIL }))).status).toBe(503);
    expect(outbox).toEqual([]);
  });

  test("campo trampa: responde igual y no registra nada", async () => {
    expect((await handlers().signup(post({ email: EMAIL, website: "http://spam.example" }))).status).toBe(202);
    expect(outbox).toEqual([]);
    expect(existsSync(file)).toBe(false);
  });

  test("límite por IP y tope global", async () => {
    const perIp = handlers({ ipLimiter: createRateLimiter(1, DAY) });
    expect((await perIp.signup(post({ email: EMAIL }))).status).toBe(202);
    expect((await perIp.signup(post({ email: "other@example.com" }))).status).toBe(429);
    const global = handlers({ globalLimiter: createRateLimiter(1, DAY) });
    expect((await global.signup(post({ email: "a@example.com" }, { "x-forwarded-for": "10.0.0.1" }))).status).toBe(202);
    expect((await global.signup(post({ email: "b@example.com" }, { "x-forwarded-for": "10.0.0.2" }))).status).toBe(429);
  });

  test("sin remitente configurado o sin disco persistente en producción: cerrado y sin guardar", async () => {
    const noMailer = await handlers({ mailer: null }).signup(post({ email: EMAIL }));
    expect(noMailer.status).toBe(503);
    expect(await noMailer.json()).toEqual({ error: "not_open" });
    expect(existsSync(file)).toBe(false);
    expect((await handlers({ env: { NODE_ENV: "production" } }).signup(post({ email: EMAIL }))).status).toBe(503);
    expect(waitlistFilePath({ NODE_ENV: "production" })).toBeNull();
    expect(waitlistFilePath({ NODE_ENV: "production", RAILWAY_VOLUME_MOUNT_PATH: "/data" })).toBe(join("/data", "waitlist.json"));
  });

  test("un archivo ilegible no se sobrescribe", async () => {
    writeFileSync(file, "{roto");
    expect((await signup()).status).toBe(503);
    expect(readFileSync(file, "utf8")).toBe("{roto");
    expect(outbox).toEqual([]);
  });

  test("si el envío falla no se gasta el enfriamiento: se puede reintentar enseguida", async () => {
    mailFails = true;
    expect((await signup()).status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stored()[0].sentAt).toEqual([]);
    mailFails = false;
    expect((await signup()).status).toBe(202);
    expect((await confirm(tokenIn(outbox[0]))).status).toBe(200);
  });

  test("un pendiente abandonado se borra pasado el plazo de retención", async () => {
    await signup();
    clock += TOKEN_TTL_MS + UNVERIFIED_RETENTION_MS + 1;
    await signup("other@example.com");
    expect(stored().map((entry) => entry.email)).toEqual(["other@example.com"]);
  });
});

describe("duplicados", () => {
  test("el mismo correo es una sola entrada; dentro del enfriamiento no sale otro envío y la respuesta es idéntica", async () => {
    const first = await signup();
    const second = await signup("PLAYER@example.com");
    expect([second.status, await second.json()]).toEqual([first.status, await first.json()]);
    expect(outbox).toHaveLength(1);
    expect(stored()).toHaveLength(1);
  });

  test("pasado el enfriamiento sale un enlace nuevo y el anterior deja de servir", async () => {
    await signup();
    clock += SEND_COOLDOWN_MS;
    await signup();
    expect(stored()).toHaveLength(1);
    expect((await confirm(tokenIn(outbox[0]))).status).toBe(400);
    expect((await confirm(tokenIn(outbox[1]))).status).toBe(200);
  });

  test("hay un tope diario de envíos por correo", async () => {
    for (let attempt = 0; attempt < MAX_SENDS_PER_DAY + 3; attempt += 1) {
      expect((await signup()).status).toBe(202);
      clock += SEND_COOLDOWN_MS;
    }
    expect(outbox).toHaveLength(MAX_SENDS_PER_DAY);
  });

  test("un correo ya confirmado recibe «ya estás», sin enlace, con la misma respuesta que uno nuevo", async () => {
    await signup();
    await confirm(tokenIn(outbox[0]));
    clock += SEND_COOLDOWN_MS;
    const again = await signup();
    expect([again.status, await again.json()]).toEqual([202, { status: "check_inbox" }]);
    expect(outbox.at(-1)?.subject).toBe("You are already on the D2KIRO waitlist");
    expect(outbox.at(-1)?.text).not.toContain("token=");
    expect(stored()).toHaveLength(1);
    expect(stored()[0].status).toBe("waitlisted");
  });
});

describe("hallazgos de la revisión de seguridad", () => {
  const seen = async (response: Response) => [response.status, await response.json()];

  test("con el proveedor caído, un correo recién enviado y uno nuevo se ven igual", async () => {
    await signup();
    mailFails = true;
    expect(await seen(await signup("other@example.com"))).toEqual(await seen(await signup()));
  });

  test("la respuesta no espera al proveedor de correo", async () => {
    const hung = handlers({ mailer: { send: () => new Promise<void>(() => {}) } });
    const response = await Promise.race([hung.signup(post({ email: EMAIL })), new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))]);
    expect(response?.status).toBe(202);
  });

  test("con la lista llena, un correo nuevo y uno ya inscrito se ven igual", async () => {
    const entries = Array.from({ length: MAX_ENTRIES }, (_, index) => ({ id: String(index), email: `m${index}@example.com`, status: "waitlisted", createdAt: clock, verifiedAt: clock, welcomeSentAt: clock, tokens: [], sentAt: [] }));
    writeFileSync(file, JSON.stringify({ version: 1, entries }));
    expect(await seen(await signup("new@example.com"))).toEqual(await seen(await signup("m1@example.com")));
  });

  test("un reenvío fallido no destruye el enlace que ya había llegado", async () => {
    await signup();
    const first = tokenIn(outbox[0]);
    clock += SEND_COOLDOWN_MS;
    mailFails = true;
    await signup();
    expect((await confirm(first)).status).toBe(200);
  });

  test("ni muchos reenvíos fallidos seguidos desplazan el enlace que sí llegó", async () => {
    await signup();
    const first = tokenIn(outbox[0]);
    clock += SEND_COOLDOWN_MS;
    mailFails = true;
    for (let attempt = 0; attempt < MAX_SENDS_PER_DAY + 1; attempt += 1) {
      await signup();
      await new Promise((resolve) => setTimeout(resolve, 0));
      clock += SEND_COOLDOWN_MS;
    }
    expect((await confirm(first)).status).toBe(200);
  });

  test("los alias de un mismo buzón comparten tope y la respuesta no cambia", async () => {
    const api = handlers({ mailboxLimiter: createRateLimiter(2, DAY) });
    for (const alias of ["victim@gmail.com", "vic.tim+a@gmail.com", "victim+b@gmail.com", "v.i.c.t.i.m@googlemail.com"]) {
      expect((await api.signup(post({ email: alias }))).status).toBe(202);
    }
    expect(outbox).toHaveLength(2);
  });

  test("un cuerpo declarado enorme se rechaza sin leerlo, y sin remitente no se gasta el cupo", async () => {
    expect((await handlers().signup(post({ email: EMAIL }, { "content-length": "9000000" }))).status).toBe(400);
    const globalLimiter = createRateLimiter(1, DAY);
    await handlers({ mailer: null, globalLimiter }).signup(post({ email: EMAIL }));
    expect((await handlers({ globalLimiter }).signup(post({ email: EMAIL }))).status).toBe(202);
  });
});

describe("verificación", () => {
  test("el enlace confirma, manda la bienvenida y deja el estado verificado", async () => {
    await signup();
    const response = await confirm(tokenIn(outbox[0]));
    expect(await response.json()).toEqual({ status: "waitlisted", welcomeEmail: "sent" });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(stored()[0]).toMatchObject({ status: "waitlisted", verifiedAt: clock, welcomeSentAt: clock });
    expect(stored()[0].tokens).toEqual([]);
    expect(verifiedWaitlistMembers(file)).toEqual([{ id: stored()[0].id as string, email: EMAIL, verifiedAt: clock }]);
  });

  test("la bienvenida confirma la lista, anuncia D2KIRO LIVE como próximo y no promete acceso", async () => {
    await signup();
    await confirm(tokenIn(outbox[0]));
    const welcome = outbox[1];
    expect(welcome.to).toBe(EMAIL);
    expect(welcome.text).toContain("you are on the D2KIRO waitlist");
    expect(welcome.text).toContain("D2KIRO LIVE");
    expect(welcome.text).toContain("not available yet");
    expect(welcome.text).toContain("does not open the draft coach");
    expect(welcome.text).not.toMatch(/you (now )?have access|available now|log in now|start using/i);
    expect(welcome.text).not.toContain("http");
  });

  test("sirve una sola vez: el segundo uso falla y no repite la bienvenida", async () => {
    await signup();
    const value = tokenIn(outbox[0]);
    await confirm(value);
    const replay = await confirm(value);
    expect(replay.status).toBe(400);
    expect(await replay.json()).toEqual({ error: "invalid_link" });
    expect(outbox).toHaveLength(2);
  });

  test("vence: un instante antes sirve, en el límite no, y un registro nuevo lo recupera", async () => {
    await signup();
    clock += TOKEN_TTL_MS;
    const expired = await confirm(tokenIn(outbox[0]));
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ error: "expired_link" });
    expect(verifiedWaitlistMembers(file)).toEqual([]);
    expect(outbox).toHaveLength(1);
    await signup();
    clock += TOKEN_TTL_MS - 1;
    expect((await confirm(tokenIn(outbox[1]))).status).toBe(200);
  });

  test("un token inventado, el hash guardado o una forma rara no verifican a nadie", async () => {
    await signup();
    for (const forged of ["A".repeat(43), (stored()[0].tokens as Array<{ hash: string }>)[0].hash, "", "corto", 12, undefined]) {
      expect((await confirm(forged)).status).toBe(400);
    }
    expect(stored()[0].status).toBe("pending_verification");
  });

  test("otro origen no puede confirmar y hay límite de intentos", async () => {
    await signup();
    const value = tokenIn(outbox[0]);
    expect((await handlers().confirm(post({ token: value }, { origin: "https://evil.example" }))).status).toBe(403);
    expect((await handlers({ confirmLimiter: createRateLimiter(0, DAY) }).confirm(post({ token: value }))).status).toBe(429);
    expect(stored()[0].status).toBe("pending_verification");
  });

  test("si la bienvenida falla, la verificación se conserva y un registro posterior la vuelve a mandar", async () => {
    await signup();
    mailFails = true;
    const response = await confirm(tokenIn(outbox[0]));
    expect(await response.json()).toEqual({ status: "waitlisted", welcomeEmail: "pending" });
    expect(stored()[0].welcomeSentAt).toBeUndefined();
    mailFails = false;
    expect((await signup()).status).toBe(202);
    expect(outbox.at(-1)?.subject).toBe("You are on the D2KIRO waitlist");
    expect(stored()[0].welcomeSentAt).toBe(clock);
  });
});
