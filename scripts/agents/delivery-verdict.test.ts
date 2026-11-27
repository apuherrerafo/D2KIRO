import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { decideDelivery, DELIVERY_BRANCH, type Gate, GATES, isGateDefinition } from "./delivery-verdict";

// Repos desechables con un remoto real (bare) y comandos que se ejecutan de verdad. La CLI corre con las comprobaciones
// de producción (`GATES`): `bun run test`, `bun x tsc`, `bun run lint` y `bash scripts/verify-simplicity.sh`.

const SCRIPT = join(import.meta.dir, "delivery-verdict.ts");
const TOOLS = join(import.meta.dir, "..", "..", "node_modules", ".bin"); // el `tsc` de la raíz
const TIMEOUT = 90_000;
const dirs: string[] = [];
afterAll(() => dirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const ENV: Record<string, string | undefined> = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
const pathKey = Object.keys(ENV).find((k) => k.toUpperCase() === "PATH") ?? "PATH";
ENV[pathKey] = `${TOOLS}${delimiter}${ENV[pathKey] ?? ""}`;

function git(root: string, ...args: string[]): string {
  const r = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd: root, env: ENV, stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
  return r.stdout.toString().trim();
}
function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function commit(root: string, message: string): string {
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", message);
  return git(root, "rev-parse", "HEAD");
}
function temp(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

const TSCONFIG = '{ "compilerOptions": { "strict": true, "noEmit": true, "types": [] }, "include": ["*.ts"] }\n';

/** Base publicada en `origin/<rama de entrega>` y, encima, un cambio de código en dos commits. */
function repo() {
  const dir = temp("d2k-deliv-");
  git(dir, "init", "-q", "-b", "main");
  const root = git(dir, "rev-parse", "--show-toplevel");
  const remote = temp("d2k-remote-");
  git(remote, "init", "-q", "--bare");
  put(root, ".gitignore", ".local/\n");
  put(root, "package.json", '{ "scripts": { "test": "bun check.ts" } }\n');
  put(root, "check.ts", "process.exit(0);\n");
  put(root, "scripts/verify-simplicity.sh", "exit 0\n");
  put(root, "apps/engine/tsconfig.json", TSCONFIG);
  put(root, "apps/engine/a.ts", "export const a: number = 1;\n");
  put(root, "apps/web/tsconfig.json", TSCONFIG);
  put(root, "apps/web/b.ts", "export const b: number = 1;\n");
  put(root, "apps/web/package.json", '{ "scripts": { "lint": "bun lint.mjs" } }\n');
  put(root, "apps/web/lint.mjs", "process.exit(0);\n");
  const base = commit(root, "base");
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", `HEAD:refs/heads/${DELIVERY_BRANCH}`);
  put(root, "primero.ts", "export const A = 1;\n");
  const middle = commit(root, "primera parte");
  put(root, "segundo.ts", "export const B = 2;\n");
  const head = commit(root, "segunda parte");
  return { root, remote, base, middle, head };
}

function cli(root: string, args: string[]) {
  const r = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd: root, env: ENV, stdout: "pipe", stderr: "pipe" });
  const out = r.stdout.toString();
  return { exit: r.exitCode, stderr: r.stderr.toString(), json: out.startsWith("{") ? JSON.parse(out) : null };
}

const ok = (name: string): Gate => ({ name, cwd: "", command: ["bun", "-e", ""] });
const doing = (code: string): Gate => ({ name: "gate", cwd: "", command: ["bun", "-e", code] });
const decide = (root: string, head: string, gates: Gate[] = [ok("gate")]) => decideDelivery(root, head, gates);

function expectNotReady(decision: ReturnType<typeof decide>, reason: string): void {
  expect(decision.resultado).toBe("NOT_READY");
  expect(decision.reasons.join(" ")).toContain(reason);
}

