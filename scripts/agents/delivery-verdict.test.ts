import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideDelivery, normalizePath, PACKAGE_LOGS, parseDispatchGates, REQUIRED_GATE_NAMES, sealSentinel, verdictOf } from "./delivery-verdict";

// El bloque de /dispatch es la ÚNICA definición de los comandos: aquí se lee el real, así que si alguien cambia un
// comando allí, estas pruebas cruzan el cambio con el decisor. Los logs son fixtures inline con el formato real de `gate()`.
const DISPATCH = readFileSync(join(import.meta.dir, "..", "..", ".claude", "skills", "dispatch", "SKILL.md"), "utf8");
const SPECS = new Map(parseDispatchGates(DISPATCH).map((s) => [s.name, s]));
const ROOT = "/d/proyecto";
const HEAD = "a".repeat(40);
const OTHER = "b".repeat(40);
const log = (cwd: string, cmd: string, exit: number, out = "") => `cwd: ${cwd}\n$ ${cmd}\n${out}exit=${exit}\n`;
const at = (name: string, exit = 0, out = "") => {
  const s = SPECS.get(name)!;
  return log(s.cwd ? `${ROOT}/${s.cwd}` : ROOT, s.command, exit, out);
};
const SHA = (h: string) => log(ROOT, "git rev-parse HEAD", 0, `${h}\n`);
const CLEAN = (cmd: string) => log(ROOT, cmd, 0);
const DIFF = (h: string, out = "diff --git a/x b/x\n+x\n", exit = 0, root = ROOT) => log(root, `git diff base...${h}`, exit, out);
const SENTINEL_PASS = '```json\n{ "veredicto": "PASS", "bloqueante": false, "hallazgos": [], "evidencia_solicitada": [] }\n```';

/** Paquete completo y correcto para `head`, con Sentinel sellado. */
function pack(head = HEAD, sentinel = SENTINEL_PASS): Record<string, string> {
  const logs: Record<string, string> = {
    sha: SHA(head),
    status: CLEAN("git status --short -uall"),
    diff: DIFF(head),
    "diff-local": CLEAN("git diff HEAD"),
    "diff-nuevos": CLEAN("bash -c ..."),
    ...Object.fromEntries(REQUIRED_GATE_NAMES.map((n) => [n, at(n)])),
    "sha-final": SHA(head),
    "status-final": CLEAN("git status --short -uall"),
  };
  logs.sentinel = sealSentinel(head, logs, sentinel);
  return logs;
}
/** Cambia un log y vuelve a sellar a Sentinel (como si Sentinel hubiera revisado ESE paquete). */
function mutate(change: Record<string, string | undefined>, head = HEAD): Record<string, string | undefined> {
  const logs: Record<string, string | undefined> = { ...pack(head), ...change };
  delete logs.sentinel;
  logs.sentinel = sealSentinel(head, logs, SENTINEL_PASS);
  return logs;
}
const decide = (logs: Record<string, string | undefined>, head = HEAD) => decideDelivery({ head, root: ROOT, logs, dispatchText: DISPATCH });
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe("una sola definición de los comandos: el bloque de /dispatch", () => {
  test("de él salen los cinco gates obligatorios, con su carpeta", () => {
    expect([...REQUIRED_GATE_NAMES].every((n) => SPECS.has(n))).toBe(true);
    expect(SPECS.get("tsc-engine")).toMatchObject({ cwd: "apps/engine", command: "bunx tsc --noEmit" });
    expect(SPECS.get("tsc-web")).toMatchObject({ cwd: "apps/web", command: "bunx tsc --noEmit" });
    expect(SPECS.get("lint")).toMatchObject({ cwd: "apps/web", command: "bun run lint" });
    expect(SPECS.get("test")).toMatchObject({ cwd: "", command: "bun run test" });
  });
  test("el paquete real incluye los logs de cierre que el decisor exige", () => {
    for (const n of ["sha-final", "status-final"]) expect(SPECS.has(n)).toBe(true);
    for (const n of PACKAGE_LOGS) expect(SPECS.has(n) || ["diff", "diff-local", "diff-nuevos"].includes(n)).toBe(true);
  });
  test("si /dispatch cambia el comando de un gate, el decisor exige el nuevo (no queda una copia vieja)", () => {
    const cambiado = DISPATCH.replace("gate test bun run test", "gate test bun run test:ci");
    const d = decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: cambiado });
    expect(d.ready).toBe(false);
    expect(d.gates.test).toBe("WRONG_COMMAND");
  });
  test("un /dispatch sin algún gate obligatorio no permite READY", () => {
    expect(decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: "" }).ready).toBe(false);
  });
});

