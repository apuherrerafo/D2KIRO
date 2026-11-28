import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Waitlist pública: un archivo JSON en el disco persistente, mismo patrón que las invitaciones de la beta (`beta-access-store.ts`):
// sin esquema nuevo, sin dependencia, sin SQL. El correo es dato PERSONAL: nunca se registra en logs. Del enlace de verificación solo se
// guarda el hash. Estar aquí (incluso verificado) NO da acceso a nada: el acceso al coach lo decide la sesión de Steam más la beta.
// Un solo proceso web y E/S síncrona sin `await` entre leer y escribir: cada operación es atómica.

export const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
export const SEND_COOLDOWN_MS = 10 * 60 * 1000;
export const MAX_SENDS_PER_DAY = 5;
export const MAX_ENTRIES = 5000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Un registro sin verificar se borra pasado este tiempo desde que venció su enlace: no se conserva el correo de quien nunca lo confirmó. */
export const UNVERIFIED_RETENTION_MS = 7 * DAY_MS;

export type WaitlistStatus = "pending_verification" | "waitlisted";

export interface VerificationToken {
  hash: string;
  expiresAt: number;
}

export interface WaitlistEntry {
  id: string;
  email: string;
  status: WaitlistStatus;
  createdAt: number;
  verifiedAt?: number;
  /** Enlaces vivos. Hay más de uno solo mientras no se confirme que el último correo salió: un reenvío fallido no mata el anterior. */
  tokens: VerificationToken[];
  /** Envíos de las últimas 24 h: de aquí salen el enfriamiento y el tope diario por correo. */
  sentAt: number[];
  welcomeSentAt?: number;
}

interface WaitlistFile {
  version: 1;
  entries: WaitlistEntry[];
}

type Env = Record<string, string | undefined>;

/** Ruta del archivo, o null si en producción no hay dónde guardarlo de forma persistente (falla cerrado). */
export function waitlistFilePath(env: Env): string | null {
  if (env.WAITLIST_FILE) return env.WAITLIST_FILE;
  if (env.RAILWAY_VOLUME_MOUNT_PATH) return join(env.RAILWAY_VOLUME_MOUNT_PATH, "waitlist.json");
  if (env.NODE_ENV === "production") return null;
  return join(process.cwd(), "data", "waitlist.json");
}

function isOptionalNumber(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isToken(value: unknown): value is VerificationToken {
  if (typeof value !== "object" || value === null) return false;
  const token = value as Record<string, unknown>;
  return typeof token.hash === "string" && typeof token.expiresAt === "number" && Number.isFinite(token.expiresAt);
}

function isEntry(value: unknown): value is WaitlistEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.id === "string" && typeof entry.email === "string" && entry.email.length <= 254
    && (entry.status === "pending_verification" || entry.status === "waitlisted")
    && typeof entry.createdAt === "number" && Number.isFinite(entry.createdAt)
    && Array.isArray(entry.tokens) && entry.tokens.every(isToken)
    && isOptionalNumber(entry.verifiedAt) && isOptionalNumber(entry.welcomeSentAt)
    && Array.isArray(entry.sentAt) && entry.sentAt.every((at) => typeof at === "number" && Number.isFinite(at));
}

/** Solo un archivo ausente es «vacío». Uno ilegible o con otra forma lanza: nunca se pisan registros por un error de disco. */
function load(path: string): WaitlistEntry[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error("waitlist_store_unreadable");
  }
  try {
    const data = JSON.parse(raw) as Partial<WaitlistFile>;
    if (data.version === 1 && Array.isArray(data.entries) && data.entries.every(isEntry)) return data.entries;
  } catch {
    // cae al error de abajo
  }
  throw new Error("waitlist_store_unreadable");
}

function save(path: string, entries: WaitlistEntry[]): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify({ version: 1, entries } satisfies WaitlistFile), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Última actividad de un registro: el vencimiento más lejano de sus enlaces. */
function lastActivity(entry: WaitlistEntry): number {
  return Math.max(entry.createdAt, ...entry.tokens.map((token) => token.expiresAt));
}

function isAbandoned(entry: WaitlistEntry, now: number): boolean {
  return entry.status === "pending_verification" && now - lastActivity(entry) > UNVERIFIED_RETENTION_MS;
}

/** Hace sitio para un registro nuevo sacando el pendiente sin actividad hace más tiempo; null si la lista está llena de verificados. */
function makeRoom(entries: WaitlistEntry[]): WaitlistEntry[] | null {
  if (entries.length < MAX_ENTRIES) return entries;
  const oldest = entries.filter((entry) => entry.status === "pending_verification").sort((a, b) => lastActivity(a) - lastActivity(b))[0];
  if (oldest === undefined) return null;
  return entries.filter((entry) => entry !== oldest);
}

