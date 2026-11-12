import { randomUUID } from "node:crypto";
import { isBetaAdmin } from "./beta-access";
import {
  appendFeedback, countRecentByAuthor, feedbackFilePath, FEEDBACK_TYPES, findFeedback, MAX_IMAGE_BYTES, MAX_IMAGES, MAX_MESSAGE_LENGTH, readFeedbackStore,
  type FeedbackImage, type FeedbackRecord, type FeedbackType, type ImageMime,
} from "./feedback-store";
import type { ObjectStorage } from "./object-storage";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

// Feedback universal de la beta: cualquier cuenta con sesión escribe un reporte (texto + hasta 3 capturas). La identidad sale SOLO de la
// sesión sellada. El contexto técnico que manda el navegador (ruta sin query, tamaño de ventana, idioma, navegador) se valida y recorta;
// la versión la pone el servidor. Nunca se aceptan ni se guardan cookies, cabeceras de autorización ni tokens.

export interface FeedbackSession {
  accountId: number;
  personaName: string;
}

export interface FeedbackDependencies {
  session: () => Promise<FeedbackSession | null>;
  env: Record<string, string | undefined>;
  publicOrigin: string | null;
  now: () => number;
  /** Almacén privado de imágenes, o null si no está configurado (entonces solo se aceptan reportes de texto). */
  storage: ObjectStorage | null;
  newId?: () => string;
  limiter?: RateLimiter;
}

const sharedLimiter = createRateLimiter(10, 60 * 60 * 1000);
const MAX_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_BYTES + 200_000;
const ROUTE_PATTERN = /^\/[A-Za-z0-9\-_/[\].]{0,150}$/;
const VIEWPORT_PATTERN = /^\d{2,5}x\d{2,5}$/;
const EXTENSION: Record<ImageMime, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Reconoce el formato por sus primeros bytes: el tipo que declara el navegador o la extensión del archivo no cuentan. */
export function detectImageMime(bytes: Uint8Array): ImageMime | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}

export function cleanText(raw: string, max: number): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/\n{4,}/g, "\n\n\n").trim().slice(0, max);
}

function singleLine(raw: string, max: number): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function appVersion(env: Record<string, string | undefined>): string {
  const sha = env.RAILWAY_GIT_COMMIT_SHA;
  return sha !== undefined && /^[0-9a-f]{40}$/.test(sha) ? sha.slice(0, 8) : "local";
}

export function imageUrl(id: string, index: number): string {
  return `/api/feedback/image/${id}/${index}`;
}

export interface PublicFeedback {
  id: string;
  createdAt: number;
  type: FeedbackType;
  status: FeedbackRecord["status"];
  message: string;
  route: string;
  images: Array<{ url: string; mime: ImageMime }>;
}

export function toPublicFeedback(record: FeedbackRecord): PublicFeedback {
  return {
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    status: record.status,
    message: record.message,
    route: record.route,
    images: record.images.map((image, index) => ({ url: imageUrl(record.id, index), mime: image.mime })),
  };
}

function sameOriginOk(request: Request, publicOrigin: string | null): boolean {
  if (publicOrigin === null) return true;
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(publicOrigin).origin;
}

interface ParsedReport {
  type: FeedbackType;
  message: string;
  route: string;
  viewport: string;
  language: string;
  userAgent: string;
  files: File[];
}

type ParseResult = { ok: true; report: ParsedReport } | { ok: false; status: number; error: string };

async function parseReport(request: Request): Promise<ParseResult> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { ok: false, status: 413, error: "too_large" };
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, status: 400, error: "bad_request" };
  }
  const type = form.get("type");
  const message = form.get("message");
  if (typeof type !== "string" || !(FEEDBACK_TYPES as readonly string[]).includes(type)) return { ok: false, status: 400, error: "bad_type" };
  if (typeof message !== "string") return { ok: false, status: 400, error: "bad_request" };
  const text = cleanText(message, MAX_MESSAGE_LENGTH + 1);
  if (text.length === 0) return { ok: false, status: 400, error: "message_required" };
  if (text.length > MAX_MESSAGE_LENGTH) return { ok: false, status: 400, error: "message_too_long" };
  const files = form.getAll("images").filter((entry): entry is File => typeof entry !== "string" && entry.size > 0);
  if (files.length > MAX_IMAGES) return { ok: false, status: 400, error: "too_many_images" };
  const routeRaw = form.get("route");
  const viewportRaw = form.get("viewport");
  return {
    ok: true,
    report: {
      type: type as FeedbackType,
      message: text,
      route: typeof routeRaw === "string" && ROUTE_PATTERN.test(routeRaw) ? routeRaw : "(desconocida)",
      viewport: typeof viewportRaw === "string" && VIEWPORT_PATTERN.test(viewportRaw) ? viewportRaw : "?",
      language: singleLine(typeof form.get("language") === "string" ? (form.get("language") as string) : "", 20) || "?",
      userAgent: singleLine(typeof form.get("userAgent") === "string" ? (form.get("userAgent") as string) : "", 200) || "?",
      files,
    },
  };
}

