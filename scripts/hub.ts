#!/usr/bin/env bun
// HUB del ecosistema: mapa de arquitectura (estático) + Kanban (docs/agents/tasks/*.md)
// + estadísticas de uso reales (parseadas de journal.md) + feed de actividad + sugerencias
// de /evolve. Fuente de verdad de cada pieza: nunca se edita nada de esto a mano.
// Uso: bun scripts/hub.ts

import { Glob } from "bun";

const PHASES = ["kickoff", "pre-flight", "blueprint", "rulebook", "ejecución", "castoff"];
const STATES = ["backlog", "ready", "doing", "review", "blocked", "done"];
const MOSCOW_ORDER: Record<string, number> = { must: 0, should: 1, could: 2, wont: 3 };

type Task = {
  id: string; title: string; state: string; moscow: string;
  attempts: number; tool: string; file: string;
};

type LogEntry = { ts: string; tool: string; ticket: string; result: string; note: string };

function parseFrontmatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const out: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const m = line.match(/^([a-zA-Z_]+):\s*(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

async function loadTasks(): Promise<Task[]> {
  const tasks: Task[] = [];
  const glob = new Glob("docs/agents/tasks/*.md");
  for await (const file of glob.scan(".")) {
    const raw = await Bun.file(file).text();
    const fm = parseFrontmatter(raw);
    tasks.push({
      id: fm.id ?? file, title: fm.title ?? "(sin título)", state: fm.state ?? "backlog",
      moscow: fm.moscow ?? "could", attempts: Number(fm.attempts ?? 0),
      tool: (fm.assigned_tool && fm.assigned_tool !== "null" ? fm.assigned_tool : fm.preferred_tool) ?? "sin-asignar", file,
    });
  }
  return tasks;
}

async function loadProgress(): Promise<{ fase: string; siguiente: string }> {
  try {
    const raw = await Bun.file("docs/agents/PROGRESS.md").text();
    const faseMatch = raw.match(/## FASE ACTUAL\n(.+)/);
    const pasoMatch = raw.match(/## SIGUIENTE PASO\n([\s\S]*?)\n\n## HISTORIAL/);
    return {
      fase: faseMatch ? faseMatch[1].trim() : "sin-iniciar",
      siguiente: pasoMatch ? pasoMatch[1].trim().replace(/\n/g, " · ") : "",
    };
  } catch {
    return { fase: "sin-iniciar", siguiente: "" };
  }
}

// Parsea líneas estructuradas: "- [ts] event:evt-x schema:v1 tool:X ticket:Y result:Z — nota"
// event: y schema: son opcionales (tolera líneas viejas sin esos campos, no rompe el parseo).
function parseLogLine(line: string): LogEntry | null {
  const m = line.match(/^-\s*\[([^\]]+)\]\s*(?:event:\S+\s*)?(?:schema:\S+\s*)?tool:(\S+)\s*ticket:(\S+)\s*result:(\S+)\s*(?:—\s*(.*))?$/);
  if (!m) return null;
  return { ts: m[1], tool: m[2], ticket: m[3], result: m[4], note: m[5] ?? "" };
}

async function loadJournal(): Promise<{ entries: LogEntry[]; rawLines: string[] }> {
  const entries: LogEntry[] = [];
  const rawLines: string[] = [];
  try {
    const glob = new Glob("docs/agents/journal*.md");
    const files: string[] = [];
    for await (const f of glob.scan(".")) files.push(f);
    files.sort(); // journal-2026-06.md antes que journal-2026-07.md antes que journal.md
    for (const file of files) {
      const raw = await Bun.file(file).text();
      const lines = raw.split("\n").filter((l) => l.trim().startsWith("-"));
      for (const l of lines) {
        rawLines.push(l);
        const parsed = parseLogLine(l.trim());
        if (parsed) entries.push(parsed);
      }
    }
  } catch {
    // sin journal todavía, se devuelve vacío
  }
  return { entries, rawLines };
}

async function loadEvolveReport(): Promise<string | null> {
  try {
    return await Bun.file("docs/agents/evolve-report.md").text();
  } catch {
    return null;
  }
}

function computeStats(entries: LogEntry[]) {
  const byTool: Record<string, { total: number; ok: number; blocked: number; fail: number; info: number }> = {};
  for (const e of entries) {
    byTool[e.tool] ??= { total: 0, ok: 0, blocked: 0, fail: 0, info: 0 };
    byTool[e.tool].total++;
    if (e.result === "ok") byTool[e.tool].ok++;
    else if (e.result === "blocked") byTool[e.tool].blocked++;
    else if (e.result === "fail") byTool[e.tool].fail++;
    else byTool[e.tool].info++;
  }
  return Object.entries(byTool).sort((a, b) => b[1].total - a[1].total);
}

const RESULT_ICON: Record<string, string> = { ok: "✅", blocked: "🟡", fail: "🔴", info: "ℹ️" };

const ARCH_MAP = `
<svg viewBox="0 0 900 380" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:900px;">
  <style>
    .n { fill:#21252e; stroke:#3a3f4a; }
    .n-agent { fill:#2d2438; stroke:#5a4a7a; }
    .n-gate { fill:#3a2323; stroke:#6b3a3a; }
    .t { fill:#ccc; font-size:11px; font-family:-apple-system,sans-serif; text-anchor:middle; }
    .e { stroke:#444; stroke-width:1.5; fill:none; marker-end:url(#arrow); }
  </style>
  <defs>
    <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#555"/>
    </marker>
  </defs>

  <rect class="n" x="20" y="20" width="90" height="34" rx="8"/><text class="t" x="65" y="41">/kickoff</text>
  <rect class="n" x="140" y="20" width="90" height="34" rx="8"/><text class="t" x="185" y="41">/pre-flight</text>
  <rect class="n" x="260" y="20" width="90" height="34" rx="8"/><text class="t" x="305" y="41">/blueprint</text>
  <rect class="n" x="380" y="20" width="90" height="34" rx="8"/><text class="t" x="425" y="41">/rulebook</text>

  <path class="e" d="M110,37 H140"/>
  <path class="e" d="M230,37 H260"/>
  <path class="e" d="M350,37 H380"/>

  <rect class="n" x="380" y="100" width="90" height="34" rx="8"/><text class="t" x="425" y="121">/helm</text>
  <rect class="n" x="380" y="160" width="90" height="34" rx="8"/><text class="t" x="425" y="181">/dispatch</text>
  <path class="e" d="M425,54 V100"/>
  <path class="e" d="M425,134 V160"/>

  <rect class="n" x="250" y="220" width="80" height="34" rx="8"/><text class="t" x="290" y="241">@build</text>
  <rect class="n" x="340" y="220" width="90" height="34" rx="8"/><text class="t" x="385" y="241">@root-cause</text>
  <rect class="n-gate" x="440" y="220" width="80" height="34" rx="8"/><text class="t" x="480" y="241">@redteam</text>
  <rect class="n" x="530" y="220" width="90" height="34" rx="8"/><text class="t" x="575" y="241">@shipcheck</text>
  <path class="e" d="M425,194 L290,220"/>
  <path class="e" d="M425,194 L385,220"/>
  <path class="e" d="M330,237 H440"/>
  <path class="e" d="M520,237 H530"/>

  <rect class="n-gate" x="530" y="290" width="90" height="34" rx="8"/><text class="t" x="575" y="311">/castoff</text>
  <path class="e" d="M575,254 V290"/>

  <rect class="n-agent" x="700" y="20" width="90" height="34" rx="8"/><text class="t" x="745" y="41">Warden</text>
  <rect class="n-agent" x="700" y="70" width="90" height="34" rx="8"/><text class="t" x="745" y="91">Artisan</text>
  <rect class="n-agent" x="700" y="120" width="90" height="34" rx="8"/><text class="t" x="745" y="141">Chronicle</text>
  <rect class="n-agent" x="700" y="170" width="90" height="34" rx="8"/><text class="t" x="745" y="191">Tracer</text>
  <rect class="n-agent" x="700" y="290" width="90" height="34" rx="8"/><text class="t" x="745" y="311">Sentinel</text>

  <path class="e" d="M620,237 L700,37" stroke-dasharray="3,3"/>
  <path class="e" d="M330,237 L700,87" stroke-dasharray="3,3"/>
  <path class="e" d="M470,340 L700,140" stroke-dasharray="3,3"/>
  <path class="e" d="M385,254 L700,187" stroke-dasharray="3,3"/>
  <path class="e" d="M620,307 H700"/>

  <rect class="n" x="20" y="340" width="150" height="30" rx="6"/><text class="t" x="95" y="360">/compass · PROGRESS.md</text>
  <rect class="n" x="210" y="340" width="140" height="30" rx="6"/><text class="t" x="280" y="360">journal.md (fuente)</text>

  <text x="700" y="10" class="t" style="font-size:9px;fill:#666;text-anchor:start">punteada = puede invocar al agente</text>
</svg>`;

function render(
  tasks: Task[],
  progress: { fase: string; siguiente: string },
  journal: { entries: LogEntry[]; rawLines: string[] },
  evolveReport: string | null
): string {
  const columns = STATES.map((state) => {
    const items = tasks.filter((t) => t.state === state)
      .sort((a, b) => (MOSCOW_ORDER[a.moscow] ?? 9) - (MOSCOW_ORDER[b.moscow] ?? 9));
    const needsHuman = state === "review" || state === "blocked";
    const cards = items.map((t) => `
        <div class="card ${t.attempts >= 3 ? "card-warn" : ""} ${needsHuman ? "card-needs-human" : ""}">
          ${needsHuman ? '<div class="human-flag">🟡 necesita tu decisión</div>' : ""}
          <div class="card-id">${t.id}</div>
          <div class="card-title">${t.title}</div>
          <div class="card-meta">
            <span class="tag tag-${t.moscow}">${t.moscow}</span>
            <span class="tag tag-tool">${t.tool}</span>
            ${t.attempts > 0 ? `<span class="tag tag-attempts">intentos: ${t.attempts}</span>` : ""}
          </div>
        </div>`).join("");
    return `
      <div class="column ${needsHuman && items.length > 0 ? "column-alert" : ""}">
        <h2>${state} <span class="count">${items.length}</span></h2>
        ${cards || '<div class="empty">—</div>'}
      </div>`;
  }).join("");

  const wip = tasks.filter((t) => t.state === "doing").length;
  const wipWarning = wip > 1 ? `<div class="wip-alert">⚠️ WIP=${wip}, debería ser máximo 1</div>` : "";

  const stepper = PHASES.map((p) => {
    const active = progress.fase.includes(p);
    return `<div class="step ${active ? "step-active" : ""}">${p}</div>`;
  }).join('<div class="step-arrow">→</div>');

  const ranked = computeStats(journal.entries);
  const maxTotal = ranked.length ? ranked[0][1].total : 1;
  const statsRows = ranked.length
    ? ranked.map(([tool, s]) => {
        const pct = Math.round((s.total / maxTotal) * 100);
        const successRate = s.total ? Math.round((s.ok / s.total) * 100) : 0;
        return `
        <div class="stat-row">
          <div class="stat-name">${tool}</div>
          <div class="stat-bar-track"><div class="stat-bar" style="width:${pct}%"></div></div>
          <div class="stat-nums">${s.total}× · ${successRate}% ok ${s.blocked ? `· ${s.blocked} bloqueado` : ""} ${s.fail ? `· ${s.fail} falló` : ""}</div>
        </div>`;
      }).join("")
    : '<div class="empty">Todavía no hay logs estructurados en journal.md — en cuanto una skill anote con el formato tool:/ticket:/result:, aparece aquí.</div>';

  const feedItems = journal.entries.length
    ? journal.entries.slice(-12).reverse().map((e) => `
        <div class="feed-card">
          <div class="feed-icon">${RESULT_ICON[e.result] ?? "•"}</div>
          <div class="feed-body">
            <div class="feed-top"><strong>${e.tool}</strong> <span class="feed-ticket">${e.ticket}</span> <span class="feed-ts">${e.ts}</span></div>
            <div class="feed-note">${e.note || e.result}</div>
          </div>
        </div>`).join("")
    : (journal.rawLines.slice(-12).reverse().map((l) => `<div class="activity-line">${l}</div>`).join("") ||
       '<div class="empty">Sin actividad todavía.</div>');

  const suggestions = evolveReport
    ? `<div class="suggestions">${evolveReport.split("\n").map((l) => `<div>${l}</div>`).join("")}</div>`
    : '<div class="empty">Corre <code>/evolve</code> para generar sugerencias — se muestran aquí automáticamente.</div>';

  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<title>HUB del ecosistema — ${new Date().toISOString()}</title>
<style>
  body { font-family: -apple-system, sans-serif; background: #0f1115; color: #e6e6e6; margin: 0; padding: 24px; }
  h1 { font-size: 18px; font-weight: 600; margin-bottom: 4px; }
  h3 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin: 24px 0 8px; }
  .subtitle { color: #888; font-size: 13px; margin-bottom: 16px; }
  .wip-alert { background: #3a1f1f; color: #ff9d9d; padding: 8px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 13px; }
  .stepper { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; flex-wrap: wrap; }
  .step { background: #21252e; color: #666; padding: 6px 12px; border-radius: 20px; font-size: 12px; }
  .step-active { background: #2d4a3a; color: #7fdba3; font-weight: 600; }
  .step-arrow { color: #444; font-size: 12px; }
  .next-step { background: #171a21; border-radius: 8px; padding: 10px 14px; font-size: 13px; color: #ccc; margin-bottom: 20px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: start; }
  .panel { background: #171a21; border-radius: 8px; padding: 14px; }
  .board { display: flex; gap: 12px; overflow-x: auto; }
  .column { background: #171a21; border-radius: 8px; padding: 10px; min-width: 200px; flex: 1; }
  .column-alert { box-shadow: 0 0 0 1px #6b5a1f inset; }
  .column h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; color: #999; margin: 4px 4px 10px; }
  .count { color: #555; font-weight: 400; }
  .card { background: #21252e; border-radius: 6px; padding: 10px; margin-bottom: 8px; }
  .card-warn { border-left: 3px solid #e05252; }
  .card-needs-human { border-left: 3px solid #d4af37; }
  .human-flag { font-size: 11px; color: #d4af37; margin-bottom: 6px; }
  .card-id { font-size: 11px; color: #666; }
  .card-title { font-size: 13px; margin: 4px 0 8px; }
  .card-meta { display: flex; gap: 6px; flex-wrap: wrap; }
  .tag { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: #2c313c; }
  .tag-must { background: #4a2323; color: #ff9d9d; }
  .tag-should { background: #4a3d23; color: #ffd28c; }
  .tag-attempts { background: #3a2323; color: #ff8a8a; }
  .empty { color: #444; font-size: 12px; padding: 8px 4px; }
  .stat-row { display: grid; grid-template-columns: 90px 1fr 180px; align-items: center; gap: 8px; margin-bottom: 8px; font-size: 12px; }
  .stat-name { color: #ccc; }
  .stat-bar-track { background: #21252e; border-radius: 4px; height: 8px; }
  .stat-bar { background: #4a7a5a; border-radius: 4px; height: 8px; }
  .stat-nums { color: #888; font-size: 11px; }
  .feed-card { display: flex; gap: 10px; padding: 8px 4px; border-bottom: 1px solid #21252e; }
  .feed-icon { font-size: 16px; }
  .feed-top { font-size: 12px; color: #ccc; }
  .feed-ticket { color: #7a90c0; }
  .feed-ts { color: #555; font-size: 11px; }
  .feed-note { font-size: 12px; color: #999; margin-top: 2px; }
  .activity-line { padding: 3px 0; border-bottom: 1px solid #21252e; font-size: 12px; color: #999; }
  .suggestions { font-size: 12px; color: #ccc; line-height: 1.6; }
  code { background: #21252e; padding: 1px 5px; border-radius: 3px; }
</style>
</head>
<body>
  <h1>HUB del ecosistema</h1>
  <div class="subtitle">Todo se regenera solo desde PROGRESS.md, docs/agents/tasks/, journal.md y evolve-report.md — nada aquí se edita a mano.</div>

  <div class="stepper">${stepper}</div>
  <div class="next-step">📍 Siguiente paso: ${progress.siguiente || "corre /kickoff para empezar"}</div>

  <h3>Mapa de arquitectura (fijo — así están conectadas las piezas)</h3>
  <div class="panel">${ARCH_MAP}</div>

  ${wipWarning}
  <h3>Kanban</h3>
  <div class="board">${columns}</div>

  <h3>Uso real — quién se activa más, y qué tan bien le fue</h3>
  <div class="panel">${statsRows}</div>

  <div class="grid2">
    <div>
      <h3>Feed de actividad</h3>
      <div class="panel">${feedItems}</div>
    </div>
    <div>
      <h3>Sugerencias (/evolve)</h3>
      <div class="panel">${suggestions}</div>
    </div>
  </div>
</body>
</html>`;
}

const tasks = await loadTasks();
const progress = await loadProgress();
const journal = await loadJournal();
const evolveReport = await loadEvolveReport();
const html = render(tasks, progress, journal, evolveReport);
await Bun.write("docs/agents/hub.html", html);
console.log(`✅ HUB regenerado: docs/agents/hub.html (${tasks.length} tareas, ${journal.entries.length} eventos estructurados)`);
