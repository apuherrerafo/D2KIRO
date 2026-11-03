import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LIVE_ENGINE_ENTRYPOINT,
  buildLiveCaptureConfig,
  engineEnv,
  liveCaptureConfigPaths,
  liveDraftUrl,
  readyBanner,
  webEnv,
} from "./dev-live-config";

const SECRETS = { captureToken: "c".repeat(64), sessionSecret: "s".repeat(64), internalAuthSecret: "i".repeat(64) };
const ROOT = resolve(import.meta.dir, "..");

describe("dev:live config", () => {
  test("usa el entrypoint de PRODUCCIÓN del motor, nunca index.e2e.ts", () => {
    expect(LIVE_ENGINE_ENTRYPOINT).toBe("src/index.ts");
    expect(readFileSync(resolve(import.meta.dir, "dev-live.ts"), "utf8")).not.toContain("index.e2e");
  });

  test("motor en 127.0.0.1:4000 con el token por entorno; web con draft en vivo y WS local", () => {
    expect(engineEnv(SECRETS, "/tmp/db.sqlite")).toMatchObject({ ENGINE_PORT: "4000", CAPTURE_TOKEN: SECRETS.captureToken });
    expect(webEnv(SECRETS)).toMatchObject({
      ENGINE_INTERNAL_URL: "http://127.0.0.1:4000",
      PUBLIC_BASE_URL: "http://127.0.0.1:3000",
      DRAFT_LIVE_ENABLED: "true",
      NEXT_PUBLIC_ENGINE_WS_URL: "ws://127.0.0.1:4000/ws/draft",
    });
    expect(JSON.stringify(webEnv(SECRETS))).not.toContain(SECRETS.captureToken);
    expect(JSON.stringify([engineEnv(SECRETS, "x"), webEnv(SECRETS)])).not.toContain("0.0.0.0");
  });

  test("config de captura local: motor loopback, sesión y token", () => {
    expect(buildLiveCaptureConfig("abc-12345678", SECRETS.captureToken)).toEqual({ engineUrl: "http://127.0.0.1:4000", sessionId: "abc-12345678", captureToken: SECRETS.captureToken });
  });

  test("el banner imprime sólo READY + URL + espera, nunca el token", () => {
    const banner = readyBanner("abc-12345678");
    expect(banner).toEqual(["D2KIRO LIVE READY", `URL: ${liveDraftUrl("abc-12345678")}`, "Waiting for Dota 2..."]);
    expect(banner[1]).toBe("URL: http://127.0.0.1:3000/live-draft?session=abc-12345678");
    expect(banner.join("\n")).not.toContain(SECRETS.captureToken);
  });

  test("las dos copias del config están gitignoradas", () => {
    const ignored = readFileSync(resolve(ROOT, ".gitignore"), "utf8");
    const paths = liveCaptureConfigPaths(ROOT).map((path) => path.slice(ROOT.length + 1).replaceAll("\\", "/"));
    expect(paths).toEqual([".local/dota-live-capture.json", "scripts/live/overwolf-capture/local/dota-live-capture.json"]);
    expect(ignored).toContain(".local/");
    expect(ignored).toContain("scripts/live/overwolf-capture/local/");
  });
});
