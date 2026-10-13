import { sealData } from "iron-session";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// Session for the Landing V2 lab without Steam: a cookie sealed with this run's ephemeral secret (see playwright.landing-v2.config.ts).
// The accountId is a synthetic constant — no real Steam32 ever touches this harness.
const SESSION_TTL_SECONDS = 24 * 60 * 60;
const SYNTHETIC_ACCOUNT_ID = 1;

export default async function globalSetup(): Promise<void> {
  const password = process.env.LAB_SESSION_SECRET;
  const baseUrl = process.env.LAB_BASE_URL;
  if (!password || !baseUrl) throw new Error("landing-v2 global-setup: LAB_SESSION_SECRET / LAB_BASE_URL missing");
  const now = Date.now();
  const sealed = await sealData({ accountId: SYNTHETIC_ACCOUNT_ID, issuedAt: now, firstLoginAt: now }, { password, ttl: SESSION_TTL_SECONDS });
  const { host } = new URL(baseUrl);
  writeFileSync(
    resolve("e2e-landing-v2/.tmp/session.json"),
    JSON.stringify({
      cookies: [{ name: "d2k_session", value: sealed, domain: host.split(":")[0], path: "/", expires: Math.floor(now / 1000) + SESSION_TTL_SECONDS, httpOnly: true, secure: false, sameSite: "Lax" }],
      origins: [],
    }),
  );
}
