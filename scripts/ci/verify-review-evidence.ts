// Compuerta `independent-review` v2: las revisiones se COMPRUEBAN contra git; ya no basta con escribir dos nombres en la descripción del PR.
//
// Qué exige (cada regla cierra una forma concreta de aparentar una revisión):
//  1. Registros de evidencia `docs/reviews/*.review.json` AÑADIDOS por este PR (uno viejo de otro PR no cuenta), de al menos DOS proveedores distintos y CONOCIDOS
//     (lista `docs/reviews/providers.json` leída de la rama BASE, que el PR no puede tocar; `human:<login>` cuenta por login).
//  2. Cada registro nombra el diff exacto que se revisó: `diffSha256` se RECALCULA aquí con git (merge-base..reviewedHead, sin docs/reviews, con las opciones de
//     git fijadas para que no dependan de la configuración local). Un registro que describa otro cambio, o uno inventado sin conocer el diff, no coincide.
//  3. Vigencia: entre `reviewedHead` y el head del PR NO cambió ni una línea fuera de docs/reviews. Tocar código después de revisar invalida la revisión:
//     hay que revisar de nuevo. Por proveedor cuenta su ronda más reciente, y se evalúan TODOS los registros de esa ronda (un RECHAZADO no se tapa con otro).
//  4. La salida cruda del revisor se guarda junto al registro; su SHA-256 (sobre el texto normalizado: BOM y CRLF no importan) debe coincidir, tiene un mínimo de
//     sustancia, cita archivos del diff y no es idéntica a la de otro revisor.
//  5. Los `findings` del registro se CONTRASTAN con la salida cruda: la cuenta por severidad (líneas "N. BLOQUEANTE|ALTA|MEDIA|BAJA ...") debe coincidir. Así un
//     BLOQUEANTE que el revisor escribió no puede desaparecer del registro sin editar la salida cruda (y entonces cambia su hash).
//  6. Hallazgos de la ronda vigente: ninguno `fixed` (si el revisor lo ve en el código actual, no está arreglado); un BLOQUEANTE o ALTA solo pasa como `accepted`
//     con una razón de >= 40 caracteres, y un BLOQUEANTE exige además `acceptedRisk` = un id de `docs/reviews/ACCEPTED-RISKS.json` DE LA RAMA BASE (el propietario
//     lo acepta al fusionar el PR que lo añade; ese PR no se evalúa con su propia lista). Rondas anteriores: `fixed` exige un commit del PR que toque el archivo.
//  7. Veredicto RECHAZADO en cualquier registro de la ronda vigente bloquea.
//
// LÍMITE (dicho sin adornos): esto vuelve la atestación COMPROBABLE y AUDITABLE, no infalsificable. Quien quiera fingir una revisión tiene que fabricar la
// salida cruda de un revisor y dejar esa fabricación en el historial de git, en vez de teclear un nombre. La autenticidad criptográfica exige una de estas
// tres cosas, que dependen del propietario (ver docs/release-protection.md): (a) aprobación NATIVA de una segunda cuenta de GitHub, (b) un revisor que corra
// DENTRO del CI con una credencial propia (cuesta dinero: no se crea sin aprobación), o (c) registros firmados con una clave de revisor registrada.
//
// Pura salvo por `git`, que se inyecta. Solo LEE blobs con `git show`/`git diff`: nunca hace checkout ni ejecuta nada del PR (pull_request_target).
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { checkCoverage, criticalMatches, INTERNAL_PROVIDER, parsePolicy, POLICY_FILE, type ReviewPolicy } from "./review-policy";

export type Git = (args: string[]) => string;

export const EVIDENCE_DIR = "docs/reviews/";
export const PROVIDERS_FILE = `${EVIDENCE_DIR}providers.json`;
export const ACCEPTED_RISKS_FILE = `${EVIDENCE_DIR}ACCEPTED-RISKS.json`;
/** Solo los registros y las salidas crudas quedan fuera del diff revisado; providers.json y ACCEPTED-RISKS.json (de las que depende la compuerta) SÍ lo integran. */
export const EVIDENCE_OUTPUT_EXCLUDES = [`:(exclude)${EVIDENCE_DIR}*.review.json`, `:(exclude)${EVIDENCE_DIR}*.raw.txt`];
const DEFAULT_PROVIDERS = ["openai", "anthropic", "google"];
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
  acceptedRisk?: string;
}

