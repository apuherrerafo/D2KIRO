"use client";

import { useState } from "react";
import { AppLink } from "@/components/app-shell/AppLink";
import { AppNotice } from "@/components/app-shell/AppNotice";
import { requestConfirmation } from "./api";
import { CONFIRM_COPY, CONFIRM_ERRORS } from "./constants";
import type { ConfirmFailure, ConfirmState } from "./types";

// <Dominio><Cosa>: la confirmación del correo. El token llega en el fragmento de la dirección y solo se usa cuando la persona
// pulsa el botón: abrir el enlace (como hacen los escáneres de correo) no lo gasta.

function tokenFromHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
}

function failureOf(state: ConfirmState): ConfirmFailure | null {
  if (state.kind !== "ready") return null;
  return state.failure;
}

function submitLabel(sending: boolean): string {
  if (sending) return CONFIRM_COPY.busy;
  return CONFIRM_COPY.submit;
}

function welcomeLine(welcomeSent: boolean): string {
  if (welcomeSent) return CONFIRM_COPY.doneSent;
  return CONFIRM_COPY.donePending;
}

function SignupLink() {
  return (
    <div className="ap-notice-actions">
      <AppLink href="/waitlist" look="solid">
        {CONFIRM_COPY.signupAgain}
      </AppLink>
    </div>
  );
}

function ConfirmFailed({ failure }: { failure: ConfirmFailure | null }) {
  if (failure === null) return null;
  return (
    <AppNotice tone="error" title={CONFIRM_COPY.failedTitle} testId="waitlist-confirm-error">
      <p>{CONFIRM_ERRORS[failure]}</p>
      <SignupLink />
    </AppNotice>
  );
}

export function WaitlistConfirmPanel() {
  const [state, setState] = useState<ConfirmState>({ kind: "ready", failure: null });
  const sending = state.kind === "sending";

  async function confirm() {
    setState({ kind: "sending" });
    const next = await requestConfirmation(tokenFromHash());
    // El enlace ya se gastó: se quita de la barra de direcciones y del historial.
    if (next.kind === "done") window.history.replaceState(null, "", window.location.pathname);
    setState(next);
  }
  function handleConfirm() {
    void confirm();
  }

  if (state.kind === "done") {
    return (
      <AppNotice tone="success" title={CONFIRM_COPY.doneTitle} testId="waitlist-confirm-done">
        <p>{welcomeLine(state.welcomeSent)}</p>
        <p>{CONFIRM_COPY.doneAccess}</p>
        {!state.welcomeSent && <SignupLink />}
      </AppNotice>
    );
  }

  return (
    <div className="ap-block">
      <p className="ap-hint">{CONFIRM_COPY.lede}</p>
      <ConfirmFailed failure={failureOf(state)} />
      <button type="button" className="ap-btn ap-btn--solid" onClick={handleConfirm} disabled={sending} aria-busy={sending} data-testid="waitlist-confirm">
        {submitLabel(sending)}
      </button>
    </div>
  );
}
