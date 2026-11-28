import { getCanonicalOrigin } from "./canonical-origin";
import { createWaitlistHandlers } from "./waitlist-handler";
import { createResendMailer } from "./waitlist-mailer";

/** Las dependencias reales de las rutas `/api/waitlist*`. */
export function waitlistHandlers() {
  return createWaitlistHandlers({
    env: process.env,
    publicOrigin: getCanonicalOrigin(),
    now: Date.now,
    mailer: createResendMailer(process.env),
  });
}
