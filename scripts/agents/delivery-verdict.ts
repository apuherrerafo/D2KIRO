// Decisión de entrega de /castoff: ¿READY o NOT_READY? Función pura sobre los logs del paquete de evidencia de /dispatch
// (`gate()` deja en cada log: `cwd:`, `$ comando`, salida y `exit=N`). El veredicto de Sentinel es una entrada
// SEPARADA y debe llegar sellado (`sentinel.log`) al HEAD y al contenido exacto del paquete: un PASS tecleado, viejo o de
// otro HEAD no habilita READY. Los comandos y carpetas de cada comprobación salen del propio bloque de /dispatch (una
// sola definición), no de una copia aquí.
//
// Límite honesto: son archivos de texto del propio coordinador; esto detecta error, obsolescencia y confusión, no un
// coordinador que falsifique todo. La fuente independiente es CI.
//
// Uso:  bun scripts/agents/delivery-verdict.ts <carpeta> <HEAD> [raíz]            decide (exit 0 READY, 1 NOT_READY)
//       bun scripts/agents/delivery-verdict.ts seal <carpeta> <HEAD> <salida-de-sentinel.txt>   escribe sentinel.log
// Código 2 = uso incorrecto.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type GateState = "PASS" | "FAIL" | "MISSING" | "STALE" | "WRONG_COMMAND" | "WRONG_CWD";

export const REQUIRED_GATE_NAMES = ["test", "tsc-engine", "tsc-web", "lint", "simplicity"] as const;
// Logs que forman el paquete: su contenido entra en el hash al que se sella a Sentinel.
export const PACKAGE_LOGS = [
  "sha", "status", "diff", "diff-local", "diff-nuevos", ...REQUIRED_GATE_NAMES, "sha-final", "status-final",
] as const;

export interface GateSpec {
  name: string;
  cwd: string; // relativo a la raíz del repo; "" = la raíz
  command: string;
}

/** Lee del bloque bash de /dispatch cada `gate NOMBRE comando` (con su `( cd carpeta && … )` si lo tiene). */
export function parseDispatchGates(skillText: string): GateSpec[] {
  const block = /## PAQUETE DE EVIDENCIA[\s\S]*?```bash\n([\s\S]*?)```/.exec(skillText.replace(/\r\n/g, "\n"))?.[1] ?? "";
  const specs: GateSpec[] = [];
  for (const line of block.split("\n")) {
    const inDir = /^\(\s*cd (\S+) && gate (\S+) (.+?)\s*\)\s*$/.exec(line);
    if (inDir) {
      specs.push({ name: inDir[2], cwd: inDir[1], command: inDir[3] });
      continue;
    }
    const plain = /^gate (\S+) (.+)$/.exec(line);
    if (plain) specs.push({ name: plain[1], cwd: "", command: plain[2].trim() });
  }
  return specs;
}

export interface Decision {
  ready: boolean;
  sentinel: string;
  gates: Record<string, GateState>;
  reasons: string[];
}

export interface DecisionInput {
  head: string;
  root: string;
  logs: Record<string, string | undefined>;
  dispatchText: string;
}

interface ParsedLog {
  command: string;
  cwd: string;
  exit: number | null;
  output: string; // sin cabecera (`cwd:`, `$ …`) ni `exit=`
  body: string;
}

function parseLog(text: string): ParsedLog {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const command = (lines.find((l) => l.startsWith("$ ")) ?? "").slice(2).trim();
  const cwd = (lines.find((l) => l.startsWith("cwd: ")) ?? "").slice(5).trim();
  const m = /^exit=(\d+)$/.exec(lines[lines.length - 1] ?? "");
  const output = lines.filter((l) => !l.startsWith("cwd: ") && !l.startsWith("$ ") && !/^exit=\d+$/.test(l)).join("\n").trim();
  return { command, cwd, exit: m ? Number(m[1]) : null, output, body: lines.join("\n") };
}

