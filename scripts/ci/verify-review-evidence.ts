// Compuerta `independent-review` v2: las revisiones se COMPRUEBAN contra git; ya no basta con escribir dos nombres en la descripción del PR.
//
// Qué exige (cada regla cierra una forma concreta de aparentar una revisión):
//  1. Registros de evidencia `docs/reviews/*.review.json` AÑADIDOS por este PR (uno viejo de otro PR no cuenta), de al menos DOS proveedores distintos.
//  2. Cada registro nombra el diff exacto que se revisó: `diffSha256` se RECALCULA aquí con git (merge-base..reviewedHead, sin docs/reviews). Un registro que
//     describa otro cambio, o uno inventado sin conocer el diff, no coincide.
//  3. Vigencia: entre `reviewedHead` y el head del PR NO cambió ni una línea fuera de docs/reviews. Tocar código después de revisar invalida la revisión:
//     hay que revisar de nuevo (de cada proveedor cuenta su registro más reciente).
//  4. La salida cruda del revisor se guarda tal cual junto al registro; su SHA-256 debe coincidir, tiene un mínimo de sustancia y cita archivos del diff.
//  5. Hallazgos: ninguno BLOQUEANTE sin resolver; un ALTA sin arreglar exige una aceptación razonada (>= 40 caracteres); los arreglos de rondas anteriores
//     (`disposition: fixed`) deben apuntar a un commit que existe en el PR y que de verdad toca el archivo citado.
//  6. Veredicto RECHAZADO en el registro más reciente de cualquier proveedor bloquea.
//
// LÍMITE (dicho sin adornos): esto vuelve la atestación COMPROBABLE y AUDITABLE, no infalsificable. Quien quiera fingir una revisión tiene que fabricar la
// salida cruda de un revisor y dejar esa fabricación en el historial de git, en vez de teclear un nombre. La autenticidad criptográfica exige una de estas
// tres cosas, que dependen del propietario (ver docs/release-protection.md): (a) aprobación NATIVA de una segunda cuenta de GitHub, (b) un revisor que corra
// DENTRO del CI con una credencial propia (cuesta dinero: no se crea sin aprobación), o (c) registros firmados con una clave de revisor registrada.
//
// Pura salvo por `git`, que se inyecta. Solo LEE blobs con `git show`/`git diff`: nunca hace checkout ni ejecuta nada del PR (pull_request_target).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

export type Git = (args: string[]) => string;

export const EVIDENCE_DIR = "docs/reviews/";
const MAX_RECORD_BYTES = 200_000;
const MIN_RAW_OUTPUT_CHARS = 300;
const MIN_ACCEPTANCE_REASON = 40;

const SEVERITIES = ["BLOQUEANTE", "ALTA", "MEDIA", "BAJA"] as const;
const DISPOSITIONS = ["fixed", "accepted", "rejected"] as const;
const VERDICTS = ["APROBADO", "APROBADO CON OBSERVACIONES", "RECHAZADO"] as const;

type Severity = (typeof SEVERITIES)[number];
type Disposition = (typeof DISPOSITIONS)[number];

interface Finding {
  severity: Severity;
  file: string;
  summary: string;
  disposition: Disposition;
  fixedIn?: string;
  reason?: string;
}

interface ReviewRecord {
  schema: "review-evidence/v1";
  reviewer: { provider: string; tool: string; model: string };
  reviewedBase: string;
  reviewedHead: string;
  diffSha256: string;
  rawOutput: { file: string; sha256: string };
  findings: Finding[];
  verdict: (typeof VERDICTS)[number];
}

export interface Verdict {
  ok: boolean;
  problems: string[];
  notes: string[];
}

