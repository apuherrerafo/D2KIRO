// Lógica pura para admitir/retirar amigos de la beta privada (BETA_ALLOWED_STEAM_IDS).
// Sin I/O: el CLI (invite.ts) es quien habla con Railway. Nunca devuelve ni imprime un Steam32 completo
// en mensajes de error -- el Steam32 es dato personal (invariantes.md).

const STEAM_ID64_OFFSET = BigInt("76561197960265728");
const STEAM32_MAX = 4_294_967_295;
const PROFILE_URL = /^https?:\/\/steamcommunity\.com\/profiles\/([0-9]{17})\/?$/;

export type ParseResult = { ok: true; steam32: number } | { ok: false; reason: string };

/** Acepta SteamID64 (17 dígitos), Steam32 (hasta 10 dígitos) o la URL /profiles/<id64>. Conversión con BigInt. */
export function parseSteamInput(raw: string): ParseResult {
  const input = raw.trim();
  const fromUrl = PROFILE_URL.exec(input);
  const digits = fromUrl ? fromUrl[1] : input;
  if (!/^[0-9]+$/.test(digits)) {
    return { ok: false, reason: "No reconozco ese dato. Usa el SteamID64 (17 dígitos), el número de Dota (Steam32) o el link steamcommunity.com/profiles/<17 dígitos>. Los links con nombre personalizado no sirven: abre el perfil y copia el número." };
  }
  let steam32: bigint;
  if (digits.length === 17) steam32 = BigInt(digits) - STEAM_ID64_OFFSET;
  else if (digits.length <= 10) steam32 = BigInt(digits);
  else return { ok: false, reason: "Largo inválido: debe tener 17 dígitos (SteamID64) o hasta 10 (Steam32)." };
  if (steam32 < BigInt(1) || steam32 > BigInt(STEAM32_MAX)) return { ok: false, reason: "El número no corresponde a una cuenta de Steam válida." };
  return { ok: true, steam32: Number(steam32) };
}

export function parseAllowlist(value: string | undefined): number[] {
  const entries = (value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const ids: number[] = [];
  for (const entry of entries) {
    const parsed = parseSteamInput(entry);
    if (!parsed.ok || entry.length > 10) throw new Error("La lista actual de la beta tiene una entrada inválida; no se modifica nada.");
    if (!ids.includes(parsed.steam32)) ids.push(parsed.steam32);
  }
  return ids;
}

export interface AllowlistChange {
  next: string;
  changed: boolean;
  count: number;
}

export function addToAllowlist(current: string | undefined, steam32: number): AllowlistChange {
  const ids = parseAllowlist(current);
  if (ids.includes(steam32)) return { next: ids.join(","), changed: false, count: ids.length };
  const next = [...ids, steam32];
  return { next: next.join(","), changed: true, count: next.length };
}

/** Nunca deja la lista vacía: start-railway.sh falla cerrado y el sitio no levantaría. */
export function removeFromAllowlist(current: string | undefined, steam32: number): AllowlistChange {
  const ids = parseAllowlist(current);
  if (!ids.includes(steam32)) return { next: ids.join(","), changed: false, count: ids.length };
  const next = ids.filter((id) => id !== steam32);
  if (next.length === 0) throw new Error("No se puede dejar la beta sin ninguna cuenta: el sitio no arrancaría.");
  return { next: next.join(","), changed: true, count: next.length };
}
