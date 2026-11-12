import { isBetaAdmin } from "./beta-access";
import { imageUrl } from "./feedback-handler";
import {
  authorRef, feedbackFilePath, FEEDBACK_STATUSES, FEEDBACK_TYPES, readFeedbackStore, setFeedbackStatus,
  type FeedbackRecord, type FeedbackStatus, type FeedbackType,
} from "./feedback-store";

// Bandeja del administrador: lista con filtros, cambio de estado y exportación JSON/CSV para revisar con una IA.
// Solo BETA_ADMIN_STEAM_IDS. Ninguna respuesta lleva el Steam32 ni el nombre de Steam del autor: solo una referencia opaca estable.

export interface FeedbackAdminDependencies {
  accountId: () => Promise<number | null>;
  env: Record<string, string | undefined>;
  publicOrigin: string | null;
  now: () => number;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function secretOf(env: Record<string, string | undefined>): string | null {
  const secret = env.SESSION_SECRET;
  return typeof secret === "string" && secret.length >= 32 ? secret : null;
}

export interface AdminFeedbackItem {
  id: string;
  createdAt: number;
  type: FeedbackType;
  status: FeedbackStatus;
  statusAt: number;
  message: string;
  route: string;
  appVersion: string;
  viewport: string;
  language: string;
  userAgent: string;
  authorRef: string;
  images: Array<{ url: string; mime: string; bytes: number }>;
}

export function toAdminItem(record: FeedbackRecord, secret: string): AdminFeedbackItem {
  return {
    id: record.id,
    createdAt: record.createdAt,
    type: record.type,
    status: record.status,
    statusAt: record.statusAt,
    message: record.message,
    route: record.route,
    appVersion: record.appVersion,
    viewport: record.context.viewport,
    language: record.context.language,
    userAgent: record.context.userAgent,
    authorRef: authorRef(record.author, secret),
    images: record.images.map((image, index) => ({ url: imageUrl(record.id, index), mime: image.mime, bytes: image.bytes })),
  };
}

function filtered(records: readonly FeedbackRecord[], url: URL): FeedbackRecord[] {
  const type = url.searchParams.get("type");
  const status = url.searchParams.get("status");
  return records
    .filter((record) => type === null || type === "" || record.type === type)
    .filter((record) => status === null || status === "" || record.status === status)
    .sort((a, b) => b.createdAt - a.createdAt);
}

/** Neutraliza la «inyección de fórmulas» de las hojas de cálculo: una celda que empieza con = + - @ se escribiría como fórmula. */
export function csvCell(value: string | number): string {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS = ["id", "createdAt", "type", "status", "message", "route", "appVersion", "viewport", "language", "userAgent", "authorRef", "images"] as const;

export function toCsv(items: readonly AdminFeedbackItem[]): string {
  const rows = items.map((item) => [
    item.id, new Date(item.createdAt).toISOString(), item.type, item.status, item.message, item.route, item.appVersion, item.viewport, item.language, item.userAgent, item.authorRef,
    item.images.map((image) => image.url).join(" "),
  ].map(csvCell).join(","));
  return `${CSV_COLUMNS.join(",")}\n${rows.join("\n")}\n`;
}

export function createFeedbackAdminHandlers(dependencies: FeedbackAdminDependencies) {
  const file = feedbackFilePath(dependencies.env);

  async function denied(): Promise<Response | null> {
    const accountId = await dependencies.accountId();
    if (accountId === null) return json({ error: "unauthorized" }, 401);
    if (!isBetaAdmin(accountId, dependencies.env)) return json({ error: "forbidden" }, 403);
    return null;
  }

  return {
    async GET(request: Request): Promise<Response> {
      const refusal = await denied();
      if (refusal !== null) return refusal;
      const secret = secretOf(dependencies.env);
      if (secret === null) return json({ error: "unavailable" }, 503);
      const all = readFeedbackStore(file).items;
      const items = filtered(all, new URL(request.url)).map((record) => toAdminItem(record, secret));
      return json({ items, total: all.length, pending: all.filter((record) => record.status === "pendiente").length });
    },

    async POST(request: Request): Promise<Response> {
      const refusal = await denied();
      if (refusal !== null) return refusal;
      const origin = request.headers.get("origin");
      if (dependencies.publicOrigin !== null && (origin === null || origin !== new URL(dependencies.publicOrigin).origin)) return json({ error: "forbidden" }, 403);
      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad_request" }, 400);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad_request" }, 400);
      }
      const { id, status } = (typeof body === "object" && body !== null ? body : {}) as { id?: unknown; status?: unknown };
      if (typeof id !== "string" || !/^[0-9a-f-]{36}$/.test(id) || typeof status !== "string" || !(FEEDBACK_STATUSES as readonly string[]).includes(status)) return json({ error: "bad_request" }, 400);
      try {
        return setFeedbackStatus(file, id, status as FeedbackStatus, dependencies.now()) ? json({ ok: true }) : json({ error: "not_found" }, 404);
      } catch {
        return json({ error: "unavailable" }, 503);
      }
    },

    async EXPORT(request: Request): Promise<Response> {
      const refusal = await denied();
      if (refusal !== null) return refusal;
      const secret = secretOf(dependencies.env);
      if (secret === null) return json({ error: "unavailable" }, 503);
      const url = new URL(request.url);
      const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
      const items = filtered(readFeedbackStore(file).items, url).map((record) => toAdminItem(record, secret));
      const stamp = new Date(dependencies.now()).toISOString().slice(0, 10);
      const headers = { "cache-control": "no-store", "content-disposition": `attachment; filename="d2kiro-feedback-${stamp}.${format}"`, "x-content-type-options": "nosniff" };
      if (format === "csv") return new Response(toCsv(items), { status: 200, headers: { ...headers, "content-type": "text/csv; charset=utf-8" } });
      const payload = {
        exportedAt: new Date(dependencies.now()).toISOString(),
        note: "Sin Steam32 ni nombres de Steam: authorRef es una referencia opaca. Las imágenes son privadas; las rutas requieren sesión de administrador. El texto lo escribió cada persona y puede contener datos personales: no lo publiques.",
        types: FEEDBACK_TYPES,
        items,
      };
      return new Response(JSON.stringify(payload, null, 2), { status: 200, headers: { ...headers, "content-type": "application/json; charset=utf-8" } });
    },
  };
}
