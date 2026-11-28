import type { ConfirmFailure, SignupFailure } from "./types";

// Todo el texto visible de la waitlist, en inglés como la portada desde la que se llega.

export const SIGNUP_COPY = {
  title: "Join the D2KIRO waitlist",
  lede: "Leave your email and confirm it. D2KIRO LIVE is coming later for people on the waitlist; it is not available yet.",
  access: "The waitlist does not open the draft coach. The beta is private and by invitation.",
  privacy: "We keep your email only to run this waitlist and to send you news about the beta and D2KIRO LIVE.",
  label: "Email",
  trap: "Leave this field empty",
  submit: "Join the waitlist",
  busy: "Sending…",
  doneTitle: "Check your inbox",
  done: "If we can send to that address, an email is on its way. If you are new, open its link to confirm: it works once and expires in 24 hours. Nothing arrived? Check spam, or try again later.",
  failedTitle: "You are not signed up yet",
} as const;

export const SIGNUP_ERRORS: Record<SignupFailure, string> = {
  invalid_email: "That does not look like an email address. Check it and try again.",
  rate_limited: "Too many signup attempts. Nothing was sent. Please try again later.",
  busy: "Signups are paused for a while because of high volume. Nothing was saved or sent. Please try again later.",
  full: "The waitlist cannot take signups right now. Nothing was saved or sent. Please come back later.",
  not_open: "The waitlist is not open yet. Please come back later.",
  unavailable: "We could not save your signup. Try again in a few minutes.",
  network: "We cannot reach D2KIRO. Check your connection and try again.",
};

export const CONFIRM_COPY = {
  title: "Confirm your email",
  lede: "Press the button to confirm your spot on the D2KIRO waitlist.",
  submit: "Confirm my email",
  busy: "Confirming…",
  doneTitle: "You are on the waitlist",
  doneSent: "Your email is confirmed. We sent you a welcome email.",
  donePending: "Your email is confirmed, but the welcome email could not be sent. Enter your email on the waitlist page again later to receive it.",
  doneAccess: "This does not open the draft coach: admission to the private beta is a separate step. D2KIRO LIVE is coming later.",
  failedTitle: "Your email is not confirmed",
  signupAgain: "Go to the waitlist page",
} as const;

export const CONFIRM_ERRORS: Record<ConfirmFailure, string> = {
  invalid_link: "This link is not valid or was already used. If you already confirmed, you are on the list; otherwise ask for a new link.",
  expired_link: "This link expired. Enter your email on the waitlist page again to get a new one.",
  rate_limited: "Too many attempts. Wait a few minutes and try again.",
  unavailable: "We could not confirm your email. Try again in a few minutes.",
  network: "We cannot reach D2KIRO. Check your connection and try again.",
};
