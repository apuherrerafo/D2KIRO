#!/usr/bin/env bun
// Mantenimiento de contexto: regenera el tablero y avisa (NUNCA bloquea) cuando los artefactos
// que un agente lee al arrancar sesión (AGENTS.md, .kiro/steering/, MEMORY.md, plan.md) se
// desincronizan de la fuente real -- CLAUDE.md para stack/reglas, el frontmatter de cada
// docs/agents/tasks/TSK-XXX.md para estado real de tickets. Nace de un hallazgo de auditoría real
// (2026-08-22): AGENTS.md seguía siendo la plantilla genérica sin llenar (Bun+HTMX) mientras
// CLAUDE.md documentaba Next.js hacía tres fases, y plan.md listaba tickets como backlog que ya
// estaban done en su propio archivo. Doc staleness es una señal de mantenimiento, no un gate de
// seguridad ni de correctitud -- por eso este script siempre sale con exit 0, incluso con avisos.
// Uso: bun scripts/sync-context.ts (también corre como primer paso de verify-simplicity.sh)

import { Glob } from "bun";

let warnings = 0;

function warn(msg: string) {
  console.log(`⚠️  ${msg}`);
  warnings++;
}

function ok(msg: string) {
  console.log(`✅ ${msg}`);
}

async function readIfExists(path: string): Promise<string | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return file.text();
}

// --- 1. Regenerar el tablero ---
console.log("🔄 sync-context: regenerando tablero...");
const hubResult = Bun.spawnSync(["bun", "scripts/hub.ts"]);
if (hubResult.exitCode !== 0) {
  warn("bun scripts/hub.ts falló -- tablero no regenerado. Revisar manualmente.");
} else {
  ok("Tablero (docs/agents/hub.html) regenerado.");
}

// --- 2. AGENTS.md y .kiro/steering/ vs. el stack real (CLAUDE.md § STACK ACTUAL) ---
// Palabras que delatan una plantilla genérica nunca reemplazada -- si aparecen en un archivo que
// se supone refleja el proyecto real, ese archivo quedó atrás (caso real: AGENTS.md con "HTMX").
const LEGACY_STACK_TOKENS = ["HTMX", "daisyUI", "[nombre-del-proyecto]"];
// Palabras del stack real que sí deberían aparecer en cualquier espejo vigente de CLAUDE.md.
const REAL_STACK_TOKENS = ["Next.js", "Bun", "SQLite", "Drizzle"];

async function checkStackSync(label: string, path: string) {
  const content = await readIfExists(path);
  if (content === null) {
    warn(`${label}: no existe (${path}).`);
    return;
  }
  const legacyHits = LEGACY_STACK_TOKENS.filter((t) => content.includes(t));
  const missingReal = REAL_STACK_TOKENS.filter((t) => !content.includes(t));
  if (legacyHits.length > 0) {
    warn(`${label}: menciona stack obsoleto (${legacyHits.join(", ")}) -- revisar contra CLAUDE.md § STACK ACTUAL.`);
  }
  if (missingReal.length > 0) {
    warn(`${label}: no menciona ${missingReal.join(", ")} -- ¿sigue reflejando el stack real?`);
  }
  if (legacyHits.length === 0 && missingReal.length === 0) {
    ok(`${label}: stack alineado con CLAUDE.md.`);
  }
}

await checkStackSync("AGENTS.md", "AGENTS.md");
await checkStackSync(".kiro/steering/tech.md", ".kiro/steering/tech.md");

// --- 2b. Fase 3 (position_fit) en .kiro/steering/ -- el cambio de arquitectura más reciente y
// el más propenso a quedar atrás: role_gap/role_safety ya no existen en el motor real
// (apps/engine/src/signals/types.ts), position_fit las reemplazó.
async function checkPhase3Sync(label: string, path: string) {
  const content = await readIfExists(path);
  if (content === null) return;
  // Markdown envuelve líneas -- "se fusionan" puede aparecer como "se\n  fusionan" en el archivo
  // fuente. Normalizar todo el whitespace a un solo espacio antes de buscar la frase evita falsos
  // positivos por wrapping (bug real encontrado al probar este script contra .kiro/steering/).
  const flat = content.replace(/\s+/g, " ");
  const mentionsOldSignalsLive =
    /\brole_gap\b|\brole_safety\b/.test(flat) &&
    !/congelad|hist[oó]ric|ya no existe|fusion|reemplaz/i.test(flat);
  if (mentionsOldSignalsLive) {
    warn(`${label}: menciona role_gap/role_safety sin marcarlas como históricas -- position_fit las reemplazó en Fase 3.`);
  }
  if (!content.includes("position_fit")) {
    warn(`${label}: no menciona position_fit -- ¿Fase 3 está reflejada acá?`);
  } else {
    ok(`${label}: Fase 3 (position_fit) reflejada.`);
  }
}

