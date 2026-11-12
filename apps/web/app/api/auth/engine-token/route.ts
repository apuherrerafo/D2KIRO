import { NextResponse } from "next/server";
import { mintAccountToken } from "@/lib/account-token";
import { isSessionStillAllowed } from "@/lib/beta-access";
import { getSession, renewSessionIfNeeded } from "@/lib/session";

interface EngineTokenDependencies {
  getSession: () => Promise<Awaited<ReturnType<typeof getSession>>>;
  renewSession: (session: Awaited<ReturnType<typeof getSession>>) => Promise<boolean>;
  mint: (accountId: number, secret: string, issuedAt: number) => string;
  now: () => number;
  secret: () => string | undefined;
  /** Una cuenta retirada de la beta no recibe tokens aunque conserve una sesión vieja. */
  isAllowed?: (accountId: number) => boolean;
}

export function createEngineTokenHandler(dependencies: EngineTokenDependencies) {
  return async (): Promise<NextResponse> => {
    const secret = dependencies.secret();
    if (!secret || secret.length < 32) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const session = await dependencies.getSession();
    if (!await dependencies.renewSession(session)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    if (!(dependencies.isAllowed?.(session.accountId) ?? true)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

    const issuedAt = dependencies.now();
    return NextResponse.json({ token: dependencies.mint(session.accountId, secret, issuedAt), expiresAt: issuedAt + 60_000 }, {
      headers: { "cache-control": "no-store" },
    });
  };
}

export async function GET() {
  return createEngineTokenHandler({
    getSession,
    renewSession: renewSessionIfNeeded,
    mint: mintAccountToken,
    now: Date.now,
    secret: () => process.env.INTERNAL_AUTH_SECRET,
    isAllowed: (accountId) => isSessionStillAllowed(accountId),
  })();
}
