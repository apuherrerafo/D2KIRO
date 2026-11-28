"use client";

import { useState, type ChangeEvent, type FormEvent } from "react";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { requestSignup } from "./api";
import { SIGNUP_COPY, SIGNUP_ERRORS } from "./constants";
import type { SignupFailure, SignupState } from "./types";

// <Dominio><Cosa>: el registro por correo. Tres estados visibles: formulario (con su error si lo hubo), enviando y «revisa tu correo».

function SignupFailed({ failure }: { failure: SignupFailure | null }) {
  if (failure === null) return null;
  return (
    <AppNotice tone="error" title={SIGNUP_COPY.failedTitle} testId="waitlist-signup-error">
      <p>{SIGNUP_ERRORS[failure]}</p>
    </AppNotice>
  );
}

function failureOf(state: SignupState): SignupFailure | null {
  if (state.kind !== "form") return null;
  return state.failure;
}

function submitLabel(sending: boolean): string {
  if (sending) return SIGNUP_COPY.busy;
  return SIGNUP_COPY.submit;
}

export function WaitlistSignupPanel() {
  const [state, setState] = useState<SignupState>({ kind: "form", failure: null });
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const sending = state.kind === "sending";

  async function send() {
    setState({ kind: "sending" });
    setState(await requestSignup(email, website));
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send();
  }
  function handleEmail(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
  }
  function handleWebsite(event: ChangeEvent<HTMLInputElement>) {
    setWebsite(event.target.value);
  }

  if (state.kind === "done") {
    return (
      <AppNotice tone="success" title={SIGNUP_COPY.doneTitle} testId="waitlist-signup-done">
        <p>{SIGNUP_COPY.done}</p>
      </AppNotice>
    );
  }

  return (
    <form className="ap-block" onSubmit={handleSubmit} noValidate data-testid="waitlist-signup-form">
      <label className="ap-field" htmlFor="waitlist-email">
        <span className="ap-h3">{SIGNUP_COPY.label}</span>
        <input
          id="waitlist-email"
          className="ap-input"
          type="email"
          name="email"
          autoComplete="email"
          maxLength={254}
          required
          value={email}
          onChange={handleEmail}
          disabled={sending}
          data-testid="waitlist-email"
        />
      </label>
      <div className="ap-trap" aria-hidden="true">
        <label>
          {SIGNUP_COPY.trap}
          <input type="text" name="d2k-extra" tabIndex={-1} autoComplete="off" value={website} onChange={handleWebsite} />
        </label>
      </div>
      <SignupFailed failure={failureOf(state)} />
      <button type="submit" className="ap-btn ap-btn--solid" disabled={sending || email.trim().length === 0} aria-busy={sending} data-testid="waitlist-submit">
        {submitLabel(sending)}
      </button>
      <p className="ap-hint">{SIGNUP_COPY.access}</p>
      <p className="ap-hint">{SIGNUP_COPY.privacy}</p>
    </form>
  );
}
