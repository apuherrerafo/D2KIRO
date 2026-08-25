import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";

const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const SESSION_RENEW_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

export interface SessionData {
  accountId: number;
  issuedAt: number;
  firstLoginAt: number;
}

export interface SessionCookieStore {
  get(name: string): { name: string; value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): void;
}

function sessionPassword(): string {
  const password = process.env.SESSION_SECRET;
  if (typeof password !== "string" || password.length < 32) {
    throw new Error("SESSION_SECRET must be at least 32 characters long");
  }
  return password;
}

export function sessionOptions(): SessionOptions {
  return {
    password: sessionPassword(),
    cookieName: "d2k_session",
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
    },
  };
}

export async function getSession(cookieStore?: SessionCookieStore): Promise<IronSession<SessionData>> {
  const store = cookieStore ?? await cookies();
  return getIronSession<SessionData>(store as never, sessionOptions());
}

export async function renewSessionIfNeeded(session: IronSession<SessionData>, now = Date.now()): Promise<boolean> {
  const isValid = Number.isInteger(session.accountId)
    && session.accountId >= 1
    && session.accountId <= 4_294_967_295
    && Number.isSafeInteger(session.issuedAt)
    && Number.isSafeInteger(session.firstLoginAt)
    && session.firstLoginAt >= 0
    && session.firstLoginAt <= session.issuedAt
    && session.issuedAt <= now;
  if (!isValid || now - session.firstLoginAt > SESSION_MAX_AGE_MS) {
    session.destroy();
    return false;
  }

  if (now - session.issuedAt > SESSION_RENEW_AFTER_MS) {
    session.issuedAt = now;
    await session.save();
  }
  return true;
}