describe("decisión de entrega", () => {
  test("todo correcto y Sentinel verificado → READY", () => {
    const d = decide(pack());
    expect(d.reasons).toEqual([]);
    expect(d.ready).toBe(true);
    expect(d.sentinel).toBe("PASS");
  });
  test("typecheck o lint fallidos → NOT_READY aunque Sentinel dé PASS", () => {
    for (const g of ["tsc-engine", "tsc-web", "lint", "test", "simplicity"]) {
      const d = decide(mutate({ [g]: at(g, 2, "error\n") }));
      expect(d.sentinel).toBe("PASS");
      expect(d.ready).toBe(false);
      expect(d.gates[g]).toBe("FAIL");
    }
  });
  test("evidencia ausente de cualquier gate o de cualquier log de cierre → NOT_READY", () => {
    for (const g of REQUIRED_GATE_NAMES) expect(decide(mutate({ [g]: undefined })).gates[g]).toBe("MISSING");
    for (const n of ["sha", "sha-final", "status", "status-final", "diff-local"]) expect(decide(mutate({ [n]: undefined })).ready).toBe(false);
  });
  test("log con cwd incorrecto → NOT_READY", () => {
    const d = decide(mutate({ lint: log(`${ROOT}/apps/engine`, "bun run lint", 0) }));
    expect(d.gates.lint).toBe("WRONG_CWD");
    expect(d.ready).toBe(false);
    expect(decide(mutate({ test: log(`${ROOT}/apps/web`, "bun run test", 0) })).gates.test).toBe("WRONG_CWD");
  });
  test("logs intercambiados entre gates (mismo comando, otra carpeta) → NOT_READY", () => {
    const d = decide(mutate({ "tsc-engine": at("tsc-web"), "tsc-web": at("tsc-engine") }));
    expect(d.gates["tsc-engine"]).toBe("WRONG_CWD");
    expect(d.gates["tsc-web"]).toBe("WRONG_CWD");
    expect(d.ready).toBe(false);
    expect(decide(mutate({ "tsc-web": at("tsc-engine") })).ready).toBe(false);
  });
  test("la misma carpeta con otra escritura de la ruta (Git Bash vs Windows) sí vale", () => {
    expect(normalizePath("/d/Proyecto/apps/web/")).toBe(normalizePath("D:\\proyecto\\apps\\web"));
    const win = (n: string) => at(n).replace(ROOT, "D:\\proyecto").replace(/apps\/(web|engine)/, "apps\\$1");
    expect(decide(mutate({ lint: win("lint") })).gates.lint).toBe("PASS");
  });
  test("árbol sucio antes o después de los gates, o cambios sin confirmar → NOT_READY", () => {
    for (const n of ["status", "status-final"]) {
      const d = decide(mutate({ [n]: log(ROOT, "git status --short -uall", 0, " M apps/engine/src/x.ts\n") }));
      expect(d.ready).toBe(false);
      expect(d.reasons.join(" ")).toContain("árbol sucio");
    }
    const d = decide(mutate({ "diff-local": log(ROOT, "git diff HEAD", 0, "diff --git a/x b/x\n+cambio\n") }));
    expect(d.ready).toBe(false);
    expect(Object.values(d.gates).every((s) => s === "STALE")).toBe(true);
  });
  test("evidencia de otro HEAD, o un HEAD que se movió durante los gates → NOT_READY", () => {
    expect(decide(pack(OTHER), HEAD).ready).toBe(false);
    const movido = decide(mutate({ "sha-final": SHA(OTHER) }));
    expect(movido.ready).toBe(false);
    expect(movido.reasons.join(" ")).toContain("sha-final.log");
    expect(decide(pack(), "abc").ready).toBe(false);
  });
  test("log cortado (sin exit=) o de otro comando no cuenta", () => {
    expect(decide(mutate({ lint: `cwd: ${ROOT}/apps/web\n$ bun run lint\nsalida a medias` })).gates.lint).toBe("FAIL");
    expect(decide(mutate({ lint: log(`${ROOT}/apps/web`, "echo listo", 0) })).gates.lint).toBe("WRONG_COMMAND");
  });
});

