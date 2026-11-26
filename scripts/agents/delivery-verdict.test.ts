import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideDelivery, REQUIRED_GATES } from "./delivery-verdict";

// Fixtures inline con el formato real de `gate()` de /dispatch. Se prueba la decisión, no el texto de ninguna instrucción.
const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const log = (cmd: string, exit: number, out = "") => `cwd: /repo\n$ ${cmd}\n${out}exit=${exit}\n`;
const good = (head = HEAD): Record<string, string> => ({
  sha: log("git rev-parse HEAD", 0, `${head}\n`),
  ...Object.fromEntries(Object.entries(REQUIRED_GATES).map(([n, c]) => [n, log(c, 0)])),
});
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("decisión de entrega", () => {
  test("todo correcto y Sentinel PASS → READY", () => {
    const d = decideDelivery(HEAD, good(), "PASS");
    expect(d.ready).toBe(true);
    expect(d.reasons).toEqual([]);
  });
  test("typecheck fallido (engine o web) → NOT_READY aunque Sentinel dé PASS", () => {
    for (const gate of ["tsc-engine", "tsc-web"]) {
      const d = decideDelivery(HEAD, { ...good(), [gate]: log("bunx tsc --noEmit", 2, "error TS2322\n") }, "PASS");
      expect(d.sentinel).toBe("PASS");
      expect(d.ready).toBe(false);
      expect(d.gates[gate]).toBe("FAIL");
    }
  });
  test("lint fallido → NOT_READY aunque Sentinel dé PASS", () => {
    const d = decideDelivery(HEAD, { ...good(), lint: log("bun run lint", 1, "1 error\n") }, "PASS");
    expect(d.ready).toBe(false);
    expect(d.gates.lint).toBe("FAIL");
  });
  test("evidencia ausente de cualquier comprobación obligatoria → NOT_READY", () => {
    for (const gate of Object.keys(REQUIRED_GATES)) {
      const logs: Record<string, string | undefined> = { ...good() };
      delete logs[gate];
      const d = decideDelivery(HEAD, logs, "PASS");
      expect(d.ready).toBe(false);
      expect(d.gates[gate]).toBe("MISSING");
    }
    expect(decideDelivery(HEAD, { ...good(), sha: undefined }, "PASS").ready).toBe(false);
  });
  test("evidencia de otro HEAD (obsoleta) → NOT_READY, aunque todo diga exit=0", () => {
    const d = decideDelivery(HEAD, good(OLD), "PASS");
    expect(d.ready).toBe(false);
    expect(Object.values(d.gates).every((s) => s === "STALE")).toBe(true);
  });
  test("log cortado (sin exit=) o de otro comando no cuenta", () => {
    expect(decideDelivery(HEAD, { ...good(), lint: "cwd: /repo\n$ bun run lint\nsalida a medias" }, "PASS").gates.lint).toBe("FAIL");
    const d = decideDelivery(HEAD, { ...good(), lint: log("echo listo", 0) }, "PASS");
    expect(d.gates.lint).toBe("WRONG_COMMAND");
    expect(d.ready).toBe(false);
  });
  test("Sentinel distinto de PASS no permite READY aunque todo pase; los dos resultados son independientes", () => {
    for (const v of ["FAIL", "BLOCKED", "NOT_VERIFIED", ""]) expect(decideDelivery(HEAD, good(), v).ready).toBe(false);
    const d = decideDelivery(HEAD, { ...good(), lint: log("bun run lint", 1) }, "PASS");
    expect(d.sentinel).toBe("PASS");
    expect(d.ready).toBe(false);
  });
});

describe("mecanismo real: la CLI sobre carpeta de evidencia", () => {
  function run(logs: Record<string, string>, head: string, sentinel: string): { code: number; out: any } {
    const dir = mkdtempSync(join(tmpdir(), "d2k-deliv-"));
    dirs.push(dir);
    for (const [n, t] of Object.entries(logs)) writeFileSync(join(dir, `${n}.log`), t);
    const r = Bun.spawnSync(["bun", join(import.meta.dir, "delivery-verdict.ts"), dir, head, sentinel], { stdout: "pipe", stderr: "pipe" });
    return { code: r.exitCode, out: JSON.parse(r.stdout.toString()) };
  }
  test("READY → exit 0; typecheck rojo, lint rojo, ausente y obsoleta → exit 1, con Sentinel PASS", () => {
    expect(run(good(), HEAD, "PASS")).toMatchObject({ code: 0, out: { resultado: "READY" } });
    expect(run({ ...good(), "tsc-web": log("bunx tsc --noEmit", 2) }, HEAD, "PASS")).toMatchObject({ code: 1, out: { resultado: "NOT_READY" } });
    expect(run({ ...good(), lint: log("bun run lint", 1) }, HEAD, "PASS").code).toBe(1);
    const { lint: _omit, ...sinLint } = good();
    expect(run(sinLint, HEAD, "PASS").code).toBe(1);
    expect(run(good(OLD), HEAD, "PASS").code).toBe(1);
  });
  test("sin argumentos → exit 2", () => {
    expect(Bun.spawnSync(["bun", join(import.meta.dir, "delivery-verdict.ts")], { stdout: "pipe", stderr: "pipe" }).exitCode).toBe(2);
  });
});
