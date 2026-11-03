#!/usr/bin/env bun
// WAVE 3 -- automated, headless product smoke. The scenarios live in the engine's perspective-safe
// harness and the rendered Coach panel tests: no browser/network/server process is required.
import { spawnSync } from "node:child_process";

const paths = [
  "apps/engine/src/coach",
  "apps/engine/src/recommendation/build-from-perspective.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.coach.test.ts",
  "apps/engine/src/server/routes/protocol-sessions.recommendations.test.ts",
  "apps/web/features/random-draft-simulator/coach-client.test.ts",
  "apps/web/features/random-draft-simulator/components/CoachPanel.test.tsx",
];

const result = spawnSync("bun", ["test", ...paths], { cwd: import.meta.dir + "/..", stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
