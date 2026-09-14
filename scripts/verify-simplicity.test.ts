import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// R0.4/Task 27 (.kiro/specs/r0-engineering-baseline-recovery, requisito 4.5 c1-c3).
// Candado de regresión para la separación "escaneo barato / regenerador / trabajo pesado":
// ejercita el script REAL (spawn, igual que lo invocan PostToolUse/SubagentStop/pretooluse-guard),
// nunca un mock -- lo que se prueba es exactamente el mecanismo que corre en cada sesión real.
//
// No depende de datos curados/mutables: opera sobre el estado de git del propio checkout (igual
// que scripts/hooks/hook-guards.test.ts y hook-path-normalization.test.ts, que también spawnean
// los guardias reales contra el REPO real en vez de un fixture aislado).

const REPO = join(import.meta.dir, "..");
const HUB_HTML = join(REPO, "docs", "agents", "hub.html");

async function runGate(env: Record<string, string> = {}): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["bash", "scripts/verify-simplicity.sh"], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout };
}

test("AFTER EDIT: el escaneo barato NO regenera docs/agents/hub.html (sin VERIFY_COMMIT_GATE)", async () => {
  const before = statSync(HUB_HTML).mtimeMs;
  const { code, stdout } = await runGate();
  const after = statSync(HUB_HTML).mtimeMs;

  expect(after).toBe(before);
  // sync-context.ts imprime "sync-context: regenerando tablero..." cuando corre -- su ausencia en
  // stdout confirma que verify-simplicity.sh ya no lo invoca automáticamente (Task 27, c1/c2).
  expect(stdout).not.toContain("sync-context");
  expect(code).toBe(0);
});

test("sync-context.ts sigue existiendo como acción explícita e independiente", async () => {
  const proc = Bun.spawn(["bash", "-lc", "test -f scripts/sync-context.ts"], { cwd: REPO });
  expect(await proc.exited).toBe(0);
});

// ---------------------------------------------------------------------------------------------
// Trampa de ejecución behavioral (blocker de revisión independiente sobre TSK-27):
//
// Comprobar que ciertos textos NO aparecen en stdout ("Gate de commit", "gate de evaluación del
// motor") no demuestra que el trabajo pesado no corrió -- solo que, SI corrió, no imprimió esas
// líneas exactas. Un `bun test`/`bunx tsc`/`gate.ts --enforce` silencioso, o cuyo wording cambie
// en el futuro, pasaría ese chequeo igual sin haber sido detectado.
//
// La prueba real: reemplazar `bun`/`bunx`/`tsc` por ejecutables señuelo, adelante en el PATH del
// proceso hijo, que registran CUALQUIER invocación (argumentos incluidos) en un archivo marcador
// ANTES de hacer nada más -- sin importar qué impriman, si imprimen algo, o si el comando real
// habría sido silencioso. Si `verify-simplicity.sh` intentara ejecutar `bun test`, `bun x tsc`,
// `bunx tsc`, `tsc --noEmit` o `bun run scripts/eval/gate.ts --enforce`, el señuelo correspondiente
// lo interceptaría (nunca llega al binario real) y lo dejaría escrito en el marcador -- se detecta
// por la EJECUCIÓN misma, no por su salida.
//
// El único uso legítimo de `bun` que el gate SÍ hace (en ambos caminos, barato y
// VERIFY_COMMIT_GATE=1) es `bun --version` para el pin de toolchain (R0/Task 31) -- el señuelo lo
// responde con la versión real esperada (leída de package.json, nunca hardcodeada) para que ese
// chequeo siga en verde y el script llegue hasta el final. Cualquier otra invocación es, por
// definición, el trabajo pesado que Task 27 debía retirar de este gate.

const SHEBANG = "#!/bin/sh\n";

function writeShim(dir: string, name: string, body: string): void {
  const path = join(dir, name);
  writeFileSync(path, SHEBANG + body);
  chmodSync(path, 0o755);
}

function expectedBunVersion(): string {
  const pkg = readFileSync(join(REPO, "package.json"), "utf8");
  const m = pkg.match(/"packageManager"\s*:\s*"bun@([0-9]+\.[0-9]+\.[0-9]+)"/);
  if (!m) throw new Error("package.json#packageManager no tiene el formato esperado bun@<semver>");
  return m[1];
}

let activeShimDir: string | null = null;
afterEach(() => {
  if (activeShimDir) {
    rmSync(activeShimDir, { recursive: true, force: true });
    activeShimDir = null;
  }
});

interface ExecutionTrap {
  /** PATH del proceso actual con el directorio de señuelos ANTEPUESTO, unido con el
   *  `node:path` `delimiter` del sistema (';' en Windows, ':' en POSIX) -- OS-agnostic. */
  path: string;
  /** Ruta absoluta del marker file -- se pasa como D2K_TRAP_MARKER al proceso hijo. */
  markerPath: string;
  readMarker: () => string[];
}

