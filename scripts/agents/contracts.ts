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
  return Object.fromEntries(Object.entries(rawFrontmatter(text)).map(([k, v]) => [k, v.replace(/^"(.*)"$/, "$1")]));
}

export function parseAgent(text: string): AgentFrontmatter {
  const fm = parseFrontmatter(text);
  const tools = (fm.tools ?? "").split(",").map((t) => t.trim()).filter(Boolean);
  return { name: fm.name, description: fm.description, model: fm.model, tools };
}

// Valor sin comillas con ': ', ' #' o ':' final: no es YAML válido (o se recorta). Claude Code descarta entonces el agente
// sin avisar y carga el homónimo de otra fuente, con sus herramientas (reproducido con el binario 2.1.329, `sentinel`).
export function unreadableFrontmatterKeys(text: string): string[] {
  return Object.entries(rawFrontmatter(text))
    .filter(([, v]) => !/^["']/.test(v) && /: | #|:$/.test(v))
    .map(([k]) => k);
}

function rawFrontmatter(text: string): Record<string, string> {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2].trim();
  }
  return out;
}

// `allowed-tools` de un skill: tokens separados por espacio; un token puede llevar paréntesis con
// espacios dentro, p. ej. `Bash(git log:*)`.
export function parseSkillTools(text: string, field: "allowed-tools" | "disallowed-tools" = "allowed-tools"): string[] {
  const raw = parseFrontmatter(text)[field] ?? "";
  return raw.match(/[^\s(]+(?:\([^)]*\))?/g) ?? [];
}

// Skills revisores: declaran no escribir (el coordinador no aprueba su propio trabajo, dispatch.md).
// OJO: `allowed-tools` en un skill es PRE-APROBACIÓN de permisos, NO una restricción (comprobado con el binario 2.1.329: un skill con
// `allowed-tools: "Read Grep"` escribió con `Write`). Lo que SÍ restringe es `disallowed-tools` (mismo binario: con él, Write, Bash y
// Agent fueron denegados y la lectura siguió funcionando; sólo vale durante el turno que invoca el skill). TSK-260.
export const READ_ONLY_SKILLS = ["redteam"] as const;
// Vías de escritura o ejecución que un skill revisor debe tener en `disallowed-tools` (Bash/PowerShell escriben; Agent delega a un subagente que escribe).
export const READ_ONLY_SKILL_DISALLOWED = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "PowerShell", "Agent"] as const;

export function checkSkillTools(skill: string, text: string): string[] {
  const tools = parseSkillTools(text);
  const errs: string[] = [];
  if ((READ_ONLY_SKILLS as readonly string[]).includes(skill) && tools.some((t) => (WRITE_TOOLS as readonly string[]).includes(t))) {
    errs.push(`skill ${skill}: revisor de sólo lectura con herramienta de escritura en allowed-tools`);
  }
  if ((READ_ONLY_SKILLS as readonly string[]).includes(skill)) {
    const blocked = parseSkillTools(text, "disallowed-tools");
    const missing = READ_ONLY_SKILL_DISALLOWED.filter((t) => !blocked.includes(t));
    if (missing.length > 0) errs.push(`skill ${skill}: revisor de sólo lectura sin ${missing.join(", ")} en disallowed-tools (allowed-tools no restringe)`);
  }
  if (tools.some((t) => t.startsWith("mcp__context7"))) {
    errs.push(`skill ${skill}: mcp__context7 no permitido en skills (context7.md)`);
  }
  return errs;
}

// Un comando que remite al SKILL.md de un revisor lo hace LEER, no lo invoca: el `disallowed-tools` del skill no rige y el
// comando necesita el suyo (reproducido con el binario 2.1.329: `/review` escribió con Write y Bash, TSK-262). El comando
// homónimo (`/redteam`) queda exento: el binario resuelve ese nombre al skill y aplica su bloqueo.
export function checkReviewerAlias(file: string, text: string): string[] {
  const name = file.replace(/\.md$/, "");
  const blocked = parseSkillTools(text, "disallowed-tools");
  return READ_ONLY_SKILLS.filter((s) => s !== name && text.includes(`.claude/skills/${s}/SKILL.md`)).flatMap((s) => {
    const missing = READ_ONLY_SKILL_DISALLOWED.filter((t) => !blocked.includes(t));
    return missing.length > 0 ? [`comando ${name}: remite al revisor ${s} sin ${missing.join(", ")} en disallowed-tools`] : [];
  });
}