const SHA = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9._\-/]{1,200}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function parseFinding(value: unknown): Finding | string {
  if (!isRecord(value)) return "hallazgo no es un objeto";
  const { severity, file, summary, disposition, fixedIn, reason } = value;
  if (!(SEVERITIES as readonly unknown[]).includes(severity)) return `severidad desconocida (${String(severity)})`;
  if (!isString(file) || !SAFE_PATH.test(file)) return "hallazgo sin `file` válido";
  if (!isString(summary) || summary.trim().length < 10) return "hallazgo sin resumen";
  if (!(DISPOSITIONS as readonly unknown[]).includes(disposition)) return `disposición desconocida (${String(disposition)})`;
  if (fixedIn !== undefined && (!isString(fixedIn) || !SHA.test(fixedIn))) return "`fixedIn` no es un SHA de 40 hex";
  if (reason !== undefined && !isString(reason)) return "`reason` no es texto";
  return { severity: severity as Severity, file, summary, disposition: disposition as Disposition, fixedIn: fixedIn as string | undefined, reason: reason as string | undefined };
}

export function parseRecord(text: string): ReviewRecord | string {
  if (text.length > MAX_RECORD_BYTES) return "registro demasiado grande";
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return "no es JSON";
  }
  if (!isRecord(raw) || raw.schema !== "review-evidence/v1") return "schema distinto de review-evidence/v1";
  const { reviewer, reviewedBase, reviewedHead, diffSha256, rawOutput, findings, verdict } = raw;
  if (!isRecord(reviewer) || !isString(reviewer.provider) || !isString(reviewer.tool) || !isString(reviewer.model)) return "reviewer incompleto (provider, tool, model)";
  if (!/^[a-z0-9:_\-.]{2,60}$/i.test(reviewer.provider) || reviewer.tool.trim().length < 2 || reviewer.model.trim().length < 2) return "reviewer con valores vacíos o raros";
  if (!isString(reviewedBase) || !SHA.test(reviewedBase) || !isString(reviewedHead) || !SHA.test(reviewedHead)) return "reviewedBase/reviewedHead no son SHA de 40 hex";
  if (!isString(diffSha256) || !HEX64.test(diffSha256)) return "diffSha256 inválido";
  if (!isRecord(rawOutput) || !isString(rawOutput.file) || !isString(rawOutput.sha256) || !HEX64.test(rawOutput.sha256)) return "rawOutput incompleto";
  if (!rawOutput.file.startsWith(EVIDENCE_DIR) || !SAFE_PATH.test(rawOutput.file) || rawOutput.file.includes("..")) return "rawOutput.file fuera de docs/reviews";
  if (!Array.isArray(findings)) return "findings no es una lista";
  if (!(VERDICTS as readonly unknown[]).includes(verdict)) return `veredicto desconocido (${String(verdict)})`;
  const parsed: Finding[] = [];
  for (const [index, entry] of findings.entries()) {
    const result = parseFinding(entry);
    if (typeof result === "string") return `hallazgo ${index + 1}: ${result}`;
    parsed.push(result);
  }
  return {
    schema: "review-evidence/v1",
    reviewer: { provider: reviewer.provider.toLowerCase(), tool: reviewer.tool, model: reviewer.model },
    reviewedBase,
    reviewedHead,
    diffSha256,
    rawOutput: { file: rawOutput.file, sha256: rawOutput.sha256 },
    findings: parsed,
    verdict: verdict as ReviewRecord["verdict"],
  };
}

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

interface Candidate {
  file: string;
  record: ReviewRecord;
}

function tryGit(git: Git, args: string[]): string | null {
  try {
    return git(args);
  } catch {
    return null;
  }
}

function isAncestor(git: Git, ancestor: string, descendant: string): boolean {
  return tryGit(git, ["merge-base", "--is-ancestor", ancestor, descendant]) !== null;
}

/** Diff del código revisado: todo lo que cambió entre la base y `reviewedHead`, sin los propios registros de revisión. */
function codeDiff(git: Git, from: string, to: string): string {
  return git(["diff", "--no-color", "--binary", from, to, "--", ".", `:(exclude)${EVIDENCE_DIR}`]);
}

