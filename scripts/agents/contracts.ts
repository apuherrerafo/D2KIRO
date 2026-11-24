// Contratos ESTÁTICOS del ecosistema de agentes (.claude/agents, skills, commands, rules, AGENTS.md).
// Son funciones puras sobre texto: comprueban coherencia documental con los guardrails
// (docs/agents/agent-guardrails.md §2 #2 "tools:" y context7.md). NO son evals conductuales:
// no prueban que un modelo obedezca, sólo que lo escrito no se contradiga ni pida lo prohibido.

export interface AgentFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  tools: string[];
}

export function parseFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim().replace(/^"(.*)"$/, "$1");
  }
  return out;
}

export function parseAgent(text: string): AgentFrontmatter {
  const fm = parseFrontmatter(text);
  const tools = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return { name: fm.name, description: fm.description, model: fm.model, tools };
}

// `allowed-tools` de un skill: tokens separados por espacio; un token puede llevar paréntesis con
// espacios dentro, p. ej. `Bash(git log:*)`.
export function parseSkillTools(text: string): string[] {
  const raw = parseFrontmatter(text)["allowed-tools"] ?? "";
  return raw.match(/[^\s(]+(?:\([^)]*\))?/g) ?? [];
}

// Skills revisores: no escriben (el coordinador no aprueba su propio trabajo, dispatch.md).
export const READ_ONLY_SKILLS = ["redteam"] as const;

export function checkSkillTools(skill: string, text: string): string[] {
  const tools = parseSkillTools(text);
  const errs: string[] = [];
  if ((READ_ONLY_SKILLS as readonly string[]).includes(skill) && tools.some((t) => (WRITE_TOOLS as readonly string[]).includes(t))) {
    errs.push(`skill ${skill}: revisor de sólo lectura con herramienta de escritura en allowed-tools`);
  }
  if (tools.some((t) => t.startsWith("mcp__context7"))) {
    errs.push(`skill ${skill}: mcp__context7 no permitido en skills (context7.md)`);
  }
  return errs;
}

// Sólo lectura = sin herramientas de escritura (lo comprueba checkAgent) **y** sin escritura por Bash. Lo segundo NO lo
// garantiza el Markdown: lo impone scripts/hooks/readonly-agent-guard.py por identidad de agente (TSK-257). Una prueba
// verifica que ese hook liste exactamente estos nombres.
export const READ_ONLY_AGENTS = ["sentinel", "tracer", "warden"] as const;
export const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
// context7.md: sólo Artisan (y la sesión principal) tienen mcp__context7.
export const CONTEXT7_ALLOWED_AGENTS = ["artisan"] as const;
// Agentes de Fase 9: su prosa debe declarar el veto de escritura sobre motor/web.
export const VETO_AGENTS = ["data-stat-engineer", "evaluation-engineer"] as const;

export function checkAgent(file: string, text: string): string[] {
  const base = file.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
  const a = parseAgent(text);
  const errs: string[] = [];
  if (a.name !== base) errs.push(`${base}: name "${a.name}" != nombre de archivo`);
  if (!a.description) errs.push(`${base}: sin description`);
  if (!a.model) errs.push(`${base}: sin model`);
  if (a.tools.length === 0) errs.push(`${base}: sin tools (hereda todo, rompe mínimo privilegio)`);
  const hasWrite = a.tools.some((t) => (WRITE_TOOLS as readonly string[]).includes(t));
  if ((READ_ONLY_AGENTS as readonly string[]).includes(base) && hasWrite) {
    errs.push(`${base}: agente de sólo lectura con herramienta de escritura`);
  }
  const hasC7 = a.tools.some((t) => t.startsWith("mcp__context7"));
  if (hasC7 && !(CONTEXT7_ALLOWED_AGENTS as readonly string[]).includes(base)) {
    errs.push(`${base}: mcp__context7 no permitido (context7.md)`);
  }
  if ((VETO_AGENTS as readonly string[]).includes(base)) {
    const veto = text.includes("Nunca escribes en `apps/engine/src/**`") && text.includes("apps/web/**");
    if (!veto) errs.push(`${base}: falta el veto de escritura sobre apps/engine/src y apps/web`);
  }
  return errs;
}