describe("entrega legítima, con la CLI y las comprobaciones de producción", () => {
  test("las cinco corren de verdad → READY, con su alcance declarado", () => {
    const { root, base, head } = repo();
    const r = cli(root, [head]);
    expect(r.json.reasons).toEqual([]);
    expect(r.exit).toBe(0);
    expect(r.json).toMatchObject({ resultado: "READY", head, base });
    expect(r.json.gates).toEqual(Object.fromEntries(GATES.map((g) => [g.name, "PASS"])));
    expect(r.json.alcance).toContain("no autoriza merge ni deploy");
  }, TIMEOUT);

  test("cada comprobación en rojo da NOT_READY", () => {
    const rotos: [string, string, string][] = [
      ["test", "check.ts", "process.exit(1);\n"],
      ["tsc-engine", "apps/engine/a.ts", 'export const a: number = "x";\n'],
      ["tsc-web", "apps/web/b.ts", 'export const b: number = "x";\n'],
      ["lint", "apps/web/lint.mjs", "process.exit(1);\n"],
    ];
    const { root } = repo();
    for (const [, path, text] of rotos) put(root, path, text);
    const r = cli(root, [commit(root, "rompe cuatro")]);
    expect(r.exit).toBe(1);
    for (const [name] of rotos) expect(r.json.gates[name]).toBe("FAIL");
    expect(r.json.gates.simplicity).toBe("PASS");
  }, TIMEOUT);

  test("uso incorrecto, o un argumento de más (no se puede pasar una base), → exit 2", () => {
    const { root, head, middle } = repo();
    expect(cli(root, []).exit).toBe(2);
    expect(cli(root, [head, root, middle]).exit).toBe(2);
  }, TIMEOUT);
});

describe("los tsc no escriben en el árbol que juzgan", () => {
  test("un tsconfig incremental sin *.tsbuildinfo ignorado sigue dando READY", () => {
    const { root } = repo();
    const incremental = TSCONFIG.replace('"noEmit": true', '"noEmit": true, "incremental": true');
    put(root, "apps/web/tsconfig.json", incremental);
    commit(root, "incremental");
    git(root, "push", "-q", "origin", `HEAD:refs/heads/${DELIVERY_BRANCH}`);
    put(root, "tercero.ts", "export const C = 3;\n");
    const d = decideDelivery(root, commit(root, "cambio"), GATES.filter((g) => g.name === "tsc-web"));
    expect(d.reasons).toEqual([]);
  }, TIMEOUT);
});

describe("hallazgo 1: la base es la publicada, no una que se declare", () => {
  test("referencias locales falsificadas no recortan el cambio", () => {
    const { root, base, middle, head } = repo();
    git(root, "update-ref", `refs/remotes/origin/${DELIVERY_BRANCH}`, middle);
    git(root, "update-ref", "refs/remotes/origin/master", middle);
    git(root, "branch", `origin/${DELIVERY_BRANCH}`, middle);
    put(root, "docs/agents/tasks/TSK-900.md", "---\nid: TSK-900\nstate: done\n---\n");
    const next = commit(root, "ficha");
    expect(decide(root, next).base).toBe(base);
    expect(head).not.toBe(base);
  }, TIMEOUT);

  test("base atrasada: la rama publicada avanzó y el HEAD no la contiene", () => {
    const { root, remote, base, head } = repo();
    git(root, "checkout", "-q", "-b", "otro", base);
    put(root, "ajeno.ts", "export {};\n");
    commit(root, "avanza la base");
    git(root, "push", "-q", remote, `HEAD:refs/heads/${DELIVERY_BRANCH}`);
    git(root, "checkout", "-q", "main");
    expectNotReady(decide(root, head), "actualiza la rama");
  }, TIMEOUT);

  test("base publicada que no está en el repo local → hace falta fetch", () => {
    const { root, remote, head } = repo();
    const other = temp("d2k-other-");
    git(other, "clone", "-q", "-b", DELIVERY_BRANCH, remote, "c");
    put(join(other, "c"), "nuevo.ts", "export {};\n");
    commit(join(other, "c"), "ajeno");
    git(join(other, "c"), "push", "-q", "origin", "HEAD");
    expectNotReady(decide(root, head), "git fetch");
  }, TIMEOUT);

  test("sin rama de entrega en el remoto, o sin remoto → NOT_READY (ni `master` la sustituye)", () => {
    const { root, remote, base, head } = repo();
    git(remote, "update-ref", "refs/heads/master", base);
    git(remote, "update-ref", "-d", `refs/heads/${DELIVERY_BRANCH}`);
    expectNotReady(decide(root, head), "no se pudo consultar");
    git(root, "remote", "remove", "origin");
    expectNotReady(decide(root, head), "no se pudo consultar");
  }, TIMEOUT);

  test("el cambio ya está publicado → no hay cambio que entregar", () => {
    const { root, head } = repo();
    git(root, "push", "-q", "origin", `HEAD:refs/heads/${DELIVERY_BRANCH}`);
    expectNotReady(decide(root, head), "no hay cambio");
  }, TIMEOUT);
});