function checkRecord(git: Git, mergeBase: string, head: string, candidate: Candidate, problems: string[]): void {
  const { file, record } = candidate;
  const tag = `${file} (${record.reviewer.provider})`;
  if (record.reviewedBase !== mergeBase) problems.push(`${tag}: reviewedBase no es la base de este PR (${mergeBase.slice(0, 8)}).`);
  if (tryGit(git, ["cat-file", "-e", `${record.reviewedHead}^{commit}`]) === null || !isAncestor(git, record.reviewedHead, head)) {
    problems.push(`${tag}: reviewedHead ${record.reviewedHead.slice(0, 8)} no pertenece a este PR.`);
    return;
  }
  const actualHash = sha256(codeDiff(git, mergeBase, record.reviewedHead));
  if (actualHash !== record.diffSha256) problems.push(`${tag}: diffSha256 no coincide con el diff real (esperado ${actualHash.slice(0, 12)}…): la revisión no describe este cambio.`);
}

export function verifyReviewEvidence(git: Git, baseSha: string, headSha: string): Verdict {
  const problems: string[] = [];
  const notes: string[] = [];
  const mergeBase = tryGit(git, ["merge-base", baseSha, headSha])?.trim();
  if (mergeBase === undefined || !SHA.test(mergeBase)) return { ok: false, problems: ["no se pudo calcular la base común del PR"], notes };

  const added = lines(tryGit(git, ["diff", "--name-only", "--diff-filter=AM", mergeBase, headSha, "--", EVIDENCE_DIR]) ?? "").filter((path) => path.endsWith(".review.json"));
  if (added.length === 0) return { ok: false, problems: ["el PR no añade ningún registro docs/reviews/*.review.json: sin evidencia no hay revisión"], notes };

  const candidates: Candidate[] = [];
  for (const file of added) {
    const text = tryGit(git, ["show", `${headSha}:${file}`]);
    if (text === null) {
      problems.push(`${file}: no se pudo leer`);
      continue;
    }
    const parsed = parseRecord(text);
    if (typeof parsed === "string") problems.push(`${file}: ${parsed}`);
    else candidates.push({ file, record: parsed });
  }
  if (problems.length > 0) return { ok: false, problems, notes };

  // El registro más reciente de cada proveedor (el que tiene por descendiente a los demás); los anteriores quedan como historial auditable.
  const latestByProvider = new Map<string, Candidate>();
  for (const candidate of candidates) {
    const current = latestByProvider.get(candidate.record.reviewer.provider);
    if (current === undefined || (candidate.record.reviewedHead !== current.record.reviewedHead && isAncestor(git, current.record.reviewedHead, candidate.record.reviewedHead))) {
      latestByProvider.set(candidate.record.reviewer.provider, candidate);
    }
  }
  if (latestByProvider.size < 2) problems.push(`se exigen revisiones de al menos 2 proveedores distintos; hay ${latestByProvider.size} (${[...latestByProvider.keys()].join(", ")}).`);

  const changedFiles = new Set(lines(tryGit(git, ["diff", "--name-only", mergeBase, headSha, "--", ".", `:(exclude)${EVIDENCE_DIR}`]) ?? ""));
  const rangeCommits = new Set(lines(tryGit(git, ["rev-list", `${mergeBase}..${headSha}`]) ?? ""));
  const rawHashes = new Set<string>();

  for (const candidate of candidates) checkRecord(git, mergeBase, headSha, candidate, problems);

  for (const candidate of latestByProvider.values()) {
    const { file, record } = candidate;
    const tag = `${file} (${record.reviewer.provider})`;
    // Vigencia: tras la revisión no cambió código.
    if (isAncestor(git, record.reviewedHead, headSha) && codeDiff(git, record.reviewedHead, headSha).length > 0) {
      problems.push(`${tag}: el código cambió después de esta revisión (${record.reviewedHead.slice(0, 8)}..${headSha.slice(0, 8)}); el proveedor debe revisar el head actual.`);
    }
    // Salida cruda.
    const raw = tryGit(git, ["show", `${headSha}:${record.rawOutput.file}`]);
    if (raw === null) {
      problems.push(`${tag}: falta la salida cruda ${record.rawOutput.file} en el PR.`);
    } else {
      if (sha256(raw) !== record.rawOutput.sha256) problems.push(`${tag}: la salida cruda no coincide con su SHA-256 (fue editada).`);
      if (raw.trim().length < MIN_RAW_OUTPUT_CHARS) problems.push(`${tag}: la salida cruda es demasiado corta (${raw.trim().length} < ${MIN_RAW_OUTPUT_CHARS}) para ser una revisión.`);
      if (![...changedFiles].some((path) => raw.includes(path))) problems.push(`${tag}: la salida cruda no menciona ningún archivo del diff: no revisó este cambio.`);
      if (rawHashes.has(sha256(raw))) problems.push(`${tag}: la salida cruda es idéntica a la de otro revisor.`);
      rawHashes.add(sha256(raw));
    }
    // Veredicto y hallazgos sin resolver.
    if (record.verdict === "RECHAZADO") problems.push(`${tag}: el veredicto es RECHAZADO.`);
    for (const finding of record.findings) {
      if (finding.severity === "BLOQUEANTE" && finding.disposition !== "fixed") problems.push(`${tag}: BLOQUEANTE sin arreglar en ${finding.file}: ${finding.summary.slice(0, 80)}`);
      if (finding.severity === "ALTA" && finding.disposition === "accepted" && (finding.reason?.trim().length ?? 0) < MIN_ACCEPTANCE_REASON) problems.push(`${tag}: ALTA aceptada sin razón suficiente (>= ${MIN_ACCEPTANCE_REASON} caracteres) en ${finding.file}.`);
      if (finding.severity === "ALTA" && finding.disposition === "rejected" && (finding.reason?.trim().length ?? 0) < MIN_ACCEPTANCE_REASON) problems.push(`${tag}: ALTA descartada sin razón suficiente en ${finding.file}.`);
    }
  }

  // Los arreglos citados (en cualquier ronda) existen en el PR y tocan el archivo del hallazgo.
  for (const candidate of candidates) {
    for (const finding of candidate.record.findings) {
      if (finding.disposition !== "fixed") continue;
      const tag = `${candidate.file}: arreglo de ${finding.file}`;
      if (finding.fixedIn === undefined) {
        problems.push(`${tag} sin \`fixedIn\`.`);
        continue;
      }
      if (!rangeCommits.has(finding.fixedIn)) {
        problems.push(`${tag}: el commit ${finding.fixedIn.slice(0, 8)} no pertenece a este PR.`);
        continue;
      }
      const touched = lines(tryGit(git, ["show", "--name-only", "--format=", finding.fixedIn]) ?? "");
      if (!touched.includes(finding.file)) problems.push(`${tag}: el commit ${finding.fixedIn.slice(0, 8)} no toca ese archivo.`);
    }
  }

  notes.push(`registros: ${candidates.length}; proveedores con registro vigente: ${[...latestByProvider.keys()].join(", ")}`);
  return { ok: problems.length === 0, problems, notes };
}

