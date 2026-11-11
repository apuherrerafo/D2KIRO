import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { accountLabel, buildNavLinks, isActiveLink, isHiddenForVisitor } from "./NavBar";

// El recorrido del MVP: las cinco rutas de trabajo del jugador. La cuenta vive en el chip de la derecha (/settings).
describe("buildNavLinks", () => {
  test("expone exactamente 5 links: Simulador, Draft en vivo, Mi pool, Equipos, Meta", () => {
    expect(buildNavLinks()).toEqual([
      { href: "/simulator", label: "Simulador" },
      { href: "/live-draft", label: "Draft en vivo" },
      { href: "/hero-pool", label: "Mi pool" },
      { href: "/team-groups", label: "Equipos" },
      { href: "/meta", label: "Meta" },
    ]);
  });

  test("no expone el catálogo ni las redirecciones de enlaces antiguos", () => {
    const hrefs = buildNavLinks().map((link) => link.href);
    for (const hidden of ["/heroes", "/draft", "/random-draft"]) {
      expect(hrefs).not.toContain(hidden);
    }
  });

  test("cada link del menú resuelve a una ruta real del repo", () => {
    for (const link of buildNavLinks()) {
      expect(existsSync(join(import.meta.dir, "..", "..", "app", link.href, "page.tsx"))).toBe(true);
    }
  });
});

// Quitar un link del menú no borra la ruta: el catálogo sigue alcanzable por URL directa.
describe("las rutas fuera del menú siguen existiendo", () => {
  test.each(["heroes", "settings"])("app/%s/page.tsx sigue en el repo", (route) => {
    expect(existsSync(join(import.meta.dir, "..", "..", "app", route, "page.tsx"))).toBe(true);
  });
});

describe("accountLabel", () => {
  test("muestra el nombre de Steam, nunca el identificador", () => {
    expect(accountLabel({ accountId: 35488109, personaName: "Kiro", avatarUrl: null })).toBe("Kiro");
  });

  test("mientras carga, o sin nombre, conserva la etiqueta neutra", () => {
    expect(accountLabel(null)).toBe("Mi cuenta");
    expect(accountLabel({ accountId: 35488109, personaName: "   ", avatarUrl: null })).toBe("Mi cuenta");
  });
});

describe("isActiveLink", () => {
  test("marca la ruta actual y sus subrutas, no una que solo comparta prefijo", () => {
    expect(isActiveLink("/simulator", "/simulator")).toBe(true);
    expect(isActiveLink("/live-draft/x", "/live-draft")).toBe(true);
    expect(isActiveLink("/live-drafts", "/live-draft")).toBe(false);
    expect(isActiveLink(null, "/meta")).toBe(false);
  });
});

describe("isHiddenForVisitor", () => {
  test("la portada pública trae su propia barra; el resto de puertas públicas muestran la marca", () => {
    expect(isHiddenForVisitor(false, "/")).toBe(true);
    expect(isHiddenForVisitor(false, "/login")).toBe(false);
    expect(isHiddenForVisitor(true, "/")).toBe(false);
  });
});

describe("una sola barra para todo el sitio", () => {
  test("la barra no carga un marco distinto por ruta ni muestra el identificador de Steam", () => {
    const source = readFileSync(join(import.meta.dir, "NavBar.tsx"), "utf8");
    expect(source).not.toContain("LiveNavFrame");
    expect(source).not.toMatch(/accountId\}|accountIdLabel|\.accountId/);
  });
});