const NEGATION = /\b(nunca|jam[aá]s|prohibid[oa]|no\s+(?:se\s+)?(?:borr|elimin|compr|reescrib|vac|trunc))/i;
const DESTRUCTIVE =
  /(empieza un `?(?:journal|ledger)[\w.-]*\.md`? nuevo|(?:vac(?:iar|ia|ía)|borr(?:ar|a)|elimin(?:ar|a)|trunc(?:ar|a)|reescrib(?:ir|e))\w*\s+(?:el\s+|tu\s+)?`?(?:journal|ledger))/i;

// verify-simplicity.sh bloquea cualquier diff que borre líneas de journal*.md / ledger.md.
export function checkJournalPolicy(file: string, text: string): string[] {
  const errs: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    if (!/(journal[\w.-]*\.md|ledger\.md)/.test(line)) return;
    if (!DESTRUCTIVE.test(line)) return;
    if (NEGATION.test(line)) return;
    errs.push(`${file}:${i + 1}: instruye borrar/vaciar/reescribir un archivo append-only`);
  });
  return errs;
}

// Rutas de repo citadas entre backticks que deben existir.
export function extractRepoPaths(text: string): string[] {
  const out = new Set<string>();
  // Sólo rutas ancladas a la raíz del repo; las de reglas por app (`features/…`, `lib/…`) son relativas a apps/*.
  const ROOTS = /^(docs|scripts|\.claude|\.github|\.kiro|apps|eval|data|qa|e2e|specs)\//;
  const re = /`((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:md|ts|tsx|sh|py|json|ya?ml))`/g;
  for (const m of text.matchAll(re)) {
    const p = m[1];
    if (/[*{}]|XXX|YYYY|-N\.|^\.\./.test(p) || !ROOTS.test(p)) continue;
    out.add(p);
  }
  return [...out];
}

// Cada excepción lleva su motivo: son salidas que una skill GENERA, no referencias rotas.
export const PATH_ALLOWLIST: Record<string, string> = {
  "docs/agents/BRAINSTORM.md": "salida de /brainstorm, entrada de /grill-me",
  "docs/agents/evolve-report.md": "salida de /evolve",
  "docs/agents/DESIGN_SYSTEM.md": "salida de /design-forge; artisan.md documenta que no existe",
  "src/archivo.ts": "plantilla de ejemplo en /shipcheck",
};

export function checkPaths(file: string, text: string, exists: (p: string) => boolean): string[] {
  return extractRepoPaths(text)
    .filter((p) => !(p in PATH_ALLOWLIST) && !exists(p))
    .map((p) => `${file}: ruta inexistente \`${p}\``);
}

// El adaptador de Gemini no duplica política: sólo apunta context.fileName a AGENTS.md.
export function checkGeminiAdapter(settingsJson: string | null): string[] {
  if (settingsJson === null) return [".gemini/settings.json: ausente"];
  try {
    const names = JSON.parse(settingsJson)?.context?.fileName;
    const list = Array.isArray(names) ? names : [names];
    return list.includes("AGENTS.md") ? [] : [".gemini/settings.json: context.fileName no incluye AGENTS.md"];
  } catch {
    return [".gemini/settings.json: JSON inválido"];
  }
}

// AGENTS.md debe listar exactamente las reglas que declaran `paths:` (y no afirmar de más).
export function checkAgentsMdRules(agentsMd: string, rulesWithPaths: string[]): string[] {
  const line = agentsMd.split(/\r?\n/).find((l) => l.includes("Reglas por ruta"));
  if (!line) return ["AGENTS.md: falta la línea 'Reglas por ruta'"];
  const listed = [...line.matchAll(/`([a-z0-9-]+)\.md`/g)].map((m) => m[1]).sort();
  const actual = [...rulesWithPaths].sort();
  return JSON.stringify(listed) === JSON.stringify(actual)
    ? []
    : [`AGENTS.md lista [${listed}] pero declaran paths: [${actual}]`];
}

