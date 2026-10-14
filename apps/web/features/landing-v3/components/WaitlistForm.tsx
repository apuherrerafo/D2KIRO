/* LANDING V3 · one waitlist form (Hero or closing). Success is shared: either form flips the other. Secondary actions after sign-up
   exist only where a real destination is configured; Founding Supporter is a post-signup idea, never a payment. */
"use client";

import { useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { HERO, WAITLIST } from "../copy";
import { helpActions } from "../config";
import { useWaitlist } from "./WaitlistProvider";

type Variant = "hero" | "close";
type Tone = "" | "err";

function Success({ variant }: { variant: Variant }) {
  const { preview, config } = useWaitlist();
  const actions = helpActions(config);
  const heading = preview ? WAITLIST.previewDone : WAITLIST.done;
  const note = preview ? WAITLIST.previewDoneNote : WAITLIST.doneNote;
  if (variant === "hero") {
    return (
      <>
        <b>{heading}</b>
        <span>{note}</span>
      </>
    );
  }
  return (
    <>
      <h3>{heading}</h3>
      <p>{note}</p>
      <div className="help">
        <p className="kicker">{WAITLIST.helpTitle}</p>
        {actions.length > 0 && (
          <div className="help-row">
            {actions.map((action) => (
              <a className="ghost" href={action.destination.href} key={action.id} rel={action.destination.external ? "noopener noreferrer" : undefined} target={action.destination.external ? "_blank" : undefined}>
                {action.id === "feedback" ? WAITLIST.helpFeedback : WAITLIST.helpFollow}
              </a>
            ))}
          </div>
        )}
        <details className="later"><summary>{WAITLIST.foundingSummary}</summary><p>{WAITLIST.foundingBody}</p></details>
      </div>
    </>
  );
}

export function WaitlistForm({ variant, inputId }: { variant: Variant; inputId: string }) {
  const { done, preview, submit } = useWaitlist();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: Tone; text: string }>({ tone: "", text: "" });
  const input = useRef<HTMLInputElement>(null);
  const ok = useRef<HTMLDivElement>(null);

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    setEmail(event.target.value);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage({ tone: "", text: "" });
    const result = await submit(email);
    setBusy(false);
    if (result === "ok") {
      window.requestAnimationFrame(() => ok.current?.focus({ preventScroll: true }));
      return;
    }
    setMessage({ tone: "err", text: result === "invalid" ? WAITLIST.emailError : WAITLIST.failed });
    input.current?.focus();
  }

  const label = variant === "hero" ? <label className="kicker" htmlFor={inputId}>{HERO.formLabel}</label> : <label className="sr-only" htmlFor={inputId}>{WAITLIST.emailLabel}</label>;
  return (
    <form className="wl" data-state={done ? "done" : "idle"} data-testid={`waitlist-${variant}`} data-wl noValidate onSubmit={handleSubmit}>
      <div className="wl-fields">
        {label}
        <div className="wl-row">
          <input
            aria-describedby={`${inputId}-msg`}
            aria-invalid={message.tone === "err"}
            autoComplete="email"
            disabled={busy}
            id={inputId}
            inputMode="email"
            name="email"
            onChange={handleChange}
            placeholder={WAITLIST.emailPlaceholder}
            ref={input}
            required
            type="email"
            value={email}
          />
          <button className="btn" disabled={busy} type="submit">
            {busy ? WAITLIST.busy : WAITLIST.button} <span aria-hidden="true" className="arr">→</span>
          </button>
        </div>
        <p className="wl-micro">{WAITLIST.micro}</p>
        {preview && <p className="wl-preview" data-testid="waitlist-preview"><b>{WAITLIST.previewTag}</b>{WAITLIST.previewNote}</p>}
        <p aria-live="polite" className="wl-msg" data-tone={message.tone} id={`${inputId}-msg`} role="status">{message.text}</p>
      </div>
      <div className={`wl-ok wl-ok-${variant}`} ref={ok} role="status" tabIndex={-1}>
        {done && <Success variant={variant} />}
      </div>
    </form>
  );
}
