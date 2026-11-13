// Detecta un `independent-review` que NO lo publicó la compuerta confiable. Defensa en profundidad contra la falsificación del check (hallazgo del 2026-11-13).
//
// Hecho medido: un workflow del propio PR (`on: pull_request`, `permissions: checks: write`) puede publicar un check-run llamado `independent-review` en verde, y GitHub
// lo atribuye a la MISMA app (`github-actions`) que al legítimo; pinnear `app_id` no lo evita. Lo que SÍ no puede falsear un PR es el registro del workflow run que
// produjo cada check: su `path` y su `event` los fija GitHub. El legítimo viene de `.github/workflows/release-gate.yml` con evento `pull_request_target`
// (definición tomada de la rama predeterminada); cualquier otro productor es ajeno.
//
// LÍMITE: esto detecta y bloquea (el gate falla); no sustituye una identidad que el PR no pueda usar (GitHub App con `app_id` fijado). Ver docs/reviews/POLICY.md.
export const GATE_CHECK_NAME = "independent-review";
export const TRUSTED_PRODUCERS: ReadonlyArray<{ path: string; event: string }> = [{ path: ".github/workflows/release-gate.yml", event: "pull_request_target" }];

export interface CheckRunLite {
  id: number;
  name: string;
  /** id del check suite que lo agrupa; se cruza con el workflow run. */
  suiteId: number;
}
export interface WorkflowRunLite {
  checkSuiteId: number;
  path: string;
  event: string;
}

/** Check-runs con el nombre de la compuerta cuyo productor no es una compuerta confiable. Un check sin workflow run asociado (creado a mano por API) también es ajeno. */
export function findForeignProducers(checkRuns: CheckRunLite[], workflowRuns: WorkflowRunLite[]): string[] {
  const bySuite = new Map(workflowRuns.map((run) => [run.checkSuiteId, run]));
  const foreign: string[] = [];
  for (const check of checkRuns) {
    if (check.name !== GATE_CHECK_NAME) continue;
    const run = bySuite.get(check.suiteId);
    const trusted = run !== undefined && TRUSTED_PRODUCERS.some((producer) => producer.path === run.path && producer.event === run.event);
    if (!trusted) foreign.push(`check-run ${check.id} (${run === undefined ? "sin workflow run asociado" : `${run.path} / ${run.event}`})`);
  }
  return foreign;
}

type Fetcher = (url: string) => Promise<unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export async function listProducers(fetchJson: Fetcher, repo: string, headSha: string): Promise<{ checkRuns: CheckRunLite[]; workflowRuns: WorkflowRunLite[] }> {
  const checks = await fetchJson(`https://api.github.com/repos/${repo}/commits/${headSha}/check-runs?check_name=${GATE_CHECK_NAME}&per_page=100`);
  const runs = await fetchJson(`https://api.github.com/repos/${repo}/actions/runs?head_sha=${headSha}&per_page=100`);
  const checkRuns: CheckRunLite[] = [];
  if (isRecord(checks) && Array.isArray(checks.check_runs)) {
    for (const entry of checks.check_runs) {
      if (isRecord(entry) && typeof entry.id === "number" && typeof entry.name === "string" && isRecord(entry.check_suite) && typeof entry.check_suite.id === "number") {
        checkRuns.push({ id: entry.id, name: entry.name, suiteId: entry.check_suite.id });
      }
    }
  }
  const workflowRuns: WorkflowRunLite[] = [];
  if (isRecord(runs) && Array.isArray(runs.workflow_runs)) {
    for (const entry of runs.workflow_runs) {
      if (isRecord(entry) && typeof entry.check_suite_id === "number" && typeof entry.path === "string" && typeof entry.event === "string") {
        workflowRuns.push({ checkSuiteId: entry.check_suite_id, path: entry.path, event: entry.event });
      }
    }
  }
  return { checkRuns, workflowRuns };
}

if (import.meta.main) {
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const headSha = process.argv[2];
  if (repo === undefined || token === undefined || headSha === undefined || !/^[0-9a-f]{40}$/.test(headSha) || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    console.error("Uso: GITHUB_REPOSITORY=o/r GITHUB_TOKEN=... bun run scripts/ci/check-gate-producers.ts <head-sha-40hex>");
    process.exit(2);
  }
  const fetchJson: Fetcher = async (url) => {
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`GitHub API ${response.status}`);
    return response.json();
  };
  const { checkRuns, workflowRuns } = await listProducers(fetchJson, repo, headSha);
  const foreign = findForeignProducers(checkRuns, workflowRuns);
  if (foreign.length > 0) {
    for (const entry of foreign) console.error(`FAIL: ${GATE_CHECK_NAME} publicado por un productor NO confiable: ${entry}.`);
    process.exit(1);
  }
  console.log(`OK: todos los check-runs "${GATE_CHECK_NAME}" (${checkRuns.length}) vienen de la compuerta confiable.`);
}
