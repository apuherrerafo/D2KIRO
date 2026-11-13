import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cleanGitEnv, EVIDENCE_DIR, parseRecord, realGit, verifyReviewEvidence, type Git } from "./verify-review-evidence";

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

  mergeBase(base: string, head: string): string {
    return this.git(["merge-base", base, head]).trim();
  }

  /** Hash del diff de código, calculado aquí con git (no con el código bajo prueba). */
  diffHash(base: string, reviewedHead: string): string {
    return sha256(this.git(["diff", "--no-color", "--binary", base, reviewedHead, "--", ".", `:(exclude)${EVIDENCE_DIR}`]));
  }

  /** Escribe registro + salida cruda; devuelve los archivos (sin commitear). */
  evidence(options: { provider: string; base: string; reviewedHead: string; raw?: string; findings?: unknown[]; verdict?: string; diffSha256?: string; rawSha256?: string; model?: string }): Record<string, string> {
    this.counter += 1;
    const rawFile = `${EVIDENCE_DIR}${options.provider}-${this.counter}.raw.txt`;
    const raw = options.raw ?? `Revisión de ${options.provider}. Archivos revisados: src/app.ts y src/util.ts. ${"Observaciones detalladas sobre el cambio. ".repeat(12)} (${this.counter})`;
    const record = {
      schema: "review-evidence/v1",
      reviewer: { provider: options.provider, tool: `${options.provider}-cli 1.0`, model: options.model ?? `${options.provider}-model` },
      reviewedBase: options.base,
      reviewedHead: options.reviewedHead,
      diffSha256: options.diffSha256 ?? this.diffHash(options.base, options.reviewedHead),
      rawOutput: { file: rawFile, sha256: options.rawSha256 ?? sha256(raw) },
      findings: options.findings ?? [],
      verdict: options.verdict ?? "APROBADO",
    };
    return { [rawFile]: raw, [`${EVIDENCE_DIR}${options.provider}-${this.counter}.review.json`]: JSON.stringify(record, null, 2) };
  }
}

/** base (main) + un commit de código en la rama del PR. */
function scenario() {
  const repo = new Repo();
  const base = repo.commit({ "src/app.ts": "export const a = 1;\n", "README.md": "x\n" }, "base");
  repo.git(["checkout", "-q", "-b", "pr"]);
  const code = repo.commit({ "src/app.ts": "export const a = 2;\n", "src/util.ts": "export const u = () => 1;\n" }, "feature");
  return { repo, base, code };
}

function twoProviders(repo: Repo, base: string, code: string, extra: Partial<Parameters<Repo["evidence"]>[0]> = {}) {
  return { ...repo.evidence({ provider: "openai", base, reviewedHead: code, ...extra }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code, ...extra }) };
}

