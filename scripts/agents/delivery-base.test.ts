import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseDispatchGates, REQUIRED_GATE_NAMES } from "./delivery-verdict";

// La base del diff la fija el contrato de la tarea (`base_ref` de su ficha, `origin/master` si no la declara) y el
// decisor la comprueba contra git. Repos desechables y la CLI real: sha, status y diff salen de git; los cinco gates y la
// respuesta de Sentinel son fixtures.

const DISPATCH = readFileSync(join(import.meta.dir, "..", "..", ".claude", "skills", "dispatch", "SKILL.md"), "utf8");
const SCRIPT = join(import.meta.dir, "delivery-verdict.ts");
const RELEASE = "origin/release/mvp-beta";
const TIMEOUT = 60_000;
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
function sh(cmd: string[], cwd: string): { exit: number; out: string } {
  const r = Bun.spawnSync(cmd, { cwd, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, out: r.stdout.toString() + r.stderr.toString() };
}
function git(root: string, ...args: string[]): string {
  const r = sh(["git", ...args], root);
  if (r.exit !== 0) throw new Error(`git ${args.join(" ")}: ${r.out}`);
  return r.out.trim();
}
function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function commit(root: string, message: string): string {
  git(root, "add", "-A");
  git(root, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", message);
  return git(root, "rev-parse", "HEAD");
}
const ticket = (id: string, extra = "") => `---\nid: ${id}\ntitle: "t"\nstate: done\n${extra}---\n`;

/** Repo con una base publicada (`origin/master`) y un cambio encima que incluye su ficha TSK-900. */
function repo(extra = ""): { root: string; base: string; middle: string; head: string } {
  const dir = mkdtempSync(join(tmpdir(), "d2k-base-"));
  dirs.push(dir);
  git(dir, "init", "-q", "-b", "main");
  const root = git(dir, "rev-parse", "--show-toplevel");
  put(root, ".gitignore", ".local/\n");
  put(root, ".claude/skills/dispatch/SKILL.md", DISPATCH);
  put(root, "docs/agents/tasks/TSK-100.md", ticket("TSK-100", `base_ref: ${RELEASE}\n`));
  const base = commit(root, "base");
  git(root, "update-ref", "refs/remotes/origin/master", base);
  put(root, "primero.ts", "export const A = 1;\n");
  const middle = commit(root, "primera parte");
  put(root, "segundo.ts", "export const B = 2;\n");
  put(root, "docs/agents/tasks/TSK-900.md", ticket("TSK-900", extra));
  const head = commit(root, "segunda parte");
  return { root, base, middle, head };
}

interface Options { base?: string; ticketId?: string; diffOutput?: string }

/** Genera el paquete como `gate()`, sella un PASS y devuelve la decisión de la CLI. */
function decide(root: string, head: string, { base = "origin/master", ticketId = "TSK-900", diffOutput }: Options = {}) {
  const dir = join(root, ".local", "evidencia", ticketId);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, cwd: string, command: string, out: string, exit = 0) =>
    writeFileSync(join(dir, `${name}.log`), `cwd: ${cwd}\n$ ${command}\n${out}${out && !out.endsWith("\n") ? "\n" : ""}exit=${exit}\n`);
  const real = (name: string, command: string, args: string[]) => {
    const r = sh(["git", ...args], root);
    write(name, root, command, r.out, r.exit);
  };
  real("sha", "git rev-parse HEAD", ["rev-parse", "HEAD"]);
  real("sha-final", "git rev-parse HEAD", ["rev-parse", "HEAD"]);
  for (const name of ["status", "status-final"]) real(name, "git status --short -uall", ["status", "--short", "-uall"]);
  real("diff-local", "git diff HEAD", ["diff", "HEAD"]);
  const diffCommand = `git diff ${base}...${head}`;
  if (diffOutput === undefined) real("diff", diffCommand, ["diff", `${base}...${head}`]);
  else write("diff", root, diffCommand, diffOutput);
  writeFileSync(join(dir, "diff-nuevos.log"), "exit=0\n");
  for (const spec of parseDispatchGates(DISPATCH)) {
    if ((REQUIRED_GATE_NAMES as readonly string[]).includes(spec.name)) {
      write(spec.name, spec.cwd ? `${root}/${spec.cwd}` : root, spec.command, "");
    }
  }
  const raw = join(dir, "sentinel.txt");
  writeFileSync(raw, '{ "veredicto": "PASS" }');
  expect(sh(["bun", SCRIPT, "seal", dir, head, raw], root).exit).toBe(0);
  const run = Bun.spawnSync(["bun", SCRIPT, dir, head, root], { cwd: root, env: ENV, stdout: "pipe", stderr: "pipe" });
  const decision = JSON.parse(run.stdout.toString()) as { resultado: string; sentinel: string; reasons: string[] };
  return { ...decision, exit: run.exitCode };
}

function expectNotReady(d: ReturnType<typeof decide>): void {
  expect(d.sentinel).toBe("PASS");
  expect(d.resultado).toBe("NOT_READY");
  expect(d.exit).toBe(1);
  expect(d.reasons.length).toBeGreaterThan(0);
}

describe("entrega legítima", () => {
  test("base declarada por defecto y cambio real → READY", () => {
    const { root, head } = repo();
    const d = decide(root, head);
    expect(d.reasons).toEqual([]);
    expect(d.resultado).toBe("READY");
    expect(d.exit).toBe(0);
  }, TIMEOUT);

  test("ficha con `base_ref` de release → READY contra release, NOT_READY contra master", () => {
    const { root, base, head } = repo(`base_ref: ${RELEASE}\n`);
    git(root, "update-ref", `refs/remotes/${RELEASE}`, base);
    expect(decide(root, head, { base: RELEASE }).resultado).toBe("READY");
    expectNotReady(decide(root, head, { base: "origin/master" }));
  }, TIMEOUT);
});

describe("base equivocada o cambio vacío → nunca READY", () => {
  test("hallazgo de Codex: base = el propio SHA del HEAD (diff vacío)", () => {
    const { root, head } = repo();
    expectNotReady(decide(root, head, { base: head }));
  }, TIMEOUT);

  test("base = `HEAD` literal", () => {
    const { root, head } = repo();
    expectNotReady(decide(root, head, { base: "HEAD" }));
  }, TIMEOUT);

  test("base arbitraria con diff NO vacío: sólo el último commit, un SHA, una rama local u otra rama remota", () => {
    const { root, base, middle, head } = repo();
    git(root, "branch", "mi-base", middle);
    git(root, "update-ref", "refs/remotes/origin/otra", middle);
    for (const wrong of ["HEAD~1", middle, base, "mi-base", "origin/otra"]) expectNotReady(decide(root, head, { base: wrong }));
  }, TIMEOUT);

  test("base autorizada pero el cambio ya está en ella (diff vacío)", () => {
    const { root, head } = repo();
    git(root, "update-ref", "refs/remotes/origin/master", head);
    expectNotReady(decide(root, head));
  }, TIMEOUT);

  test("la base autorizada no existe en el repo", () => {
    const { root, head } = repo();
    git(root, "update-ref", "-d", "refs/remotes/origin/master");
    expectNotReady(decide(root, head, { diffOutput: "diff --git a/x b/x\n+x\n" }));
  }, TIMEOUT);

  test("comando correcto con una salida que no es la de git (inventada, recortada o vacía)", () => {
    const { root, head } = repo();
    for (const diffOutput of ["diff --git a/x b/x\n+inventado\n", ""]) expectNotReady(decide(root, head, { diffOutput }));
    const real = git(root, "diff", `origin/master...${head}`);
    expectNotReady(decide(root, head, { diffOutput: real.split("\n").slice(0, 6).join("\n") }));
  }, TIMEOUT);

  test("una rama local llamada `origin/master` no suplanta a la remota", () => {
    const { root, middle, head } = repo();
    git(root, "branch", "origin/master", middle);
    expectNotReady(decide(root, head));
  }, TIMEOUT);
});

describe("la referencia sale del contrato de la tarea, no del coordinador", () => {
  test("`base_ref` fuera de la lista cerrada, repetido o con comentario → la ficha no autoriza nada", () => {
    for (const extra of ["base_ref: HEAD\n", "base_ref: origin/otra\n", `base_ref: ${RELEASE} # nota\n`, `base_ref: origin/master\nbase_ref: ${RELEASE}\n`]) {
      const { root, base, head } = repo(extra);
      git(root, "update-ref", `refs/remotes/${RELEASE}`, base);
      git(root, "update-ref", "refs/remotes/origin/otra", base);
      for (const candidate of ["origin/master", RELEASE, "origin/otra", "HEAD"]) expectNotReady(decide(root, head, { base: candidate }));
    }
  }, TIMEOUT);

  test("clave `base_ref` entre comillas: se respeta, no cae en silencio al valor por defecto", () => {
    const { root, base, head } = repo(`"base_ref": ${RELEASE}\n`);
    git(root, "update-ref", `refs/remotes/${RELEASE}`, base);
    expectNotReady(decide(root, head, { base: "origin/master" }));
    expect(decide(root, head, { base: RELEASE }).resultado).toBe("READY");
  }, TIMEOUT);

  test("tomar prestada una ficha que no forma parte del cambio (para usar su `base_ref`)", () => {
    const { root, middle, head } = repo();
    git(root, "update-ref", `refs/remotes/${RELEASE}`, middle);
    expectNotReady(decide(root, head, { base: RELEASE, ticketId: "TSK-100" }));
  }, TIMEOUT);

  test("carpeta de evidencia sin ficha: nombre ajeno o ficha inexistente", () => {
    const { root, head } = repo();
    for (const ticketId of ["TSK-999", "paquete"]) expectNotReady(decide(root, head, { ticketId }));
  }, TIMEOUT);

  test("`base_ref` cambiado sin commit no vale", () => {
    const { root, base, head } = repo();
    git(root, "update-ref", `refs/remotes/${RELEASE}`, base);
    put(root, "docs/agents/tasks/TSK-900.md", ticket("TSK-900", `base_ref: ${RELEASE}\n`));
    expectNotReady(decide(root, head, { base: RELEASE }));
  }, TIMEOUT);

  test("el HEAD pedido no es el HEAD del repo", () => {
    const { root, middle, head } = repo();
    const d = decide(root, head);
    expect(d.resultado).toBe("READY");
    git(root, "checkout", "-q", "--detach", middle);
    const again = Bun.spawnSync(["bun", SCRIPT, join(root, ".local", "evidencia", "TSK-900"), head, root], { cwd: root, env: ENV, stdout: "pipe" });
    expect(again.exitCode).toBe(1);
  }, TIMEOUT);
});