interface ReviewRecord {
  schema: "review-evidence/v1";
  reviewer: { provider: string; tool: string; model: string; promptId?: string; promptSha256?: string; isolation?: string };
  reviewedBase: string;
  reviewedHead: string;
  diffSha256: string;
  rawOutput: { file: string; sha256: string };
  findings: Finding[];
  verdict: (typeof VERDICTS)[number];
}

/** Lector del checkout CONFIABLE (rama predeterminada), nunca del PR: de ahí salen la política y los prompts versionados. */
export type Trusted = (path: string) => string | null;
export const fsTrusted: Trusted = (path) => (existsSync(path) ? readFileSync(path, "utf8") : null);

export interface Verdict {
  /** true si pasa SOLO por pasadas internas Claude: no es una revisión independiente. */
  internalOnly?: boolean;
  ok: boolean;
  problems: string[];
  notes: string[];
}

const SHA = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const SAFE_PATH = /^[A-Za-z0-9._\-/]{1,200}$/;
const RISK_ID = /^[A-Za-z0-9._-]{1,40}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === "string";

function parseFinding(value: unknown): Finding | string {
  if (!isRecord(value)) return "hallazgo no es un objeto";
  const { severity, file, summary, disposition, fixedIn, reason, acceptedRisk } = value;
  if (!(SEVERITIES as readonly unknown[]).includes(severity)) return `severidad desconocida (${String(severity)})`;
  if (!isString(file) || !SAFE_PATH.test(file)) return "hallazgo sin `file` válido";
  if (!isString(summary) || summary.trim().length < 10) return "hallazgo sin resumen";
  if (!(DISPOSITIONS as readonly unknown[]).includes(disposition)) return `disposición desconocida (${String(disposition)})`;
  if (fixedIn !== undefined && (!isString(fixedIn) || !SHA.test(fixedIn))) return "`fixedIn` no es un SHA de 40 hex";
  if (reason !== undefined && !isString(reason)) return "`reason` no es texto";
  if (acceptedRisk !== undefined && (!isString(acceptedRisk) || !RISK_ID.test(acceptedRisk))) return "`acceptedRisk` no es un id válido";
  return { severity: severity as Severity, file, summary, disposition: disposition as Disposition, fixedIn: fixedIn as string | undefined, reason: reason as string | undefined, acceptedRisk: acceptedRisk as string | undefined };
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
  const internal = {
    ...(isString(reviewer.promptId) ? { promptId: reviewer.promptId } : {}),
    ...(isString(reviewer.promptSha256) ? { promptSha256: reviewer.promptSha256 } : {}),
    ...(isString(reviewer.isolation) ? { isolation: reviewer.isolation } : {}),
  };
  return {
    schema: "review-evidence/v1",
    reviewer: { provider: reviewer.provider.toLowerCase(), tool: reviewer.tool, model: reviewer.model, ...internal },
    reviewedBase,
    reviewedHead,
    diffSha256,
    rawOutput: { file: rawOutput.file, sha256: rawOutput.sha256 },
    findings: parsed,
    verdict: verdict as ReviewRecord["verdict"],
  };
}

/** Texto canónico de una salida cruda: sin BOM y con saltos LF. El hash se calcula SIEMPRE sobre esto, así `core.autocrlf` o un editor de Windows no lo cambian. */
export function normalizeRaw(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

export const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const lines = (text: string) => text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);

