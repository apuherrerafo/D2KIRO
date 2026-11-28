// Envío de los correos de la waitlist por la API HTTP de Resend, sin dependencia nueva. Sin las dos variables no hay remitente y el
// registro responde «no disponible» (falla cerrado). La clave vive solo en process.env y ningún error lleva el correo de la persona.

export interface WaitlistEmail {
  subject: string;
  text: string;
}

export interface OutgoingEmail extends WaitlistEmail {
  to: string;
  /** Evita duplicar un mismo correo si se reintenta (Resend la recuerda 24 h). */
  idempotencyKey?: string;
}

export interface WaitlistMailer {
  send(email: OutgoingEmail): Promise<void>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<Response>;

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export function createResendMailer(env: Record<string, string | undefined>, fetchImpl: FetchLike = fetch): WaitlistMailer | null {
  const apiKey = env.RESEND_API_KEY?.trim();
  const from = env.WAITLIST_EMAIL_FROM?.trim();
  if (!apiKey || !from || /[\r\n]/.test(from)) return null;
  return {
    async send({ to, subject, text, idempotencyKey }) {
      const headers: Record<string, string> = { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
      if (idempotencyKey !== undefined) headers["idempotency-key"] = idempotencyKey;
      const response = await fetchImpl(RESEND_URL, { method: "POST", headers, body: JSON.stringify({ from, to: [to], subject, text }), signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
      if (!response.ok) throw new Error(`waitlist_email_failed_${response.status}`);
    },
  };
}
