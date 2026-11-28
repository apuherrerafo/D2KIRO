import { createRateLimiter, clientKey, type RateLimiter } from "./rate-limit";
import { alreadyListedEmail, verificationEmail, welcomeEmail } from "./waitlist-emails";
import type { OutgoingEmail, WaitlistMailer } from "./waitlist-mailer";
import { confirmToken, keepOnlyToken, markWelcomeSent, planSignup, releaseSend, waitlistFilePath, type ConfirmResult, type SignupPlan } from "./waitlist-store";

// Puertas públicas de la waitlist. Ninguna abre sesión, pone cookies ni toca la beta. La respuesta del registro es la misma exista o no
// el correo (no se puede preguntar quién está en la lista): por eso el correo sale sin que la respuesta lo espere y su resultado no
// la cambia. Un envío fallido libera el reintento y queda en el log (sin el correo); la pantalla dice qué hacer si no llega nada.

export interface WaitlistDependencies {
  env: Record<string, string | undefined>;
  publicOrigin: string | null;
  now: () => number;
  mailer: WaitlistMailer | null;
  /** Trabajo que sigue después de responder (el envío del registro). El servidor es un proceso de vida larga. */
  defer?: (task: () => Promise<void>) => void;
  mailboxLimiter?: RateLimiter;
  /** Para pruebas: límites propios en lugar de los del proceso. */
  ipLimiter?: RateLimiter;
  globalLimiter?: RateLimiter;
  confirmLimiter?: RateLimiter;
}

const sharedIpLimiter = createRateLimiter(5, 10 * 60 * 1000);
/** Tope total de registros por hora: acota el abuso del proveedor de correo aunque se falsee la IP. */
const sharedGlobalLimiter = createRateLimiter(100, 60 * 60 * 1000);
const sharedConfirmLimiter = createRateLimiter(20, 10 * 60 * 1000);
/** Tope por buzón real: los alias (`+algo`, puntos de Gmail) no multiplican los correos que recibe una persona. */
const sharedMailboxLimiter = createRateLimiter(5, 60 * 60 * 1000);

const MAX_BODY_CHARS = 2000;
const EMAIL_PATTERN = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]{1,64}@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function mailboxKey(email: string): string {
  const [local, domain] = email.split("@");
  const base = local.split("+")[0];
  if (domain === "gmail.com" || domain === "googlemail.com") return `${base.replaceAll(".", "")}@gmail.com`;
  return `${base}@${domain}`;
}

function runDetached(task: () => Promise<void>): void {
  void task();
}

/** Mismo origen y JSON (un formulario de otro sitio no puede mandar esto), con cuerpo acotado. */
async function readBody(request: Request, publicOrigin: string): Promise<Record<string, unknown> | Response> {
  if (request.headers.get("origin") !== new URL(publicOrigin).origin) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad_request" }, 400);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_CHARS * 4) return json({ error: "bad_request" }, 400);
  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ error: "bad_request" }, 400);
    const body = JSON.parse(raw) as unknown;
    if (typeof body === "object" && body !== null) return body as Record<string, unknown>;
  } catch {
    // cae al error de abajo
  }
  return json({ error: "bad_request" }, 400);
}

function emailFor(plan: Extract<SignupPlan, { id: string }>, to: string, origin: string): OutgoingEmail {
  // El token va en el fragmento: el navegador no lo envía al servidor, así que no queda en logs ni en el Referer.
  if (plan.kind === "verify") return { to, ...verificationEmail(`${new URL(origin).origin}/waitlist/confirm#token=${plan.token}`) };
  if (plan.kind === "welcome") return { to, ...welcomeEmail(), idempotencyKey: `waitlist-welcome/${plan.id}` };
  return { to, ...alreadyListedEmail() };
}