describe("Sentinel con procedencia, separado del resultado global", () => {
  test("PASS sin procedencia (sin sentinel.log, o texto suelto sin sello) → NOT_READY", () => {
    const sin: Record<string, string | undefined> = { ...pack() };
    delete sin.sentinel;
    expect(decide(sin).ready).toBe(false);
    expect(decide(sin).sentinel).toBe("SIN_PROCEDENCIA");
    expect(decide({ ...sin, sentinel: SENTINEL_PASS }).ready).toBe(false);
    expect(decide({ ...sin, sentinel: `head: ${HEAD}\n---\n${SENTINEL_PASS}` }).sentinel).toBe("SIN_PROCEDENCIA");
  });
  test("PASS sellado a otro HEAD → NOT_READY", () => {
    const logs = pack();
    logs.sentinel = sealSentinel(OTHER, logs, SENTINEL_PASS);
    const d = decide(logs);
    expect(d.sentinel).toBe("OTRO_HEAD");
    expect(d.ready).toBe(false);
  });
  test("PASS de un paquete que luego cambió → NOT_READY", () => {
    const logs = pack();
    logs.diff = log(ROOT, "git diff base...HEAD", 0, "diff --git a/y b/y\n+otro cambio\n");
    const d = decide(logs);
    expect(d.sentinel).toBe("OTRO_PAQUETE");
    expect(d.ready).toBe(false);
  });
  test("veredicto distinto de PASS, o sin veredicto, no permite READY aunque todo lo demás pase", () => {
    for (const v of ["FAIL", "BLOCKED", "NOT_VERIFIED"]) {
      const logs = mutate({});
      logs.sentinel = sealSentinel(HEAD, logs, `{"veredicto": "${v}"}`);
      expect(decide(logs).ready).toBe(false);
    }
    const logs = mutate({});
    logs.sentinel = sealSentinel(HEAD, logs, "todo bien, listo");
    expect(decide(logs).sentinel).toBe("SIN_VEREDICTO");
    expect(decide(logs).ready).toBe(false);
  });
  test("los dos resultados son independientes: Sentinel PASS no salva un gate rojo, ni gates verdes un Sentinel FAIL", () => {
    expect(decide(mutate({ lint: at("lint", 1) })).ready).toBe(false);
    const logs = mutate({});
    logs.sentinel = sealSentinel(HEAD, logs, '{"veredicto": "FAIL"}');
    const d = decide(logs);
    expect(Object.values(d.gates).every((s) => s === "PASS")).toBe(true);
    expect(d.ready).toBe(false);
  });
});

