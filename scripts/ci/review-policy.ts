// Política híbrida de revisión (decisión del propietario, opción B). Pura: no lee disco ni git.
//
//  - Revisión INTERNA = pasadas de Claude con contexto aislado y prompt versionado. NUNCA es "independiente": comparte modelo y puntos ciegos con el autor.
//  - Cambios CRÍTICOS (autenticación, scoring activo, CI/compuertas, secretos, la propia política) exigen además al menos un revisor EXTERNO a la familia Claude:
//    un proveedor distinto (openai, google, ...) o una persona (`human:<login>`).
//  - La política y los prompts se leen del checkout CONFIABLE (rama predeterminada), nunca del PR: un PR no puede relajarla ni cambiar un prompt.
//  - Sin política válida el verificador conserva la regla anterior (2 proveedores distintos): ausente o ilegible NUNCA relaja nada.

export const POLICY_FILE = "docs/reviews/policy.json";
export const INTERNAL_PROVIDER = "claude-internal";
/** Proveedores que son el mismo modelo que escribe el código. Para contar independencia colapsan en una sola familia. */
export const CLAUDE_FAMILY = new Set([INTERNAL_PROVIDER, "anthropic"]);

export interface ReviewPolicy {
  /** Prefijos de ruta (o coincidencia exacta) cuyo cambio vuelve crítico al PR. */
  criticalPaths: string[];
  /** Pasadas internas distintas (por `promptId`) que bastan en un cambio no crítico. */
  internalPasses: number;
  /** `promptId` -> archivo del prompt versionado en el repo (checkout confiable). */
  prompts: Record<string, { file: string }>;
}

const SAFE = /^[A-Za-z0-9._\-/]{1,200}$/;
const PROMPT_ID = /^[a-z0-9-]{2,40}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export function parsePolicy(text: string | null): ReviewPolicy | null {
  if (text === null) return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || raw.schema !== "review-policy/v1") return null;
    const { criticalPaths, internalPasses, prompts } = raw;
    if (!Array.isArray(criticalPaths) || criticalPaths.length === 0 || !criticalPaths.every((entry) => typeof entry === "string" && SAFE.test(entry) && !entry.includes(".."))) return null;
    if (typeof internalPasses !== "number" || !Number.isInteger(internalPasses) || internalPasses < 2 || internalPasses > 5) return null;
    if (!isRecord(prompts) || Object.keys(prompts).length < internalPasses) return null;
    const parsed: Record<string, { file: string }> = {};
    for (const [id, entry] of Object.entries(prompts)) {
      if (!PROMPT_ID.test(id) || !isRecord(entry) || typeof entry.file !== "string" || !SAFE.test(entry.file) || entry.file.includes("..")) return null;
      parsed[id] = { file: entry.file };
    }
    return { criticalPaths: criticalPaths as string[], internalPasses, prompts: parsed };
  } catch {
    return null;
  }
}

/** Archivos del cambio que caen en una ruta crítica. Vacío = cambio estándar. */
export function criticalMatches(changedFiles: Iterable<string>, policy: ReviewPolicy): string[] {
  const matches: string[] = [];
  for (const file of changedFiles) {
    if (policy.criticalPaths.some((path) => (path.endsWith("/") ? file.startsWith(path) : file === path || file.startsWith(`${path}/`)))) matches.push(file);
  }
  return matches;
}

export const familyOf = (provider: string): string => (CLAUDE_FAMILY.has(provider) ? "claude" : provider);
export const isExternal = (provider: string): boolean => !CLAUDE_FAMILY.has(provider);

export interface Coverage {
  /** Proveedores presentes en la ronda vigente. */
  providers: string[];
  /** `promptId` válidos de pasadas internas. */
  internalPromptIds: string[];
}

/** Cobertura exigida. Devuelve los motivos de rechazo (vacío = cumple) y si el visto bueno es SOLO interno. */
export function checkCoverage(coverage: Coverage, critical: boolean, policy: ReviewPolicy): { problems: string[]; internalOnly: boolean } {
  const families = new Set(coverage.providers.map(familyOf));
  const external = coverage.providers.filter(isExternal);
  const passes = new Set(coverage.internalPromptIds).size;
  const problems: string[] = [];
  if (critical) {
    if (external.length === 0) problems.push("cambio CRÍTICO (autenticación, scoring, CI o política): exige al menos un revisor externo a Claude (otro proveedor o `human:<login>`); las pasadas internas no bastan.");
    if (families.size < 2) problems.push("cambio CRÍTICO: además del revisor externo hace falta una pasada Claude (interna o anthropic) sobre el mismo head.");
    return { problems, internalOnly: false };
  }
  if (families.size >= 2) return { problems, internalOnly: false };
  if (passes >= policy.internalPasses) return { problems, internalOnly: true };
  problems.push(`se exigen revisiones de 2 proveedores independientes, o ${policy.internalPasses} pasadas INTERNAS Claude con prompts distintos (válidas: ${passes}).`);
  return { problems, internalOnly: false };
}
