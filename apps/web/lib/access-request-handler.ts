import { accessStatusOf, betaAccessFilePath, MAX_REQUEST_MESSAGE, MIN_REQUEST_MESSAGE, submitAccessRequest, type AccessStatus, type SubmitResult } from "./beta-access-store";
import { createRateLimiter, clientKey, type RateLimiter } from "./rate-limit";
import type { AccessRequestData } from "./access-request-session";

// «Pedir acceso» a la beta: la persona ya probó con Steam quién es (cookie sellada); aquí solo escribe «¿Quién eres y de dónde nos conoces?».
// La identidad sale EXCLUSIVAMENTE de esa cookie: el cuerpo no puede traer cuenta, nombre ni avatar. Anti-spam: un pedido pendiente por cuenta,
// enfriamiento tras un rechazo, límite por IP y por cuenta, campo trampa invisible y mensaje con largo acotado.

export interface AccessRequestDependencies {
  /** Datos de la cookie sellada del último inicio de sesión de Steam, o null. */
  readNotice: () => Promise<AccessRequestData | null>;
  env: Record<string, string | undefined>;
  publicOrigin: string | null;
  now: () => number;
  /** Para pruebas: límites propios en lugar de los del proceso. */
  ipLimiter?: RateLimiter;
  accountLimiter?: RateLimiter;
  /** ¿Esa cuenta ya entra por cualquier vía (lista fija, administrador o invitación)? */
  isAllowedNow?: (accountId: number) => boolean;
}

const sharedIpLimiter = createRateLimiter(8, 10 * 60 * 1000);
const sharedAccountLimiter = createRateLimiter(5, 60 * 60 * 1000);

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** Quita caracteres de control (salvo saltos de línea), colapsa espacios y recorta. El texto se muestra siempre escapado por React. */
export function sanitizeRequestMessage(raw: string): string {
  return raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export function publicStatus(status: AccessStatus): { status: AccessStatus["kind"]; at?: number; message?: string | null } {
  if (status.kind === "pending") return { status: "pending", at: status.at, message: status.message };
  if (status.kind === "rejected") return { status: "rejected", at: status.at };
  return { status: status.kind };
}

export function createAccessRequestHandlers(dependencies: AccessRequestDependencies) {
  const ipLimiter = dependencies.ipLimiter ?? sharedIpLimiter;
  const accountLimiter = dependencies.accountLimiter ?? sharedAccountLimiter;
  const file = betaAccessFilePath(dependencies.env);
  return {
    /** Estado de MI solicitud (para la pantalla de espera). Sin identidad verificada no hay estado. */
    async GET(): Promise<Response> {
      const notice = await dependencies.readNotice();
      if (notice?.accountId === undefined) return json({ error: "unauthorized" }, 401);
      if (dependencies.isAllowedNow?.(notice.accountId) === true) return json({ status: "invited" });
      return json(publicStatus(accessStatusOf(file, notice.accountId)));
    },

    async POST(request: Request): Promise<Response> {
      const origin = request.headers.get("origin");
      if (dependencies.publicOrigin !== null && (origin === null || origin !== new URL(dependencies.publicOrigin).origin)) return json({ error: "forbidden" }, 403);
      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad_request" }, 400);

      const notice = await dependencies.readNotice();
      const accountId = notice?.accountId;
      if (notice === null || accountId === undefined) return json({ error: "unauthorized" }, 401);

      if (!ipLimiter.allow(clientKey(request.headers), dependencies.now())) return json({ error: "rate_limited" }, 429);
      if (!accountLimiter.allow(String(accountId), dependencies.now())) return json({ error: "rate_limited" }, 429);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad_request" }, 400);
      }
      const { message, website } = (typeof body === "object" && body !== null ? body : {}) as { message?: unknown; website?: unknown };
      // Campo trampa: un humano nunca lo ve ni lo llena. Se responde como si hubiera funcionado, sin registrar nada.
      if (typeof website === "string" && website.length > 0) return json({ status: "pending" });
      if (typeof message !== "string") return json({ error: "bad_request" }, 400);
      const clean = sanitizeRequestMessage(message);
      if (clean.length < MIN_REQUEST_MESSAGE) return json({ error: "message_too_short" }, 400);
      if (clean.length > MAX_REQUEST_MESSAGE) return json({ error: "message_too_long" }, 400);

      let result: SubmitResult;
      try {
        result = submitAccessRequest(file, {
          steam32: accountId,
          personaName: notice.personaName ?? "Jugador de Steam",
          avatarUrl: notice.avatarUrl ?? null,
          at: dependencies.now(),
          message: clean,
        }, dependencies.now());
      } catch {
        return json({ error: "unavailable" }, 503);
      }
      if (result === "cooldown") return json({ error: "cooldown" }, 429);
      if (result === "already_invited") return json({ status: "invited" });
      if (result === "already_pending") return json({ status: "pending", already: true });
      return json({ status: "pending" }, 201);
    },
  };
}