export function createWaitlistHandlers(dependencies: WaitlistDependencies) {
  const ipLimiter = dependencies.ipLimiter ?? sharedIpLimiter;
  const globalLimiter = dependencies.globalLimiter ?? sharedGlobalLimiter;
  const confirmLimiter = dependencies.confirmLimiter ?? sharedConfirmLimiter;
  const file = waitlistFilePath(dependencies.env);

  async function sendWelcome(path: string, id: string, to: string): Promise<boolean> {
    if (dependencies.mailer === null) return false;
    try {
      await dependencies.mailer.send(emailFor({ kind: "welcome", id }, to, dependencies.publicOrigin as string));
      markWelcomeSent(path, id, dependencies.now());
      return true;
    } catch {
      console.error("[waitlist] welcome email not sent");
      return false;
    }
  }

  async function deliver(path: string, mailer: WaitlistMailer, plan: Extract<SignupPlan, { id: string }>, email: OutgoingEmail, reservedAt: number): Promise<void> {
    try {
      await mailer.send(email);
      if (plan.kind === "verify") keepOnlyToken(path, plan.id, plan.token);
      if (plan.kind === "welcome") markWelcomeSent(path, plan.id, dependencies.now());
    } catch {
      console.error("[waitlist] signup email not sent");
      try {
        releaseSend(path, plan.id, reservedAt);
      } catch {
        // la reserva caduca sola con el enfriamiento
      }
    }
  }

  return {
    async signup(request: Request): Promise<Response> {
      const origin = dependencies.publicOrigin;
      if (origin === null) return json({ error: "unavailable" }, 503);
      const body = await readBody(request, origin);
      if (body instanceof Response) return body;
      // Campo trampa: un humano nunca lo ve ni lo llena. Se responde como si hubiera funcionado, sin registrar nada.
      if (typeof body.website === "string" && body.website.length > 0) return json({ status: "check_inbox" }, 202);
      const email = normalizeEmail(body.email);
      if (email === null) return json({ error: "invalid_email" }, 400);
      const { mailer } = dependencies;
      if (mailer === null || file === null) return json({ error: "not_open" }, 503);
      const now = dependencies.now();
      if (!ipLimiter.allow(clientKey(request.headers), now) || !globalLimiter.allow("all", now)) return json({ error: "rate_limited" }, 429);
      if (!(dependencies.mailboxLimiter ?? sharedMailboxLimiter).allow(mailboxKey(email), now)) return json({ status: "check_inbox" }, 202);

      let plan: SignupPlan;
      try {
        plan = planSignup(file, email, now);
      } catch {
        console.error("[waitlist] signup not stored");
        return json({ error: "unavailable" }, 503);
      }
      if (plan.kind === "full") console.error("[waitlist] list is full");
      if (plan.kind !== "full" && plan.kind !== "skip") {
        const pending = plan;
        const outgoing = emailFor(pending, email, origin);
        (dependencies.defer ?? runDetached)(() => deliver(file, mailer, pending, outgoing, now));
      }
      return json({ status: "check_inbox" }, 202);
    },

    async confirm(request: Request): Promise<Response> {
      const origin = dependencies.publicOrigin;
      if (origin === null || file === null) return json({ error: "unavailable" }, 503);
      const body = await readBody(request, origin);
      if (body instanceof Response) return body;
      const now = dependencies.now();
      if (!confirmLimiter.allow(clientKey(request.headers), now)) return json({ error: "rate_limited" }, 429);
      if (typeof body.token !== "string" || !TOKEN_PATTERN.test(body.token)) return json({ error: "invalid_link" }, 400);

      let result: ConfirmResult;
      try {
        result = confirmToken(file, body.token, now);
      } catch {
        console.error("[waitlist] confirmation not stored");
        return json({ error: "unavailable" }, 503);
      }
      if (result.kind === "expired") return json({ error: "expired_link" }, 410);
      if (result.kind === "invalid") return json({ error: "invalid_link" }, 400);
      const sent = await sendWelcome(file, result.id, result.email);
      return json({ status: "waitlisted", welcomeEmail: sent ? "sent" : "pending" });
    },
  };
}