describe("mecanismo real: la CLI sobre una carpeta de evidencia", () => {
  const script = join(import.meta.dir, "delivery-verdict.ts");
  function folder(logs: Record<string, string | undefined>): string {
    const dir = mkdtempSync(join(tmpdir(), "d2k-deliv-"));
    dirs.push(dir);
    for (const [n, t] of Object.entries(logs)) if (t !== undefined) writeFileSync(join(dir, `${n}.log`), t);
    return dir;
  }
  // El decisor lee el /dispatch de la raíz que se le da: una raíz desechable con una copia del real.
  function rootWithDispatch(): string {
    const root = mkdtempSync(join(tmpdir(), "d2k-root-"));
    dirs.push(root);
    mkdirSync(join(root, ".claude", "skills", "dispatch"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "dispatch", "SKILL.md"), DISPATCH);
    return root;
  }
  const run = (args: string[]) => Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
  test("READY → exit 0; gate rojo, árbol sucio, Sentinel de otro HEAD → exit 1", () => {
    const root = rootWithDispatch();
    // Reubica los logs a la raíz desechable y vuelve a sellar a Sentinel (con su HEAD original) sobre el paquete reubicado.
    const rootLogs = (logs: Record<string, string | undefined>) => {
      const moved: Record<string, string | undefined> = Object.fromEntries(
        Object.entries(logs).filter(([k]) => k !== "sentinel").map(([k, v]) => [k, v?.replaceAll(ROOT, root.replace(/\\/g, "/"))]),
      );
      const sealedHead = /^head: ([0-9a-f]{40})/.exec(logs.sentinel ?? "")?.[1] ?? HEAD;
      return { ...moved, sentinel: sealSentinel(sealedHead, moved, SENTINEL_PASS) };
    };
    const ok = run([folder(rootLogs(pack())), HEAD, root]);
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(ok.stdout.toString()).resultado).toBe("READY");
    expect(run([folder(rootLogs(mutate({ lint: at("lint", 1) }))), HEAD, root]).exitCode).toBe(1);
    expect(run([folder(rootLogs(mutate({ status: log(ROOT, "git status --short -uall", 0, "?? x\n") }))), HEAD, root]).exitCode).toBe(1);
    const otro = pack();
    otro.sentinel = sealSentinel(OTHER, otro, SENTINEL_PASS);
    expect(run([folder(rootLogs(otro)), HEAD, root]).exitCode).toBe(1);
  });
  test("`seal` escribe sentinel.log atado al HEAD y al paquete; si un log cambia después, deja de valer", () => {
    const root = rootWithDispatch();
    const base: Record<string, string | undefined> = Object.fromEntries(
      Object.entries(pack()).filter(([k]) => k !== "sentinel").map(([k, v]) => [k, v.replaceAll(ROOT, root.replace(/\\/g, "/"))]),
    );
    const dir = folder(base);
    const raw = join(dir, "..", `sentinel-raw-${Date.now()}.txt`);
    writeFileSync(raw, SENTINEL_PASS);
    dirs.push(raw);
    expect(run(["seal", dir, HEAD, raw]).exitCode).toBe(0);
    expect(run([dir, HEAD, root]).exitCode).toBe(0);
    writeFileSync(join(dir, "diff.log"), log(root, "git diff base...HEAD", 0, "diff --git a/z b/z\n+distinto\n"));
    const after = run([dir, HEAD, root]);
    expect(after.exitCode).toBe(1);
    expect(JSON.parse(after.stdout.toString()).sentinel).toBe("OTRO_PAQUETE");
  });
  test("sin argumentos, o carpeta inexistente → exit 2", () => {
    expect(run([]).exitCode).toBe(2);
    expect(run(["/no/existe", HEAD]).exitCode).toBe(2);
  });
});

describe("el veredicto de Sentinel sale del JSON final, no de cualquier texto citado", () => {
  const sealWith = (raw: string) => {
    const logs = mutate({});
    logs.sentinel = sealSentinel(HEAD, logs, raw);
    return decide(logs);
  };
  const FAIL_JSON = '```json\n{ "veredicto": "FAIL", "bloqueante": true, "hallazgos": ["hay un secreto"], "evidencia_solicitada": [] }\n```';
  test("un FAIL con texto posterior que cita un PASS no es un veredicto, y no hay READY", () => {
    const d = sealWith(`${FAIL_JSON}\nNota: el diff contiene la cadena "veredicto": "PASS" en una prueba.`);
    expect(d.sentinel).toBe("SIN_VEREDICTO");
    expect(d.ready).toBe(false);
  });
  test("un hallazgo que cita un veredicto dentro de su texto no cambia el del JSON", () => {
    const raw = '{ "veredicto": "FAIL", "bloqueante": true, "hallazgos": ["la prueba usa \\"veredicto\\": \\"PASS\\" de ejemplo"], "evidencia_solicitada": [] }';
    expect(sealWith(raw).sentinel).toBe("FAIL");
  });
  test("el eco del esquema de salida (`\"veredicto\": \"PASS\" | \"FAIL\"`) no es un PASS", () => {
    const d = sealWith('Formato: { "veredicto": "PASS" | "FAIL" | "BLOCKED" | "NOT_VERIFIED" }');
    expect(d.sentinel).toBe("SIN_VEREDICTO");
    expect(d.ready).toBe(false);
  });
  test("dos objetos finales contradictorios no permiten READY; uno solo y válido sí", () => {
    const dos = sealWith(`${SENTINEL_PASS}\n${FAIL_JSON}`);
    expect(dos.ready).toBe(false);
    expect(sealWith(SENTINEL_PASS).ready).toBe(true);
  });
  test("un veredicto fuera del vocabulario cerrado no cuenta", () => {
    expect(sealWith('{ "veredicto": "APPROVED" }').sentinel).toBe("SIN_VEREDICTO");
  });
});

