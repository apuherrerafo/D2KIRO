// server launcher: ephemeral secrets, own child only.  usage: node serve.mjs <secrets.json> <dev|start>
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const WT = "D:/JULIO/apuherrerafoprojects/dota2coach-wt/landing-v2-integration";
const secret = randomBytes(32).toString("hex"), internal = randomBytes(32).toString("hex");
const PORT = 3161;
const mode = process.argv[3] || "start";
writeFileSync(process.argv[2], JSON.stringify({ secret, internal, PORT }));
// .next-hero-loop is gitignored (Tailwind skips it) and already listed in tsconfig.json "include", so next leaves tsconfig.json alone
// -H 127.0.0.1: loopback only, never reachable from the LAN
const child = spawn("npx", ["next", mode, "-H", "127.0.0.1", "-p", String(PORT)], { cwd: WT + "/apps/web", shell: true, stdio: "inherit",
  env: { ...process.env, SESSION_SECRET: secret, INTERNAL_AUTH_SECRET: internal, NEXT_DIST_DIR: ".next-hero-loop" } });
child.on("exit", () => process.exit(0));
