import { CONFIRM_ERRORS, SIGNUP_ERRORS } from "./constants";
import type { ConfirmFailure, ConfirmState, SignupFailure, SignupState } from "./types";

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> } | null> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, data };
  } catch {
    return null;
  }
}

/** Un código de error que la pantalla conoce; cualquier otro se muestra como «no disponible». */
function knownFailure<T extends string>(code: unknown, known: Record<T, string>, fallback: T): T {
  if (typeof code === "string" && Object.hasOwn(known, code)) return code as T;
  return fallback;
}

export async function requestSignup(email: string, website: string): Promise<SignupState> {
  const result = await postJson("/api/waitlist", { email, website });
  if (result === null) return { kind: "form", failure: "network" };
  if (result.ok && result.data.status === "check_inbox") return { kind: "done" };
  return { kind: "form", failure: knownFailure<SignupFailure>(result.data.error, SIGNUP_ERRORS, "unavailable") };
}

export async function requestConfirmation(token: string): Promise<ConfirmState> {
  const result = await postJson("/api/waitlist/confirm", { token });
  if (result === null) return { kind: "ready", failure: "network" };
  if (result.ok && result.data.status === "waitlisted") return { kind: "done", welcomeSent: result.data.welcomeEmail === "sent" };
  return { kind: "ready", failure: knownFailure<ConfirmFailure>(result.data.error, CONFIRM_ERRORS, "unavailable") };
}