/** Cuenta, por severidad, las líneas de hallazgo de la salida cruda: "1. BLOQUEANTE ...", "1) **ALTA** ...", "- [MEDIA] ...". Solo mayúsculas (no confunde prosa). */
export function countSeverities(raw: string): Record<Severity, number> {
  const counts: Record<Severity, number> = { BLOQUEANTE: 0, ALTA: 0, MEDIA: 0, BAJA: 0 };
  for (const line of raw.split("\n")) {
    const match = /^[ \t#>*-]*(?:\d+[.)]\s*)?[[*(]*(BLOQUEANTE|ALTA|MEDIA|BAJA)\b/.exec(line);
    if (match?.[1] !== undefined) counts[match[1] as Severity] += 1;
  }
  return counts;
}

/** Líneas de hallazgo de la salida cruda (mismo formato que `countSeverities`) con su severidad y su texto normalizado en minúsculas. */
export function findingLinesOf(raw: string): Array<{ severity: Severity; text: string }> {
  const found: Array<{ severity: Severity; text: string }> = [];
  for (const line of raw.split("\n")) {
    const match = /^[ \t#>*-]*(?:\d+[.)]\s*)?[[*(]*(BLOQUEANTE|ALTA|MEDIA|BAJA)\b/.exec(line);
    if (match?.[1] !== undefined) found.push({ severity: match[1] as Severity, text: line.replace(/\s+/g, " ").trim().toLowerCase() });
  }
  return found;
}

/** Menciones de cada severidad (palabra en mayúsculas exactas) en cualquier parte de la salida cruda: cota superior de lo que el registro puede declarar. */
export function countSeverityMentions(raw: string): Record<Severity, number> {
  const counts: Record<Severity, number> = { BLOQUEANTE: 0, ALTA: 0, MEDIA: 0, BAJA: 0 };
  for (const match of raw.matchAll(/\b(BLOQUEANTE|ALTA|MEDIA|BAJA)\b/g)) counts[match[1] as Severity] += 1;
  return counts;
}

/** Argumentos de `git diff` del código revisado, con todo lo que cambia el texto fijado (prefijos, algoritmo, renames, drivers externos). Los usa también record-review. */
export function codeDiffArgs(from: string, to: string): string[] {
  return [
    "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "diff.algorithm=myers", "-c", "diff.renames=false", "-c", "core.quotepath=true",
    "diff", "--no-color", "--binary", "--no-ext-diff", "--no-textconv", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/",
    from, to, "--", ".", ...EVIDENCE_OUTPUT_EXCLUDES,
  ];
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

const codeDiff = (git: Git, from: string, to: string): string => git(codeDiffArgs(from, to));

/** Cambio de CÓDIGO entre dos commits: sin docs/ ni *.md (un retoque de documentación no es corregir lo que un revisor rechazó). */
const sourceDiff = (git: Git, from: string, to: string): string => git([...codeDiffArgs(from, to), ":(exclude)docs/", ":(exclude)*.md"]);

interface Candidate {
  file: string;
  record: ReviewRecord;
}

/** Proveedores admitidos: la lista de la rama BASE (o la de fábrica si aún no existe). `human:<login>` se admite con login. */
function allowedProviders(git: Git, baseSha: string): { providers: Set<string>; problem?: string } {
  const text = tryGit(git, ["show", `${baseSha}:${PROVIDERS_FILE}`]);
  if (text === null) return { providers: new Set(DEFAULT_PROVIDERS) };
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed) && Array.isArray(parsed.providers) && parsed.providers.every((entry) => isString(entry) && /^[a-z0-9_.-]{2,40}$/.test(entry))) return { providers: new Set(parsed.providers as string[]) };
  } catch {
    // cae al mensaje de abajo
  }
  return { providers: new Set(DEFAULT_PROVIDERS), problem: `${PROVIDERS_FILE} de la rama base es ilegible: se usa la lista de fábrica` };
}

