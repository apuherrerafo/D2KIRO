// Decisión de entrega de /castoff: ¿READY o NOT_READY? Función pura sobre los logs del paquete de evidencia de /dispatch
// (`gate()` deja en cada log: `cwd:`, `$ comando`, salida y `exit=N`). El veredicto de Sentinel es una entrada
// SEPARADA: un PASS de seguridad no cubre tipos, lint ni pruebas, y nunca basta por sí solo para READY.
//
// Uso: bun scripts/agents/delivery-verdict.ts <carpeta-de-evidencia> <HEAD> <veredicto-de-sentinel>
// Salida: JSON. Código de salida 0 = READY, 1 = NOT_READY, 2 = uso incorrecto.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type GateState = "PASS" | "FAIL" | "MISSING" | "STALE" | "WRONG_COMMAND";

// Comando canónico de cada comprobación obligatoria (los mismos que escribe el bloque de /dispatch): un log de otro
// comando no cuenta.
export const REQUIRED_GATES: Record<string, string> = {
  test: "bun run test",
  "tsc-engine": "bunx tsc --noEmit",
  "tsc-web": "bunx tsc --noEmit",
  lint: "bun run lint",
  simplicity: "bash scripts/verify-simplicity.sh",
};

export interface Decision {
  ready: boolean;
  sentinel: string;
  gates: Record<string, GateState>;
  reasons: string[];
}

interface ParsedLog {
  command: string;
  exit: number | null;
  body: string;
}

function parseLog(text: string): ParsedLog {
  const lines = text.replace(/\r\n/g, "\n").trimEnd().split("\n");
  const command = (lines.find((l) => l.startsWith("$ ")) ?? "").slice(2).trim();
  const last = lines[lines.length - 1] ?? "";
  const m = /^exit=(\d+)$/.exec(last);
  return { command, exit: m ? Number(m[1]) : null, body: lines.join("\n") };
}

export function decideDelivery(head: string, logs: Record<string, string | undefined>, sentinelVerdict: string): Decision {
  const reasons: string[] = [];
  const gates: Record<string, GateState> = {};

  // Evidencia atribuible al HEAD: sha.log debe terminar bien y nombrar exactamente este HEAD.
  const shaText = logs.sha;
  let headOk = false;
  if (shaText === undefined) {
    reasons.push("falta sha.log: la evidencia no se puede atribuir a un HEAD");
  } else {
    const sha = parseLog(shaText);
    const found = /^[0-9a-f]{40}$/m.exec(sha.body)?.[0];
    headOk = sha.exit === 0 && found === head && /^[0-9a-f]{40}$/.test(head);
    if (!headOk) reasons.push(`evidencia obsoleta o de otro HEAD (sha.log=${found ?? "?"}, HEAD=${head})`);
  }

  for (const [name, canonical] of Object.entries(REQUIRED_GATES)) {
    const text = logs[name];
    if (text === undefined) {
      gates[name] = "MISSING";
      reasons.push(`falta la evidencia de ${name}`);
      continue;
    }
    const log = parseLog(text);
    if (!headOk) {
      gates[name] = "STALE";
      continue;
    }
    if (log.command !== canonical) {
      gates[name] = "WRONG_COMMAND";
      reasons.push(`${name}: el comando fue "${log.command}", se exige "${canonical}"`);
    } else if (log.exit !== 0) {
      gates[name] = "FAIL";
      reasons.push(`${name}: ${log.exit === null ? "sin código de salida (cortado)" : `exit=${log.exit}`}`);
    } else {
      gates[name] = "PASS";
    }
  }

  const sentinel = sentinelVerdict.trim().toUpperCase();
  if (sentinel !== "PASS") reasons.push(`Sentinel no dio PASS (${sentinel || "sin veredicto"})`);

  const allPass = Object.values(gates).every((s) => s === "PASS");
  return { ready: allPass && sentinel === "PASS", sentinel, gates, reasons };
}

export function readLogs(dir: string): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const name of ["sha", ...Object.keys(REQUIRED_GATES)]) {
    const p = join(dir, `${name}.log`);
    out[name] = existsSync(p) ? readFileSync(p, "utf8") : undefined;
  }
  return out;
}

if (import.meta.main) {
  const [dir, head, sentinel] = process.argv.slice(2);
  if (!dir || !head || sentinel === undefined) {
    console.error("uso: bun scripts/agents/delivery-verdict.ts <carpeta-de-evidencia> <HEAD> <veredicto-de-sentinel>");
    process.exit(2);
  }
  const decision = decideDelivery(head, readLogs(dir), sentinel);
  console.log(JSON.stringify({ resultado: decision.ready ? "READY" : "NOT_READY", ...decision }, null, 2));
  process.exit(decision.ready ? 0 : 1);
}
