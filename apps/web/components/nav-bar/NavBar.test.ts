import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { accountLabel, buildNavLinks, profileLabel } from "./NavBar";

// TSK-187 (Fase 8B, SPEC.md §14.8): el nav pasa de 7 a 4 links.
describe("buildNavLinks", () => {
  test("expone exactamente 4 links: Simulador, Mi pool, Meta, Configuración", () => {
    expect(buildNavLinks()).toEqual([
      { href: "/simulator", label: "Simulador de Draft" },
      { href: "/hero-pool", label: "Mi pool" },
      { href: "/meta", label: "Meta" },
      { href: "/settings", label: "Configuración" },
    ]);
  });

  test("no expone las rutas ocultas en 8B ni las ambiguas anteriores", () => {
    const hrefs = buildNavLinks().map((link) => link.href);

    for (const hidden of ["/live-draft", "/team-groups", "/heroes", "/draft", "/random-draft"]) {
      expect(hrefs).not.toContain(hidden);
    }
  });
});

// §14.8 criterio 9: quitar el link del nav NO borra la ruta -- las 3 páginas siguen en el repo,
// alcanzables por URL directa (reversible). Guarda contra un borrado accidental al ocultar el link.
describe("8B -- las rutas quitadas del nav siguen existiendo", () => {
  test.each(["live-draft", "team-groups", "heroes"])("app/%s/page.tsx sigue en el repo", (route) => {
    expect(existsSync(join(import.meta.dir, "..", "..", "app", route, "page.tsx"))).toBe(true);
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

describe("profileLabel", () => {
  test("muestra el nombre de Steam y conserva el Steam32 como identidad secundaria", () => {
    expect(profileLabel({ accountId: 35488109, personaName: "Kiro", avatarUrl: "https://avatars.steamstatic.com/avatar.jpg" })).toEqual({
      displayName: "Kiro",
      accountIdLabel: "35488109",
    });
  });

  test("sin perfil remoto conserva el fallback legible basado en Steam32", () => {
    expect(profileLabel({ accountId: 35488109, personaName: `Steam 35488109`, avatarUrl: null })).toEqual({
      displayName: "Steam 35488109",
      accountIdLabel: "35488109",
    });
  });
});
