import { applyAccessAction, betaAccessFilePath, readAccessStore, toPublicEntries, type AccessAction } from "./beta-access-store";
import { isBetaAdmin } from "./beta-access";
import { parseBetaAllowedSteamIds } from "./beta-allowlist";

// Administración de invitados de la beta: lista de pedidos pendientes, invitados y aprobar / rechazar / retirar.
// Solo la cuenta que figura en BETA_ADMIN_STEAM_IDS puede usarla (el resto recibe 403, incluidos los invitados aprobados).
// Responde nombre, avatar y una referencia opaca: jamás un Steam32.

export interface BetaAdminDependencies {
  /** Steam32 de la sesión válida, o null si no hay sesión. */
  accountId: () => Promise<number | null>;
  env: Record<string, string | undefined>;
  /** Origen público del sitio (el enlace que se comparte con los amigos). */
  publicOrigin: string | null;
  now: () => number;
}

const ACTIONS: ReadonlySet<string> = new Set<AccessAction>(["approve", "reject", "revoke"]);
const REF_PATTERN = /^[0-9a-f]{16}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

async function authorizedAdmin(dependencies: BetaAdminDependencies): Promise<Response | null> {
  const accountId = await dependencies.accountId();
  if (accountId === null) return json({ error: "unauthorized" }, 401);
  if (!isBetaAdmin(accountId, dependencies.env)) return json({ error: "forbidden" }, 403);
  return null;
}

function refSecret(env: Record<string, string | undefined>): string | null {
  const secret = env.SESSION_SECRET;
  return typeof secret === "string" && secret.length >= 32 ? secret : null;
}

export function createBetaAdminHandlers(dependencies: BetaAdminDependencies) {
  const { env } = dependencies;
  return {
    async GET(): Promise<Response> {
      const denied = await authorizedAdmin(dependencies);
      if (denied !== null) return denied;
      const secret = refSecret(env);
      if (secret === null) return json({ error: "unavailable" }, 503);
      const store = readAccessStore(betaAccessFilePath(env));
      return json({
        shareUrl: dependencies.publicOrigin,
        requests: toPublicEntries(store.requests, secret),
        invited: toPublicEntries(store.invited, secret),
        fixedCount: parseBetaAllowedSteamIds(env.BETA_ALLOWED_STEAM_IDS).validIds.size,
      });
    },

    async POST(request: Request): Promise<Response> {
      const denied = await authorizedAdmin(dependencies);
      if (denied !== null) return denied;
      // Acción de la propia pantalla: mismo origen y JSON (un formulario de otro sitio no puede mandar esto).
      const origin = request.headers.get("origin");
      if (dependencies.publicOrigin !== null && origin !== null && origin !== new URL(dependencies.publicOrigin).origin) return json({ error: "forbidden" }, 403);
      if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad_request" }, 400);
      const secret = refSecret(env);
      if (secret === null) return json({ error: "unavailable" }, 503);
      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return json({ error: "bad_request" }, 400);
      }
      const { action, ref } = (typeof body === "object" && body !== null ? body : {}) as { action?: unknown; ref?: unknown };
      if (typeof action !== "string" || !ACTIONS.has(action) || typeof ref !== "string" || !REF_PATTERN.test(ref)) return json({ error: "bad_request" }, 400);
      const done = applyAccessAction(betaAccessFilePath(env), action as AccessAction, ref, secret, dependencies.now());
      return done ? json({ ok: true }) : json({ error: "not_found" }, 404);
    },
  };
}
