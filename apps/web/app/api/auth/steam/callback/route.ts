import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { mintAccountToken } from "@/lib/account-token";
import { getSession } from "@/lib/session";
import { steamId64ToSteam32, verifySteamCallback } from "@/lib/steam-openid";
import { getSteamPlayerProfile, type SteamPlayerProfile } from "@/lib/steam-profile";

const LOGIN_NONCE_COOKIE = "d2k_login_nonce";
type SteamVerification = Awaited<ReturnType<typeof verifySteamCallback>>;

interface CallbackDependencies {
  readNonce: () => string | undefined;
  clearNonce: () => void;
  verify: (params: URLSearchParams) => Promise<SteamVerification>;
  createAccount: (accountId: number, token: string) => Promise<boolean>;
  getProfile: (accountId: number, steamId64: bigint) => Promise<SteamPlayerProfile>;
  startSession: (accountId: number, profile: SteamPlayerProfile) => Promise<void>;
  createToken: (accountId: number) => string;
}

function loginError(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
}

export { mintAccountToken as createAccountToken } from "@/lib/account-token";

export function createCallbackHandler(dependencies: CallbackDependencies) {
  return async (request: Request): Promise<NextResponse> => {
    const params = new URL(request.url).searchParams;
    const expectedNonce = dependencies.readNonce();
    dependencies.clearNonce();
    if (!expectedNonce || params.get("state") !== expectedNonce) return loginError(request);

    try {
      const verification = await dependencies.verify(params);
      if (!verification.ok) return loginError(request);

      const accountId = steamId64ToSteam32(verification.steamId64);
      if (!Number.isInteger(accountId) || accountId < 1 || accountId > 4_294_967_295) return loginError(request);
      if (!await dependencies.createAccount(accountId, dependencies.createToken(accountId))) return loginError(request);

      const profile = await dependencies.getProfile(accountId, verification.steamId64);
      await dependencies.startSession(accountId, profile);
      return NextResponse.redirect(new URL("/", request.url));
    } catch {
      return loginError(request);
    }
  };
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const internalSecret = process.env.INTERNAL_AUTH_SECRET;
  const engineUrl = process.env.ENGINE_INTERNAL_URL;
  if (!internalSecret || internalSecret.length < 32 || !engineUrl) return loginError(request);

  return createCallbackHandler({
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
  })(request);
}