function canSend(sentAt: readonly number[], now: number): boolean {
  const recent = sentAt.filter((at) => now - at < DAY_MS);
  if (recent.length >= MAX_SENDS_PER_DAY) return false;
  return recent.every((at) => now - at >= SEND_COOLDOWN_MS);
}

/** Acota la lista sin perder el primero: tras un envío confirmado es el que sí llegó; los que se acumulan detrás pueden no haber salido. */
function trimTokens(tokens: VerificationToken[]): VerificationToken[] {
  if (tokens.length <= MAX_SENDS_PER_DAY) return tokens;
  return [tokens[0], ...tokens.slice(1 - MAX_SENDS_PER_DAY)];
}

export type SignupPlan =
  | { kind: "verify"; id: string; token: string }
  | { kind: "welcome"; id: string }
  | { kind: "already"; id: string }
  | { kind: "skip" }
  | { kind: "full" };

/**
 * Registra un correo YA normalizado y decide qué correo toca enviar, reservando ese envío. Un correo es una sola entrada:
 * pendiente → enlace nuevo (el anterior deja de servir cuando el nuevo sale); verificado → «ya estás en la lista» (o la bienvenida,
 * si no llegó a salir).
 */
export function planSignup(path: string, email: string, now: number): SignupPlan {
  const entries = load(path).filter((entry) => !isAbandoned(entry, now));
  const existing = entries.find((entry) => entry.email === email);
  if (existing !== undefined && !canSend(existing.sentAt, now)) return { kind: "skip" };

  const others = existing === undefined ? makeRoom(entries) : entries.filter((entry) => entry !== existing);
  if (others === null) return { kind: "full" };
  const base: WaitlistEntry = existing ?? { id: randomUUID(), email, status: "pending_verification", createdAt: now, tokens: [], sentAt: [] };
  const sentAt = [...base.sentAt.filter((at) => now - at < DAY_MS), now];

  if (base.status === "waitlisted") {
    save(path, [...others, { ...base, sentAt }]);
    if (base.welcomeSentAt === undefined) return { kind: "welcome", id: base.id };
    return { kind: "already", id: base.id };
  }

  const token = randomBytes(32).toString("base64url");
  const tokens = [...base.tokens.filter((item) => item.expiresAt > now), { hash: hashToken(token), expiresAt: now + TOKEN_TTL_MS }];
  save(path, [...others, { ...base, sentAt, tokens: trimTokens(tokens) }]);
  return { kind: "verify", id: base.id, token };
}

/** El correo con enlace salió: desde ahora solo sirve ese. */
export function keepOnlyToken(path: string, id: string, token: string): void {
  const hash = hashToken(token);
  save(path, load(path).map((entry) => {
    if (entry.id !== id || !entry.tokens.some((item) => item.hash === hash)) return entry;
    return { ...entry, tokens: entry.tokens.filter((item) => item.hash === hash) };
  }));
}

/** El envío falló: se libera la reserva para que la persona pueda reintentar enseguida. */
export function releaseSend(path: string, id: string, at: number): void {
  save(path, load(path).map((entry) => (entry.id === id ? { ...entry, sentAt: entry.sentAt.filter((sent) => sent !== at) } : entry)));
}

export type ConfirmResult = { kind: "verified"; id: string; email: string } | { kind: "expired" } | { kind: "invalid" };

/** Consume el enlace: sirve una sola vez y solo antes de vencer. */
export function confirmToken(path: string, token: string, now: number): ConfirmResult {
  const entries = load(path);
  const hash = hashToken(token);
  const target = entries.find((entry) => entry.status === "pending_verification" && entry.tokens.some((item) => item.hash === hash));
  const match = target?.tokens.find((item) => item.hash === hash);
  if (target === undefined || match === undefined) return { kind: "invalid" };
  if (now >= match.expiresAt) return { kind: "expired" };
  const verified: WaitlistEntry = { id: target.id, email: target.email, status: "waitlisted", createdAt: target.createdAt, verifiedAt: now, tokens: [], sentAt: [] };
  save(path, entries.map((entry) => (entry === target ? verified : entry)));
  return { kind: "verified", id: target.id, email: target.email };
}

export function markWelcomeSent(path: string, id: string, now: number): void {
  save(path, load(path).map((entry) => (entry.id === id ? { ...entry, welcomeSentAt: now } : entry)));
}

export interface VerifiedMember {
  id: string;
  email: string;
  verifiedAt: number;
}

/**
 * Único punto de enganche para el futuro D2KIRO LIVE: quién confirmó su correo. Solo servidor; ninguna ruta lo expone.
 * No es una admisión a la beta.
 */
export function verifiedWaitlistMembers(path: string): VerifiedMember[] {
  return load(path).flatMap((entry) => {
    if (entry.status !== "waitlisted" || entry.verifiedAt === undefined) return [];
    return [{ id: entry.id, email: entry.email, verifiedAt: entry.verifiedAt }];
  });
}
