import { describe, expect, test } from "bun:test";
import { evaluate, formatReport, type PreflightFacts } from "./live-preflight-core";

function readyFacts(): PreflightFacts {
  return {
    worktreeRoot: "D:/repo",
    bunVersion: "1.4.2",
    depsInstalled: { root: true, web: true, engine: true },
    dotaInstallFound: true,
    dotaRunning: false,
    launchOptionGsi: true,
    gsiCfg: { found: true, uri: "http://127.0.0.1:53122/gsi", hasTokenShape: true, sections: ["provider", "map", "player", "hero", "draft", "events"] },
    companion: { configFound: true, schemaOk: true, port: 53122, siteOrigin: "https://localhost:3443", healthOk: true },
    expectedOrigin: "https://localhost:3443",
    webPort: { port: 3000, owner: { pid: 1, ours: true } },
    enginePort: { port: 4000, owner: { pid: 2, ours: true } },
    httpsProxyUp: true,
    engineHealthy: true,
    webHealthy: true,
    engineEntrypoint: "production",
    metaReady: true,
  };
}

const failing = (facts: PreflightFacts) =>
  evaluate(facts)
    .findings.filter((f) => f.severity === "P0" && !f.ok)
    .map((f) => f.id);

describe("live preflight", () => {
  test("motor con index.e2e.ts (capacidades de prueba) bloquea una sesión auténtica", () => {
    const facts = readyFacts();
    facts.engineEntrypoint = "test";
    expect(failing(facts)).toEqual(["engine-real"]);
  });

  test("meta vieja o vacía NO bloquea (aviso P1): el motor degrada a confianza baja, no se cae", () => {
    const facts = readyFacts();
    facts.metaReady = false;
    const report = evaluate(facts);
    expect(report.verdict).toBe("LISTO");
    expect(report.findings.find((f) => f.id === "meta-ready")?.ok).toBe(false);
  });

  test("motor de origen desconocido tampoco se declara seguro", () => {
    const facts = readyFacts();
    facts.engineEntrypoint = "unknown";
    expect(failing(facts)).toEqual(["engine-real"]);
  });

  test("todo en orden: LISTO, y lo que exige el juego queda UNTESTED (nunca PASS)", () => {
    const report = evaluate(readyFacts());
    expect(report.verdict).toBe("LISTO");
    const untested = report.findings.filter((f) => f.severity === "UNTESTED");
    expect(untested.length).toBeGreaterThan(0);
    expect(untested.every((f) => f.ok === false)).toBe(true);
  });

  test("Companion emparejado a OTRO despliegue (preview) bloquea: Dota alimentaría otro código", () => {
    const facts = readyFacts();
    facts.companion.siteOrigin = "https://d2kiro-f4-preview-preview.up.railway.app";
    expect(failing(facts)).toEqual(["companion-pairing"]);
  });

  test("puerto ocupado por un proceso que no es de este código bloquea", () => {
    const facts = readyFacts();
    facts.enginePort = { port: 4000, owner: { pid: 99, ours: false } };
    expect(failing(facts)).toContain("port-4000");
    expect(evaluate(facts).verdict).toBe("BLOQUEADO");
  });

  test("el cfg sin `events` bloquea: los bans de Ranked llegan SÓLO por events", () => {
    const facts = readyFacts();
    facts.gsiCfg.sections = ["provider", "map", "player", "hero", "draft"];
    expect(failing(facts)).toEqual(["gsi-sections"]);
  });

  test("el cfg que apunta a un puerto distinto del Companion bloquea", () => {
    const facts = readyFacts();
    facts.gsiCfg.uri = "http://127.0.0.1:53120/gsi";
    expect(failing(facts)).toEqual(["gsi-cfg"]);
  });

  test("opción de lanzamiento ilegible NO se da por buena", () => {
    const facts = readyFacts();
    facts.launchOptionGsi = null;
    expect(failing(facts)).toEqual(["launch-option"]);
  });

  test("Dota abierto es aviso P1, no bloquea", () => {
    const facts = readyFacts();
    facts.dotaRunning = true;
    expect(evaluate(facts).verdict).toBe("LISTO");
  });

  test("servicios caídos: BLOQUEADO con acción concreta, y el texto nunca trae token ni Steam id", () => {
    const facts = readyFacts();
    facts.engineHealthy = false;
    facts.webHealthy = false;
    facts.httpsProxyUp = false;
    const text = formatReport(evaluate(facts)).join("\n");
    expect(text).toContain("BLOQUEADO");
    expect(text).not.toMatch(/[0-9a-f]{32,}/);
  });
});