describe("hallazgo 2: ni logs ni veredictos escritos a mano cuentan", () => {
  test("paquete entero fabricado y PASS de Sentinel, con las pruebas en rojo → NOT_READY", () => {
    const { root } = repo();
    put(root, "check.ts", "process.exit(1);\n");
    const head = commit(root, "rompe");
    const folder = ".local/evidencia/TSK-900";
    for (const g of GATES) put(root, `${folder}/${g.name}.log`, `cwd: ${root}\n$ ${g.command.join(" ")}\nexit=0\n`);
    put(root, `${folder}/sentinel.log`, `head: ${head}\n---\n{ "veredicto": "PASS" }\n`);
    const r = cli(root, [head]);
    expect(r.json.resultado).toBe("NOT_READY");
    expect(r.json.gates.test).toBe("FAIL");
    // La forma antigua de invocarlo (carpeta de evidencia) y el sello ya no existen.
    expect(cli(root, [join(root, folder), head, root]).exit).toBe(2);
    expect(cli(root, ["seal", join(root, folder), head, join(root, folder, "sentinel.log")]).exit).toBe(2);
  }, TIMEOUT);
});

describe("hallazgo 3: quien cambia la definición de las comprobaciones no obtiene READY", () => {
  const cambios: [string, string][] = [
    ["package.json", '{ "scripts": { "test": "echo ok" } }\n'],
    ["apps/web/package.json", '{ "scripts": { "lint": "echo ok" } }\n'],
    ["scripts/verify-simplicity.sh", "echo ok\n"],
    ["apps/engine/tsconfig.json", '{ "include": [] }\n'],
    ["apps/web/bunfig.toml", "[test]\n"],
    ["apps/web/eslint.config.mjs", "export default [];\n"],
    ["scripts/agents/delivery-verdict.ts", "process.exit(0);\n"],
  ];
  test.each(cambios)("%s en el cambio → NOT_READY sin ejecutar nada", (path, text) => {
    const { root } = repo();
    put(root, path, text);
    const d = decide(root, commit(root, "debilita"));
    expectNotReady(d, path);
    expect(d.gates.gate).toBe("NOT_RUN");
  }, TIMEOUT);

  test("`echo ok` en lugar de la suite, por la CLI y con las pruebas rotas → exit 1", () => {
    const { root } = repo();
    put(root, "check.ts", "process.exit(1);\n");
    put(root, "package.json", '{ "scripts": { "test": "echo ok" } }\n');
    expect(cli(root, [commit(root, "echo ok")]).exit).toBe(1);
  }, TIMEOUT);

  test("reescribir el bloque de /dispatch no cambia lo que se ejecuta", () => {
    const { root } = repo();
    put(root, "check.ts", "process.exit(1);\n");
    put(root, ".claude/skills/dispatch/SKILL.md", "## PAQUETE DE EVIDENCIA\n```bash\ngate test echo ok\n```\n");
    expect(cli(root, [commit(root, "dispatch débil")]).json.gates.test).toBe("FAIL");
  }, TIMEOUT);

  test("el repo real: cada comprobación depende de archivos que cuentan como definición", () => {
    for (const path of ["package.json", "apps/engine/package.json", "apps/web/tsconfig.json", "apps/web/eslint.config.mjs", "scripts/verify-simplicity.sh", "scripts/agents/delivery-verdict.ts"]) {
      expect(isGateDefinition(path)).toBe(true);
    }
    for (const path of ["apps/engine/src/signals/mix.ts", "docs/agents/journal.md", "apps/web/next.config.ts"]) expect(isGateDefinition(path)).toBe(false);
  });
});

