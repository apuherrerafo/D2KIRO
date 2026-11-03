import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("la beta privada sólo expone Ranked All Pick en el simulador", () => {
  const page = readFileSync(resolve(import.meta.dir, "page.tsx"), "utf8");

  expect(page).toContain('data-testid="mode-tab-ranked-all-pick"');
  expect(page).not.toContain("mode-tab-captains-mode");
  expect(page).not.toContain('import { CaptainsModeSimulator }');
  expect(page).not.toContain('"captains_mode"');
});
