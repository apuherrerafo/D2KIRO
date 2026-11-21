import { describe, expect, test } from "bun:test";
import { findForeignProducers, listProducers } from "./check-gate-producers";

// Fixtures con la forma REAL medida el 2026-11-13 en la sonda de falsificación (PR de prueba #132): mismo app `github-actions`, distinto workflow run.
const real = { id: 132137596895, name: "independent-review", suiteId: 117786843657 };
const forged = { id: 132137630473, name: "independent-review", suiteId: 117786840834 };
const gateRun = { checkSuiteId: 117786843657, path: ".github/workflows/release-gate.yml", event: "pull_request_target" };
const forgeRun = { checkSuiteId: 117786840834, path: ".github/workflows/forge-probe.yml", event: "pull_request" };

describe("productores del check independent-review", () => {
  test("solo el legítimo (release-gate.yml + pull_request_target) → sin ajenos", () => {
    expect(findForeignProducers([real], [gateRun, forgeRun])).toEqual([]);
  });

  test("PRUEBA NEGATIVA REAL: el check falsificado por un workflow del PR se detecta", () => {
    const foreign = findForeignProducers([real, forged], [gateRun, forgeRun]);
    expect(foreign).toHaveLength(1);
    expect(foreign[0]).toContain("forge-probe.yml");
  });

  test("un workflow del PR llamado release-gate.yml pero con evento pull_request NO es confiable", () => {
    const spoofedPath = { checkSuiteId: 117786840834, path: ".github/workflows/release-gate.yml", event: "pull_request" };
    expect(findForeignProducers([forged], [spoofedPath])).toHaveLength(1);
  });

  test("un check sin workflow run asociado (creado a mano por API) es ajeno", () => {
    expect(findForeignProducers([forged], [gateRun])).toEqual([expect.stringContaining("sin workflow run asociado")]);
  });

  test("checks con otro nombre se ignoran", () => {
    expect(findForeignProducers([{ id: 1, name: "test (web)", suiteId: 9 }], [])).toEqual([]);
  });

  test("listProducers lee la forma de la API y descarta entradas malformadas, sin lanzar", async () => {
    const fetchJson = async (url: string): Promise<unknown> =>
      url.includes("check-runs")
        ? { check_runs: [{ id: 1, name: "independent-review", check_suite: { id: 7 } }, { id: "x" }, null] }
        : { workflow_runs: [{ check_suite_id: 7, path: ".github/workflows/release-gate.yml", event: "pull_request_target" }, { path: 3 }] };
    const { checkRuns, workflowRuns } = await listProducers(fetchJson, "o/r", "a".repeat(40));
    expect(checkRuns).toEqual([{ id: 1, name: "independent-review", suiteId: 7 }]);
    expect(workflowRuns).toHaveLength(1);
    expect(findForeignProducers(checkRuns, workflowRuns)).toEqual([]);
  });
});