/** Crea señuelos de bun/bunx/tsc que registran toda invocación (argumentos incluidos) en un
 *  marker file, antes de hacer cualquier otra cosa -- incluso si el comando real habría sido
 *  silencioso o su texto de salida cambiara en el futuro. */
function installExecutionTrap(): ExecutionTrap {
  const shimDir = mkdtempSync(join(tmpdir(), "d2k-verify-simplicity-trap-"));
  activeShimDir = shimDir;
  const markerPath = join(shimDir, "marker.log");
  writeFileSync(markerPath, "");

  const version = expectedBunVersion();

  // `bun`: el único caso legítimo es `--version` (toolchain pin) -- se responde en verde. CUALQUIER
  // otro argumento (test, run, x tsc, etc.) es trabajo pesado y queda registrado antes de salir 0
  // en silencio (a propósito: así se prueba que el trap detecta incluso un comando que no imprime
  // nada y se comporta como si hubiera tenido éxito).
  writeShim(
    shimDir,
    "bun",
    `echo "bun $*" >> "$D2K_TRAP_MARKER"\n` +
      `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi\n` +
      `exit 0\n`,
  );
  // `bunx`: no lo usa el código actual, pero cubre la redacción alternativa "bunx tsc" que un
  // futuro regressor podría introducir en vez de "bun x tsc".
  writeShim(shimDir, "bunx", `echo "bunx $*" >> "$D2K_TRAP_MARKER"\nexit 0\n`);
  // `tsc`: cubre la redacción alternativa de invocar el compilador directamente (sin bun/bunx
  // delante), por si el PATH del entorno real ya trae un `tsc` global.
  writeShim(shimDir, "tsc", `echo "tsc $*" >> "$D2K_TRAP_MARKER"\nexit 0\n`);

  return {
    path: `${shimDir}${delimiter}${process.env.PATH ?? ""}`,
    markerPath,
    readMarker: () =>
      readFileSync(markerPath, "utf8")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
  };
}

async function runGateUnderTrap(
  gateEnv: Record<string, string>,
): Promise<{ code: number; suspiciousCalls: string[]; hubUnchanged: boolean }> {
  const { path, markerPath, readMarker } = installExecutionTrap();

  const before = statSync(HUB_HTML).mtimeMs;
  const proc = Bun.spawn(["bash", "scripts/verify-simplicity.sh"], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...gateEnv, PATH: path, D2K_TRAP_MARKER: markerPath },
  });
  const [, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  const after = statSync(HUB_HTML).mtimeMs;

  // Única línea tolerada: la consulta de versión del pin de toolchain (R0/Task 31). Cualquier otra
  // línea en el marker es, por construcción, una invocación real de bun/bunx/tsc más allá de eso.
  const suspiciousCalls = readMarker().filter((line) => line !== "bun --version");

  return { code, suspiciousCalls, hubUnchanged: after === before };
}

test("AFTER EDIT (sin VERIFY_COMMIT_GATE): NINGÚN intento de ejecutar bun test/bunx/tsc/eval --enforce", async () => {
  const { code, suspiciousCalls, hubUnchanged } = await runGateUnderTrap({});
  expect(suspiciousCalls).toEqual([]);
  expect(hubUnchanged).toBe(true);
  expect(code).toBe(0);
});

test("commit gate PreToolUse (VERIFY_COMMIT_GATE=1): NINGÚN intento de ejecutar bun test/bunx/tsc/eval --enforce (c3, behavioral)", async () => {
  const { code, suspiciousCalls, hubUnchanged } = await runGateUnderTrap({ VERIFY_COMMIT_GATE: "1" });
  expect(suspiciousCalls).toEqual([]);
  expect(hubUnchanged).toBe(true);
  expect(code).toBe(0);
});

test("trampa de ejecución: canario -- confirma que el mecanismo SÍ detecta bun test / bunx tsc / tsc si se invocaran", async () => {
  // Prueba negativa de la propia trampa: sin esto, un señuelo roto (p.ej. mal ubicado en PATH, sin
  // permiso de ejecución, o con un shebang que Git Bash no reconoce en Windows) haría que las dos
  // pruebas de arriba "pasen" SIEMPRE por vacuidad, no porque el gate esté realmente limpio.
  const { path, markerPath, readMarker } = installExecutionTrap();

  const proc = Bun.spawn(
    ["bash", "-lc", "bun test some/suite && bunx tsc --noEmit && tsc --noEmit -p tsconfig.json"],
    {
      cwd: REPO,
      env: { ...process.env, PATH: path, D2K_TRAP_MARKER: markerPath },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  expect(await proc.exited).toBe(0);

  const calls = readMarker();
  expect(calls.some((l) => l.startsWith("bun test"))).toBe(true);
  expect(calls.some((l) => l.startsWith("bunx tsc"))).toBe(true);
  expect(calls.some((l) => l.startsWith("tsc --noEmit"))).toBe(true);
});