// `/d/x`, `D:\x` y `d:/x` son la misma carpeta (Git Bash escribe unas y Windows otras).
export function normalizePath(p: string): string {
  const s = p.replace(/\\/g, "/").replace(/\/+$/, "");
  const drive = /^\/([A-Za-z])\/(.*)$/.exec(s) ?? /^([A-Za-z]):\/(.*)$/.exec(s);
  return (drive ? `${drive[1]}:/${drive[2]}` : s).toLowerCase();
}

export function packageHash(logs: Record<string, string | undefined>): string {
  const h = createHash("sha256");
  for (const name of PACKAGE_LOGS) h.update(`${name}\0${logs[name] ?? "<ausente>"}\0`);
  return h.digest("hex");
}

/** Texto de `sentinel.log`: la salida literal de Sentinel atada al HEAD y al paquete que revisó. */
export function sealSentinel(head: string, logs: Record<string, string | undefined>, rawOutput: string): string {
  return `head: ${head}\npackage-sha256: ${packageHash(logs)}\n---\n${rawOutput}\n`;
}

function sentinelVerdict(logs: Record<string, string | undefined>, head: string, reasons: string[]): string {
  const text = logs.sentinel;
  if (text === undefined) {
    reasons.push("sin sentinel.log: el veredicto de Sentinel no tiene procedencia");
    return "SIN_PROCEDENCIA";
  }
  const norm = text.replace(/\r\n/g, "\n");
  const m = /^head: ([0-9a-f]{40})\npackage-sha256: ([0-9a-f]{64})\n---\n([\s\S]*)$/.exec(norm);
  if (!m) {
    reasons.push("sentinel.log sin cabecera de procedencia (head y package-sha256)");
    return "SIN_PROCEDENCIA";
  }
  if (m[1] !== head) {
    reasons.push(`el veredicto de Sentinel es de otro HEAD (${m[1]}, HEAD=${head})`);
    return "OTRO_HEAD";
  }
  if (m[2] !== packageHash(logs)) {
    reasons.push("el veredicto de Sentinel es de otro paquete de evidencia (el contenido cambió después de revisarlo)");
    return "OTRO_PAQUETE";
  }
  const verdicts = [...m[3].matchAll(/"veredicto"\s*:\s*"(PASS|FAIL|BLOCKED|NOT_VERIFIED)"/g)].map((x) => x[1]);
  return verdicts[verdicts.length - 1] ?? "SIN_VEREDICTO";
}

