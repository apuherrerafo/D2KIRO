import { describe, expect, test } from "bun:test";
import { displayPersonaName } from "./session";
import { ANONYMOUS_PERSONA_NAME } from "./steam-profile";

// El identificador interno de Steam no es parte de la interfaz: ni como nombre, ni siquiera en sesiones viejas que lo traen.
describe("displayPersonaName", () => {
  test("un nombre real de Steam se conserva", () => {
    expect(displayPersonaName("Kiro")).toBe("Kiro");
  });

  test("sin nombre, o con el 'Steam <id>' que emitían las sesiones anteriores, se muestra un nombre neutro", () => {
    expect(displayPersonaName(undefined)).toBe(ANONYMOUS_PERSONA_NAME);
    expect(displayPersonaName("Steam 35488109")).toBe(ANONYMOUS_PERSONA_NAME);
    expect(ANONYMOUS_PERSONA_NAME).not.toMatch(/\d/);
  });

  test("un nombre que solo empieza con 'Steam' no se reemplaza", () => {
    expect(displayPersonaName("Steam Punk")).toBe("Steam Punk");
  });
});
