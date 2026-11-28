import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIENT_PER_DAY, CLIENT_PER_HOUR, GLOBAL_PER_DAY, GLOBAL_PER_HOUR, NETWORK_PER_DAY, TAGGED_PER_MAILBOX_PER_DAY, clientKeys, createSignupLimits, taggedMailboxKey, type SignupLimits } from "./waitlist-abuse";
import { createWaitlistHandlers, normalizeEmail } from "./waitlist-handler";
import type { OutgoingEmail } from "./waitlist-mailer";
import { MAX_ENTRIES, TOKEN_TTL_MS, confirmToken, hashToken, planSignup } from "./waitlist-store";

// Regresiones de la revisión del PR #176. Límites REALES, correo en memoria, archivo en una carpeta temporal.

const ORIGIN = "https://beta.example";
const HOUR = 60 * 60 * 1000;
const START = 1_800_000_000_000;
let dir = "";
let file = "";
let clock = START;
let outbox: OutgoingEmail[] = [];
let limits: SignupLimits;
let counter = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-waitlist-abuse-"));
  file = join(dir, "waitlist.json");
  clock = START;
  outbox = [];
  limits = createSignupLimits();
  counter = 0;
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

function api() {
  return createWaitlistHandlers({
    env: { WAITLIST_FILE: file },
    publicOrigin: ORIGIN,
    now: () => clock,
    mailer: { send: async (email) => void outbox.push(email) },
    limits,
  });
}

/** Un registro desde `ip`; sin correo, usa uno nuevo cada vez. */
async function signup(ip: string, email?: string, extra: Record<string, string> = {}) {
  counter += 1;
  const response = await api().signup(new Request(`${ORIGIN}/api/waitlist`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", "x-real-ip": ip, ...extra },
    body: JSON.stringify({ email: email ?? `user${counter}@example.com` }),
  }));
  return { status: response.status, body: (await response.json()) as Record<string, string> };
}

/** `count` registros, cada uno desde una red /24 distinta (el atacante repartido). */
async function flood(count: number, offset = 0) {
  let accepted = 0;
  for (let index = offset; index < offset + count; index += 1) {
    const network = Math.floor(index / CLIENT_PER_HOUR);
    if ((await signup(`10.${Math.floor(network / 250)}.${network % 250}.1`)).status === 202) accepted += 1;
  }
  return accepted;
}

const stored = () => JSON.parse(readFileSync(file, "utf8")).entries as Array<{ email: string }>;

function entry(index: number, overrides: Record<string, unknown>) {
  return { id: `id-${index}`, email: `m${index}@example.com`, status: "pending_verification", createdAt: START, tokens: [], sentAt: [], ...overrides };
}

const verified = (index: number) => entry(index, { status: "waitlisted", verifiedAt: START, welcomeSentAt: START });
const pending = (index: number, expiresAt: number) => entry(index, { tokens: [{ hash: hashToken(`other-${index}`), expiresAt }] });

function fill(entries: unknown[]) {
  writeFileSync(file, JSON.stringify({ version: 1, entries }));
}

