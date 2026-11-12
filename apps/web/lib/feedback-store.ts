import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { betaAccessFilePath } from "./beta-access-store";

// Mensajes de feedback de la beta. Un archivo JSON propio en el volumen persistente de Railway, SEPARADO de los datos estratégicos de V6
// (que viven en la SQLite del motor): una escritura aquí jamás toca el motor ni su base. Las imágenes NO viven aquí, solo su referencia
// (clave del objeto privado en el bucket S3/R2). El Steam32 del autor se guarda para poder aislar cuentas, pero nunca sale hacia la
// interfaz ni hacia las exportaciones: ahí aparece una referencia opaca (`authorRef`).

export const FEEDBACK_TYPES = ["problema", "idea", "sugerencia", "consulta"] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const FEEDBACK_STATUSES = ["pendiente", "en_revision", "resuelto"] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const IMAGE_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;
export type ImageMime = (typeof IMAGE_MIMES)[number];

export const MAX_FEEDBACK_ITEMS = 5000;
export const MAX_MESSAGE_LENGTH = 2000;
export const MAX_IMAGES = 3;
export const MAX_IMAGE_BYTES = 2_500_000;

const STEAM32_MAX = 4_294_967_295;

export interface FeedbackImage {
  key: string;
  mime: ImageMime;
  bytes: number;
}

export interface FeedbackContext {
  viewport: string;
  language: string;
  userAgent: string;
}

export interface FeedbackRecord {
  id: string;
  createdAt: number;
  type: FeedbackType;
  status: FeedbackStatus;
  statusAt: number;
  message: string;
  /** Ruta de la pantalla desde donde se escribió (sin query ni hash). */
  route: string;
  appVersion: string;
  context: FeedbackContext;
  images: FeedbackImage[];
  author: number;
  authorName: string;
}

export interface FeedbackStore {
  version: 1;
  items: FeedbackRecord[];
}

export function feedbackFilePath(env: Record<string, string | undefined>): string {
  if (env.FEEDBACK_FILE) return env.FEEDBACK_FILE;
  return join(dirname(betaAccessFilePath(env)), "feedback.json");
}

function isImage(value: unknown): value is FeedbackImage {
  if (typeof value !== "object" || value === null) return false;
  const image = value as Record<string, unknown>;
  return typeof image.key === "string" && /^feedback\/[0-9a-f-]{36}\/[0-9]\.(png|jpg|webp)$/.test(image.key)
    && typeof image.mime === "string" && (IMAGE_MIMES as readonly string[]).includes(image.mime)
    && typeof image.bytes === "number" && Number.isFinite(image.bytes);
}

function isRecord(value: unknown): value is FeedbackRecord {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  const context = item.context as Record<string, unknown> | undefined;
  return typeof item.id === "string" && /^[0-9a-f-]{36}$/.test(item.id)
    && typeof item.createdAt === "number" && Number.isFinite(item.createdAt)
    && typeof item.type === "string" && (FEEDBACK_TYPES as readonly string[]).includes(item.type)
    && typeof item.status === "string" && (FEEDBACK_STATUSES as readonly string[]).includes(item.status)
    && typeof item.statusAt === "number" && typeof item.message === "string" && item.message.length <= MAX_MESSAGE_LENGTH
    && typeof item.route === "string" && typeof item.appVersion === "string"
    && typeof context === "object" && context !== null && typeof context.viewport === "string" && typeof context.language === "string" && typeof context.userAgent === "string"
    && Array.isArray(item.images) && item.images.length <= MAX_IMAGES && item.images.every(isImage)
    && typeof item.author === "number" && Number.isInteger(item.author) && item.author >= 1 && item.author <= STEAM32_MAX
    && typeof item.authorName === "string";
}

export function parseFeedbackStore(raw: string): FeedbackStore {
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.items)) return { version: 1, items: [] };
    return { version: 1, items: data.items.filter(isRecord).slice(-MAX_FEEDBACK_ITEMS) };
  } catch {
    return { version: 1, items: [] };
  }
}

export function readFeedbackStore(path: string): FeedbackStore {
  try {
    return parseFeedbackStore(readFileSync(path, "utf8"));
  } catch {
    return { version: 1, items: [] };
  }
}

/** Para ESCRIBIR: solo un archivo ausente es «vacío». Si existe pero no se puede leer o no tiene forma válida, se lanza: jamás se pisan los mensajes. */
function loadForWrite(path: string): FeedbackStore {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, items: [] };
    throw new Error("feedback_store_unreadable");
  }
  try {
    const data = JSON.parse(raw) as Record<string, unknown>;
    if (data.version !== 1 || !Array.isArray(data.items)) throw new Error("shape");
  } catch {
    throw new Error("feedback_store_unreadable");
  }
  return parseFeedbackStore(raw);
}

function writeStore(path: string, store: FeedbackStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const backup = `${path}.bak-v1`;
  if (existsSync(path) && !existsSync(backup)) copyFileSync(path, backup);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(store), { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
}

/** Agrega un mensaje. La lectura-modificación-escritura es síncrona (sin `await` en medio): en un solo proceso no hay carreras. */
export function appendFeedback(path: string, record: FeedbackRecord): void {
  const store = loadForWrite(path);
  writeStore(path, { ...store, items: [...store.items, record].slice(-MAX_FEEDBACK_ITEMS) });
}

export function setFeedbackStatus(path: string, id: string, status: FeedbackStatus, now: number): boolean {
  const store = loadForWrite(path);
  const target = store.items.find((item) => item.id === id);
  if (target === undefined) return false;
  writeStore(path, { ...store, items: store.items.map((item) => (item === target ? { ...item, status, statusAt: now } : item)) });
  return true;
}

export function findFeedback(path: string, id: string): FeedbackRecord | null {
  return readFeedbackStore(path).items.find((item) => item.id === id) ?? null;
}

export function countRecentByAuthor(path: string, author: number, since: number): number {
  return readFeedbackStore(path).items.filter((item) => item.author === author && item.createdAt >= since).length;
}

/** Referencia opaca del autor: sirve para agrupar reportes de la misma persona sin exponer su Steam32. */
export function authorRef(steam32: number, secret: string): string {
  return createHash("sha256").update(`author:${steam32}:${secret}`).digest("hex").slice(0, 12);
}
