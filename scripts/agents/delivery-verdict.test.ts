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
const X_DIFF = "diff --git a/x b/x\n+x\n";
const DIFF = (h: string, out = X_DIFF, exit = 0, root = ROOT) => log(root, `git diff base...${h}`, exit, out);
/** Lo que `authorizedChange` obtendría de git y la ficha (esa comprobación real se prueba en delivery-base.test.ts). */
const CHANGE = { ref: "base", diff: X_DIFF };
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
const decide = (logs: Record<string, string | undefined>, head = HEAD) =>
  decideDelivery({ head, root: ROOT, logs, dispatchText: DISPATCH, change: CHANGE });
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
    const d = decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: cambiado, change: CHANGE });
    expect(d.ready).toBe(false);
    expect(d.gates.test).toBe("WRONG_COMMAND");
  });
  test("un /dispatch sin algún gate obligatorio no permite READY", () => {
    expect(decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: "", change: CHANGE }).ready).toBe(false);
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

// Repo desechable con el /dispatch real, una base en `origin/master` y un cambio que incluye su ficha TSK-900.
function repo() {
  const dir = mkdtempSync(join(tmpdir(), "d2k-root-"));
  dirs.push(dir);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const git = (...args: string[]) => {
    const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: dir, env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode !== 0) throw new Error(r.stderr.toString());
    return r.stdout.toString();
  };
  git("init", "-q", "-b", "main");
  mkdirSync(join(dir, ".claude", "skills", "dispatch"), { recursive: true });
  writeFileSync(join(dir, ".claude", "skills", "dispatch", "SKILL.md"), DISPATCH);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  git("update-ref", "refs/remotes/origin/master", "HEAD");
  mkdirSync(join(dir, "docs", "agents", "tasks"), { recursive: true });
  writeFileSync(join(dir, "docs", "agents", "tasks", "TSK-900.md"), "---\nid: TSK-900\nstate: done\n---\n");
  git("add", "-A");
  git("commit", "-q", "-m", "cambio");
  const head = git("rev-parse", "HEAD").trim();
  const root = git("rev-parse", "--show-toplevel").trim();
  const diff = log(ROOT, `git diff origin/master...${head}`, 0, git("diff", `origin/master...${head}`));
  /** Paquete de ese HEAD reubicado a la raíz desechable, con Sentinel sellado a `sealedHead`. */
  const logs = (change: Record<string, string> = {}, sealedHead = head) => {
    const all: Record<string, string> = { ...pack(head), diff, ...change };
    delete all.sentinel;
    const moved = Object.fromEntries(Object.entries(all).map(([k, v]) => [k, v.replaceAll(ROOT, root)]));
    return { ...moved, sentinel: sealSentinel(sealedHead, moved, SENTINEL_PASS) };
  };
  return { root, head, logs };
}
describe("mecanismo real: la CLI sobre una carpeta de evidencia", () => {
  const script = join(import.meta.dir, "delivery-verdict.ts");
  function folder(logs: Record<string, string | undefined>): string {
    const base = mkdtempSync(join(tmpdir(), "d2k-deliv-"));
    dirs.push(base);
    const dir = join(base, "TSK-900");
    mkdirSync(dir);
    for (const [n, t] of Object.entries(logs)) if (t !== undefined) writeFileSync(join(dir, `${n}.log`), t);
    return dir;
  }
  const run = (args: string[]) => Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
  test("READY → exit 0; gate rojo, árbol sucio, Sentinel de otro HEAD → exit 1", () => {
    const { root, head, logs } = repo();
    const ok = run([folder(logs()), head, root]);
    expect(JSON.parse(ok.stdout.toString()).reasons).toEqual([]);
    expect(ok.exitCode).toBe(0);
    expect(JSON.parse(ok.stdout.toString()).resultado).toBe("READY");
    expect(run([folder(logs({ lint: at("lint", 1) })), head, root]).exitCode).toBe(1);
    expect(run([folder(logs({ status: log(ROOT, "git status --short -uall", 0, "?? x\n") })), head, root]).exitCode).toBe(1);
    expect(run([folder(logs({}, OTHER)), head, root]).exitCode).toBe(1);
  }, 60_000);
  test("`seal` escribe sentinel.log atado al HEAD y al paquete; si un log cambia después, deja de valer", () => {
    const { root, head, logs } = repo();
    const base: Record<string, string | undefined> = { ...logs(), sentinel: undefined };
    const dir = folder(base);
    const raw = join(dir, "..", `sentinel-raw-${Date.now()}.txt`);
    writeFileSync(raw, SENTINEL_PASS);
    expect(run(["seal", dir, head, raw]).exitCode).toBe(0);
    expect(run([dir, head, root]).exitCode).toBe(0);
    writeFileSync(join(dir, "diff.log"), log(root, `git diff origin/master...${head}`, 0, "diff --git a/z b/z\n+distinto\n"));
    const after = run([dir, head, root]);
    expect(after.exitCode).toBe(1);
    expect(JSON.parse(after.stdout.toString()).sentinel).toBe("OTRO_PAQUETE");
  }, 60_000);
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
  test("un diff vacío (comando correcto, exit=0) → NOT_READY, aunque git también lo dé vacío", () => {
    rejected(DIFF(HEAD, ""));
    const d = decideDelivery({ head: HEAD, root: ROOT, logs: mutate({ diff: DIFF(HEAD, "") }), dispatchText: DISPATCH, change: { ref: "base", diff: "" } });
    expect(d.ready).toBe(false);
    expect(d.reasons.join(" ")).toContain("vacío");
  });
  test("sin base autorizada, o con otra salida que la de git → NOT_READY", () => {
    const d = decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: DISPATCH, change: { problem: "sin ficha" } });
    expect(d.ready).toBe(false);
    expect(d.reasons.join(" ")).toContain("sin ficha");
    rejected(DIFF(HEAD, "diff --git a/x b/x\n+otra cosa\n"));
  });
  test("el comando exigido sale de /dispatch, no de una copia", () => {
    const cambiado = DISPATCH.replace('gate diff git diff "$BASE', 'gate diff git diff --binary "$BASE');
    expect(cambiado).not.toBe(DISPATCH);
    expect(decideDelivery({ head: HEAD, root: ROOT, logs: pack(), dispatchText: cambiado, change: CHANGE }).ready).toBe(false);
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
    const { root, head, logs: paquete } = repo();
    const base = mkdtempSync(join(tmpdir(), "d2k-cli-pack-"));
    dirs.push(base);
    const dir = join(base, "TSK-900");
    mkdirSync(dir);
    const logs: Record<string, string | undefined> = { ...paquete(), sentinel: undefined };
    for (const [n, t] of Object.entries(change)) logs[n] = t?.replaceAll(ROOT, root).replaceAll(HEAD, head);
    for (const [n, t] of Object.entries(logs)) if (t !== undefined) writeFileSync(join(dir, `${n}.log`), t);
    const raw = join(dir, "sentinel-raw.txt");
    writeFileSync(raw, answer);
    const run = (args: string[]) => Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
    expect(run(["seal", dir, head, raw]).exitCode).toBe(0);
    const out = run([dir, head, root]);
    return { exit: out.exitCode, json: JSON.parse(out.stdout.toString()) as { resultado: string; reasons: string[] } };
  }
  test("diff real con contenido → READY; el mismo paquete con diff vacío → NOT_READY", () => {
    const ok = runCase({}, SENTINEL_PASS);
    expect(ok.json.reasons).toEqual([]);
    expect(ok.exit).toBe(0);
    const empty = runCase({ diff: log(ROOT, `git diff origin/master...${HEAD}`, 0) }, SENTINEL_PASS);
    expect(empty.json.resultado).toBe("NOT_READY");
    expect(empty.exit).toBe(1);
  }, 60_000);
  test("diff ausente, fallido u obsoleto, o PASS ambiguo → NOT_READY", () => {
    const casos: [Record<string, string | undefined>, string][] = [
      [{ diff: undefined }, SENTINEL_PASS],
      [{ diff: log(ROOT, `git diff origin/master...${HEAD}`, 128, "fatal\n") }, SENTINEL_PASS],
      [{ diff: log(ROOT, `git diff origin/master...${OTHER}`, 0, X_DIFF) }, SENTINEL_PASS],
      [{}, `Ejemplo: {"veredicto": "PASS"}\n{"veredicto":"FAIL",}`],
    ];
    for (const [change, answer] of casos) {
      const r = runCase(change, answer);
      expect(r.json.resultado).toBe("NOT_READY");
      expect(r.exit).toBe(1);
    }
  }, 90_000);
});
