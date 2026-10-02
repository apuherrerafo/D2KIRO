import { resolve } from "node:path";

// `bun run dev:live` -- the pure half (paths, env, local capture config, banner), testable without
// spawning anything. scripts/dev-live.ts is the process half.
//
// Live mode runs the PRODUCTION engine entrypoint (apps/engine/src/index.ts) -- never index.e2e.ts,
// which enables test-only capabilities. The capture token is minted per run, handed to the engine via
// its environment and to the local Overwolf capturer via a gitignored file; it is never printed.

export const LIVE_ENGINE_HOST = "127.0.0.1";
export const LIVE_ENGINE_PORT = 4000;
export const LIVE_WEB_PORT = 3000;
export const LIVE_ENGINE_URL = `http://${LIVE_ENGINE_HOST}:${LIVE_ENGINE_PORT}`;
export const LIVE_WEB_URL = `http://${LIVE_ENGINE_HOST}:${LIVE_WEB_PORT}`;
export const LIVE_ENGINE_WS_URL = `ws://${LIVE_ENGINE_HOST}:${LIVE_ENGINE_PORT}/ws/draft`;
/** Production entrypoint, relative to apps/engine. */
export const LIVE_ENGINE_ENTRYPOINT = "src/index.ts";
/** The unpacked Overwolf extension folder the Player loads (Development options -> Load unpacked). */
export const OVERWOLF_EXTENSION_DIR = "scripts/live/overwolf-capture";

export interface LiveCaptureConfig {
  engineUrl: string;
  sessionId: string;
  captureToken: string;
}

/** Both copies are gitignored: the canonical one at the repo root, and the one the extension can read from its own folder. */
export function liveCaptureConfigPaths(root: string): string[] {
  return [resolve(root, ".local/dota-live-capture.json"), resolve(root, OVERWOLF_EXTENSION_DIR, "local/dota-live-capture.json")];
}

export function buildLiveCaptureConfig(sessionId: string, captureToken: string): LiveCaptureConfig {
  return { engineUrl: LIVE_ENGINE_URL, sessionId, captureToken };
}

export interface LiveSecrets {
  captureToken: string;
  sessionSecret: string;
  internalAuthSecret: string;
}

export function engineEnv(secrets: LiveSecrets, databasePath: string): Record<string, string> {
  return {
    ENGINE_PORT: String(LIVE_ENGINE_PORT),
    ENGINE_DB_PATH: databasePath,
    CAPTURE_TOKEN: secrets.captureToken,
    INTERNAL_AUTH_SECRET: secrets.internalAuthSecret,
  };
}

export function webEnv(secrets: LiveSecrets): Record<string, string> {
  return {
    ENGINE_INTERNAL_URL: LIVE_ENGINE_URL,
    SESSION_SECRET: secrets.sessionSecret,
    INTERNAL_AUTH_SECRET: secrets.internalAuthSecret,
    PUBLIC_BASE_URL: LIVE_WEB_URL,
    DRAFT_LIVE_ENABLED: "true",
    NEXT_PUBLIC_ENGINE_WS_URL: LIVE_ENGINE_WS_URL,
  };
}

export function liveDraftUrl(sessionId: string): string {
  return `${LIVE_WEB_URL}/live-draft?session=${encodeURIComponent(sessionId)}`;
}

/** The ONLY lines `dev:live` prints on success. No token, no secret. */
export function readyBanner(sessionId: string): string[] {
  return ["D2KIRO LIVE READY", `URL: ${liveDraftUrl(sessionId)}`, "Waiting for Dota 2..."];
}