describe("hallazgo 1: un solo origen no puede cerrar el registro", () => {
  test("rotar x-forwarded-for no crea clientes nuevos", async () => {
    const results = [];
    for (let index = 0; index < 10; index += 1) results.push((await signup("203.0.113.9", undefined, { "x-forwarded-for": `10.9.${index}.1` })).status);
    expect(results.filter((status) => status === 202)).toHaveLength(CLIENT_PER_HOUR);
  });

  test("cuatro IP insistiendo no dejan fuera a una persona legítima", async () => {
    for (let index = 0; index < 100; index += 1) await signup(`198.51.${index % 4}.5`);
    expect(outbox).toHaveLength(4 * CLIENT_PER_HOUR);
    expect((await signup("192.0.2.44", "legit@example.com")).status).toBe(202);
  });

  test("una red entera no pasa de su cupo diario", async () => {
    for (let index = 1; index <= 200; index += 1) await signup(`203.0.113.${index}`);
    expect(outbox).toHaveLength(NETWORK_PER_DAY);
    expect((await signup("192.0.2.44")).status).toBe(202);
  });

  test("cada cliente tiene además un tope diario", async () => {
    for (let hour = 0; hour < 6; hour += 1) {
      clock = START + hour * (HOUR + 1);
      for (let index = 0; index < CLIENT_PER_HOUR; index += 1) await signup("203.0.113.9");
    }
    expect(outbox).toHaveLength(CLIENT_PER_DAY);
  });

  test("en IPv6 todo un /64 es un cliente y todo un /48 es una red", async () => {
    for (let index = 1; index <= 20; index += 1) await signup(`2001:db8:1:1::${index.toString(16)}`);
    expect(outbox).toHaveLength(CLIENT_PER_HOUR);
    for (let index = 2; index <= 60; index += 1) await signup(`2001:db8:1:${index.toString(16)}::1`);
    expect(outbox).toHaveLength(NETWORK_PER_DAY);
  });

  test("la clave sale de x-real-ip; sin una IP legible todos comparten cupo", () => {
    const keys = (value: string) => clientKeys(new Headers({ "x-real-ip": value }));
    expect(keys("::ffff:203.0.113.9")).toEqual(keys("203.0.113.9"));
    expect(keys("2001:0DB8:0001:0001:0000:0000:0000:0001")).toEqual(keys("2001:db8:1:1::2"));
    for (const bad of ["", "unknown", "1.2.3.4, 5.6.7.8", "<script>"]) expect(keys(bad).client).toBe("unknown");
    expect(clientKeys(new Headers({ "x-forwarded-for": "203.0.113.9" })).client).toBe("unknown");
  });

  test("el freno global sigue: al agotarse dice que está en pausa, sin guardar ni enviar, y se recupera", async () => {
    expect(await flood(GLOBAL_PER_HOUR)).toBe(GLOBAL_PER_HOUR);
    const sizeBefore = readFileSync(file, "utf8");
    const fresh = await signup("192.0.2.44", "late@example.com");
    const known = await signup("192.0.2.45", "user1@example.com");
    expect(fresh).toEqual({ status: 503, body: { error: "busy" } });
    expect(known).toEqual(fresh);
    expect(readFileSync(file, "utf8")).toBe(sizeBefore);
    expect(outbox).toHaveLength(GLOBAL_PER_HOUR);
    clock += HOUR + 1;
    expect((await signup("192.0.2.46", "late@example.com")).status).toBe(202);
  });

  test("hay tope global diario", async () => {
    for (let hour = 0; hour < 8; hour += 1) {
      clock = START + hour * (HOUR + 1);
      await flood(GLOBAL_PER_HOUR, hour * 300);
    }
    expect(outbox).toHaveLength(GLOBAL_PER_DAY);
  });
});

describe("hallazgo 2: capacidad llena", () => {
  test("un pendiente con enlace vigente no se expulsa y el nuevo no recibe un «revisa tu correo»", async () => {
    const first = planSignup(file, "legit@example.com", START);
    if (first.kind !== "verify") throw new Error("expected a verification");
    fill([...stored(), ...Array.from({ length: MAX_ENTRIES - 1 }, (_, index) => pending(index, START + TOKEN_TTL_MS + index + 1))]);
    clock += 60_000;
    expect(await signup("192.0.2.1", "new@example.com")).toEqual({ status: 503, body: { error: "full" } });
    expect(outbox).toEqual([]);
    expect(confirmToken(file, first.token, clock).kind).toBe("verified");
  });

  test("lista llena: un correo nuevo, uno verificado y uno pendiente se ven igual; nada se guarda ni se envía", async () => {
    fill([pending(0, START + TOKEN_TTL_MS), ...Array.from({ length: MAX_ENTRIES - 1 }, (_, index) => verified(index + 1))]);
    const before = readFileSync(file, "utf8");
    const results = [await signup("192.0.2.1", "new@example.com"), await signup("192.0.2.2", "m1@example.com"), await signup("192.0.2.3", "m0@example.com")];
    for (const result of results) expect(result).toEqual({ status: 503, body: { error: "full" } });
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(outbox).toEqual([]);
  });

  test("si hay un pendiente ya vencido, entra el nuevo y solo sale ese vencido", async () => {
    fill([pending(0, START - 1), pending(1, START + TOKEN_TTL_MS), ...Array.from({ length: MAX_ENTRIES - 2 }, (_, index) => verified(index + 2))]);
    expect((await signup("192.0.2.1", "new@example.com")).status).toBe(202);
    const emails = stored().map((item) => item.email);
    expect(emails).toHaveLength(MAX_ENTRIES);
    expect([emails.includes("m0@example.com"), emails.includes("m1@example.com"), emails.includes("new@example.com")]).toEqual([false, true, true]);
    expect(outbox.map((email) => email.to)).toEqual(["new@example.com"]);
  });
});

