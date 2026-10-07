/* LANDING-01B · closing CTA. ActionPrimary is the one spectral commitment of this view; its busy and
   success states are the canonical ones (words, not a flourish: a waitlist is a routine action).
   `onJoin` is the seam for the real endpoint. Without it the form runs in PREVIEW and says so — it
   never pretends to have sent anything. */
"use client";

import { useId, useState, type ChangeEvent, type FormEvent } from "react";
import { ActionPrimary, type ActionStatus } from "@/design/canonical/primitives";
import { CTA_LABEL, WAITLIST } from "../copy";
import { LandingSection } from "./LandingSection";

const PREVIEW_DELAY_MS = 900;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string) {
  return EMAIL_PATTERN.test(value.trim());
}

/** The words the form uses. With no endpoint it is a preview and must never read as a stored sign-up. */
export function waitlistWords(preview: boolean) {
  if (preview) return { busy: WAITLIST.previewBusy, success: WAITLIST.previewSuccess, successNote: WAITLIST.previewSuccessNote };
  return { busy: WAITLIST.busy, success: WAITLIST.success, successNote: WAITLIST.successNote };
}

export type JoinWaitlist = (email: string) => Promise<void>;

function previewJoin(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, PREVIEW_DELAY_MS));
}

function FieldError({ id, show }: { id: string; show: boolean }) {
  if (!show) return null;
  return <p className="ld-field-error" id={id} role="alert">{WAITLIST.emailError}</p>;
}

function PreviewNote({ show }: { show: boolean }) {
  if (!show) return null;
  return <p className="ld-illustrative">{WAITLIST.previewNote}</p>;
}

function SuccessNote({ note, show }: { note: string; show: boolean }) {
  if (!show) return null;
  return <p className="ld-success" role="status">{note}</p>;
}

export function WaitlistSection({ onJoin }: { onJoin?: JoinWaitlist }) {
  const fieldId = useId();
  const errorId = `${fieldId}-error`;
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [status, setStatus] = useState<ActionStatus>("idle");
  /* No endpoint wired: the form is a preview and must never read as a stored sign-up. */
  const preview = onJoin === undefined;
  const words = waitlistWords(preview);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
    if (invalid) setInvalid(false);
  }

  async function submit() {
    if (status !== "idle") return;
    if (!isValidEmail(email)) {
      setInvalid(true);
      return;
    }
    setStatus("busy");
    try {
      await (onJoin ?? previewJoin)(email.trim());
      setStatus("success");
    } catch {
      setStatus("idle");
      setInvalid(true);
    }
  }
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit();
  }
  function handlePress() {
    void submit();
  }

  return (
    <LandingSection id="waitlist" kicker={WAITLIST.kicker} layout="split" lede={WAITLIST.lede} title={WAITLIST.title}>
      <form className="ld-waitlist" noValidate onSubmit={handleSubmit}>
        <label className="ld-field-label" htmlFor={fieldId}>{WAITLIST.emailLabel}</label>
        <input
          aria-describedby={invalid ? errorId : undefined}
          aria-invalid={invalid}
          autoComplete="email"
          className="ld-field"
          disabled={status !== "idle"}
          id={fieldId}
          inputMode="email"
          name="email"
          onChange={handleChange}
          placeholder={WAITLIST.emailPlaceholder}
          type="email"
          value={email}
        />
        <FieldError id={errorId} show={invalid} />
        <div className="ld-waitlist-action">
          <ActionPrimary busyLabel={words.busy} onPress={handlePress} status={status} successLabel={words.success}>{CTA_LABEL}</ActionPrimary>
        </div>
        <SuccessNote note={words.successNote} show={status === "success"} />
        <PreviewNote show={preview} />
      </form>
    </LandingSection>
  );
}
