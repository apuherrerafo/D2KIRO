// Prints how to give a HUMAN browser the lab session for the isolated server started by serve.mjs (the synthetic account-1 session, 24 h, this server only).
// usage: node scripts/coach-motion-v2/cookie.mjs <state.json>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { ROOT } from "./lib.mjs";

const { sealData } = createRequire(`${ROOT}/apps/web/package.json`)("iron-session");
const st = JSON.parse(readFileSync(process.argv[2], "utf8"));
const now = Date.now();
const value = await sealData({ accountId: 1, issuedAt: now, firstLoginAt: now }, { password: st.secret, ttl: 86400 });
console.log(`Open http://localhost:${st.port}/lab/coach-motion-v2/production once (it will redirect), then in that tab's DevTools console run:`);
console.log(`document.cookie = "d2k_session=${value}; path=/"`);
console.log("then reload. The cookie only opens this throwaway server; it stops working when the server stops.");
