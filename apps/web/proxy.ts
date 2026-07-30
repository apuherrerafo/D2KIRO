import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const REALM = "dota2coach";

function configuredCredentials() {
  const user = process.env.SITE_ACCESS_USER;
  const password = process.env.SITE_ACCESS_PASSWORD;
  if (!user || !password) return null;
  return { user, password };
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function isValidBasicAuth(header: string | null, expectedUser: string, expectedPassword: string): boolean {
  if (!header?.startsWith("Basic ")) return false;

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator < 0) return false;

  const user = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  const userMatches = timingSafeEqual(sha256(user), sha256(expectedUser));
  const passwordMatches = timingSafeEqual(sha256(password), sha256(expectedPassword));
  return userMatches && passwordMatches;
}

function unauthorized() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "www-authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
    },
  });
}

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/healthz") return NextResponse.next();

  const credentials = configuredCredentials();
  if (!credentials) return NextResponse.next();

  if (isValidBasicAuth(request.headers.get("authorization"), credentials.user, credentials.password)) {
    return NextResponse.next();
  }

  return unauthorized();
}

export const config = {
  matcher: ["/((?!healthz$).*)"],
};
