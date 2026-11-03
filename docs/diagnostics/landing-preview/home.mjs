// TSK-244 evidence: a signed-in visitor still gets the account home at `/` (sealed session, test secret only).
// Usage (from apps/web): SESSION_SECRET=... BASE=... node ../../docs/diagnostics/landing-routing/home.mjs
import { chromium } from "@playwright/test";
import { sealData } from "iron-session";
const base = process.env.BASE ?? "http://localhost:3100";
const now = Date.now();
const sealed = await sealData({ accountId: 1234567, issuedAt: now, firstLoginAt: now }, { password: process.env.SESSION_SECRET });
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addCookies([{ name: "d2k_session", value: sealed, url: base }]);
const page = await ctx.newPage();
await page.goto(`${base}/`, { waitUntil: "load" });
console.log(JSON.stringify(await page.evaluate(() => ({ title: document.title, landing: !!document.querySelector("[data-landing]"), appNav: !!document.querySelector("nav.border-b"), text: document.querySelector("main")?.textContent.slice(0, 60) }))));
await browser.close();