describe("simplicidad sobre árbol limpio: mira el cambio entregado, no el diff sin commitear", () => {
  const REAL = join(import.meta.dir, "..");
  const SIMPLICITY = GATES.filter((g) => g.name === "simplicity");

  /** Repo con el gate de simplicidad real publicado en la base, y encima el cambio que se entrega. */
  function conGateReal(cambio: (root: string) => void) {
    const { root } = repo();
    for (const path of ["verify-simplicity.sh", "hooks/ticket_contract.py", "hooks/_hook_lib.py"]) {
      put(root, `scripts/${path}`, readFileSync(join(REAL, path), "utf8"));
    }
    put(root, "package.json", readFileSync(join(REAL, "..", "package.json"), "utf8"));
    put(root, "docs/agents/journal.md", "- primera\n- segunda\n");
    put(root, ".gitignore", ".local/\n__pycache__/\n");
    put(root, "docs/agents/tasks/TSK-269.md", readFileSync(join(REAL, "..", "docs/agents/tasks/TSK-269.md"), "utf8"));
    commit(root, "gate real");
    git(root, "push", "-q", "origin", `HEAD:refs/heads/${DELIVERY_BRANCH}`);
    cambio(root);
    return decideDelivery(root, commit(root, "cambio"), SIMPLICITY);
  }

  // El literal se arma al ejecutar para que este archivo no dispare el propio gate.
  const SECRETO = `const api_key = ${JSON.stringify("abcd1234efgh5678")};\n`;
  const violaciones: [string, (root: string) => void][] = [
    ["secreto ya commiteado", (root) => put(root, "clave.ts", SECRETO)],
    ["línea borrada del journal", (root) => put(root, "docs/agents/journal.md", "- primera\n")],
    ["dependencia de producción sin marca", (root) => put(root, "apps/engine/package.json", '{\n  "dependencies": {\n    "x": "1.0.0"\n  }\n}\n')],
  ];

  test("un cambio limpio pasa", () => {
    expect(conGateReal((root) => put(root, "limpio.ts", "export {};\n")).gates.simplicity).toBe("PASS");
  }, TIMEOUT);

  // Un byte NUL hace que git llame binario al archivo: sin `--text` no hay líneas que revisar.
  const enUtf16 = (root: string) => writeFileSync(join(root, "ancho.ts"), Buffer.from(`﻿${SECRETO}`, "utf16le"));
  const loopback = `export const U = "http://${["127", "0", "0", "1"].join(".")}:4000";\n`;
  const escondidas: [string, (root: string) => void][] = [
    ["secreto en un archivo que git llama binario", (root) => put(root, "bin.ts", `\u0000\n${SECRETO}`)],
    ["secreto en un archivo UTF-16", enUtf16],
    ["línea borrada de un journal vuelto binario", (root) => put(root, "docs/agents/journal.md", "- primera\n\u0000\n")],
    ["loopback en un archivo binario de apps/web", (root) => put(root, "apps/web/lib/u.ts", `\u0000\n${loopback}`)],
    ["color forzado en la configuración de git", (root) => {
      git(root, "config", "color.diff", "always");
      put(root, "color.ts", SECRETO);
    }],
  ];

  // La dependencia toca un package.json: el decisor la corta antes, como definición.
  test.each([...violaciones.slice(0, 2), ...escondidas])("%s → NOT_READY", (_nombre, cambio) => {
    const d = conGateReal(cambio);
    expect(d.gates.simplicity).toBe("FAIL");
    expect(d.resultado).toBe("NOT_READY");
  }, TIMEOUT);

  test("una VERIFY_DIFF_BASE heredada no llega a las comprobaciones; la de simplicidad es la base publicada", () => {
    const { root, base, head } = repo();
    const ve = (esperado: string, baseEnv?: string): Gate => ({
      ...doing(`process.exit(process.env.VERIFY_DIFF_BASE === ${esperado} ? 0 : 1)`),
      baseEnv,
    });
    const previa = process.env.VERIFY_DIFF_BASE;
    process.env.VERIFY_DIFF_BASE = head;
    try {
      expect(decide(root, head, [ve("undefined")]).resultado).toBe("READY");
      expect(decide(root, head, [ve(JSON.stringify(base), "VERIFY_DIFF_BASE")]).resultado).toBe("READY");
    } finally {
      if (previa === undefined) delete process.env.VERIFY_DIFF_BASE;
      else process.env.VERIFY_DIFF_BASE = previa;
    }
  }, TIMEOUT);

  test("una base que no es un commit hace fallar el gate en vez de revisar nada", () => {
    const r = Bun.spawnSync(["bash", "scripts/verify-simplicity.sh"], {
      cwd: join(REAL, ".."), env: { ...ENV, VERIFY_DIFF_BASE: "no-existe" }, stdout: "pipe", stderr: "pipe",
    });
    expect(r.exitCode).not.toBe(0);
    expect(r.stdout.toString()).toContain("VERIFY_DIFF_BASE");
  }, TIMEOUT);
});

