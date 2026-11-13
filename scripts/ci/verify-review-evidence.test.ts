import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { decodeReviewerOutput } from "./record-review";
import { ACCEPTED_RISKS_FILE, cleanGitEnv, codeDiffArgs, countSeverities, EVIDENCE_DIR, normalizeRaw, parseRecord, PROVIDERS_FILE, realGit, verifyReviewEvidence, type Git } from "./verify-review-evidence";

// Cada prueba crea varios repos git reales (en Windows ~1 s por repo): el plazo por defecto de 5 s no alcanza para las que arman 5-6 escenarios.
setDefaultTimeout(60_000);

// Repos git REALES y efímeros (cero red, cero repo del proyecto): la compuerta se prueba contra git de verdad, no contra mocks de git.
const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

class Repo {
  readonly dir = mkdtempSync(join(tmpdir(), "review-gate-"));
  readonly git: Git = realGit(this.dir);
  private counter = 0;

  constructor() {
    dirs.push(this.dir);
    this.git(["init", "-q", "-b", "main"]);
    this.git(["config", "user.email", "t@example.test"]);
    this.git(["config", "user.name", "t"]);
    this.git(["config", "commit.gpgsign", "false"]);
  }

  commit(files: Record<string, string>, message: string): string {
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(this.dir, path)), { recursive: true });
      writeFileSync(join(this.dir, path), content);
    }
    this.git(["add", "-A"]);
    this.git(["commit", "-q", "-m", message]);
    return this.git(["rev-parse", "HEAD"]).trim();
  }

  /** Hash del diff de código con los MISMOS argumentos fijados que usa el verificador (codeDiffArgs). */
  diffHash(base: string, reviewedHead: string): string {
    return sha256(this.git(codeDiffArgs(base, reviewedHead)));
  }

  /** Escribe registro + salida cruda; devuelve los archivos (sin commitear). Si hay hallazgos, la salida cruda los lista en su formato ("N. SEVERIDAD ..."). */
  evidence(options: { provider: string; base: string; reviewedHead: string; raw?: string; findings?: Array<Record<string, unknown>>; verdict?: string; diffSha256?: string; rawSha256?: string; model?: string; eol?: string; name?: string }): Record<string, string> {
    this.counter += 1;
    const stem = options.name ?? `${options.provider}-${this.counter}`;
    const rawFile = `${EVIDENCE_DIR}${stem}.raw.txt`;
    const findingLines = (options.findings ?? []).map((finding, index) => `${index + 1}. ${String(finding.severity)} — ${String(finding.file)}: ${String(finding.summary)}`).join("\n");
    const raw = options.raw ?? `HEAD REVISADO: ${options.reviewedHead}
Revisión de ${options.provider}. Archivos revisados: src/app.ts y src/util.ts. ${"Observaciones detalladas sobre el cambio. ".repeat(12)} (${this.counter})\n${findingLines}\n`;
    const eol = options.eol ?? "\n";
    const record = {
      schema: "review-evidence/v1",
      reviewer: { provider: options.provider, tool: `${options.provider}-cli 1.0`, model: options.model ?? `${options.provider}-model` },
      reviewedBase: options.base,
      reviewedHead: options.reviewedHead,
      diffSha256: options.diffSha256 ?? this.diffHash(options.base, options.reviewedHead),
      rawOutput: { file: rawFile, sha256: options.rawSha256 ?? sha256(normalizeRaw(raw)) },
      findings: options.findings ?? [],
      verdict: options.verdict ?? "APROBADO",
    };
    return { [rawFile]: raw.replace(/\n/g, eol), [`${EVIDENCE_DIR}${stem}.review.json`]: JSON.stringify(record, null, 2) };
  }
}

/** base (main) + un commit de código en la rama del PR. `baseFiles` van en la rama base (providers.json, ACCEPTED-RISKS.json). */
function scenario(baseFiles: Record<string, string> = {}) {
  const repo = new Repo();
  const base = repo.commit({ "src/app.ts": "export const a = 1;\n", "README.md": "x\n", ...baseFiles }, "base");
  repo.git(["checkout", "-q", "-b", "pr"]);
  const code = repo.commit({ "src/app.ts": "export const a = 2;\n", "src/util.ts": "export const u = () => 1;\n" }, "feature");
  return { repo, base, code };
}

