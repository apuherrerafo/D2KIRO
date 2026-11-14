import { NextResponse, type NextRequest } from "next/server";
import { mintAccountToken } from "./lib/account-token";
import { getCanonicalOrigin } from "./lib/canonical-origin";
import { isAccountAllowedNow, isBetaAccessEnforced } from "./lib/beta-access";
import { getSession, renewSessionIfNeeded, type SessionCookieStore } from "./lib/session";

// TSK-219: Dota's Game State Integration has no session cookie -- its ingest path is public here and
// authenticated by the link token in the engine (app/api/live/gsi/[liveId]/route.ts). Exactly this
// prefix: `/api/live/gsi-config` (the cfg download) still needs a session.
const GSI_INGEST_PREFIX = "/api/live/gsi/";
// Local visual capture (the Player's PC derives hero ids from the Dota window): same public door, same link
// credential, checked by the engine. Facts only -- never a frame.
const VISUAL_INGEST_PREFIX = "/api/live/visual/";
// D2KIRO Companion heartbeat: same public door, same link credential, checked by the engine. Exactly this prefix:
// `/api/live/companion-installer` (the personal download) still needs a session.
const COMPANION_INGEST_PREFIX = "/api/live/companion/";

function isPublicPath(pathname: string): boolean {
  return pathname === "/" || pathname === "/login" || pathname === "/access-denied" || pathname === "/healthz" || pathname.startsWith("/api/auth/") || pathname.startsWith(GSI_INGEST_PREFIX) || pathname.startsWith(VISUAL_INGEST_PREFIX) || pathname.startsWith(COMPANION_INGEST_PREFIX);
}

function isEngineRewrite(pathname: string): boolean {
  return pathname.startsWith("/engine/");
}

function cookieStoreFor(request: NextRequest, response: NextResponse): SessionCookieStore {
  return {
    get: (name) => request.cookies.get(name),
    set: (name, value, options) => response.cookies.set(name, value, options as never),
  };
}

function loginRedirect(): NextResponse {
  const origin = getCanonicalOrigin();
  if (origin === null) return new NextResponse("Authentication unavailable", { status: 503 });
  return NextResponse.redirect(new URL("/login", origin));
}

async function revokedAccessRedirect(request: NextRequest): Promise<NextResponse> {
  const origin = getCanonicalOrigin();
  if (origin === null) return new NextResponse("Authentication unavailable", { status: 503 });
  const redirect = NextResponse.redirect(new URL("/access-denied", origin));
  (await getSession(cookieStoreFor(request, redirect))).destroy();
  return redirect;
}

// SECURITY-001: ninguna pantalla usa `next/image`, pero `/_next/image` es una ruta pública de Next (el matcher la excluía del gate de
// sesión) y el endpoint de los avisos críticos de sharp/libvips. Se corta acá, antes de cualquier trabajo. Next la reconoce por
// PREFIJO (`startsWith('/_next/image')`), así que el corte hace lo mismo y no depende de que `images.unoptimized` siga en `true`.
const IMAGE_OPTIMIZER_PATH = "/_next/image";

function isImageOptimizerPath(pathname: string): boolean {
  return pathname.startsWith(IMAGE_OPTIMIZER_PATH);
}

export async function proxy(request: NextRequest) {
  if (isImageOptimizerPath(request.nextUrl.pathname)) return new NextResponse(null, { status: 404 });

  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  const internalSecret = process.env.INTERNAL_AUTH_SECRET;
  if (!internalSecret || internalSecret.length < 32) {
    return new NextResponse("Authentication unavailable", { status: 503 });
  }

  const requestHeaders = new Headers(request.headers);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const session = await getSession(cookieStoreFor(request, response));
  if (!await renewSessionIfNeeded(session)) return loginRedirect();

  // Retirar a alguien de la beta (lista fija o invitación web) corta también su sesión abierta, no solo el próximo login.
  if (isBetaAccessEnforced() && !isAccountAllowedNow(session.accountId)) return revokedAccessRedirect(request);

  if (!isEngineRewrite(request.nextUrl.pathname)) return response;

  requestHeaders.set("x-account-token", mintAccountToken(session.accountId, internalSecret));
  const engineResponse = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of response.cookies.getAll()) engineResponse.cookies.set(cookie);
  return engineResponse;
}

export const config = {
  matcher: ["/((?!_next/static|favicon.ico).*)"],
};
