// Shared helpers of the Coach Motion V2 production pipeline. No absolute paths, no session-specific folders:
// the repo root comes from this file's location, the server and the session secret from the environment.
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const reqRoot = createRequire(`${ROOT}/package.json`);
const reqWeb = createRequire(`${ROOT}/apps/web/package.json`);
export const { chromium } = reqRoot("@playwright/test");
const { sealData } = reqWeb("iron-session");

/** Server that serves /lab/coach-motion-v2/* (a `next start` of this worktree). */
export const BASE = process.env.CM_BASE ?? "http://localhost:3162";
/** The SESSION_SECRET that server was started with (the lab stays behind the normal session gate). */
export function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("set SESSION_SECRET to the secret the lab server was started with (>= 32 chars)");
  return s;
}
export const PUBLIC_PACKS = `${ROOT}/apps/web/public/coach-motion-v2/prod`;

/** Same synthetic session the other labs' harnesses use (accountId 1, no Steam). */
export async function sessionCookie(host = new URL(BASE).hostname) {
  const now = Date.now();
  const value = await sealData({ accountId: 1, issuedAt: now, firstLoginAt: now }, { password: sessionSecret(), ttl: 86400 });
  return { name: "d2k_session", value, domain: host, path: "/", expires: Math.floor(now / 1000) + 86400, httpOnly: true, secure: false, sameSite: "Lax" };
}

/** Headless always: no window ever opens on the dev machine. channel "chromium" = new headless mode (real GPU through ANGLE). */
export async function launch(extra = {}) {
  const browser = await chromium.launch({
    headless: true,
    channel: "chromium",
    args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"],
  });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...extra });
  await ctx.addCookies([await sessionCookie()]);
  return { browser, ctx };
}