await checkPhase3Sync(".kiro/steering/product.md", ".kiro/steering/product.md");
await checkPhase3Sync(".kiro/steering/structure.md", ".kiro/steering/structure.md");

// --- 3. Vigencia de MEMORY.md y plan.md contra el estado real de los tickets ---
const taskIds: number[] = [];
const glob = new Glob("docs/agents/tasks/TSK-*.md");
for await (const file of glob.scan(".")) {
  const m = file.match(/TSK-(\d+)\.md$/);
  if (m) taskIds.push(parseInt(m[1], 10));
}

if (taskIds.length > 0) {
  const latestId = Math.max(...taskIds);
  const latestTicket = `TSK-${String(latestId).padStart(3, "0")}`;

  // plan.md: si LISTA (no solo menciona en prosa narrativa) un ticket como backlog/ready cuando
  // su propio frontmatter ya dice `done`, la vista derivada no se regeneró tras el cierre. Buscar
  // solo en líneas que combinan un TSK-XXX con la palabra backlog/ready -- una línea de prosa
  // como "TSK-027 a TSK-033 completos, done" menciona el ticket sin listarlo como pendiente, y no
  // debe contar como señal de staleness (falso positivo real, encontrado al probar este script
  // contra la primera versión de plan.md regenerado).
  const plan = await readIfExists("docs/agents/plan.md");
  if (plan !== null) {
    const staleInPlan = new Set<string>();
    for (const line of plan.split("\n")) {
      if (!/\b(backlog|ready)\b/i.test(line)) continue;
      // "Cero tareas en backlog" / "Ninguno en backlog" describen un backlog VACÍO, no listan un
      // ticket como pendiente -- sin este filtro, cualquier resumen que nombre tickets ya
      // cerrados en la misma frase que confirma "backlog en cero" se marca como falso positivo
      // (encontrado al probar este script contra la propia regeneración de plan.md).
      if (/\bcero\b|\bningun[oa]\b/i.test(line)) continue;
      for (const m of line.matchAll(/TSK-(\d+)/g)) {
        const id = m[1];
        const ticket = await readIfExists(`docs/agents/tasks/TSK-${id}.md`);
        if (ticket && /^state:\s*done\s*$/m.test(ticket)) {
          staleInPlan.add(`TSK-${id}`);
        }
      }
    }
    if (staleInPlan.size > 0) {
      warn(`plan.md lista ${[...staleInPlan].join(", ")} como backlog/ready -- ya están \`state: done\` en su propio ticket. Regenerar con /helm.`);
    } else {
      ok("plan.md no lista como backlog/ready ningún ticket ya cerrado.");
    }
  }

  // MEMORY.md: si el ticket más reciente del repo no aparece mencionado, la vista comprimida se
  // quedó atrás respecto al journal real.
  const memory = await readIfExists("docs/agents/MEMORY.md");
  if (memory !== null) {
    if (!memory.includes(latestTicket)) {
      warn(`MEMORY.md no menciona ${latestTicket} (el ticket más reciente del repo) -- regenerar con /helm checkpoint.`);
    } else {
      ok(`MEMORY.md incluye ${latestTicket} -- razonablemente al día.`);
    }
  }
}

// --- Resultado ---
console.log("");
if (warnings === 0) {
  console.log("✅ sync-context: todo el contexto revisado está alineado.");
} else {
  console.log(`⚠️  sync-context: ${warnings} señal(es) de contexto potencialmente desincronizado.`);
  console.log("   Esto NO bloquea el commit ni el deploy -- es mantenimiento, no un gate de seguridad/correctitud.");
}
process.exit(0);