type PreparedImage = { mime: ImageMime; bytes: Uint8Array };

async function prepareImages(files: File[]): Promise<PreparedImage[] | { error: string; status: number }> {
  const prepared: PreparedImage[] = [];
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) return { error: "image_too_large", status: 413 };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const mime = detectImageMime(bytes);
    if (mime === null) return { error: "image_format", status: 415 };
    prepared.push({ mime, bytes });
  }
  return prepared;
}

export function createFeedbackHandlers(dependencies: FeedbackDependencies) {
  const limiter = dependencies.limiter ?? sharedLimiter;
  const file = feedbackFilePath(dependencies.env);
  const newId = dependencies.newId ?? randomUUID;

  return {
    /** Mis reportes (solo los míos, aunque yo sea administrador) y si las capturas están disponibles. */
    async GET(): Promise<Response> {
      const session = await dependencies.session();
      if (session === null) return json({ error: "unauthorized" }, 401);
      const mine = readFeedbackStore(file).items.filter((item) => item.author === session.accountId).slice(-30).reverse();
      return json({ imagesEnabled: dependencies.storage !== null, limits: { images: MAX_IMAGES, imageBytes: MAX_IMAGE_BYTES, message: MAX_MESSAGE_LENGTH }, items: mine.map(toPublicFeedback) });
    },

    async POST(request: Request): Promise<Response> {
      const session = await dependencies.session();
      if (session === null) return json({ error: "unauthorized" }, 401);
      if (!sameOriginOk(request, dependencies.publicOrigin)) return json({ error: "forbidden" }, 403);
      if (!limiter.allow(String(session.accountId), dependencies.now())) return json({ error: "rate_limited" }, 429);
      if (countRecentByAuthor(file, session.accountId, dependencies.now() - 60 * 60 * 1000) >= 30) return json({ error: "rate_limited" }, 429);

      const parsed = await parseReport(request);
      if (!parsed.ok) return json({ error: parsed.error }, parsed.status);
      const { report } = parsed;

      const images = await prepareImages(report.files);
      if (!Array.isArray(images)) return json({ error: images.error }, images.status);
      if (images.length > 0 && dependencies.storage === null) return json({ error: "images_unavailable" }, 503);

      const id = newId();
      const stored: FeedbackImage[] = [];
      try {
        for (const [index, image] of images.entries()) {
          const key = `feedback/${id}/${index}.${EXTENSION[image.mime]}`;
          await dependencies.storage!.put(key, image.bytes, image.mime);
          stored.push({ key, mime: image.mime, bytes: image.bytes.length });
        }
      } catch {
        await discard(dependencies.storage, stored);
        return json({ error: "image_upload_failed" }, 502);
      }

      const now = dependencies.now();
      const record: FeedbackRecord = {
        id,
        createdAt: now,
        type: report.type,
        status: "pendiente",
        statusAt: now,
        message: report.message,
        route: report.route,
        appVersion: appVersion(dependencies.env),
        context: { viewport: report.viewport, language: report.language, userAgent: report.userAgent },
        images: stored,
        author: session.accountId,
        authorName: singleLine(session.personaName, 100) || "Jugador de Steam",
      };
      try {
        appendFeedback(file, record);
      } catch {
        await discard(dependencies.storage, stored);
        return json({ error: "unavailable" }, 503);
      }
      return json({ ok: true, item: toPublicFeedback(record) }, 201);
    },

    /** Una captura: solo su autor o el administrador. Las capturas son privadas; nunca hay URL pública del bucket. */
    async IMAGE(id: string, indexRaw: string): Promise<Response> {
      const session = await dependencies.session();
      if (session === null) return json({ error: "unauthorized" }, 401);
      const index = Number(indexRaw);
      if (!/^[0-9a-f-]{36}$/.test(id) || !Number.isInteger(index) || index < 0 || index >= MAX_IMAGES) return json({ error: "not_found" }, 404);
      const record = findFeedback(file, id);
      if (record === null) return json({ error: "not_found" }, 404);
      if (record.author !== session.accountId && !isBetaAdmin(session.accountId, dependencies.env)) return json({ error: "not_found" }, 404);
      const image = record.images[index];
      if (image === undefined || dependencies.storage === null) return json({ error: "not_found" }, 404);
      try {
        const object = await dependencies.storage.get(image.key);
        if (object === null) return json({ error: "not_found" }, 404);
        return new Response(object.body as BodyInit, {
          status: 200,
          headers: { "content-type": image.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "content-disposition": "inline" },
        });
      } catch {
        return json({ error: "unavailable" }, 502);
      }
    },
  };
}

async function discard(storage: ObjectStorage | null, images: FeedbackImage[]): Promise<void> {
  if (storage === null) return;
  for (const image of images) {
    try {
      await storage.remove(image.key);
    } catch {
      // un objeto huérfano en el bucket privado es inofensivo; no se tapa el error original
    }
  }
}
