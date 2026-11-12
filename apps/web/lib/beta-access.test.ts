import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { accessRef, applyAccessAction, MAX_PENDING_REQUESTS, readAccessStore, recordAccessRequest, toPublicEntries } from "./beta-access-store";
import { isAccountAllowedNow, isBetaAccessEnforced, isBetaAdmin, isSessionStillAllowed } from "./beta-access";

const SECRET = "ref-" + "credential-for-tests-only-0123456789abcdef";
const OWNER = 1001;
const FRIEND = 2002;
const STRANGER = 3003;
let dir = "";
let file = "";

function env(extra: Record<string, string> = {}): Record<string, string> {
  return { BETA_ALLOWED_STEAM_IDS: String(OWNER), BETA_ADMIN_STEAM_IDS: String(OWNER), BETA_ACCESS_FILE: file, ...extra };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-access-"));
  file = join(dir, "beta-access.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("pedidos y aprobación desde la web", () => {
  test("un desconocido queda como pedido pendiente, NO admitido; al aprobarlo entra", () => {
    expect(isAccountAllowedNow(FRIEND, env())).toBe(false);
    expect(recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 })).toBe(true);
    expect(isAccountAllowedNow(FRIEND, env())).toBe(false);
    const ref = accessRef(FRIEND, SECRET);
    expect(applyAccessAction(file, "approve", ref, SECRET, 5)).toBe(true);
    expect(isAccountAllowedNow(FRIEND, env())).toBe(true);
    expect(readAccessStore(file).requests).toEqual([]);
  });

  test("rechazar quita el pedido sin admitir; retirar la invitación revoca el acceso", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    expect(applyAccessAction(file, "reject", accessRef(FRIEND, SECRET), SECRET, 2)).toBe(true);
    expect(isAccountAllowedNow(FRIEND, env())).toBe(false);
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 3 });
    applyAccessAction(file, "approve", accessRef(FRIEND, SECRET), SECRET, 4);
    expect(applyAccessAction(file, "revoke", accessRef(FRIEND, SECRET), SECRET, 5)).toBe(true);
    expect(isAccountAllowedNow(FRIEND, env())).toBe(false);
  });

  test("una referencia desconocida no hace nada (no se puede aprobar a un tercero que no pidió acceso)", () => {
    expect(applyAccessAction(file, "approve", accessRef(STRANGER, SECRET), SECRET, 1)).toBe(false);
    expect(isAccountAllowedNow(STRANGER, env())).toBe(false);
  });

  test("la interfaz solo recibe nombre, avatar y una referencia opaca: nunca el Steam32", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    const publicEntries = toPublicEntries(readAccessStore(file).requests, SECRET);
    expect(JSON.stringify(publicEntries)).not.toContain(String(FRIEND));
    expect(publicEntries[0]?.ref).toMatch(/^[0-9a-f]{16}$/);
  });

  test("pedir dos veces no duplica; la lista de pedidos tiene tope", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 2 });
    expect(readAccessStore(file).requests).toHaveLength(1);
    for (let id = 10; id < 10 + MAX_PENDING_REQUESTS; id += 1) recordAccessRequest(file, { steam32: id, personaName: "x", avatarUrl: null, at: 1 });
    expect(readAccessStore(file).requests.length).toBeLessThanOrEqual(MAX_PENDING_REQUESTS);
    expect(recordAccessRequest(file, { steam32: 999_999, personaName: "x", avatarUrl: null, at: 1 })).toBe(true); // cola FIFO: nunca se rechaza un pedido nuevo
  });
});