type EvidenceOptions = Parameters<Repo["evidence"]>[0];
function twoProviders(repo: Repo, base: string, code: string, extra: Partial<EvidenceOptions> = {}) {
  return { ...repo.evidence({ provider: "openai", base, reviewedHead: code, ...extra }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code, ...extra }) };
}

const high = { severity: "ALTA", file: "src/app.ts", summary: "riesgo de regresión en la constante", disposition: "accepted", reason: "Riesgo conocido y acotado: la constante solo se lee en una ruta de desarrollo, con prueba que la cubre." };
const blocker = { severity: "BLOQUEANTE", file: "src/app.ts", summary: "la autenticidad del revisor no se verifica en src/app.ts", disposition: "accepted", reason: "Limitación inherente y documentada: la independencia no se autentica sin segunda cuenta.", acceptedRisk: "R-001" };

describe("compuerta de revisión independiente v2", () => {
  test("camino feliz: dos proveedores, diff coincide, nada cambió después, salida cruda íntegra", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit(twoProviders(repo, base, code), "evidencia");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("SOLO NOMBRES (lo que antes bastaba): sin registros en el PR → rechazado", () => {
    const { repo, base } = scenario();
    const head = repo.commit({ "NOTAS.md": "- [x] Revision independiente 1 (Codex): APROBADO -- revisé todo bien\n- [x] Revision independiente 2 (Claude): APROBADO -- revisé todo bien\n" }, "solo texto");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("no añade ningún registro");
  });

  test("dos registros del MISMO proveedor no son dos revisores", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: code }), ...repo.evidence({ provider: "openai", base, reviewedHead: code }) }, "dos de lo mismo");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("al menos 2 proveedores distintos");
  });

  test("proveedores INVENTADOS (openai2, gpt, codex) no cuentan: solo la lista de la rama base y human:<login>", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: code }), ...repo.evidence({ provider: "openai2", base, reviewedHead: code }) }, "inventado");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("proveedor desconocido (openai2)");

    const ok = scenario();
    const humanHead = ok.repo.commit({ ...ok.repo.evidence({ provider: "openai", base: ok.base, reviewedHead: ok.code }), ...ok.repo.evidence({ provider: "human:alice", base: ok.base, reviewedHead: ok.code, name: "human-alice" }) }, "humano");
    expect(verifyReviewEvidence(ok.repo.git, ok.base, humanHead).problems).toEqual([]);
  });

  test("la lista de proveedores sale de la rama BASE: el PR no puede ampliarla para colar un proveedor propio", () => {
    const { repo, base, code } = scenario({ [PROVIDERS_FILE]: JSON.stringify({ providers: ["openai", "anthropic"] }) });
    const head = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: code }), ...repo.evidence({ provider: "google", base, reviewedHead: code }), [PROVIDERS_FILE]: JSON.stringify({ providers: ["openai", "anthropic", "google"] }) }, "amplia la lista");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.problems.join(" ")).toContain("proveedor desconocido (google)");
  });

  test("un diffSha256 inventado (no describe el cambio real) se rechaza: hay que conocer el diff para fingir", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: code, diffSha256: "a".repeat(64) }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) }, "hash falso");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("diffSha256 no coincide");
  });

  test("el hash del diff NO depende de la configuración local de git (diff.noprefix, mnemonicPrefix...)", () => {
    const { repo, base, code } = scenario();
    const files = twoProviders(repo, base, code); // hash calculado con la config por defecto
    repo.git(["config", "diff.noprefix", "true"]);
    repo.git(["config", "diff.mnemonicPrefix", "true"]);
    repo.git(["config", "diff.algorithm", "patience"]);
    repo.git(["config", "diff.renames", "copies"]);
    const head = repo.commit(files, "evidencia");
    expect(verifyReviewEvidence(repo.git, base, head).problems).toEqual([]);
  });

  test("el código cambió DESPUÉS de revisar: la revisión caduca; con una nueva sobre el head actual vuelve a pasar", () => {
    const { repo, base, code } = scenario();
    repo.commit(twoProviders(repo, base, code), "evidencia");
    const changed = repo.commit({ "src/app.ts": "export const a = 3; // retoque tras revisar\n" }, "retoque");
    const stale = verifyReviewEvidence(repo.git, base, changed);
    expect(stale.ok).toBe(false);
    expect(stale.problems.join(" ")).toContain("el código cambió después de esta revisión");
    const fresh = repo.commit(twoProviders(repo, base, changed), "re-revisión");
    expect(verifyReviewEvidence(repo.git, base, fresh).problems).toEqual([]);
  });

  test("la salida cruda editada tras fijar su hash se detecta", () => {
    const { repo, base, code } = scenario();
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, rawSha256: sha256("otra cosa") }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit(files, "editada"));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("no coincide con su SHA-256");
  });

  test("la salida cruda con CRLF (Windows, core.autocrlf) y con BOM sigue coincidiendo: el hash es sobre el texto normalizado", () => {
    const { repo, base, code } = scenario();
    const crlf = twoProviders(repo, base, code, { eol: "\r\n" });
    const withBom = Object.fromEntries(Object.entries(crlf).map(([path, content]) => [path, path.endsWith(".raw.txt") ? `﻿${content}` : content]));
    const head = repo.commit(withBom, "crlf + bom");
    expect(verifyReviewEvidence(repo.git, base, head).problems).toEqual([]);
  });

  test("una 'revisión' demasiado corta o que no menciona ningún archivo del diff no cuenta", () => {
    const { repo, base, code } = scenario();
    const short = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, raw: "ok todo bien" }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    expect(verifyReviewEvidence(repo.git, base, repo.commit(short, "corta")).problems.join(" ")).toContain("demasiado corta");

    const other = scenario();
    const generic = "Esto es una revisión larga pero genérica que habla de buenas prácticas sin citar un solo archivo concreto del cambio. ".repeat(6);
    const noFiles = { ...other.repo.evidence({ provider: "openai", base: other.base, reviewedHead: other.code, raw: generic }), ...other.repo.evidence({ provider: "anthropic", base: other.base, reviewedHead: other.code }) };
    expect(verifyReviewEvidence(other.repo.git, other.base, other.repo.commit(noFiles, "generica")).problems.join(" ")).toContain("no menciona ningún archivo del diff");
  });

  test("dos salidas crudas idénticas: se copió una revisión", () => {
    const { repo, base, code } = scenario();
    const same = "Revisión de src/app.ts y src/util.ts. ".repeat(20);
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, raw: same }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code, raw: same }) };
    expect(verifyReviewEvidence(repo.git, base, repo.commit(files, "copia")).problems.join(" ")).toContain("idéntica a la de otro revisor");
  });

  test("los hallazgos del registro se CONTRASTAN con la salida cruda: un BLOQUEANTE que el revisor escribió no puede desaparecer del registro", () => {
    const { repo, base, code } = scenario();
    // la salida cruda trae un BLOQUEANTE y el registro (tecleado a mano) dice `findings: []` y APROBADO
    const raw = `HEAD REVISADO: ${code}\nRevisión de src/app.ts.\n1. BLOQUEANTE — src/app.ts:1: ejecución insegura de entrada externa sin validar.\n${"Detalle de la revisión. ".repeat(20)}\n`;
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, raw, findings: [] }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit(files, "oculta el bloqueante"));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("lista 1 hallazgo(s) BLOQUEANTE y el registro solo 0");
  });

  test("countSeverities lee los formatos reales de los revisores (Codex y Claude) y no confunde prosa en minúscula", () => {
    const raw = ["1. **ALTA** — `a.ts:1` — x", "2. BLOQUEANTE, a.ts:2 — y", "3) [MEDIA] z", "- BAJA: w", "La severidad alta del problema es media-alta y no cuenta.", "  ## 5. ALTA, b.ts"].join("\n");
    expect(countSeverities(raw)).toEqual({ BLOQUEANTE: 1, ALTA: 2, MEDIA: 1, BAJA: 1 });
  });

  test("hallazgos: ALTA aceptada exige razón; RECHAZADO bloquea; BLOQUEANTE solo pasa como riesgo aceptado POR LA RAMA BASE", () => {
    let s = scenario();
    const noReason = { ...high, reason: "ok" };
    expect(verifyReviewEvidence(s.repo.git, s.base, s.repo.commit(twoProviders(s.repo, s.base, s.code, { findings: [noReason] }), "e")).problems.join(" ")).toContain("sin razón suficiente");

    s = scenario();
    expect(verifyReviewEvidence(s.repo.git, s.base, s.repo.commit(twoProviders(s.repo, s.base, s.code, { findings: [high] }), "e")).problems).toEqual([]);

    s = scenario();
    expect(verifyReviewEvidence(s.repo.git, s.base, s.repo.commit(twoProviders(s.repo, s.base, s.code, { verdict: "RECHAZADO" }), "e")).problems.join(" ")).toContain("RECHAZADO");

    // BLOQUEANTE sin acceptedRisk válido en la base
    s = scenario();
    expect(verifyReviewEvidence(s.repo.git, s.base, s.repo.commit(twoProviders(s.repo, s.base, s.code, { findings: [blocker] }), "e")).problems.join(" ")).toContain("solo pasa como riesgo aceptado por el propietario");

    // el riesgo aceptado existe SOLO en el PR (no en la base): no vale, el PR no se aprueba a sí mismo
    s = scenario();
    const selfAccepted = { ...twoProviders(s.repo, s.base, s.code, { findings: [blocker] }), [ACCEPTED_RISKS_FILE]: JSON.stringify({ risks: [{ id: "R-001", match: "autentic", expires: "2999-01-01", summary: "x" }] }) };
    expect(verifyReviewEvidence(s.repo.git, s.base, s.repo.commit(selfAccepted, "e")).problems.join(" ")).toContain("solo pasa como riesgo aceptado por el propietario");

    // el riesgo ya está en la rama base (el propietario lo aceptó al fusionar): pasa, con razón
    s = scenario({ [ACCEPTED_RISKS_FILE]: JSON.stringify({ risks: [{ id: "R-001", match: "autentic", expires: "2999-01-01", summary: "Independencia no autenticada" }] }) });
    expect(verifyReviewEvidence(s.repo.git, s.base, s.repo.commit(twoProviders(s.repo, s.base, s.code, { findings: [blocker] }), "e")).problems).toEqual([]);
  });

  test("un RECHAZADO no se tapa con otro registro APROBADO del mismo proveedor y el mismo head (se evalúan todos los de la ronda vigente)", () => {
    const { repo, base, code } = scenario();
    const files = {
      ...repo.evidence({ provider: "openai", base, reviewedHead: code, verdict: "APROBADO", name: "aaa-openai" }),
      ...repo.evidence({ provider: "openai", base, reviewedHead: code, verdict: "RECHAZADO", name: "zzz-openai" }),
      ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }),
    };
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit(files, "tapado"));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("RECHAZADO");
  });

  test("un hallazgo `fixed` en la ronda VIGENTE se rechaza (si el revisor lo ve en el código actual, no está arreglado)", () => {
    const { repo, base, code } = scenario();
    const fixed = { severity: "ALTA", file: "src/app.ts", summary: "valor sin validar en la constante", disposition: "fixed", fixedIn: code };
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit(twoProviders(repo, base, code, { findings: [fixed] }), "e"));
    expect(verdict.problems.join(" ")).toContain("figura como arreglado en la ronda vigente");
  });

  test("un arreglo citado en una ronda ANTERIOR debe existir en el PR y tocar el archivo del hallazgo", () => {
    const { repo, base, code } = scenario();
    const fix = repo.commit({ "src/app.ts": "export const a = 4; // arreglo\n" }, "arreglo");
    const round1Finding = (fixedIn: string, file = "src/app.ts") => ({ severity: "ALTA", file, summary: "valor sin validar en la constante", disposition: "fixed", fixedIn });
    const old = repo.evidence({ provider: "openai", base, reviewedHead: code, findings: [round1Finding(fix)], name: "ronda1-openai" });
    const round2 = repo.commit({ ...old, ...twoProviders(repo, base, fix) }, "ronda 2");
    expect(verifyReviewEvidence(repo.git, base, round2).problems).toEqual([]);

    const bad = scenario();
    const badFiles = { ...bad.repo.evidence({ provider: "openai", base: bad.base, reviewedHead: bad.code, findings: [round1Finding("b".repeat(40))], name: "r1" }) };
    const badFix = bad.repo.commit({ "src/app.ts": "export const a = 5;\n" }, "otro cambio");
    const badHead = bad.repo.commit({ ...badFiles, ...twoProviders(bad.repo, bad.base, badFix) }, "e");
    expect(verifyReviewEvidence(bad.repo.git, bad.base, badHead).problems.join(" ")).toContain("no pertenece a este PR");

    const wrong = scenario();
    const wrongOld = wrong.repo.evidence({ provider: "openai", base: wrong.base, reviewedHead: wrong.code, findings: [round1Finding(wrong.code, "README.md")], name: "r1" });
    const wrongFix = wrong.repo.commit({ "src/app.ts": "export const a = 6;\n" }, "arreglo de otra cosa");
    const wrongHead = wrong.repo.commit({ ...wrongOld, ...twoProviders(wrong.repo, wrong.base, wrongFix) }, "e");
    expect(verifyReviewEvidence(wrong.repo.git, wrong.base, wrongHead).problems.join(" ")).toContain("no toca ese archivo");
  });

  test("la salida cruda debe NOMBRAR el head revisado: una revisión de otro código no sirve", () => {
    const { repo, base, code } = scenario();
    const otherHeadRaw = `HEAD REVISADO: ${"e".repeat(40)}\nRevisión de src/app.ts. ${"Detalle de la revisión. ".repeat(20)}\n`;
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, raw: otherHeadRaw }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    expect(verifyReviewEvidence(repo.git, base, repo.commit(files, "otro head")).problems.join(" ")).toContain("no nombra el head revisado");
  });

  test("REUTILIZAR la salida cruda real de una revisión anterior (ya en la base) se rechaza: la salida cruda la añade este PR", () => {
    const repo = new Repo();
    const oldRawPath = `${EVIDENCE_DIR}vieja.raw.txt`;
    const oldRaw = `Revisión real de otro cambio que cita src/app.ts. ${"Detalle. ".repeat(60)}\n`;
    const base = repo.commit({ "src/app.ts": "export const a = 1;\n", [oldRawPath]: oldRaw }, "base con una salida cruda vieja");
    repo.git(["checkout", "-q", "-b", "pr"]);
    const code = repo.commit({ "src/app.ts": "export const a = 2;\n" }, "feature");
    // el registro apunta a la salida vieja de la base (y su hash coincide: es real); ningún archivo raw nuevo
    const files = repo.evidence({ provider: "openai", base, reviewedHead: code, raw: `HEAD REVISADO: ${code}\n${oldRaw}` });
    const reused = Object.fromEntries(Object.entries(files).filter(([path]) => path.endsWith(".review.json")).map(([path, content]) => {
      const record = JSON.parse(content) as { rawOutput: { file: string; sha256: string } };
      record.rawOutput = { file: oldRawPath, sha256: sha256(normalizeRaw(oldRaw)) };
      return [path, JSON.stringify(record)];
    }));
    const second = repo.evidence({ provider: "anthropic", base, reviewedHead: code });
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit({ ...reused, ...second }, "reutiliza"));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("no la añade este PR");
  });

  test("las listas de control (providers.json, ACCEPTED-RISKS.json) ENTRAN en el diff revisado: cambiarlas después de revisar invalida la revisión", () => {
    const { repo, base, code } = scenario();
    const files = twoProviders(repo, base, code); // revisado SIN tocar las listas
    const head = repo.commit({ ...files, [PROVIDERS_FILE]: JSON.stringify({ providers: ["openai", "anthropic", "propio"] }), [ACCEPTED_RISKS_FILE]: JSON.stringify({ risks: [{ id: "COMODIN", match: "todo", summary: "x" }] }) }, "cuela las listas");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toMatch(/el código cambió después de esta revisión|diffSha256 no coincide/);
  });

  test("un ALTA 'rejected' con texto libre NO pasa: solo 'accepted' razonado", () => {
    const { repo, base, code } = scenario();
    const rejected = { ...high, disposition: "rejected" };
    expect(verifyReviewEvidence(repo.git, base, repo.commit(twoProviders(repo, base, code, { findings: [rejected] }), "e")).problems.join(" ")).toContain('solo pasa con disposition "accepted"');
  });

  test("un riesgo aceptado NO es comodín: debe coincidir con el hallazgo (`match`) y no estar caducado", () => {
    const risks = (extra: Record<string, unknown>) => JSON.stringify({ risks: [{ id: "R-001", match: "autentic", expires: "2999-01-01", summary: "x", ...extra }] });
    // otro BLOQUEANTE (sin 'autentic') aprovechando R-001 genérico
    let s2 = scenario({ [ACCEPTED_RISKS_FILE]: risks({}) });
    const other = { ...blocker, summary: "ejecución de código arbitrario desde la entrada del usuario" };
    expect(verifyReviewEvidence(s2.repo.git, s2.base, s2.repo.commit(twoProviders(s2.repo, s2.base, s2.code, { findings: [other] }), "e")).problems.join(" ")).toContain("no es un comodín");
    // caducado (la fecha del commit head es posterior a `expires`)
    s2 = scenario({ [ACCEPTED_RISKS_FILE]: risks({ expires: "2020-01-01" }) });
    expect(verifyReviewEvidence(s2.repo.git, s2.base, s2.repo.commit(twoProviders(s2.repo, s2.base, s2.code, { findings: [blocker] }), "e")).problems.join(" ")).toContain("caducó");
    // sin `match` el riesgo no vale
    s2 = scenario({ [ACCEPTED_RISKS_FILE]: JSON.stringify({ risks: [{ id: "R-001", summary: "sin match" }] }) });
    expect(verifyReviewEvidence(s2.repo.git, s2.base, s2.repo.commit(twoProviders(s2.repo, s2.base, s2.code, { findings: [blocker] }), "e")).problems.join(" ")).toContain("sin resolver");
  });

  test("cota superior: el registro no puede declarar más hallazgos de una severidad que veces la menciona la salida cruda", () => {
    const { repo, base, code } = scenario();
    const invented = { severity: "MEDIA", file: "src/app.ts", summary: "hallazgo inventado que la salida cruda nunca menciona", disposition: "accepted", reason: "x" };
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, findings: [invented], raw: `HEAD REVISADO: ${code}\nRevisión de src/app.ts. ${"Detalle sin ninguna severidad. ".repeat(20)}\n` }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    expect(verifyReviewEvidence(repo.git, base, repo.commit(files, "e")).problems.join(" ")).toContain("solo menciona 0");
  });

  test("un registro de OTRO PR (ya estaba en la base) no cuenta como evidencia de este", () => {
    const repo = new Repo();
    repo.commit({ "src/app.ts": "1\n" }, "viejo");
    const oldBase = repo.git(["rev-parse", "HEAD"]).trim();
    repo.commit(twoProviders(repo, oldBase, oldBase), "evidencia vieja ya fusionada");
    const base = repo.git(["rev-parse", "HEAD"]).trim();
    repo.git(["checkout", "-q", "-b", "pr"]);
    const head = repo.commit({ "src/app.ts": "2\n" }, "cambio sin evidencia");
    expect(verifyReviewEvidence(repo.git, base, head).problems.join(" ")).toContain("no añade ningún registro");
  });

  test("parseRecord rechaza basura: no JSON, schema ajeno, rutas fuera de docs/reviews, hallazgos mal formados, acceptedRisk inválido", () => {
    expect(parseRecord("{no json")).toBe("no es JSON");
    expect(parseRecord(JSON.stringify({ schema: "otro" }))).toBe("schema distinto de review-evidence/v1");
    const base = { schema: "review-evidence/v1", reviewer: { provider: "openai", tool: "codex", model: "m1" }, reviewedBase: "a".repeat(40), reviewedHead: "b".repeat(40), diffSha256: "c".repeat(64), rawOutput: { file: `${EVIDENCE_DIR}x.raw.txt`, sha256: "d".repeat(64) }, findings: [], verdict: "APROBADO" };
    expect(typeof parseRecord(JSON.stringify(base))).toBe("object");
    expect(parseRecord(JSON.stringify({ ...base, rawOutput: { file: "../../etc/passwd", sha256: "d".repeat(64) } }))).toContain("fuera de docs/reviews");
    expect(parseRecord(JSON.stringify({ ...base, findings: [{ severity: "ENORME" }] }))).toContain("severidad desconocida");
    expect(parseRecord(JSON.stringify({ ...base, findings: [{ ...blocker, acceptedRisk: "no válido!" }] }))).toContain("acceptedRisk");
    expect(parseRecord(JSON.stringify({ ...base, verdict: "tal vez" }))).toContain("veredicto desconocido");
    expect(parseRecord("x".repeat(300_000))).toBe("registro demasiado grande");
  });

  test("record-review decodifica UTF-16 de PowerShell y normaliza igual que el verificador", () => {
    const text = "Revisión de src/app.ts\r\nlínea dos";
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(normalizeRaw(decodeReviewerOutput(utf16))).toBe("Revisión de src/app.ts\nlínea dos");
    expect(normalizeRaw(decodeReviewerOutput(Buffer.from(`﻿${text}`, "utf8")))).toBe("Revisión de src/app.ts\nlínea dos");
  });
});

