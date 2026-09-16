import { runEngine } from "./bootstrap";

// TEST-ONLY entrypoint (R1 S7 final blocker repair, Blocker 1). NEVER referenced by
// apps/engine/package.json's "start"/"dev" scripts or by scripts/start-railway.sh -- Railway's
// `bun run start` and a plain `cd apps/engine && bun run dev` both resolve to index.ts, never this
// file. The only callers are playwright.config.ts's webServer.command (the real browser E2E suite,
// `bun run e2e`) and scripts/dev-mvp.ts (a local-only convenience script for the project owner,
// never deployed) -- neither is a path Railway/production can reach.
//
// This is the ONLY file in the codebase that hardcodes `allowClientForcedBotSelection: true` --
// not from an environment variable, a literal `true`. index.ts never sets it, and nothing in
// index.ts reads `process.env` for it, so setting an ordinary env var in production cannot turn
// this on there even by accident -- the capability only exists because THIS file was the one
// constructed, never because of anything an operator configured.
//
// `cmEligibilityArtifactPath` still reads an env var here, same as before -- that stays safe for
// the same reason: only this file (never index.ts) forwards it into runEngine().
runEngine({
  cmEligibilityArtifactPath: process.env.CM_ELIGIBILITY_ARTIFACT_PATH,
  allowClientForcedBotSelection: true,
});
