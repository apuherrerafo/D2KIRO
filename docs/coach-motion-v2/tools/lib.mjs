import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const WT = "D:/JULIO/apuherrerafoprojects/dota2coach-wt/landing-v2-integration";
const reqRoot = createRequire(WT + "/package.json");
const reqWeb = createRequire(WT + "/apps/web/package.json");
export const { chromium } = reqRoot("@playwright/test");
const { sealData } = reqWeb("iron-session");
export const sec = JSON.parse(readFileSync(new URL("./secrets.json", import.meta.url), "utf8"));
export const BASE = `http://localhost:${sec.PORT}`;
export const OUT = WT + "/docs/coach-motion-v2";
export const PUB = WT + "/apps/web/public/coach-motion-v2";
export async function cookie() {
  const now = Date.now();
  const v = await sealData({ accountId: 1, issuedAt: now, firstLoginAt: now }, { password: sec.secret, ttl: 86400 });
  return [{ name: "d2k_session", value: v, domain: "localhost", path: "/", expires: Math.floor(now / 1000) + 86400, httpOnly: true, secure: false, sameSite: "Lax" }];
}
// Headless by default: no window ever opens on the dev machine. Set HEADED=1 only when a person asks to watch.
// channel "chromium" = new headless mode, which keeps the real GPU (ANGLE / D3D11) instead of the SwiftShader headless shell.
export async function launch(headless = process.env.HEADED !== "1", extra = {}) {
  const browser = await chromium.launch({ headless, channel: headless ? "chromium" : undefined, args: ["--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-features=CalculateNativeWindowOcclusion,CalculateNativeWinOcclusion", "--window-position=0,0"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ...extra });
  await ctx.addCookies(await cookie());
  return { browser, ctx };
}