// docs/agents/models.yaml es el checklist de "qué tocar si un modelo cambia de nombre": cada agente
// debe figurar bajo el tier cuyo modelo_actual coincide con su `model:`.
export function checkModelsYaml(agents: { file: string; model?: string }[], yamlText: string): string[] {
  const tierOf = new Map<string, string>();
  let current = "";
  for (const line of yamlText.split(/\r?\n/)) {
    const m = /modelo_actual:\s*(\S+)/.exec(line);
    if (m) current = m[1];
    const a = /^\s*-\s+(\.claude\/agents\/[\w-]+\.md)/.exec(line);
    if (a) tierOf.set(a[1], current);
  }
  const errs: string[] = [];
  for (const { file, model } of agents) {
    const key = `.claude/agents/${file}`;
    if (!tierOf.has(key)) errs.push(`models.yaml: falta ${key}`);
    else if (tierOf.get(key) !== model) errs.push(`models.yaml: ${key} figura con ${tierOf.get(key)} pero declara ${model}`);
  }
  return errs;
}

// Ciclo de coordinación (dispatch + helm + compass). Chequeo ESTÁTICO de que el texto declara las
// prohibiciones, paradas y evidencia; no prueba que un modelo las obedezca.
export const COORDINATION_CLAUSES: [string, RegExp][] = [
  ["sección del ciclo", /CICLO DE COORDINACI[ÓO]N/],
  ["no aprueba su propio trabajo", /no aprueba su propio trabajo/i],
  ["no omite tests ni guardrails", /no omite (?:pruebas|tests)/i],
  ["PASS sólo con evidencia", /PASS sin (?:comando|evidencia)/i],
  ["no sale del alcance autorizado", /no modifica archivos fuera del `?write_scope`?/i],
  ["merge/deploy sólo con autorización", /merge[^.\n]*deploy[^.\n]*autorizaci[óo]n expl[íi]cita/i],
  ["parada: attempts 3 → Tracer", /attempts: 3/],
  ["parada: 3 rondas de redteam", /3 rondas/],
  ["regresión permanente", /prueba permanente/i],
  ["evidencia por tipo: implementación", /\|\s*Implementaci[óo]n\s*\|[^\n]*diff[^\n]*prueba/i],
  ["evidencia por tipo: corrección de bug", /\|\s*Correcci[óo]n de bug\s*\|[^\n]*rojo[^\n]*verde[^\n]*permitido/i],
  ["evidencia por tipo: seguridad", /\|\s*Seguridad\s*\|[^\n]*severidad[^\n]*evidencia/i],
  ["evidencia por tipo: evaluación", /\|\s*Evaluaci[óo]n\s*\|[^\n]*baseline[^\n]*limitaciones/i],
  ["evidencia por tipo: release", /\|\s*Release\s*\|[^\n]*requeridos[^\n]*autorizaci[óo]n/i],
  ["SKIPPED/NOT_TESTED no cuentan como PASS", /PASS \/ FAIL \/ SKIPPED \/ NOT_TESTED/],
];

export function checkCoordinationWorkflow(dispatchText: string): string[] {
  return COORDINATION_CLAUSES.filter(([, re]) => !re.test(dispatchText)).map(([n]) => `dispatch: falta cláusula "${n}"`);
}

export function checkRootCauseRegression(text: string): string[] {
  return /prueba permanente/i.test(text) && /rojo/i.test(text) && /verde/i.test(text)
    ? []
    : ["root-cause: no exige convertir la reproducción en una prueba permanente (rojo → verde)"];
}
