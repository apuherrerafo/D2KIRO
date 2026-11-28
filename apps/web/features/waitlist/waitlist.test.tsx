import "@/test-support/happy-dom";

import { cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { WaitlistConfirmPanel, WaitlistSignupPanel } from ".";
import { CONFIRM_COPY, CONFIRM_ERRORS, SIGNUP_COPY, SIGNUP_ERRORS } from "./constants";

const originalFetch = globalThis.fetch;
let calls: Array<{ url: string; body: unknown }> = [];
let reply: () => Response = () => new Response("{}", { status: 500 });

beforeEach(() => {
  calls = [];
  globalThis.fetch = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return reply();
  }) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.location.hash = "";
});

describe("registro en pantalla", () => {
  it("envía el correo y pide revisar la bandeja", async () => {
    reply = () => Response.json({ status: "check_inbox" }, { status: 202 });
    const user = userEvent.setup({ document: window.document });
    const screen = render(<WaitlistSignupPanel />);
    await user.type(screen.getByTestId("waitlist-email"), "fan@example.com");
    await user.click(screen.getByTestId("waitlist-submit"));
    await waitFor(() => expect(screen.getByTestId("waitlist-signup-done").textContent).toContain(SIGNUP_COPY.doneTitle));
    expect(calls).toEqual([{ url: "/api/waitlist", body: { email: "fan@example.com", website: "" } }]);
  });

  for (const failure of ["busy", "full", "rate_limited"] as const) {
    it(`un registro no aceptado (${failure}) no dice «revisa tu correo»`, async () => {
      reply = () => Response.json({ error: failure }, { status: failure === "rate_limited" ? 429 : 503 });
      const user = userEvent.setup({ document: window.document });
      const screen = render(<WaitlistSignupPanel />);
      await user.type(screen.getByTestId("waitlist-email"), "fan@example.com");
      await user.click(screen.getByTestId("waitlist-submit"));
      await waitFor(() => expect(screen.getByTestId("waitlist-signup-error").textContent).toContain(SIGNUP_ERRORS[failure]));
      expect(screen.queryByTestId("waitlist-signup-done")).toBeNull();
    });
  }

  it("muestra cada error y deja reintentar", async () => {
    reply = () => Response.json({ error: "unavailable" }, { status: 503 });
    const user = userEvent.setup({ document: window.document });
    const screen = render(<WaitlistSignupPanel />);
    await user.type(screen.getByTestId("waitlist-email"), "fan@example.com");
    await user.click(screen.getByTestId("waitlist-submit"));
    await waitFor(() => expect(screen.getByTestId("waitlist-signup-error").textContent).toContain(SIGNUP_ERRORS.unavailable));
    expect((screen.getByTestId("waitlist-submit") as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("confirmación en pantalla", () => {
  it("abrir el enlace no lo gasta; al pulsar manda el token del fragmento y lo borra de la dirección", async () => {
    reply = () => Response.json({ status: "waitlisted", welcomeEmail: "sent" });
    window.location.hash = `#token=${"b".repeat(43)}`;
    const user = userEvent.setup({ document: window.document });
    const screen = render(<WaitlistConfirmPanel />);
    expect(calls).toEqual([]);
    await user.click(screen.getByTestId("waitlist-confirm"));
    await waitFor(() => expect(screen.getByTestId("waitlist-confirm-done").textContent).toContain(CONFIRM_COPY.doneAccess));
    expect(calls).toEqual([{ url: "/api/waitlist/confirm", body: { token: "b".repeat(43) } }]);
    expect(window.location.hash).toBe("");
  });

  it("un enlace vencido se explica y ofrece volver a la waitlist", async () => {
    reply = () => Response.json({ error: "expired_link" }, { status: 410 });
    const user = userEvent.setup({ document: window.document });
    const screen = render(<WaitlistConfirmPanel />);
    await user.click(screen.getByTestId("waitlist-confirm"));
    await waitFor(() => expect(screen.getByTestId("waitlist-confirm-error").textContent).toContain(CONFIRM_ERRORS.expired_link));
    expect(screen.getByTestId("waitlist-confirm-error").querySelector('a[href="/waitlist"]')).not.toBeNull();
  });
});
