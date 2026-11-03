import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { mintAccountToken } from "@/lib/account-token";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { getSession } from "@/lib/session";
import { steamId64ToSteam32, verifySteamCallback } from "@/lib/steam-openid";
import { getSteamPlayerProfile, type SteamPlayerProfile } from "@/lib/steam-profile";
import { isSteamIdAllowed } from "@/lib/beta-allowlist";

const LOGIN_NONCE_COOKIE = "d2k_login_nonce";
type SteamVerification = Awaited<ReturnType<typeof verifySteamCallback>>;
type AuthFailure = "missing_nonce" | "nonce_mismatch" | "steam_verify_failed" | "invalid_steam_identity" | "account_create_failed" | "profile_fetch_failed" | "session_save_failed" | "auth_config_invalid";

interface CallbackDependencies {
  publicOrigin: string | null;
  readNonce: () => string | undefined;
  clearNonce: () => void;
  verify: (params: URLSearchParams) => Promise<SteamVerification>;
  createAccount: (accountId: number, token: string) => Promise<boolean>;
  getProfile: (accountId: number, steamId64: bigint) => Promise<SteamPlayerProfile>;
  startSession: (accountId: number, profile: SteamPlayerProfile) => Promise<void>;
  createToken: (accountId: number) => string;
  isAccountAllowed?: (accountId: number) => boolean;
}

function redirectToCanonicalPath(origin: string | null, path: string): NextResponse {
  if (origin === null) return new NextResponse("Authentication is unavailable", { status: 503 });
  return NextResponse.redirect(new URL(path, origin));
}

function loginError(origin: string | null, failure: AuthFailure): NextResponse {
  if (process.env.NODE_ENV === "development") {
    console.error(`[auth] Steam login failed: ${failure}`);
  }
  return redirectToCanonicalPath(origin, "/login?error=auth_failed");
}

export { mintAccountToken as createAccountToken } from "@/lib/account-token";

export function createCallbackHandler(dependencies: CallbackDependencies) {
  return async (request: Request): Promise<NextResponse> => {
    const params = new URL(request.url).searchParams;
    const expectedNonce = dependencies.readNonce();
    dependencies.clearNonce();
    if (!expectedNonce) return loginError(dependencies.publicOrigin, "missing_nonce");
    if (params.get("state") !== expectedNonce) return loginError(dependencies.publicOrigin, "nonce_mismatch");

    try {
      const verification = await dependencies.verify(params);
      if (!verification.ok) return loginError(dependencies.publicOrigin, "steam_verify_failed");

      const accountId = steamId64ToSteam32(verification.steamId64);
      if (!Number.isInteger(accountId) || accountId < 1 || accountId > 4_294_967_295) return loginError(dependencies.publicOrigin, "invalid_steam_identity");
      if (!(dependencies.isAccountAllowed?.(accountId) ?? true)) return redirectToCanonicalPath(dependencies.publicOrigin, "/access-denied");
      try {
        if (!await dependencies.createAccount(accountId, dependencies.createToken(accountId))) return loginError(dependencies.publicOrigin, "account_create_failed");
      } catch {
        return loginError(dependencies.publicOrigin, "account_create_failed");
      }

      let profile: SteamPlayerProfile;
      try {
        profile = await dependencies.getProfile(accountId, verification.steamId64);
      } catch {
        return loginError(dependencies.publicOrigin, "profile_fetch_failed");
      }
      try {
        await dependencies.startSession(accountId, profile);
      } catch {
        return loginError(dependencies.publicOrigin, "session_save_failed");
      }
      return redirectToCanonicalPath(dependencies.publicOrigin, "/");
    } catch {
      return loginError(dependencies.publicOrigin, "steam_verify_failed");
    }
  };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const internalSecret = process.env.INTERNAL_AUTH_SECRET;
  const engineUrl = process.env.ENGINE_INTERNAL_URL;
  const publicOrigin = getCanonicalOrigin();
  if (!internalSecret || internalSecret.length < 32 || !engineUrl) return loginError(publicOrigin, "auth_config_invalid");

  return createCallbackHandler({
    publicOrigin,
    readNonce: () => cookieStore.get(LOGIN_NONCE_COOKIE)?.value,
    clearNonce: () => cookieStore.delete(LOGIN_NONCE_COOKIE),
    verify: verifySteamCallback,
    createAccount: async (accountId, token) => {
      const response = await fetch(new URL("/api/account", engineUrl), {
        method: "POST",
        headers: { "x-account-token": token },
        cache: "no-store",
      });
      return response.ok;
    },
    getProfile: (accountId, steamId64) => getSteamPlayerProfile({ accountId, steamId64, apiKey: process.env.STEAM_WEB_API_KEY }),
    startSession: async (accountId, profile) => {
      const now = Date.now();
      const session = await getSession();
      Object.assign(session, { accountId, issuedAt: now, firstLoginAt: now, ...profile });
      await session.save();
    },
    createToken: (accountId) => mintAccountToken(accountId, internalSecret),
    isAccountAllowed: (accountId) => isSteamIdAllowed(accountId, process.env.BETA_ALLOWED_STEAM_IDS),
  })(request);
}