describe("los logs del snapshot también deben ser los de /dispatch", () => {
  test("un status vacío de otro comando o de otra carpeta no cuenta como árbol limpio", () => {
    for (const n of ["status", "status-final", "diff-local", "sha", "sha-final"]) {
      const otroComando = n.startsWith("sha") ? log(ROOT, "echo", 0, `${HEAD}\n`) : log(ROOT, "echo", 0);
      expect(decide(mutate({ [n]: otroComando })).ready).toBe(false);
      const otraCarpeta = n.startsWith("sha") ? log("/d/otro", "git rev-parse HEAD", 0, `${HEAD}\n`) : log("/d/otro", SPECS.get(n)!.command, 0);
      const d = decide(mutate({ [n]: otraCarpeta }));
      expect(d.ready).toBe(false);
      expect(d.reasons.join(" ")).toContain("distintos de los que define /dispatch");
    }
  });
});

describe("diff.log: sin evidencia del cambio no hay READY", () => {
  const rejected = (diff: string | undefined) => {
    const d = decide(mutate({ diff }));
    expect(d.sentinel).toBe("PASS");
    expect(Object.values(d.gates).every((s) => s === "PASS")).toBe(true);
    expect(d.ready).toBe(false);
    expect(d.reasons.join(" ")).toContain("diff.log");
  };
  test("ausente → NOT_READY", () => rejected(undefined));
  test("ejecución fallida → NOT_READY", () => rejected(DIFF(HEAD, "fatal: bad revision\n", 128)));
  test("cortado, sin exit= → NOT_READY", () => rejected(`cwd: ${ROOT}\n$ git diff base...${HEAD}\ndiff --git a/x b/x\n`));
  test("de otro HEAD → NOT_READY", () => rejected(DIFF(OTHER)));
  test("sin atar a un SHA (`...HEAD` literal) → NOT_READY", () => rejected(log(ROOT, "git diff base...HEAD", 0, "diff --git a/x b/x\n+x\n")));
  test("otro comando, opciones añadidas o base que es una opción → NOT_READY", () => {
    for (const cmd of ["echo", `git diff --stat base...${HEAD}`, `git diff --stat...${HEAD}`, `git diff base...${HEAD} -- x`, `git diff base..${HEAD}`]) rejected(log(ROOT, cmd, 0));
  });
  test("otra carpeta → NOT_READY", () => rejected(DIFF(HEAD, "", 0, "/d/otro")));
  test("estructura inválida: sin cabecera, o salida que no es un diff → NOT_READY", () => {
    rejected(`$ git diff base...${HEAD}\ncwd: ${ROOT}\nexit=0\n`);
    rejected(`basura\n${DIFF(HEAD, "")}`);
    rejected("exit=0\n");
    rejected("");
    rejected(DIFF(HEAD, "todo bien\n"));
  });
  test("un diff legítimamente vacío (comando correcto, exit=0) sí vale", () => {
    const d = decide(mutate({ diff: DIFF(HEAD, "") }));
    expect(d.reasons).toEqual([]);
    expect(d.ready).toBe(true);
  });
  test("el comando exigido sale de /dispatch, no de una copia", () => {
    const cambiado = DISPATCH.replace('gate diff git diff "$BASE', 'gate diff git diff --binary "$BASE');
    expect(cambiado).not.toBe(DISPATCH);
    expect(decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: cambiado }).ready).toBe(false);
  });
});

