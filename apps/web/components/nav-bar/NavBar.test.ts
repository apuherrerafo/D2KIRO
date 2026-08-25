import { describe, expect, test } from "bun:test";
import { accountLabel, buildNavLinks } from "./NavBar";

describe("buildNavLinks", () => {
  test("con draft habilitado expone Draft en vivo en su ruta explícita", () => {
    const draftLink = buildNavLinks(true).find((link) => link.href === "/live-draft");

    expect(draftLink?.label).toBe("Draft en vivo");
  });

  test("con draft apagado el NavBar conserva que el draft en vivo es local", () => {
    const draftLink = buildNavLinks(false).find((link) => link.href === "/live-draft");

    expect(draftLink?.label).toBe("Draft en vivo local");
  });

  test("prioriza el Simulador de Draft en su ruta explícita", () => {
    const randomDraftLink = buildNavLinks(true).find((link) => link.href === "/simulator");

    expect(randomDraftLink?.label).toBe("Simulador de Draft");
  });

  test("no expone las rutas ambiguas anteriores", () => {
    const oldDraftLink = buildNavLinks(true).find((link) => link.href === "/draft");
    const oldSimulatorLink = buildNavLinks(true).find((link) => link.href === "/random-draft");

    expect(oldDraftLink).toBeUndefined();
    expect(oldSimulatorLink).toBeUndefined();
  });
});

describe("accountLabel", () => {
  test("muestra el Steam32 activo sin nombre ni avatar externos", () => {
    expect(accountLabel(35488109)).toBe("Cuenta · 35488109");
  });

  test("conserva una etiqueta neutra mientras carga la cuenta", () => {
    expect(accountLabel(null)).toBe("Mi cuenta");
  });
});