interface AcceptedRisk {
  /** Cadenas que el resumen del hallazgo debe contener TODAS (sin distinguir mayúsculas): un riesgo aceptado no es un comodín para cualquier hallazgo. */
  match: string[];
  /** Prefijos de ruta: el hallazgo debe ser sobre un archivo bajo alguno de ellos (si se declara). Un riesgo sobre la compuerta no cubre un hallazgo en el motor o la web. */
  paths?: string[];
  /** Fecha límite `YYYY-MM-DD` frente a la fecha del commit head (no al reloj): pasada, el riesgo deja de valer y hay que volver a aceptarlo. */
  expires?: string;
}

function acceptedRisks(git: Git, baseSha: string): Map<string, AcceptedRisk> {
  const risks = new Map<string, AcceptedRisk>();
  const text = tryGit(git, ["show", `${baseSha}:${ACCEPTED_RISKS_FILE}`]);
  if (text === null) return risks;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || !Array.isArray(parsed.risks)) return risks;
    for (const entry of parsed.risks) {
      if (!isRecord(entry) || !isString(entry.id) || !RISK_ID.test(entry.id)) continue;
      const needles = (Array.isArray(entry.match) ? entry.match : [entry.match]).filter((item): item is string => isString(item) && item.trim().length >= 4).map((item) => item.trim().toLowerCase());
      if (needles.length === 0) continue; // sin `match` no vale
      if (entry.expires !== undefined && (!isString(entry.expires) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires))) continue;
      const paths = Array.isArray(entry.paths) ? entry.paths.filter((item): item is string => isString(item) && SAFE_PATH.test(item)) : undefined;
      risks.set(entry.id, { match: needles, paths: paths !== undefined && paths.length > 0 ? paths : undefined, expires: entry.expires as string | undefined });
    }
  } catch {
    // lista ilegible = ningún riesgo aceptado
  }
  return risks;
}

function providerKnown(provider: string, providers: Set<string>, policy: ReviewPolicy | null = null): boolean {
  if (provider === INTERNAL_PROVIDER) return policy !== null; // sin política confiable, una pasada "interna" no existe
  if (provider.startsWith("human:")) return /^human:[a-z0-9-]{1,39}$/.test(provider);
  return providers.has(provider);
}

function checkRecord(git: Git, mergeBase: string, head: string, candidate: Candidate, problems: string[]): void {
  const { file, record } = candidate;
  const tag = `${file} (${record.reviewer.provider})`;
  if (record.reviewedBase !== mergeBase) problems.push(`${tag}: reviewedBase no es la base de este PR (${mergeBase.slice(0, 8)}); si la base avanzó o se hizo rebase, hay que revisar de nuevo.`);
  if (tryGit(git, ["cat-file", "-e", `${record.reviewedHead}^{commit}`]) === null || !isAncestor(git, record.reviewedHead, head)) {
    problems.push(`${tag}: reviewedHead ${record.reviewedHead.slice(0, 8)} no pertenece a este PR.`);
    return;
  }
  const actualHash = sha256(codeDiff(git, mergeBase, record.reviewedHead));
  if (actualHash !== record.diffSha256) problems.push(`${tag}: diffSha256 no coincide con el diff real (esperado ${actualHash.slice(0, 12)}…): la revisión no describe este cambio.`);
}