describe("aislamiento de git (regresión: dentro de un hook, GIT_INDEX_FILE/GIT_DIR apuntan al repo REAL)", () => {
  test("cleanGitEnv quita todo GIT_* menos GIT_TERMINAL_PROMPT", () => {
    const clean = cleanGitEnv({ PATH: "/bin", GIT_DIR: "/real/.git", GIT_INDEX_FILE: "/real/.git/index", GIT_WORK_TREE: "/real", GIT_TERMINAL_PROMPT: "0", HOME: "/h" });
    expect(clean).toEqual({ PATH: "/bin", GIT_TERMINAL_PROMPT: "0", HOME: "/h" });
  });

  test("con GIT_DIR/GIT_INDEX_FILE envenenados en el entorno, el repo temporal NO toca el repo 'real'", () => {
    const real = new Repo();
    real.commit({ "a.txt": "real\n" }, "real");
    const before = real.git(["rev-parse", "HEAD"]).trim();
    const indexBefore = real.git(["ls-files", "-s"]);
    const saved = { dir: process.env.GIT_DIR, index: process.env.GIT_INDEX_FILE };
    process.env.GIT_DIR = join(real.dir, ".git");
    process.env.GIT_INDEX_FILE = join(real.dir, ".git", "index");
    try {
      const other = new Repo(); // se crea con el entorno envenenado
      other.commit({ "b.txt": "otro\n" }, "otro");
    } finally {
      if (saved.dir === undefined) delete process.env.GIT_DIR;
      else process.env.GIT_DIR = saved.dir;
      if (saved.index === undefined) delete process.env.GIT_INDEX_FILE;
      else process.env.GIT_INDEX_FILE = saved.index;
    }
    expect(real.git(["rev-parse", "HEAD"]).trim()).toBe(before);
    expect(real.git(["ls-files", "-s"])).toBe(indexBefore);
    expect(real.git(["status", "--porcelain"]).trim()).toBe("");
  });
});
