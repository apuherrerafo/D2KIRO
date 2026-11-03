import { randomBytes } from "node:crypto";

/**
 * Secret that mints `x-account-token` for the E2E harness.
 *   - Local managed runtime: the harness starts the engine itself, so a per-run generated secret is correct.
 *   - External runtime: the already-running engine owns its own secret. A generated substitute could never be
 *     verified by it, so the real one is REQUIRED and its absence fails closed before any test starts.
 */
export function resolveInternalAuthSecret(env: Record<string, string | undefined>, useExternalRuntime: boolean): string {
  const provided = env.E2E_INTERNAL_AUTH_SECRET;
  if (provided) return provided;
  if (useExternalRuntime) {
    throw new Error("E2E_EXTERNAL_BASE_URL requiere E2E_INTERNAL_AUTH_SECRET del runtime externo (el motor ya arrancado no puede verificar un secreto generado)");
  }
  return randomBytes(32).toString("hex");
}
