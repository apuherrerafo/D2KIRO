export type SignupFailure = "invalid_email" | "rate_limited" | "not_open" | "unavailable" | "network";

export type ConfirmFailure = "invalid_link" | "expired_link" | "rate_limited" | "unavailable" | "network";

export type SignupState = { kind: "form"; failure: SignupFailure | null } | { kind: "sending" } | { kind: "done" };

export type ConfirmState =
  | { kind: "ready"; failure: ConfirmFailure | null }
  | { kind: "sending" }
  | { kind: "done"; welcomeSent: boolean };