describe("lo que cambia qué mira un gate también es definición", () => {
  test.each(["scripts/hooks/ticket_contract.py", "scripts/hooks/_hook_lib.py", "scripts/hooks/re.py", ".gitattributes", "apps/web/.gitattributes"])("%s", (path) => {
    expect(isGateDefinition(path)).toBe(true);
  });
});

describe("hallazgo 4: el estado se comprueba al decidir, antes y después de ejecutar", () => {
  test("un cambio sin commit después de un READY lo invalida (seguido, sin seguimiento u oculto)", () => {
    const { root, head } = repo();
    expect(decide(root, head).resultado).toBe("READY");
    put(root, "suelto.ts", "export {};\n");
    expectNotReady(decide(root, head), "árbol sucio");
    unlinkSync(join(root, "suelto.ts"));
    put(root, "primero.ts", "export const A = 2;\n");
    expectNotReady(decide(root, head), "árbol sucio");
    git(root, "update-index", "--assume-unchanged", "primero.ts");
    expectNotReady(decide(root, head), "ocultos");
  }, TIMEOUT);

  const durante: [string, string, string][] = [
    ["modifica un archivo", 'require("fs").writeFileSync("primero.ts", "x")', "árbol sucio"],
    ["crea un archivo", 'require("fs").writeFileSync("nuevo.ts", "x")', "árbol sucio"],
    ["mueve el HEAD", 'Bun.spawnSync(["git","-c","user.name=t","-c","user.email=t@t","commit","-q","--allow-empty","-m","x"])', "no es el HEAD pedido"],
    ["publica la rama", `Bun.spawnSync(["git","push","-q","origin","HEAD~1:refs/heads/${DELIVERY_BRANCH}"])`, "la base publicada cambió"],
  ];
  test.each(durante)("una comprobación que en verde %s → NOT_READY", (_nombre, code, reason) => {
    const { root, head } = repo();
    const d = decide(root, head, [doing(code)]);
    expect(d.gates.gate).toBe("PASS");
    expectNotReady(d, reason);
  }, TIMEOUT);

  test("HEAD ajeno o abreviado, comprobación inexistente o lista vacía → NOT_READY", () => {
    const { root, middle, head } = repo();
    expectNotReady(decide(root, middle), "no es el HEAD pedido");
    expectNotReady(decide(root, head.slice(0, 8)), "SHA completo");
    expectNotReady(decide(root, head, [{ name: "gate", cwd: "no/existe", command: ["bun", "-e", ""] }]), "gate: falló");
    expectNotReady(decide(root, head, []), "no hay comprobaciones");
  }, TIMEOUT);
});