export function verifyReviewEvidence(git: Git, baseSha: string, headSha: string, now: Date = new Date(), trusted: Trusted = () => null): Verdict {
  const problems: string[] = [];
  const notes: string[] = [];
  const mergeBase = tryGit(git, ["merge-base", baseSha, headSha])?.trim();
  if (mergeBase === undefined || !SHA.test(mergeBase)) return { ok: false, problems: ["no se pudo calcular la base común del PR"], notes };

  // Solo registros NUEVOS de este PR (A, sin detección de renombres: un registro renombrado cuenta como nuevo, uno modificado de otro PR no).
  const added = lines(tryGit(git, ["diff", "--name-only", "--no-renames", "--diff-filter=A", mergeBase, headSha, "--", EVIDENCE_DIR]) ?? "").filter((path) => path.endsWith(".review.json"));
  if (added.length === 0) return { ok: false, problems: ["el PR no añade ningún registro docs/reviews/*.review.json: sin evidencia no hay revisión"], notes };

  // Política híbrida: del checkout confiable. Ausente o inválida => regla anterior (2 proveedores distintos), jamás una más laxa.
  const policy = parsePolicy(trusted(POLICY_FILE));
  const { providers: allowed, problem: providersProblem } = allowedProviders(git, baseSha);
  if (providersProblem !== undefined) notes.push(providersProblem);
  const risks = acceptedRisks(git, baseSha);
  // Caducidad: se toma la MÁS TARDÍA entre la fecha del commit head (el autor puede ponerla atrás con GIT_COMMITTER_DATE) y el reloj de quien verifica (el CI).
  const commitDate = (tryGit(git, ["show", "-s", "--format=%cI", headSha]) ?? "").trim().slice(0, 10);
  const clockDate = now.toISOString().slice(0, 10);
  const headDate = commitDate > clockDate ? commitDate : clockDate;

  const candidates: Candidate[] = [];
  for (const file of added) {
    const text = tryGit(git, ["show", `${headSha}:${file}`]);
    if (text === null) {
      problems.push(`${file}: no se pudo leer`);
      continue;
    }
    const parsed = parseRecord(text);
    if (typeof parsed === "string") problems.push(`${file}: ${parsed}`);
    else if (!providerKnown(parsed.reviewer.provider, allowed, policy)) problems.push(`${file}: proveedor desconocido (${parsed.reviewer.provider}); admitidos: ${[...allowed].join(", ")} o human:<login>.`);
    else candidates.push({ file, record: parsed });
  }
  if (problems.length > 0) return { ok: false, problems, notes };

  // Ronda vigente de cada proveedor = los registros de su(s) `reviewedHead` más reciente(s) (los que no son ancestro de otro). Más de una rama sin relación bloquea.
  const byProvider = new Map<string, Candidate[]>();
  for (const candidate of candidates) byProvider.set(candidate.record.reviewer.provider, [...(byProvider.get(candidate.record.reviewer.provider) ?? []), candidate]);
  if (policy === null && byProvider.size < 2) problems.push(`se exigen revisiones de al menos 2 proveedores distintos; hay ${byProvider.size} (${[...byProvider.keys()].join(", ")}).`);

  const addedSet = new Set(lines(tryGit(git, ["diff", "--name-only", "--no-renames", "--diff-filter=A", mergeBase, headSha, "--", EVIDENCE_DIR]) ?? ""));
  const current: Candidate[] = [];
  for (const [provider, records] of byProvider) {
    const heads = [...new Set(records.map((entry) => entry.record.reviewedHead))];
    const latest = heads.filter((head) => !heads.some((other) => other !== head && isAncestor(git, head, other)));
    if (latest.length !== 1) problems.push(`${provider}: sus registros más recientes apuntan a ${latest.length} heads sin relación entre sí; debe haber una sola ronda vigente.`);
    else current.push(...records.filter((entry) => entry.record.reviewedHead === latest[0]));
  }

  const changedFiles = new Set(lines(tryGit(git, ["diff", "--name-only", mergeBase, headSha, "--", ".", ...EVIDENCE_OUTPUT_EXCLUDES]) ?? ""));
  let internalOnly = false;
  if (policy !== null) {
    // Pasadas internas: prompt versionado EN EL CHECKOUT CONFIABLE, con su hash, y contexto aislado declarado. Un PR no puede aportar su propio prompt.
    const validPromptIds: string[] = [];
    for (const { file, record } of current.filter((entry) => entry.record.reviewer.provider === INTERNAL_PROVIDER)) {
      const { promptId, promptSha256, isolation } = record.reviewer;
      const tag = `${file} (${INTERNAL_PROVIDER})`;
      const prompt = promptId === undefined ? undefined : policy.prompts[promptId];
      if (prompt === undefined) problems.push(`${tag}: promptId desconocido o ausente; admitidos: ${Object.keys(policy.prompts).join(", ")}.`);
      else if (isolation !== "fresh-context") problems.push(`${tag}: una pasada interna debe declarar isolation="fresh-context" (contexto nuevo, sin historial del autor).`);
      else {
        const text = trusted(prompt.file);
        if (text === null) problems.push(`${tag}: el prompt versionado ${prompt.file} no existe en el checkout confiable.`);
        else if (promptSha256 !== sha256(normalizeRaw(text))) problems.push(`${tag}: promptSha256 no coincide con ${prompt.file} de la rama predeterminada (prompt cambiado o inventado).`);
        else validPromptIds.push(promptId as string);
      }
    }
    const critical = criticalMatches(changedFiles, policy);
    const coverage = checkCoverage({ providers: [...new Set(current.map((entry) => entry.record.reviewer.provider))], internalPromptIds: validPromptIds }, critical.length > 0, policy);
    problems.push(...coverage.problems);
    internalOnly = coverage.internalOnly;
    if (critical.length > 0) notes.push(`cambio CRÍTICO por: ${critical.slice(0, 6).join(", ")}${critical.length > 6 ? ` (+${critical.length - 6})` : ""}`);
    else notes.push("cambio estándar (sin rutas críticas)");
  }
  const rangeCommits = new Set(lines(tryGit(git, ["rev-list", `${mergeBase}..${headSha}`]) ?? ""));
  const rawHashes = new Set<string>();

  for (const candidate of candidates) checkRecord(git, mergeBase, headSha, candidate, problems);

  for (const candidate of current) {
    const { file, record } = candidate;
    const tag = `${file} (${record.reviewer.provider})`;
    // Vigencia: tras la revisión no cambió código.
    if (isAncestor(git, record.reviewedHead, headSha) && codeDiff(git, record.reviewedHead, headSha).length > 0) {
      problems.push(`${tag}: el código cambió después de esta revisión (${record.reviewedHead.slice(0, 8)}..${headSha.slice(0, 8)}); el proveedor debe revisar el head actual.`);
    }
    // Salida cruda: íntegra, con sustancia, sobre este diff, y coherente con los hallazgos tecleados.
    const blob = tryGit(git, ["show", `${headSha}:${record.rawOutput.file}`]);
    if (blob === null) {
      problems.push(`${tag}: falta la salida cruda ${record.rawOutput.file} en el PR.`);
    } else if (!addedSet.has(record.rawOutput.file)) {
      problems.push(`${tag}: la salida cruda ${record.rawOutput.file} no la añade este PR: se reutilizó la de otra revisión.`);
    } else {
      const raw = normalizeRaw(blob);
      const rawHash = sha256(raw);
      if (rawHash !== record.rawOutput.sha256) problems.push(`${tag}: la salida cruda no coincide con su SHA-256 (fue editada).`);
      if (raw.trim().length < MIN_RAW_OUTPUT_CHARS) problems.push(`${tag}: la salida cruda es demasiado corta (${raw.trim().length} < ${MIN_RAW_OUTPUT_CHARS}) para ser una revisión.`);
      if (!raw.includes(record.reviewedHead)) problems.push(`${tag}: la salida cruda no nombra el head revisado (${record.reviewedHead.slice(0, 8)}): no es la revisión de este código.`);
      if (![...changedFiles].some((path) => raw.includes(path))) problems.push(`${tag}: la salida cruda no menciona ningún archivo del diff: no revisó este cambio.`);
      if (rawHashes.has(rawHash)) problems.push(`${tag}: la salida cruda es idéntica a la de otro revisor.`);
      rawHashes.add(rawHash);
      const lineStart = countSeverities(raw);
      const mentions = countSeverityMentions(raw);
      const fromRecord: Record<Severity, number> = { BLOQUEANTE: 0, ALTA: 0, MEDIA: 0, BAJA: 0 };
      for (const finding of record.findings) fromRecord[finding.severity] += 1;
      // Vínculo 1 a 1: cada hallazgo del registro debe estar, con su resumen TAL CUAL, en una línea de hallazgo de la salida cruda de SU severidad, y ninguna línea de
      // hallazgo puede quedar sin registro. Así un ALTA real no se reemplaza por otro ALTA cuyo resumen aparece en prosa.
      const findingLines = findingLinesOf(raw);
      const unused = new Set(findingLines.keys());
      for (const finding of record.findings) {
        const needle = finding.summary.replace(/\s+/g, " ").trim().toLowerCase();
        const at = findingLines.findIndex((line, index) => unused.has(index) && line.severity === finding.severity && line.text.includes(needle));
        if (at === -1) problems.push(`${tag}: el resumen del hallazgo ${finding.severity} en ${finding.file} no está tal cual en una línea de hallazgo ${finding.severity} de la salida cruda: el registro no puede decir otra cosa que el revisor.`);
        else unused.delete(at);
      }
      for (const index of unused) problems.push(`${tag}: la salida cruda lista un hallazgo ${findingLines[index]!.severity} ("${findingLines[index]!.text.slice(0, 70)}…") que el registro no recoge.`);
      // Líneas que parecen hallazgos (viñeta o número) con una severidad dentro pero fuera del formato reconocible, con un registro vacío: formato libre que oculta hallazgos.
      const looseLines = raw.split("\n").filter((line) => /^[ \t]*(?:(?:\d+[.)]|[-*•])\s+|(?:Severidad|Hallazgo|Severity|Finding)\b[^A-Z\n]{0,20})[^\n]*\b(BLOQUEANTE|ALTA|MEDIA|BAJA)\b/.test(line)).length;
      if (looseLines > findingLines.length && record.findings.length < looseLines) problems.push(`${tag}: la salida cruda tiene ${looseLines} líneas con severidad pero solo ${findingLines.length} en el formato reconocible ("N. SEVERIDAD ..."): use ese formato.`);
      for (const severity of SEVERITIES) {
        // Cota inferior: cada línea "N. SEVERIDAD ..." de la salida cruda tiene su hallazgo en el registro (no se puede ocultar uno). Cota superior: el registro no
        // puede traer más hallazgos de una severidad que veces aparece esa palabra en la salida cruda (formatos raros pasan, inventar hallazgos no).
        if (fromRecord[severity] < lineStart[severity]) problems.push(`${tag}: la salida cruda lista ${lineStart[severity]} hallazgo(s) ${severity} y el registro solo ${fromRecord[severity]}: los hallazgos no coinciden con lo que escribió el revisor.`);
        if (fromRecord[severity] > mentions[severity]) problems.push(`${tag}: el registro trae ${fromRecord[severity]} hallazgo(s) ${severity} pero la salida cruda solo menciona ${mentions[severity]}.`);
      }
    }
    if (record.verdict === "RECHAZADO") problems.push(`${tag}: el veredicto es RECHAZADO.`);
    for (const finding of record.findings) {
      const where = `${tag}: ${finding.severity} en ${finding.file}`;
      if (finding.disposition === "fixed") {
        problems.push(`${where} figura como arreglado en la ronda vigente: si el revisor lo ve en el código actual, no está arreglado.`);
        continue;
      }
      const reasoned = (finding.reason?.trim().length ?? 0) >= MIN_ACCEPTANCE_REASON;
      // ALTA y BLOQUEANTE solo pasan ACEPTADOS (no "rejected" con texto libre) y razonados; MEDIA/BAJA pueden quedar como observaciones.
      if ((finding.severity === "ALTA" || finding.severity === "BLOQUEANTE") && finding.disposition !== "accepted") problems.push(`${where}: solo pasa con disposition "accepted" (aceptación explícita y razonada), no "${finding.disposition}".`);
      if ((finding.severity === "ALTA" || finding.severity === "BLOQUEANTE") && finding.disposition === "accepted") {
        const risk = finding.acceptedRisk === undefined ? undefined : risks.get(finding.acceptedRisk);
        if (risk === undefined) problems.push(`${where} sin resolver: solo pasa como riesgo aceptado por el propietario (acceptedRisk en ${ACCEPTED_RISKS_FILE} de la rama base): un ALTA o BLOQUEANTE no lo acepta quien escribe el PR.`);
        else if (!risk.match.every((needle) => finding.summary.toLowerCase().includes(needle)) || (risk.paths !== undefined && !risk.paths.some((prefix) => finding.file.startsWith(prefix)))) problems.push(`${where}: el riesgo ${finding.acceptedRisk} solo cubre hallazgos que mencionan ${risk.match.map((needle) => `"${needle}"`).join(" y ")}${risk.paths === undefined ? "" : ` sobre ${risk.paths.join(", ")}`}; no es un comodín.`);
        else if (risk.expires !== undefined && headDate !== "" && headDate > risk.expires) problems.push(`${where}: el riesgo ${finding.acceptedRisk} caducó el ${risk.expires}; el propietario debe volver a aceptarlo.`);
        else if (!reasoned) problems.push(`${where}: el riesgo aceptado exige además una razón (>= ${MIN_ACCEPTANCE_REASON} caracteres).`);
      }
    }
  }

  // Rondas ANTERIORES de un proveedor: un RECHAZADO o un hallazgo grave no se entierra con un registro nuevo. Hace falta que el código haya cambiado desde esa ronda y que
  // cada ALTA/BLOQUEANTE de entonces figure `fixed` (con su commit, comprobado abajo).
  for (const [provider, records] of byProvider) {
    const latestHead = current.find((entry) => entry.record.reviewer.provider === provider)?.record.reviewedHead;
    if (latestHead === undefined) continue;
    for (const candidate of records) {
      if (candidate.record.reviewedHead === latestHead) continue;
      const earlier = candidate.record;
      const tag = `${candidate.file} (${provider}, ronda anterior ${earlier.reviewedHead.slice(0, 8)})`;
      if (earlier.verdict === "RECHAZADO" && isAncestor(git, earlier.reviewedHead, latestHead) && sourceDiff(git, earlier.reviewedHead, latestHead).length === 0) {
        problems.push(`${tag}: fue RECHAZADO y el código no cambió desde entonces: no se entierra con un registro nuevo.`);
      }
      for (const finding of earlier.findings) {
        if (finding.severity !== "ALTA" && finding.severity !== "BLOQUEANTE") continue;
        const risk = finding.disposition === "accepted" && finding.acceptedRisk !== undefined ? risks.get(finding.acceptedRisk) : undefined;
        const coveredByRisk = risk !== undefined && risk.match.every((needle) => finding.summary.toLowerCase().includes(needle)) && (risk.paths === undefined || risk.paths.some((prefix) => finding.file.startsWith(prefix))) && (risk.expires === undefined || headDate === "" || headDate <= risk.expires);
        if (finding.disposition !== "fixed" && !coveredByRisk) {
          problems.push(`${tag}: ${finding.severity} en ${finding.file} de una ronda anterior sin arreglar (debe figurar fixed con su commit o estar cubierto por un riesgo aceptado vigente de la rama base).`);
        }
      }
    }
  }

  // Arreglos de rondas anteriores: el commit existe en el PR y de verdad toca el archivo del hallazgo.
  const currentFiles = new Set(current.map((entry) => entry.file));
  for (const candidate of candidates) {
    if (currentFiles.has(candidate.file)) continue;
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

  notes.push(`registros: ${candidates.length}; ronda vigente: ${current.length} registro(s) de ${[...byProvider.keys()].join(", ")}`);
  return { ok: problems.length === 0, problems, notes, internalOnly: internalOnly && problems.length === 0 };
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
  const verdict = verifyReviewEvidence(realGit(), base, head, new Date(), fsTrusted);
  for (const note of verdict.notes) console.log(`nota: ${note}`);
  if (verdict.ok) {
    console.log(verdict.internalOnly === true ? "OK (INTERNA): pasadas Claude aisladas comprobadas contra git. NO es una revisión independiente." : "OK: revisiones comprobadas contra git.");
    process.exit(0);
  }
  for (const problem of verdict.problems) console.error(`FAIL: ${problem}`);
  process.exit(1);
}