describe("control de acceso: nadie se vuelve administrador", () => {
  test("solo BETA_ADMIN_STEAM_IDS administra; un invitado aprobado NO es administrador", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    applyAccessAction(file, "approve", accessRef(FRIEND, SECRET), SECRET, 2);
    expect(isBetaAdmin(OWNER, env())).toBe(true);
    expect(isBetaAdmin(FRIEND, env())).toBe(false);
    expect(isBetaAdmin(STRANGER, env())).toBe(false);
  });

  test("sin BETA_ADMIN_STEAM_IDS o mal formada, no hay administradores (falla cerrado)", () => {
    expect(isBetaAdmin(OWNER, { ...env(), BETA_ADMIN_STEAM_IDS: "" })).toBe(false);
    expect(isBetaAdmin(OWNER, { ...env(), BETA_ADMIN_STEAM_IDS: `${OWNER},abc` })).toBe(false);
  });

  test("la lista fija sigue mandando; una lista fija mal formada no admite a nadie por esa vía", () => {
    expect(isAccountAllowedNow(OWNER, env())).toBe(true);
    expect(isAccountAllowedNow(OWNER, env({ BETA_ALLOWED_STEAM_IDS: `${OWNER},xx`, BETA_ADMIN_STEAM_IDS: "" }))).toBe(false);
  });

  test("el administrador entra aunque no esté en la lista fija", () => {
    expect(isAccountAllowedNow(OWNER, env({ BETA_ALLOWED_STEAM_IDS: "77" }))).toBe(true);
  });

  test("archivo corrupto o ausente = nadie invitado, sin lanzar", () => {
    writeFileSync(file, "{ esto no es json");
    expect(isAccountAllowedNow(FRIEND, env())).toBe(false);
    rmSync(file);
    expect(isAccountAllowedNow(FRIEND, env())).toBe(false);
    writeFileSync(file, JSON.stringify({ version: 1, invited: [{ steam32: -5, personaName: "x", avatarUrl: null, at: 1 }, "basura"], requests: [] }));
    expect(readAccessStore(file).invited).toEqual([]);
  });

  test("el archivo se escribe completo (sin restos temporales) y se hace cumplir solo donde hay beta configurada", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    expect(JSON.parse(readFileSync(file, "utf8")).version).toBe(1);
    expect(isBetaAccessEnforced(env())).toBe(true);
    expect(isBetaAccessEnforced({})).toBe(false);
  });
});

describe("endurecimiento tras la revisión adversarial", () => {
  test("un archivo ilegible NO se sobrescribe: ni un pedido nuevo ni una aprobación borran las invitaciones", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    applyAccessAction(file, "approve", accessRef(FRIEND, SECRET), SECRET, 2);
    const before = readFileSync(file, "utf8");
    writeFileSync(file, "{ corrupto");
    expect(() => recordAccessRequest(file, { steam32: STRANGER, personaName: "Otro", avatarUrl: null, at: 3 })).toThrow();
    expect(() => applyAccessAction(file, "reject", accessRef(STRANGER, SECRET), SECRET, 4)).toThrow();
    expect(readFileSync(file, "utf8")).toBe("{ corrupto");
    writeFileSync(file, before);
    expect(isAccountAllowedNow(FRIEND, env())).toBe(true);
  });

  test("con la lista llena se descarta el pedido más antiguo: un pedido nuevo siempre queda registrado", () => {
    for (let id = 10; id < 10 + MAX_PENDING_REQUESTS; id += 1) recordAccessRequest(file, { steam32: id, personaName: "x", avatarUrl: null, at: id });
    expect(recordAccessRequest(file, { steam32: 999_999, personaName: "Legítimo", avatarUrl: null, at: 5_000 })).toBe(true);
    const requests = readAccessStore(file).requests;
    expect(requests).toHaveLength(MAX_PENDING_REQUESTS);
    expect(requests.some((entry) => entry.steam32 === 999_999)).toBe(true);
    expect(requests.some((entry) => entry.steam32 === 10)).toBe(false);
  });

  test("la lista fija mal escrita apaga a todos (también admins e invitados) hasta corregirla", () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    applyAccessAction(file, "approve", accessRef(FRIEND, SECRET), SECRET, 2);
    const broken = env({ BETA_ALLOWED_STEAM_IDS: `${OWNER},xx` });
    expect(isAccountAllowedNow(OWNER, broken)).toBe(false);
    expect(isAccountAllowedNow(FRIEND, broken)).toBe(false);
  });

  test("una sesión de una cuenta retirada ya no sirve para las rutas /api/auth/*", () => {
    expect(isSessionStillAllowed(OWNER, env())).toBe(true);
    expect(isSessionStillAllowed(STRANGER, env())).toBe(false);
    expect(isSessionStillAllowed(STRANGER, {})).toBe(true); // sin beta configurada (desarrollo/E2E) no se bloquea
  });
});