describe("hallazgo 3: variantes de un buzón", () => {
  test("las variantes de un tercero no le gastan el cupo a la dueña", async () => {
    for (let index = 0; index < 40; index += 1) {
      await signup(`10.1.${index}.1`, `victim+x${index}@gmail.com`);
      await signup(`10.2.${index}.1`, `victim+y${index}@example.org`);
    }
    expect((await signup("192.0.2.1", "victim@gmail.com")).status).toBe(202);
    expect((await signup("192.0.2.2", "victim@example.org")).status).toBe(202);
    expect(outbox.slice(-2).map((email) => email.to)).toEqual(["victim@gmail.com", "victim@example.org"]);
  });

  test("en Gmail las variantes con etiqueta comparten un cupo pequeño y el rechazo se ve", async () => {
    const results = [];
    for (let index = 0; index < 20; index += 1) results.push(await signup(`10.3.${index}.1`, `v.ictim+${index}@${index % 2 === 0 ? "gmail" : "googlemail"}.com`));
    expect(outbox).toHaveLength(TAGGED_PER_MAILBOX_PER_DAY);
    expect(stored()).toHaveLength(TAGGED_PER_MAILBOX_PER_DAY);
    expect(results.at(-1)).toEqual({ status: 429, body: { error: "rate_limited" } });
  });

  test("fuera de Gmail no se supone nada: puntos y sufijos son direcciones distintas, sin cupo compartido", async () => {
    const addresses = ["a.b@example.com", "ab@example.com", "ab+1@example.com", "ab+2@example.com", "ab+3@example.com"];
    for (const [index, address] of addresses.entries()) expect((await signup(`10.4.${index}.1`, address)).status).toBe(202);
    expect(outbox.map((email) => email.to)).toEqual(addresses);
    expect([taggedMailboxKey("ab+1@example.com"), taggedMailboxKey("a.b@gmail.com")]).toEqual([null, null]);
  });
});

describe("hallazgos 5 y 6", () => {
  test("un cuerpo sin content-length se corta al pasar el límite, sin leerlo entero", async () => {
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 1000) return controller.close();
        pulled += 1;
        controller.enqueue(new Uint8Array(4096).fill(97));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await api().signup(new Request(`${ORIGIN}/api/waitlist`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body, duplex: "half" } as RequestInit));
    expect(response.status).toBe(400);
    expect(pulled).toBeLessThan(10);
    expect(cancelled).toBe(true);
    expect(outbox).toEqual([]);
  });

  test("rechaza direcciones mal formadas y conserva las válidas", () => {
    const bad = [".a@example.com", "a.@example.com", "a..b@example.com", ".@example.com", "a@.example.com", "a@example..com", "a@example.com.", "a@-example.com", "a@example-.com", "a@@example.com", "a@b@example.com", `${"a".repeat(65)}@example.com`, `a@${"b".repeat(64)}.com`, `${"a".repeat(64)}@${`${"b".repeat(60)}.`.repeat(4)}com`, "a,b@example.com", "a;b@example.com", "\"a\"@example.com", "a@example.c0m", "ñ@example.com"];
    for (const value of bad) expect([value, normalizeEmail(value)]).toEqual([value, null]);
    const good = ["a@example.com", "a.b.c@sub.example.co", "a+tag@example.com", "o'neil@example.com", "x_y-z@ex-ample.io", "1@123.com", `${"a".repeat(64)}@example.com`];
    for (const value of good) expect(normalizeEmail(value)).toBe(value);
  });
});