export function decideDelivery(input: DecisionInput): Decision {
  const { head, root, logs, dispatchText } = input;
  const reasons: string[] = [];
  const gates: Record<string, GateState> = {};
  const validHead = /^[0-9a-f]{40}$/.test(head);

  // 1) El árbol es exactamente el HEAD: sha antes y después de los gates, y estado limpio antes y después.
  let snapshotOk = validHead;
  if (!validHead) reasons.push("HEAD no es un SHA completo");
  for (const name of ["sha", "sha-final"]) {
    const text = logs[name];
    if (text === undefined) {
      snapshotOk = false;
      reasons.push(`falta ${name}.log: la evidencia no se puede atribuir a un HEAD`);
      continue;
    }
    const log = parseLog(text);
    const found = /^[0-9a-f]{40}$/m.exec(log.output)?.[0];
    if (log.exit !== 0 || found !== head) {
      snapshotOk = false;
      reasons.push(`${name}.log: ${found ?? "sin SHA"} no es el HEAD ${head} (evidencia obsoleta o el HEAD se movió)`);
    }
  }
  for (const name of ["status", "diff-local", "status-final"]) {
    const text = logs[name];
    if (text === undefined) {
      snapshotOk = false;
      reasons.push(`falta ${name}.log: no se sabe si el árbol estaba limpio`);
      continue;
    }
    const log = parseLog(text);
    if (log.exit !== 0) {
      snapshotOk = false;
      reasons.push(`${name}.log incompleto (exit=${log.exit ?? "?"})`);
    } else if (log.output !== "") {
      snapshotOk = false;
      reasons.push(`árbol sucio: ${name}.log no está vacío; las pruebas no corresponden al HEAD`);
    }
  }

  // 2) Cada comprobación obligatoria: mismo comando y carpeta que define /dispatch, con exit=0.
  const specs = new Map(parseDispatchGates(dispatchText).map((s) => [s.name, s]));
  for (const name of REQUIRED_GATE_NAMES) {
    const spec = specs.get(name);
    if (!spec) {
      gates[name] = "WRONG_COMMAND";
      reasons.push(`/dispatch no define el gate ${name}`);
      continue;
    }
    const text = logs[name];
    if (text === undefined) {
      gates[name] = "MISSING";
      reasons.push(`falta la evidencia de ${name}`);
      continue;
    }
    if (!snapshotOk) {
      gates[name] = "STALE";
      continue;
    }
    const log = parseLog(text);
    const expectedCwd = normalizePath(spec.cwd ? `${root}/${spec.cwd}` : root);
    if (log.command !== spec.command) {
      gates[name] = "WRONG_COMMAND";
      reasons.push(`${name}: el comando fue "${log.command}", se exige "${spec.command}"`);
    } else if (normalizePath(log.cwd) !== expectedCwd) {
      gates[name] = "WRONG_CWD";
      reasons.push(`${name}: corrió en "${log.cwd}", se exige "${spec.cwd || "."}" de la raíz (log intercambiado o de otra ruta)`);
    } else if (log.exit !== 0) {
      gates[name] = "FAIL";
      reasons.push(`${name}: ${log.exit === null ? "sin código de salida (cortado)" : `exit=${log.exit}`}`);
    } else {
      gates[name] = "PASS";
    }
  }

  // 3) Sentinel, aparte y con procedencia. Sólo PASS habilita; nunca basta por sí solo.
  const sentinel = sentinelVerdict(logs, head, reasons);
  if (sentinel !== "PASS" && !["SIN_PROCEDENCIA", "OTRO_HEAD", "OTRO_PAQUETE"].includes(sentinel)) {
    reasons.push(`Sentinel no dio PASS (${sentinel})`);
  }

  const allPass = snapshotOk && Object.values(gates).every((s) => s === "PASS");
  return { ready: allPass && sentinel === "PASS", sentinel, gates, reasons };
}

export function readLogs(dir: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const name of [...PACKAGE_LOGS, "sentinel"]) {
    const p = join(dir, `${name}.log`);
    out[name] = existsSync(p) ? readFileSync(p, "utf8") : undefined;
  }
  return out;
}

function gitRoot(): string {
  const r = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString().trim() : "";
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const usage = (): never => {
    console.error("uso: bun scripts/agents/delivery-verdict.ts <carpeta> <HEAD> [raíz]\n     bun scripts/agents/delivery-verdict.ts seal <carpeta> <HEAD> <salida-de-sentinel.txt>");
    process.exit(2);
  };
  if (args[0] === "seal") {
    const [, dir, head, rawFile] = args;
    if (!dir || !head || !rawFile || !existsSync(rawFile)) usage();
    writeFileSync(join(dir, "sentinel.log"), sealSentinel(head, readLogs(dir), readFileSync(rawFile, "utf8")));
    console.log(`sentinel.log sellado a ${head} y al paquete ${packageHash(readLogs(dir)).slice(0, 12)}`);
    process.exit(0);
  }
  const [dir, head, rootArg] = args;
  if (!dir || !head || !existsSync(dir)) usage();
  const root = rootArg ?? gitRoot();
  const skill = join(root, ".claude", "skills", "dispatch", "SKILL.md");
  const dispatchText = existsSync(skill) ? readFileSync(skill, "utf8") : "";
  const decision = decideDelivery({ head, root, logs: readLogs(dir), dispatchText });
  console.log(JSON.stringify({ resultado: decision.ready ? "READY" : "NOT_READY", ...decision }, null, 2));
  process.exit(decision.ready ? 0 : 1);
}