describe("el veredicto de Sentinel es la respuesta entera, estructurada y sin ambigüedad", () => {
  const P = '{ "veredicto": "PASS" }';
  const rechazadas: [string, string][] = [
    ["cita de bloque", `> ${P}`],
    ["PASS citado en una explicación", `No puedo dar ${P} sin el diff.`],
    ["ejemplo en un bloque tras texto", `Ejemplo de respuesta:\n\`\`\`json\n${P}\n\`\`\``],
    ["texto después del bloque", `\`\`\`json\n${P}\n\`\`\`\nEn realidad falta evidencia.`],
    ["cita PASS y FAIL mal formado", `Ejemplo: ${P}\n{"veredicto":"FAIL","hallazgos":["x"],}`],
    ["cita PASS y veredicto fuera de vocabulario", `${P}\n{"veredicto":"REJECTED"}`],
    ["JSON con coma sobrante", '{ "veredicto": "PASS", }'],
    ["dos bloques", `\`\`\`json\n${P}\n\`\`\`\n\`\`\`json\n${P}\n\`\`\``],
    ["dos objetos iguales", `${P}\n${P}`],
    ["clave repetida", '{ "veredicto": "FAIL", "veredicto": "PASS" }'],
    ["clave repetida con escape", '{ "veredicto": "FAIL", "veredict\\u006f": "PASS" }'],
    ["anidado como ejemplo", `{ "ejemplo": ${P} }`],
    ["dentro de una lista", `[${P}]`],
    ["segundo veredicto anidado", '{ "veredicto": "PASS", "hallazgos": [{ "veredicto": "FAIL" }] }'],
    ["bloque sin cerrar", `\`\`\`json\n${P}`],
  ];
  test.each(rechazadas)("%s → no es PASS y no hay READY", (_nombre, raw) => {
    expect(verdictOf(raw)).not.toBe("PASS");
    const logs = mutate({});
    logs.sentinel = sealSentinel(HEAD, logs, raw);
    expect(decide(logs).ready).toBe(false);
  });
  test.each([
    ["JSON solo", P],
    ["bloque json", SENTINEL_PASS],
    ["bloque sin lenguaje y CRLF", `\r\n\`\`\`\r\n${P}\r\n\`\`\`\r\n`],
    ["texto citado dentro de un hallazgo", '{ "veredicto": "PASS", "hallazgos": ["la prueba cita \\"veredicto\\": \\"FAIL\\""] }'],
  ])("%s → PASS", (_nombre, raw) => {
    expect(verdictOf(raw)).toBe("PASS");
  });
  test("Sentinel declara que su respuesta es sólo el JSON", () => {
    const sentinel = readFileSync(join(import.meta.dir, "..", "..", ".claude", "agents", "sentinel.md"), "utf8");
    expect(sentinel).toContain("Tu respuesta completa es sólo ese bloque JSON");
  });
});

describe("la CLI real: seal y decisión de punta a punta", () => {
  const script = join(import.meta.dir, "delivery-verdict.ts");
  function runCase(change: Record<string, string | undefined>, answer: string) {
    const root = mkdtempSync(join(tmpdir(), "d2k-cli-root-"));
    const dir = mkdtempSync(join(tmpdir(), "d2k-cli-pack-"));
    dirs.push(root, dir);
    mkdirSync(join(root, ".claude", "skills", "dispatch"), { recursive: true });
    writeFileSync(join(root, ".claude", "skills", "dispatch", "SKILL.md"), DISPATCH);
    const logs: Record<string, string | undefined> = { ...pack(), ...change };
    delete logs.sentinel;
    for (const [n, t] of Object.entries(logs)) if (t !== undefined) writeFileSync(join(dir, `${n}.log`), t.replaceAll(ROOT, root.replace(/\\/g, "/")));
    const raw = join(dir, "sentinel-raw.txt");
    writeFileSync(raw, answer);
    const run = (args: string[]) => Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
    expect(run(["seal", dir, HEAD, raw]).exitCode).toBe(0);
    const out = run([dir, HEAD, root]);
    return { exit: out.exitCode, json: JSON.parse(out.stdout.toString()) as { resultado: string; reasons: string[] } };
  }
  test("diff con contenido y diff vacío → READY", () => {
    for (const change of [{}, { diff: DIFF(HEAD, "") }]) {
      const r = runCase(change, SENTINEL_PASS);
      expect(r.json.reasons).toEqual([]);
      expect(r.exit).toBe(0);
    }
  }, 30_000);
  test("diff ausente, fallido u obsoleto, o PASS ambiguo → NOT_READY", () => {
    const casos: [Record<string, string | undefined>, string][] = [
      [{ diff: undefined }, SENTINEL_PASS],
      [{ diff: DIFF(HEAD, "fatal\n", 128) }, SENTINEL_PASS],
      [{ diff: DIFF(OTHER) }, SENTINEL_PASS],
      [{}, `Ejemplo: {"veredicto": "PASS"}\n{"veredicto":"FAIL",}`],
    ];
    for (const [change, answer] of casos) {
      const r = runCase(change, answer);
      expect(r.json.resultado).toBe("NOT_READY");
      expect(r.exit).toBe(1);
    }
  }, 60_000);
});
