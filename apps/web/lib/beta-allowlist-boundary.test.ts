import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("el allowlist sólo se lee en el callback de servidor y nunca mediante una variable NEXT_PUBLIC", () => {
  const callback = readFileSync(resolve(import.meta.dir, "../app/api/auth/steam/callback/route.ts"), "utf8");
  const clientSources = [resolve(import.meta.dir, "../features"), resolve(import.meta.dir, "../components")]
    .flatMap((directory) => readdirSync(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.[jt]sx?$/.test(entry.name))
    .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), "utf8"));

  expect(callback).toContain("process.env.BETA_ALLOWED_STEAM_IDS");
  expect(callback).not.toContain("NEXT_PUBLIC_BETA_ALLOWED_STEAM_IDS");
  expect(clientSources.join("\n")).not.toContain("BETA_ALLOWED_STEAM_IDS");
});
