import { betaAccessFilePath, isInvited } from "./beta-access-store";
import { isSteamIdAllowed, parseBetaAllowedSteamIds } from "./beta-allowlist";

// Reglas de acceso de la beta privada, en un solo lugar:
//   · lista fija BETA_ALLOWED_STEAM_IDS (la maneja el dueño con Railway) — sigue siendo obligatoria y sigue mandando;
//   · administradores BETA_ADMIN_STEAM_IDS — siempre pueden entrar, y solo ellos administran invitados;
//   · invitados aprobados desde la web (archivo en el disco persistente).
// Ausente o mal formada una lista, esa lista NO admite a nadie (falla cerrado). Las aprobaciones web nunca amplían a un administrador.

type Env = Record<string, string | undefined>;

export function isBetaAdmin(accountId: number, env: Env = process.env): boolean {
  const admins = parseBetaAllowedSteamIds(env.BETA_ADMIN_STEAM_IDS);
  return admins.configured && !admins.malformed && admins.validIds.has(accountId);
}

export function isAccountAllowedNow(accountId: number, env: Env = process.env): boolean {
  // La lista fija es obligatoria: si está escrita pero mal formada, nadie entra (ni admins ni invitados) hasta corregirla.
  const fixed = parseBetaAllowedSteamIds(env.BETA_ALLOWED_STEAM_IDS);
  if (fixed.configured && fixed.malformed) return false;
  if (isSteamIdAllowed(accountId, env.BETA_ALLOWED_STEAM_IDS)) return true;
  if (isBetaAdmin(accountId, env)) return true;
  return isInvited(betaAccessFilePath(env), accountId);
}

/** El control de acceso solo se exige donde la beta está configurada (Railway); en desarrollo y E2E no hay lista y no se bloquea. */
export function isBetaAccessEnforced(env: Env = process.env): boolean {
  return parseBetaAllowedSteamIds(env.BETA_ALLOWED_STEAM_IDS).configured;
}

/** Para las rutas `/api/auth/*` (puertas públicas del proxy): una sesión de una cuenta retirada de la beta ya no sirve. */
export function isSessionStillAllowed(accountId: number, env: Env = process.env): boolean {
  return !isBetaAccessEnforced(env) || isAccountAllowedNow(accountId, env);
}