// `@redteam` no ejecuta nada: sin el diff entregado no tiene qué revisar (reproducido con el binario 2.1.329: 6/6 APPROVED
// sin diff, TSK-263). No hay mecanismo ejecutable que lo impida; esto sólo fija que el texto lo pide y no se anuncie como control.
export const REDTEAM_EVIDENCE_CLAUSES: [string, RegExp][] = [
  ["exige el paquete de evidencia con el diff", /paquete de evidencia[^\n]*diff/i],
  ["sin evidencia el veredicto es BLOCKED", /Sin paquete de evidencia el veredicto es `BLOCKED`/],
  ["el formato de salida admite BLOCKED", /"veredicto": "APPROVED" \| "REJECTED" \| "BLOCKED"/],
  ["declara NOT_VERIFIED el cumplimiento de la regla", /no es un control ejecutable[^\n]*NOT_VERIFIED/],
];

export function checkRedteamEvidence(text: string): string[] {
  return REDTEAM_EVIDENCE_CLAUSES.filter(([, re]) => !re.test(text)).map(([n]) => `redteam: falta cláusula "${n}"`);
}

// Revisores de sólo lectura (TSK-261): lista BLANCA de herramientas, sin Bash, escritura, delegación ni MCP. El control es
// `tools:` del frontmatter (allowlist real de Claude Code); scripts/hooks/readonly-agent-guard.py queda como defensa
// adicional (cualquier Bash/PowerShell de estas identidades se bloquea) y una prueba verifica que liste estos nombres.
export const READ_ONLY_AGENTS = ["sentinel", "tracer", "warden"] as const;
// La cabecera se compara ENTERA, no se interpreta: Claude Code lee el frontmatter distinto que un parser casero (cierra en
// el primer `---`, y sin `tools` el agente hereda todo; reproducido con el binario 2.1.329). Cambiar la descripción o el
// modelo de un revisor exige actualizar aquí, a propósito.
export const READ_ONLY_AGENT_HEADERS: Record<(typeof READ_ONLY_AGENTS)[number], string> = {
  sentinel: '---\nname: sentinel\ndescription: "Gate de seguridad obligatorio antes de cada deploy. Audita inputs, secretos, sanitización y privilegios. No es un checklist opcional: bloquea el deploy si falla."\nmodel: claude-sonnet-5\ntools: Read, Glob, Grep\n---\n',
  tracer: '---\nname: tracer\ndescription: Se activa cuando hay fallos repetidos. Analiza patrones y recomienda cambios de enfoque.\nmodel: claude-sonnet-5\ntools: Read, Glob, Grep\n---\n',
  warden: '---\nname: warden\ndescription: Interpreta el resultado de los gates deterministas (tests, lint, tipos) y valida accesibilidad. Se activa tras @build.\nmodel: claude-sonnet-5\ntools: Read, Glob, Grep\n---\n',
};
// Entradas exactas de .claude/agents: Claude Code carga subcarpetas y la identidad sale de `name:`, así que un archivo
// extra podría suplantar a un revisor (reproducido con el binario 2.1.329).
export const AGENT_ENTRIES = [
  "artisan.md", "chronicle.md", "data-stat-engineer.md", "evaluation-engineer.md", "sentinel.md", "tracer.md", "warden.md",
];

export function checkAgentEntries(entries: string[]): string[] {
  const extra = entries.filter((e) => !AGENT_ENTRIES.includes(e)).map((e) => `.claude/agents: entrada no declarada "${e}"`);
  const missing = AGENT_ENTRIES.filter((e) => !entries.includes(e)).map((e) => `.claude/agents: falta "${e}"`);
  return [...extra, ...missing];
}
export const WRITE_TOOLS = ["Write", "Edit", "MultiEdit", "NotebookEdit"] as const;
// context7.md: sólo Artisan (y la sesión principal) tienen mcp__context7.
export const CONTEXT7_ALLOWED_AGENTS = ["artisan"] as const;
// Agentes de Fase 9: su prosa debe declarar el veto de escritura sobre motor/web.
export const VETO_AGENTS = ["data-stat-engineer", "evaluation-engineer"] as const;

