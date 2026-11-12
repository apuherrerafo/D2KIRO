import { cookies } from "next/headers";
import { getIronSession, type SessionOptions } from "iron-session";

// Cookie sellada y de vida corta que solo sirve para decirle a quien Steam acaba de verificar (pero no está en la beta) que su pedido llegó.
// Lleva datos de presentación (nombre y avatar públicos) y la identidad que Steam acaba de verificar (`accountId`): vive SELLADA y httpOnly, así que
// el navegador no puede leerla ni cambiarla, y es la ÚNICA fuente de identidad al enviar la solicitud (el formulario nunca manda quién eres).
// El Steam32 nunca vuelve a la interfaz. No abre sesión alguna.
const TTL_SECONDS = 60 * 60;

export interface AccessRequestData {
  /** Steam32 verificado por Steam en este mismo inicio de sesión. Solo el servidor lo lee. */
  accountId?: number;
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

export async function saveAccessRequestNotice(data: Required<Omit<AccessRequestData, "recorded">>): Promise<void> {
  const session = await getIronSession<AccessRequestData>((await cookies()) as never, options());
  Object.assign(session, data);
  await session.save();
}

function validAccountId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 4_294_967_295 ? value : undefined;
}

/** Nunca lanza: sin cookie válida (o sin secreto) simplemente no hay aviso personalizado. */
export async function readAccessRequestNotice(): Promise<AccessRequestData | null> {
  try {
    const session = await getIronSession<AccessRequestData>((await cookies()) as never, options());
    if (typeof session.personaName !== "string") return null;
    return { accountId: validAccountId(session.accountId), personaName: session.personaName, avatarUrl: session.avatarUrl ?? null, profileAvailable: session.profileAvailable === true, recorded: session.recorded !== false };
  } catch {
    return null;
  }
}