/**
 * Entorno para procesos `git` hijos SIN las variables que git exporta dentro de un hook (GIT_DIR, GIT_INDEX_FILE, GIT_WORK_TREE...): heredadas, un `git` lanzado
 * desde una prueba que corre en pre-commit operaría sobre el índice del repositorio REAL en vez del suyo (así se corrompió el índice durante el desarrollo).
 */
export function cleanGitEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const clean: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) if (!key.startsWith("GIT_") || key === "GIT_TERMINAL_PROMPT") clean[key] = value;
  return clean;
}

export function realGit(cwd?: string): Git {
  return (args) => execFileSync("git", args, { cwd, env: cleanGitEnv(), encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
}

if (import.meta.main) {
  const [base, head] = process.argv.slice(2);
  if (base === undefined || head === undefined || !SHA.test(base) || !SHA.test(head)) {
    console.error("Uso: bun run scripts/ci/verify-review-evidence.ts <base-sha-40hex> <head-sha-40hex>");
    process.exit(2);
  }
  const verdict = verifyReviewEvidence(realGit(), base, head);
  for (const note of verdict.notes) console.log(`nota: ${note}`);
  if (verdict.ok) {
    console.log("OK: revisiones independientes comprobadas contra git.");
    process.exit(0);
  }
  for (const problem of verdict.problems) console.error(`FAIL: ${problem}`);
  process.exit(1);
}