describe("compuerta de revisión independiente v2", () => {
  test("camino feliz: dos proveedores, diff coincide, nada cambió después, salida cruda íntegra", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit(twoProviders(repo, base, code), "evidencia");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
  });

  test("SOLO NOMBRES (lo que antes bastaba): sin registros en el PR → rechazado", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit({ "NOTAS.md": "- [x] Revision independiente 1 (Codex): APROBADO -- revisé todo bien\n- [x] Revision independiente 2 (Claude): APROBADO -- revisé todo bien\n" }, "solo texto");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("no añade ningún registro");
    expect(code).toBeDefined();
  });

  test("dos registros del MISMO proveedor no son dos revisores", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: code }), ...repo.evidence({ provider: "openai", base, reviewedHead: code }) }, "dos de lo mismo");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("al menos 2 proveedores distintos");
  });

  test("un diffSha256 inventado (no describe el cambio real) se rechaza: hay que conocer el diff para fingir", () => {
    const { repo, base, code } = scenario();
    const head = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: code, diffSha256: "a".repeat(64) }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) }, "hash falso");
    const verdict = verifyReviewEvidence(repo.git, base, head);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("diffSha256 no coincide");
  });

  test("el código cambió DESPUÉS de revisar: la revisión caduca; con una nueva sobre el head actual vuelve a pasar", () => {
    const { repo, base, code } = scenario();
    const withEvidence = repo.commit(twoProviders(repo, base, code), "evidencia");
    const changed = repo.commit({ "src/app.ts": "export const a = 3; // retoque tras revisar\n" }, "retoque");
    const stale = verifyReviewEvidence(repo.git, base, changed);
    expect(stale.ok).toBe(false);
    expect(stale.problems.join(" ")).toContain("el código cambió después de esta revisión");
    // re-revisión del head actual por ambos proveedores
    const fresh = repo.commit(twoProviders(repo, base, changed), "re-revisión");
    const verdict = verifyReviewEvidence(repo.git, base, fresh);
    expect(verdict.problems).toEqual([]);
    expect(withEvidence).toBeDefined();
  });

  test("la salida cruda editada tras fijar su hash se detecta", () => {
    const { repo, base, code } = scenario();
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, rawSha256: sha256("otra cosa") }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit(files, "editada"));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems.join(" ")).toContain("no coincide con su SHA-256");
  });

  test("una 'revisión' demasiado corta o que no menciona ningún archivo del diff no cuenta", () => {
    const { repo, base, code } = scenario();
    const short = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, raw: "ok todo bien" }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code }) };
    const shortVerdict = verifyReviewEvidence(repo.git, base, repo.commit(short, "corta"));
    expect(shortVerdict.problems.join(" ")).toContain("demasiado corta");

    const { repo: repo2, base: base2, code: code2 } = scenario();
    const generic = "Esto es una revisión larga pero genérica que habla de buenas prácticas sin citar un solo archivo concreto del cambio. ".repeat(6);
    const noFiles = { ...repo2.evidence({ provider: "openai", base: base2, reviewedHead: code2, raw: generic }), ...repo2.evidence({ provider: "anthropic", base: base2, reviewedHead: code2 }) };
    const noFilesVerdict = verifyReviewEvidence(repo2.git, base2, repo2.commit(noFiles, "generica"));
    expect(noFilesVerdict.problems.join(" ")).toContain("no menciona ningún archivo del diff");
  });

  test("dos salidas crudas idénticas: se copió una revisión", () => {
    const { repo, base, code } = scenario();
    const same = "Revisión de src/app.ts y src/util.ts. ".repeat(20);
    const files = { ...repo.evidence({ provider: "openai", base, reviewedHead: code, raw: same }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: code, raw: same }) };
    const verdict = verifyReviewEvidence(repo.git, base, repo.commit(files, "copia"));
    expect(verdict.problems.join(" ")).toContain("idéntica a la de otro revisor");
  });

  test("hallazgos: BLOQUEANTE sin arreglar bloquea; ALTA aceptada exige razón; RECHAZADO bloquea", () => {
    const blocker = { severity: "BLOQUEANTE", file: "src/app.ts", summary: "sobrescribe el valor sin validar nada", disposition: "accepted", reason: "x".repeat(60) };
    let { repo, base, code } = scenario();
    let verdict = verifyReviewEvidence(repo.git, base, repo.commit(twoProviders(repo, base, code, { findings: [blocker] }), "e"));
    expect(verdict.problems.join(" ")).toContain("BLOQUEANTE sin arreglar");

    ({ repo, base, code } = scenario());
    const high = { severity: "ALTA", file: "src/app.ts", summary: "riesgo de regresión en la constante", disposition: "accepted", reason: "ok" };
    verdict = verifyReviewEvidence(repo.git, base, repo.commit(twoProviders(repo, base, code, { findings: [high] }), "e"));
    expect(verdict.problems.join(" ")).toContain("ALTA aceptada sin razón suficiente");

    ({ repo, base, code } = scenario());
    const reasoned = { ...high, reason: "Riesgo conocido y acotado: la constante solo se lee en una ruta de desarrollo, con prueba que la cubre." };
    verdict = verifyReviewEvidence(repo.git, base, repo.commit(twoProviders(repo, base, code, { findings: [reasoned] }), "e"));
    expect(verdict.problems).toEqual([]);

    ({ repo, base, code } = scenario());
    verdict = verifyReviewEvidence(repo.git, base, repo.commit(twoProviders(repo, base, code, { verdict: "RECHAZADO" }), "e"));
    expect(verdict.problems.join(" ")).toContain("RECHAZADO");
  });

  test("un arreglo citado debe existir en el PR y tocar el archivo del hallazgo (ronda anterior + re-revisión)", () => {
    const { repo, base, code } = scenario();
    const round1 = repo.commit(twoProviders(repo, base, code, { findings: [{ severity: "ALTA", file: "src/app.ts", summary: "valor sin validar en la constante", disposition: "accepted", reason: "se corrige en la siguiente ronda de cambios" }] }), "ronda 1");
    const fix = repo.commit({ "src/app.ts": "export const a = 4; // arreglo\n" }, "arreglo");
    const fixedFinding = (fixedIn: string, file = "src/app.ts") => ({ severity: "ALTA", file, summary: "valor sin validar en la constante", disposition: "fixed", fixedIn });
    // ronda 2 sobre el head con el arreglo; el hallazgo de la ronda 1 queda como `fixed` apuntando al commit real
    const round2 = repo.commit({ ...repo.evidence({ provider: "openai", base, reviewedHead: fix, findings: [] }), ...repo.evidence({ provider: "anthropic", base, reviewedHead: fix, findings: [] }) }, "ronda 2");
    expect(verifyReviewEvidence(repo.git, base, round2).problems).toEqual([]);
    expect(round1).toBeDefined();

    // registro de ronda anterior que cita un arreglo inexistente en el PR
    const bad = scenario();
    const badHead = bad.repo.commit(twoProviders(bad.repo, bad.base, bad.code, { findings: [fixedFinding("b".repeat(40))] }), "e");
    expect(verifyReviewEvidence(bad.repo.git, bad.base, badHead).problems.join(" ")).toContain("no pertenece a este PR");

    // registro que cita un commit real del PR pero que NO toca el archivo
    const wrong = scenario();
    const wrongHead = wrong.repo.commit(twoProviders(wrong.repo, wrong.base, wrong.code, { findings: [fixedFinding(wrong.code, "README.md")] }), "e");
    expect(verifyReviewEvidence(wrong.repo.git, wrong.base, wrongHead).problems.join(" ")).toContain("no toca ese archivo");
  });

  test("un registro de OTRO PR (ya estaba en la base) no cuenta como evidencia de este", () => {
    const repo = new Repo();
    const oldCode = repo.commit({ "src/app.ts": "1\n" }, "viejo");
    const oldBase = repo.git(["rev-parse", "HEAD~0"]).trim();
    repo.commit(twoProviders(repo, oldBase, oldBase), "evidencia vieja ya fusionada");
    const base = repo.git(["rev-parse", "HEAD"]).trim();
    repo.git(["checkout", "-q", "-b", "pr"]);
    const head = repo.commit({ "src/app.ts": "2\n" }, "cambio sin evidencia");
    expect(verifyReviewEvidence(repo.git, base, head).problems.join(" ")).toContain("no añade ningún registro");
    expect(oldCode).toBeDefined();
  });

  test("parseRecord rechaza basura: no JSON, schema ajeno, rutas fuera de docs/reviews, hallazgos mal formados", () => {
    expect(parseRecord("{no json")).toBe("no es JSON");
    expect(parseRecord(JSON.stringify({ schema: "otro" }))).toBe("schema distinto de review-evidence/v1");
    const base = { schema: "review-evidence/v1", reviewer: { provider: "openai", tool: "codex", model: "m1" }, reviewedBase: "a".repeat(40), reviewedHead: "b".repeat(40), diffSha256: "c".repeat(64), rawOutput: { file: `${EVIDENCE_DIR}x.raw.txt`, sha256: "d".repeat(64) }, findings: [], verdict: "APROBADO" };
    expect(typeof parseRecord(JSON.stringify(base))).toBe("object");
    expect(parseRecord(JSON.stringify({ ...base, rawOutput: { file: "../../etc/passwd", sha256: "d".repeat(64) } }))).toContain("fuera de docs/reviews");
    expect(parseRecord(JSON.stringify({ ...base, findings: [{ severity: "ENORME" }] }))).toContain("severidad desconocida");
    expect(parseRecord(JSON.stringify({ ...base, verdict: "tal vez" }))).toContain("veredicto desconocido");
    expect(parseRecord("x".repeat(300_000))).toBe("registro demasiado grande");
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
