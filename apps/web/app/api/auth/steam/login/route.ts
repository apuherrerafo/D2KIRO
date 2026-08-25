import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { buildSteamLoginUrl } from "@/lib/steam-openid";

const LOGIN_NONCE_COOKIE = "d2k_login_nonce";

interface LoginDependencies {
  publicBaseUrl: string;
  createNonce: () => string;
  saveNonce: (nonce: string) => void;
}

export function createLoginHandler(dependencies: LoginDependencies) {
  return async () => {
    const nonce = dependencies.createNonce();
    const callback = new URL("/api/auth/steam/callback", dependencies.publicBaseUrl);
    callback.searchParams.set("state", nonce);
    dependencies.saveNonce(nonce);
    return NextResponse.redirect(buildSteamLoginUrl(callback.toString(), nonce));
  };
}

export async function GET() {
  const publicBaseUrl = process.env.PUBLIC_BASE_URL;
  if (!publicBaseUrl) return new Response("Authentication is unavailable", { status: 503 });

  const cookieStore = await cookies();
  return createLoginHandler({
    publicBaseUrl,
    createNonce: () => randomBytes(16).toString("hex"),
    saveNonce: (nonce) => cookieStore.set(LOGIN_NONCE_COOKIE, nonce, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600,
      path: "/",
    }),
  })();
}
