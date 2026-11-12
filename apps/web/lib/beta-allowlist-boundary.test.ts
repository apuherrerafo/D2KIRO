import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

test("el allowlist sólo se lee en el callback de servidor y nunca mediante una variable NEXT_PUBLIC", () => {
  const callback = readFileSync(resolve(import.meta.dir, "../app/api/auth/steam/callback/route.ts"), "utf8");
  const clientSources = [resolve(import.meta.dir, "../features"), resolve(import.meta.dir, "../components")]
    .flatMap((directory) => readdirSync(directory, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.[jt]sx?$/.test(entry.name))
    .map((entry) => readFileSync(resolve(entry.parentPath, entry.name), "utf8"));

  const access = readFileSync(resolve(import.meta.dir, "beta-access.ts"), "utf8");
  // El callback decide con `isAccountAllowedNow` (lista fija + administradores + invitados aprobados); las listas solo se leen en el servidor.
  expect(callback).toContain("isAccountAllowedNow(accountId, process.env)");
  expect(access).toContain("env.BETA_ALLOWED_STEAM_IDS");
  expect(access).toContain("env.BETA_ADMIN_STEAM_IDS");
  for (const source of [callback, access]) expect(source).not.toMatch(/NEXT_PUBLIC_BETA_/);
  expect(clientSources.join("\n")).not.toMatch(/BETA_ALLOWED_STEAM_IDS|BETA_ADMIN_STEAM_IDS/);
});
