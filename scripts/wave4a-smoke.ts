#!/usr/bin/env bun
// WAVE 4A -- automated, headless product smoke (Safe Core V1 + curated counter evidence + Opportunity block).
// NOT the full Wave 4: Task 26 (side context) and Task 27 (one-ply) are BLOCKED and are not covered.
// No browser/network/server process is required: the scenarios live in the engine's perspective-safe
// harness (apps/engine/src/coach/wave4a.smoke.test.ts) and the rendered Coach panel tests.
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
