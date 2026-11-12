import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

// Cookie sellada y de vida corta que solo sirve para decirle a quien Steam acaba de verificar (pero no está en la beta) que su pedido llegó.
// Lleva ÚNICAMENTE datos de presentación (nombre y avatar públicos): nunca el Steam32, y no abre sesión alguna.
const TTL_SECONDS = 60 * 60;

export interface AccessRequestData {
  personaName?: string;
  avatarUrl?: string | null;
  profileAvailable?: boolean;
  /** `false` si el pedido NO se pudo registrar (disco, etc.): la pantalla no debe decir que el dueño ya lo recibió. */
  recorded?: boolean;
}

function options(): SessionOptions {
  const password = process.env.SESSION_SECRET;
  if (typeof password !== "string" || password.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters long");
  return {
    password,
    cookieName: "d2k_access_request",
    ttl: TTL_SECONDS,
    cookieOptions: { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/" },
  };
}

export async function saveAccessRequestNotice(data: Required<AccessRequestData>): Promise<void> {
  const session = await getIronSession<AccessRequestData>((await cookies()) as never, options());
  Object.assign(session, data);
  await session.save();
}

/** Nunca lanza: sin cookie válida (o sin secreto) simplemente no hay aviso personalizado. */
export async function readAccessRequestNotice(): Promise<AccessRequestData | null> {
  try {
    const session = await getIronSession<AccessRequestData>((await cookies()) as never, options());
    if (typeof session.personaName !== "string") return null;
    return { personaName: session.personaName, avatarUrl: session.avatarUrl ?? null, profileAvailable: session.profileAvailable === true, recorded: session.recorded !== false };
  } catch {
    return null;
  }
}
