import { runEngine } from "./bootstrap";

// PRODUCTION entrypoint. `apps/engine/package.json`'s "start" (what scripts/start-railway.sh
// actually runs) and "dev" scripts both resolve to this exact file, and nothing else in the repo
// does. Deliberately zero test overrides, unconditionally -- no `process.env` lookup anywhere in
// this file for a test-only capability, so no environment variable, however it is set (by
// accident, by a copied .env template, by anything), can activate one here. The test-only
// counterpart is index.e2e.ts, wired only from playwright.config.ts's webServer.command and
// scripts/dev-mvp.ts -- never from a production start path.
runEngine();
