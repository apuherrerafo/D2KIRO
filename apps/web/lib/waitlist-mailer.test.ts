import { describe, expect, test } from "bun:test";
import { createResendMailer } from "./waitlist-mailer";

// El proveedor es un doble: ninguna prueba toca la red.
const ENV = { RESEND_API_KEY: "test-" + "provider-credential", WAITLIST_EMAIL_FROM: "D2KIRO <hello@example.com>" };
const EMAIL = { to: "player@example.com", subject: "S", text: "T" };

describe("remitente de la waitlist", () => {
  test("sin clave, sin remitente o con salto de línea no hay remitente", () => {
    expect(createResendMailer({})).toBeNull();
    expect(createResendMailer({ ...ENV, RESEND_API_KEY: " " })).toBeNull();
    expect(createResendMailer({ ...ENV, WAITLIST_EMAIL_FROM: undefined })).toBeNull();
    expect(createResendMailer({ ...ENV, WAITLIST_EMAIL_FROM: "a@example.com\r\nBcc: b@example.com" })).toBeNull();
  });

  test("llama a la API con la clave en la cabecera y la llave de idempotencia cuando se pide", async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: unknown }> = [];
    const mailer = createResendMailer(ENV, async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return new Response("{}", { status: 200 });
    });
    await mailer?.send({ ...EMAIL, idempotencyKey: "waitlist-welcome/1" });
    await mailer?.send(EMAIL);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(calls[0].headers.authorization).toBe(`Bearer ${ENV.RESEND_API_KEY}`);
    expect(calls[0].headers["idempotency-key"]).toBe("waitlist-welcome/1");
    expect(calls[1].headers["idempotency-key"]).toBeUndefined();
    expect(calls[0].body).toEqual({ from: ENV.WAITLIST_EMAIL_FROM, to: [EMAIL.to], subject: "S", text: "T" });
  });

  test("un rechazo del proveedor lanza sin filtrar el correo ni la clave", async () => {
    const mailer = createResendMailer(ENV, async () => new Response(EMAIL.to, { status: 422 }));
    const error = await mailer?.send(EMAIL).then(() => null, (reason: Error) => reason);
    expect(error?.message).toBe("waitlist_email_failed_422");
  });
});
