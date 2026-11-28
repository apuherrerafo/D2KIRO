import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { clientKeys, createSignupLimits, taggedMailboxKey, type SignupLimits } from "./waitlist-abuse";
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
  /** Para pruebas: límites propios en lugar de los del proceso. */
  limits?: SignupLimits;
  confirmLimiter?: RateLimiter;
}

const sharedSignupLimits = createSignupLimits();
const sharedConfirmLimiter = createRateLimiter(20, 10 * 60 * 1000);

const MAX_BODY_CHARS = 2000;
const MAX_BODY_BYTES = MAX_BODY_CHARS * 4;
/** Parte local: 1 a 64 caracteres, tramos separados por UN punto (ni al principio, ni al final, ni seguidos). */
const EMAIL_PATTERN = /^(?=[^@]{1,64}@)[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

function runDetached(task: () => Promise<void>): void {
  void task();
}

/** El cuerpo como texto, o null si pasa del tope: se deja de leer ahí, venga o no `content-length`. */
async function readBoundedText(request: Request): Promise<string | null> {
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks).toString("utf8");
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
}

/** Mismo origen y JSON (un formulario de otro sitio no puede mandar esto), con cuerpo acotado. */
async function readBody(request: Request, publicOrigin: string): Promise<Record<string, unknown> | Response> {
  if (request.headers.get("origin") !== new URL(publicOrigin).origin) return json({ error: "forbidden" }, 403);
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return json({ error: "bad_request" }, 400);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "bad_request" }, 400);
  try {
    const raw = await readBoundedText(request);
    if (raw === null || raw.length > MAX_BODY_CHARS) return json({ error: "bad_request" }, 400);
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
  const limits = dependencies.limits ?? sharedSignupLimits;
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

  /**
   * Por orden: quién pide, su red, las variantes del buzón y, solo para lo que pasó todo eso, el freno global. Ninguna negativa
   * depende de si el correo está inscrito, y ninguna guarda ni envía nada.
   */
  function limitRefusal(headers: Headers, email: string, now: number): Response | null {
    const { client, network } = clientKeys(headers);
    const tagged = taggedMailboxKey(email);
    if (!limits.client.allow(client, now) || !limits.network.allow(network, now)) return json({ error: "rate_limited" }, 429);
    if (tagged !== null && !limits.tagged.allow(tagged, now)) return json({ error: "rate_limited" }, 429);
    if (!limits.global.allow("all", now)) {
      console.error("[waitlist] global signup limit reached");
      return json({ error: "busy" }, 503);
    }
    return null;
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
      const refusal = limitRefusal(request.headers, email, now);
      if (refusal !== null) return refusal;

      let plan: SignupPlan;
      try {
        plan = planSignup(file, email, now);
      } catch {
        console.error("[waitlist] signup not stored");
        return json({ error: "unavailable" }, 503);
      }
      if (plan.kind === "full") {
        console.error("[waitlist] list is full");
        return json({ error: "full" }, 503);
      }
      if (plan.kind !== "skip") {
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
      if (!confirmLimiter.allow(clientKeys(request.headers).client, now)) return json({ error: "rate_limited" }, 429);
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
