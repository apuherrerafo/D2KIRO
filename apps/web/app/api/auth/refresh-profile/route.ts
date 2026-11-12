import { NextResponse } from "next/server";
import { isBetaAdmin, isSessionStillAllowed } from "@/lib/beta-access";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { getSession, getSessionProfile, renewSessionIfNeeded } from "@/lib/session";
import { steam32ToSteamId64 } from "@/lib/steam-openid";
import { getSteamPlayerProfile } from "@/lib/steam-profile";

// "Reintentar" del perfil de Steam: vuelve a leer nombre y avatar públicos y renueva la sesión sin pedir otro login.
// Está bajo /api/auth/ (puerta pública del proxy), así que exige sesión AQUÍ. Mismo origen obligatorio: es una acción de la propia pantalla.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const origin = getCanonicalOrigin();
  const requestOrigin = request.headers.get("origin");
  if (origin !== null && requestOrigin !== null && requestOrigin !== new URL(origin).origin) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const session = await getSession();
  if (!await renewSessionIfNeeded(session)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isSessionStillAllowed(session.accountId)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const profile = await getSteamPlayerProfile({ accountId: session.accountId, steamId64: steam32ToSteamId64(session.accountId), apiKey: process.env.STEAM_WEB_API_KEY, communityOrigin: process.env.STEAM_COMMUNITY_ORIGIN });
  if (profile.available) {
    Object.assign(session, { personaName: profile.personaName, avatarUrl: profile.avatarUrl, profileAvailable: true });
    await session.save();
  }
  return NextResponse.json(getSessionProfile(session, isBetaAdmin(session.accountId)), { headers: { "cache-control": "no-store" } });
}