export function checkReadOnlyAgent(base: (typeof READ_ONLY_AGENTS)[number], text: string): string[] {
  const errs: string[] = [];
  if (!text.replace(/\r\n/g, "\n").startsWith(READ_ONLY_AGENT_HEADERS[base])) {
    errs.push(`${base}: cabecera distinta de la fijada (revisor de sólo lectura: sólo Read, Glob, Grep)`);
  }
  if (!/NOT_VERIFIED/.test(text) || !/BLOCKED/.test(text)) {
    errs.push(`${base}: no declara BLOCKED/NOT_VERIFIED cuando falta evidencia`);
  }
  return errs;
}

export function checkAgent(file: string, text: string): string[] {
  const base = file.replace(/^.*[\\/]/, "").replace(/\.md$/, "");
  const a = parseAgent(text);
  const errs: string[] = [];
  if (a.name !== base) errs.push(`${base}: name "${a.name}" != nombre de archivo`);
  if (!a.description) errs.push(`${base}: sin description`);
  if (!a.model) errs.push(`${base}: sin model`);
  if (a.tools.length === 0) errs.push(`${base}: sin tools (hereda todo, rompe mínimo privilegio)`);
  for (const key of unreadableFrontmatterKeys(text)) {
    errs.push(`${base}: "${key}" lleva ': ' o ' #' sin comillas (Claude Code descartaría el agente en silencio)`);
  }
  const reviewer = READ_ONLY_AGENTS.find((n) => n === base);
  if (reviewer) errs.push(...checkReadOnlyAgent(reviewer, text));
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
  ["paquete de evidencia para revisores sin Bash", /PAQUETE DE EVIDENCIA[\s\S]*rev-parse HEAD[\s\S]*exit/],
  ["BLOCKED/NOT_VERIFIED de un revisor nunca es PASS", /BLOCKED[^\n]*NOT_VERIFIED[^\n]*nunca[^\n]*PASS/],
  ["tras @redteam el coordinador sigue en el turno siguiente", /@redteam[^\n]*todo el turno[^\n]*turno siguiente/],
];

export function checkCoordinationWorkflow(dispatchText: string): string[] {
  return COORDINATION_CLAUSES.filter(([, re]) => !re.test(dispatchText)).map(([n]) => `dispatch: falta cláusula "${n}"`);
}

// Warden juzga ALCANCE (write_scope de las fichas), nunca cantidad de archivos: CLAUDE.md no admite límites por tamaño.
export const WARDEN_SCOPE_CLAUSES: [string, RegExp][] = [
  ["declara que no hay límite por cantidad", /no hay límite de archivos ni de líneas/],
  ["lee el write_scope de las fichas", /Lee tú mismo el `write_scope` de cada ficha del cambio/],
  ["cubre diff, diff-local y diff-nuevos", /cada archivo de `diff`, `diff-local` y `diff-nuevos`/],
  ["fuera de alcance es FAIL", /fuera de todo `write_scope`[^\n]*`FAIL`/],
  ["sin alcance declarado es NOT_VERIFIED", /Sin `write_scope` declarado[^\n]*`NOT_VERIFIED`/],
  ["una ampliación de alcance se reporta", /amplía un `write_scope`[^\n]*hallazgos/],
];

export function checkWardenScope(text: string): string[] {
  const errs = WARDEN_SCOPE_CLAUSES.filter(([, re]) => !re.test(text)).map(([n]) => `warden: falta cláusula "${n}"`);
  if (/(más de|máximo|hasta|more than)\s+(de\s+)?\d+\s+(archivos|files)/i.test(text)) {
    errs.push("warden: limita la cantidad de archivos (contradice CLAUDE.md)");
  }
  return errs;
}

// castoff sólo continúa con PASS:un `BLOCKED`/`NOT_VERIFIED` de Sentinel no puede colarse por "no es FAIL".
export function checkCastoffDelivery(text: string): string[] {
  return /scripts\/agents\/delivery-verdict\.ts/.test(text) && /`NOT_READY` aunque Sentinel/.test(text) ? [] : ["castoff: no decide la entrega con delivery-verdict.ts"];
}

export function checkCastoffGate(text: string): string[] {
  return /distinto de `"PASS"`[^\n]*DETENTE/.test(text) ? [] : ["castoff: no detiene ante un veredicto de Sentinel distinto de PASS"];
}

export function checkRootCauseRegression(text: string): string[] {
  return /prueba permanente/i.test(text) && /rojo/i.test(text) && /verde/i.test(text)
    ? []
    : ["root-cause: no exige convertir la reproducción en una prueba permanente (rojo → verde)"];
}
