import { describe, expect, test } from "bun:test";
import { describeMeta, describePool, describeTeams, greetingFor } from "./prep-status";

describe("greetingFor", () => {
  test("saluda por el nombre de Steam; sin nombre real, solo 'Hola' (nunca el identificador)", () => {
    expect(greetingFor("Kiro")).toBe("Hola, Kiro");
    expect(greetingFor(null)).toBe("Hola");
    expect(greetingFor("   ")).toBe("Hola");
    expect(greetingFor("Jugador de Steam")).toBe("Hola");
  });
});

describe("describePool", () => {
  test("cada estado dice lo que pasa: cargando, error, vacío y listo", () => {
    expect(describePool(true, false, 0, 5).kind).toBe("loading");
    expect(describePool(false, true, 0, 5).kind).toBe("error");
    expect(describePool(false, false, 0, 5).kind).toBe("empty");
    expect(describePool(false, false, 3, 5)).toEqual({ kind: "ready", text: "3 de 5 héroes en tu pool." });
  });

  test("un error de lectura no se presenta como pool vacío", () => {
    expect(describePool(false, true, 0, 5).text).not.toContain("Todavía no elegiste");
  });
});

describe("describeTeams", () => {
  test("singular y plural, y vacío explicado", () => {
    expect(describeTeams(false, false, 0).kind).toBe("empty");
    expect(describeTeams(false, false, 1).text).toBe("1 equipo guardado.");
    expect(describeTeams(false, false, 4).text).toBe("4 equipos guardados.");
    expect(describeTeams(false, true, 0).kind).toBe("error");
  });
});

describe("describeMeta", () => {
  test("nunca sincronizado, desactualizado, al día y error", () => {
    expect(describeMeta(false, false, { syncedAt: null, isStale: true }).kind).toBe("empty");
    expect(describeMeta(false, false, { syncedAt: "2026-11-10T10:00:00Z", isStale: true }).kind).toBe("stale");
    expect(describeMeta(false, false, { syncedAt: "2026-11-10T10:00:00Z", isStale: false }).kind).toBe("ready");
    expect(describeMeta(false, true, null).kind).toBe("error");
    expect(describeMeta(true, false, null).kind).toBe("loading");
  });
});
