import { expect, test } from "bun:test";
import { isHeroCapabilities, loadHeroCapabilities } from "./capabilities";

test("capabilities.json carga entradas válidas y sin héroes duplicados", () => {
  const capabilities = loadHeroCapabilities();
  const ids = capabilities.map((entry) => entry.hero);

  expect(capabilities.length).toBeGreaterThan(0);
  expect(ids.length).toBe(new Set(ids).size);
  expect(capabilities.every(isHeroCapabilities)).toBe(true);
});
