import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Invitaciones de la beta privada administradas desde la web. Un archivo JSON en el disco persistente (junto a la SQLite del motor):
// sin esquema nuevo, sin dependencia, sin SQL. Es dato PERSONAL (Steam32): nunca se registra en logs ni se devuelve a la interfaz — la
// interfaz solo ve nombre público, avatar y una referencia opaca (`accessRef`). Un archivo ausente o corrupto se lee como "vacío":
// nunca admite a nadie por error (la lista fija BETA_ALLOWED_STEAM_IDS sigue mandando).

const STEAM32_MAX = 4_294_967_295;
export const MAX_PENDING_REQUESTS = 100;
export const MAX_INVITED = 500;

export interface AccessEntry {
  steam32: number;
  personaName: string;
  avatarUrl: string | null;
  /** ms epoch del pedido (requests) o de la aprobación (invited). */
  at: number;
}

export interface AccessStore {
  version: 1;
  invited: AccessEntry[];
  requests: AccessEntry[];
}

export function emptyStore(): AccessStore {
  return { version: 1, invited: [], requests: [] };
}

export function betaAccessFilePath(env: Record<string, string | undefined>): string {
  if (env.BETA_ACCESS_FILE) return env.BETA_ACCESS_FILE;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return join(env.RAILWAY_VOLUME_MOUNT_PATH, "beta-access.json");
  return join(process.cwd(), "data", "beta-access.json");
}

function isEntry(value: unknown): value is AccessEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.steam32 === "number" && Number.isInteger(entry.steam32) && entry.steam32 >= 1 && entry.steam32 <= STEAM32_MAX
    && typeof entry.personaName === "string" && entry.personaName.length > 0 && entry.personaName.length <= 100
    && (entry.avatarUrl === null || typeof entry.avatarUrl === "string")
    && typeof entry.at === "number" && Number.isFinite(entry.at);
}

export function parseAccessStore(raw: string): AccessStore {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.invited) || !Array.isArray(data.requests)) return emptyStore();
    return { version: 1, invited: data.invited.filter(isEntry).slice(0, MAX_INVITED), requests: data.requests.filter(isEntry).slice(0, MAX_PENDING_REQUESTS) };
  } catch {
    return emptyStore();
  }
}

// Lectura con caché por fecha de modificación: el proxy la consulta en cada petición y el archivo casi nunca cambia.
// La clave incluye el tamaño: dos escrituras en el mismo milisegundo (otro módulo del servidor, p. ej. el proxy) casi nunca dejan el mismo tamaño.
const cache = new Map<string, { mtimeMs: number; size: number; store: AccessStore }>();

export function readAccessStore(path: string): AccessStore {
  try {
    const { mtimeMs, size } = statSync(path);
    const hit = cache.get(path);
    if (hit !== undefined && hit.mtimeMs === mtimeMs && hit.size === size) return hit.store;
    const store = parseAccessStore(readFileSync(path, "utf8"));
    cache.set(path, { mtimeMs, size, store });
    return store;
  } catch {
    cache.delete(path);
    return emptyStore();
  }
}

/**
 * Lectura para ESCRIBIR: solo un archivo ausente es «vacío». Si existe pero no se puede leer o no tiene la forma esperada, se lanza y la
 * escritura se niega: un error transitorio del disco jamás puede borrar las invitaciones aprobadas.
 */
function loadForWrite(path: string): AccessStore {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyStore();
    throw new Error("beta_access_store_unreadable");
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.invited) || !Array.isArray(data.requests)) throw new Error("shape");
  } catch {
    throw new Error("beta_access_store_unreadable");
  }
  return parseAccessStore(raw);
}

export function writeAccessStore(path: string, store: AccessStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  cache.delete(path);
}

/** Referencia opaca de una entrada: sirve de clave en pantalla sin exponer el Steam32. */
export function accessRef(steam32: number, secret: string): string {
  return createHash("sha256").update(`${steam32}:${secret}`).digest("hex").slice(0, 16);
}

export function isInvited(path: string, steam32: number): boolean {
  return readAccessStore(path).invited.some((entry) => entry.steam32 === steam32);
}

/**
 * Registra (o actualiza) el pedido de acceso de una cuenta ya verificada por Steam. Con la lista llena se descarta el pedido MÁS ANTIGUO
 * (cola FIFO): llenarla con cuentas desechables no puede impedir que un pedido nuevo quede registrado. Lanza si el archivo no se puede leer.
 */
export function recordAccessRequest(path: string, entry: AccessEntry): boolean {
  const store = loadForWrite(path);
  if (store.invited.some((item) => item.steam32 === entry.steam32)) return true;
  const others = store.requests.filter((item) => item.steam32 !== entry.steam32);
  const kept = others.length >= MAX_PENDING_REQUESTS ? [...others].sort((a, b) => a.at - b.at).slice(others.length - MAX_PENDING_REQUESTS + 1) : others;
  writeAccessStore(path, { ...store, requests: [...kept, entry] });
  return true;
}

export type AccessAction = "approve" | "reject" | "revoke";

/** Aprueba/rechaza un pedido o retira una invitación, siempre por referencia opaca. Devuelve false si la referencia no existe. */
export function applyAccessAction(path: string, action: AccessAction, ref: string, secret: string, now: number): boolean {
  const store = loadForWrite(path);
  if (action === "revoke") {
    const target = store.invited.find((entry) => accessRef(entry.steam32, secret) === ref);
    if (target === undefined) return false;
    writeAccessStore(path, { ...store, invited: store.invited.filter((entry) => entry !== target) });
    return true;
  }
  const target = store.requests.find((entry) => accessRef(entry.steam32, secret) === ref);
  if (target === undefined) return false;
  const requests = store.requests.filter((entry) => entry !== target);
  if (action === "reject") {
    writeAccessStore(path, { ...store, requests });
    return true;
  }
  if (store.invited.length >= MAX_INVITED) return false;
  writeAccessStore(path, { ...store, requests, invited: [...store.invited.filter((entry) => entry.steam32 !== target.steam32), { ...target, at: now }] });
  return true;
}

export interface PublicAccessEntry {
  ref: string;
  personaName: string;
  avatarUrl: string | null;
  at: number;
}

export function toPublicEntries(entries: readonly AccessEntry[], secret: string): PublicAccessEntry[] {
  return entries.map((entry) => ({ ref: accessRef(entry.steam32, secret), personaName: entry.personaName, avatarUrl: entry.avatarUrl, at: entry.at }));
}
