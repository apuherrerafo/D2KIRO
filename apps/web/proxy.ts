import { NextResponse, type NextRequest } from "next/server";
import { mintAccountToken } from "./lib/account-token";
import { getSession, renewSessionIfNeeded, type SessionCookieStore } from "./lib/session";

function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname === "/healthz" || pathname.startsWith("/api/auth/");
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

function loginRedirect(request: NextRequest): NextResponse {
  return NextResponse.redirect(new URL("/login", request.url));
}

export async function proxy(request: NextRequest) {
  if (isPublicPath(request.nextUrl.pathname)) return NextResponse.next();

  const internalSecret = process.env.INTERNAL_AUTH_SECRET;
  if (!internalSecret || internalSecret.length < 32) {
    return new NextResponse("Authentication unavailable", { status: 503 });
  }

  const requestHeaders = new Headers(request.headers);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  const session = await getSession(cookieStoreFor(request, response));
  if (!await renewSessionIfNeeded(session)) return loginRedirect(request);

  if (!isEngineRewrite(request.nextUrl.pathname)) return response;

  requestHeaders.set("x-account-token", mintAccountToken(session.accountId, internalSecret));
  const engineResponse = NextResponse.next({ request: { headers: requestHeaders } });
  for (const cookie of response.cookies.getAll()) engineResponse.cookies.set(cookie);
  return engineResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
