import { createHmac, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { steamId64ToSteam32, verifySteamCallback } from "@/lib/steam-openid";

const LOGIN_NONCE_COOKIE = "d2k_login_nonce";
const ACCOUNT_TOKEN_DOMAIN = "d2k-account-token/v1";

type SteamVerification = Awaited<ReturnType<typeof verifySteamCallback>>;

interface CallbackDependencies {
  readNonce: () => string | undefined;
  clearNonce: () => void;
  verify: (params: URLSearchParams) => Promise<SteamVerification>;
  createAccount: (accountId: number, token: string) => Promise<boolean>;
  startSession: (accountId: number) => Promise<void>;
  createToken: (accountId: number) => string;
}

function loginError(request: Request): NextResponse {
  return NextResponse.redirect(new URL("/login?error=auth_failed", request.url));
}

export function createAccountToken(accountId: number, secret: string, issuedAtMs: number, nonce: string): string {
  const payload = `${accountId}.${issuedAtMs}.${nonce}`;
  const signature = createHmac("sha256", secret).update(`${ACCOUNT_TOKEN_DOMAIN}|${payload}`).digest("hex");
  return `${payload}.${signature}`;
}

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

      await dependencies.startSession(accountId);
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
    startSession: async (accountId) => {
      const now = Date.now();
      const session = await getSession();
      Object.assign(session, { accountId, issuedAt: now, firstLoginAt: now });
      await session.save();
    },
    createToken: (accountId) => createAccountToken(accountId, internalSecret, Date.now(), randomBytes(16).toString("hex")),
  })(request);
}
