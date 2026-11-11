// Preflight de Live (Companion + GSI) -- la mitad PURA: dados los hechos ya recogidos de la PC, decide
// LISTO / BLOQUEADO y explica por qué. Sin I/O, sin reloj, sin secretos: los hechos nunca traen un
// token ni un Steam id (el recolector los descarta antes de llegar aquí).

import type { EngineEntrypointKind } from "./dev-mvp-config";

export type Severity = "P0" | "P1" | "UNTESTED";
export interface Finding {
  id: string;
  severity: Severity;
  ok: boolean;
  /** Una línea, lenguaje llano. */
  detail: string;
  /** Qué hacer si falla. */
  action?: string;
}

export interface PortFact {
  port: number;
  /** null = libre. `ours` = lo lanzó este preflight (PID registrado) o su línea de comandos apunta a este worktree. */
  owner: { pid: number; ours: boolean } | null;
}

export interface GsiCfgFact {
  found: boolean;
  uri: string | null;
  hasTokenShape: boolean;
  sections: string[];
}

export interface CompanionFact {
  configFound: boolean;
  schemaOk: boolean;
  port: number | null;
  siteOrigin: string | null;
  healthOk: boolean | null;
}

export interface PreflightFacts {
  worktreeRoot: string;
  bunVersion: string | null;
  depsInstalled: { root: boolean; web: boolean; engine: boolean };
  dotaInstallFound: boolean;
  dotaRunning: boolean;
  launchOptionGsi: boolean | null;
  gsiCfg: GsiCfgFact;
  companion: CompanionFact;
  /** Origen HTTPS por el que el Companion DEBE hablar con ESTE código (p. ej. https://localhost:3443). */
  expectedOrigin: string;
  webPort: PortFact;
  enginePort: PortFact;
  httpsProxyUp: boolean;
  engineHealthy: boolean | null;
  webHealthy: boolean | null;
  /** Qué entrypoint corre el proceso que escucha en el puerto del motor. null = nadie escucha. */
  engineEntrypoint: EngineEntrypointKind | null;
  /** Meta de OpenDota en la base local: sincronizada y fresca (true), vieja/vacía/sincronizando (false), motor abajo (null). */
  metaReady: boolean | null;
}

export interface Report {
  verdict: "LISTO" | "BLOQUEADO";
  findings: Finding[];
}

const REQUIRED_GSI_SECTIONS = ["draft", "events", "map", "player", "hero"];

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").toLowerCase();
}

/** ¿El proceso que ocupa el puerto pertenece a este worktree? (por la ruta en su línea de comandos). */
export function ownedByWorktree(commandLine: string, worktreeRoot: string): boolean {
  return normalizePath(commandLine).includes(normalizePath(worktreeRoot));
}

function checkPort(label: string, fact: PortFact, serviceUp: boolean | null): Finding {
  if (fact.owner === null) {
    return { id: `port-${fact.port}`, severity: "P1", ok: true, detail: `${label} :${fact.port} libre.` };
  }
  if (fact.owner.ours && serviceUp !== false) {
    return { id: `port-${fact.port}`, severity: "P1", ok: true, detail: `${label} :${fact.port} lo ocupa este mismo worktree (PID ${fact.owner.pid}).` };
  }
  return {
    id: `port-${fact.port}`,
    severity: "P0",
    ok: false,
    detail: `${label} :${fact.port} lo ocupa un proceso (PID ${fact.owner.pid}) que no se pudo atribuir a este código: la prueba podría hablar con una versión vieja.`,
    action: "Detén ese stack (D2KIRO-STOP.cmd) y arranca con `bun scripts/live-preflight.ts --start`; o ensaya en otros puertos con --rehearse.",
  };
}

export function evaluate(facts: PreflightFacts): Report {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);

  add({
    id: "bun",
    severity: "P0",
    ok: facts.bunVersion !== null,
    detail: facts.bunVersion === null ? "Bun no está instalado." : `Bun ${facts.bunVersion}.`,
    action: "Instalar Bun (winget install Oven-sh.Bun).",
  });
  const missing = (Object.entries(facts.depsInstalled) as [string, boolean][]).filter(([, present]) => !present).map(([name]) => name);
  add({
    id: "deps",
    severity: "P0",
    ok: missing.length === 0,
    detail: missing.length === 0 ? "Dependencias instaladas (raíz, web, motor)." : `Faltan dependencias en: ${missing.join(", ")}.`,
    action: "Correr `bun install` en la raíz, en apps/web y en apps/engine.",
  });

  add({
    id: "dota-install",
    severity: "P0",
    ok: facts.dotaInstallFound,
    detail: facts.dotaInstallFound ? "Dota 2 instalado (carpeta encontrada)." : "No se encontró la carpeta de Dota 2.",
    action: "Verificar la instalación en Steam.",
  });
  add({
    id: "dota-closed",
    severity: "P1",
    ok: !facts.dotaRunning,
    detail: facts.dotaRunning ? "Dota está abierto AHORA: el preflight no lo necesita; cualquier cambio de cfg exige reiniciarlo." : "Dota cerrado (correcto para el preflight).",
  });
  add({
    id: "launch-option",
    severity: "P0",
    ok: facts.launchOptionGsi === true,
    detail:
      facts.launchOptionGsi === null
        ? "No pude leer las opciones de lanzamiento de Dota en Steam."
        : facts.launchOptionGsi
          ? "Opción de lanzamiento -gamestateintegration presente."
          : "Falta -gamestateintegration en las opciones de lanzamiento de Dota.",
    action: "Steam → Dota 2 → Propiedades → Opciones de lanzamiento: agregar -gamestateintegration.",
  });

  const cfg = facts.gsiCfg;
  const companionPort = facts.companion.port;
  const expectedUri = companionPort === null ? null : `http://127.0.0.1:${companionPort}/gsi`;
  add({
    id: "gsi-cfg",
    severity: "P0",
    ok: cfg.found && cfg.hasTokenShape && expectedUri !== null && cfg.uri === expectedUri,
    detail: !cfg.found
      ? "No existe gamestate_integration_d2kiro.cfg en la carpeta de Dota."
      : cfg.uri === expectedUri
        ? "GSI cfg presente, apunta al receptor local del Companion y trae token."
        : `GSI cfg apunta a "${cfg.uri ?? "?"}" pero el Companion escucha en ${expectedUri ?? "?"}.`,
    action: "Descargar de nuevo el instalador del Companion desde el sitio (re-empareja y reescribe el cfg).",
  });
  const missingSections = REQUIRED_GSI_SECTIONS.filter((section) => !cfg.sections.includes(section));
  add({
    id: "gsi-sections",
    severity: "P0",
    ok: cfg.found && missingSections.length === 0,
    detail: !cfg.found
      ? "Sin cfg no se pueden verificar secciones."
      : missingSections.length === 0
        ? "El cfg pide draft, events, map, player y hero (los bans ranked llegan SOLO por events)."
        : `Al cfg le faltan secciones: ${missingSections.join(", ")}.`,
    action: "Reinstalar el Companion; no editar el cfg a mano.",
  });

  const companion = facts.companion;
  add({
    id: "companion-config",
    severity: "P0",
    ok: companion.configFound && companion.schemaOk && companion.siteOrigin !== null,
    detail: companion.configFound && companion.schemaOk ? "Companion instalado y con configuración válida." : "Companion no instalado o con configuración ilegible.",
    action: "Instalar el Companion desde el botón del sitio.",
  });
  add({
    id: "companion-running",
    severity: "P0",
    ok: companion.healthOk === true,
    detail: companion.healthOk === true ? `Companion responde en 127.0.0.1:${companion.port}.` : "El Companion no responde en su puerto local.",
    action: "Reiniciar sesión de Windows o ejecutar su acceso directo; revisar %LOCALAPPDATA%\\D2KIRO\\Companion\\companion.log.",
  });
  const pairedToExpected = companion.siteOrigin === facts.expectedOrigin;
  add({
    id: "companion-pairing",
    severity: "P0",
    ok: pairedToExpected,
    detail: pairedToExpected
      ? `Companion emparejado con ${facts.expectedOrigin} (este código).`
      : `Companion emparejado con ${companion.siteOrigin ?? "nada"}, no con ${facts.expectedOrigin}: Dota alimentaría OTRO despliegue, no este código.`,
    action: `Elegir UNA: (a) con el stack local arriba, iniciar sesión en ${facts.expectedOrigin} y descargar el instalador del Companion desde "Conectar Dota"; o (b) probar contra el preview de Railway sólo si ese despliegue ya tiene este commit.`,
  });
  add({
    id: "https-proxy",
    severity: "P0",
    ok: facts.httpsProxyUp,
    detail: facts.httpsProxyUp ? "Proxy HTTPS local (Caddy :3443) arriba." : "Proxy HTTPS local (Caddy :3443) abajo: el Companion sólo habla HTTPS.",
    action: "Arrancar Caddy con el Caddyfile de C:\\Users\\APU\\d2kiro-local (D2KIRO-START.cmd lo levanta junto con el stack).",
  });

  add(checkPort("Web", facts.webPort, facts.webHealthy));
  add(checkPort("Motor", facts.enginePort, facts.engineHealthy));
  add({
    id: "engine-real",
    severity: "P0",
    ok: facts.engineEntrypoint === "production",
    detail:
      facts.engineEntrypoint === null
        ? "Motor sin arrancar: se verifica que sea el REAL (index.ts) en cuanto arranque."
        : facts.engineEntrypoint === "production"
          ? "Motor REAL (index.ts, el mismo que Railway): sin bot forzado, sin reloj de prueba, sin fixture de CM."
          : facts.engineEntrypoint === "test"
            ? "El motor corre index.e2e.ts (capacidades de PRUEBA: bot forzado y reloj controlable). No es apto para una sesión auténtica."
            : "No pude confirmar qué entrypoint corre el motor: no se declara seguro.",
    action: "Detener ese motor y arrancar con `bun run preflight:live -- --start` (usa el motor real).",
  });
  add({
    id: "meta-ready",
    severity: "P1",
    ok: facts.metaReady === true,
    detail:
      facts.metaReady === true
        ? "Meta de héroes sincronizada y fresca en la base local."
        : facts.metaReady === null
          ? "Sin motor no se puede ver el estado del meta."
          : "El meta de la base local está vacío, viejo o sincronizando: las recomendaciones saldrán con confianza baja hasta que termine.",
    action: "Esperar a que termine la primera sincronización (minutos, con internet) antes de la partida; en una base nueva es lo normal.",
  });
  add({
    id: "engine-health",
    severity: "P0",
    ok: facts.engineHealthy === true,
    detail: facts.engineHealthy === true ? "Motor responde /api/health." : "Motor no responde (¿no está arrancado?).",
    action: "bun run dev:mvp (o --rehearse para un ensayo).",
  });
  add({
    id: "web-health",
    severity: "P0",
    ok: facts.webHealthy === true,
    detail: facts.webHealthy === true ? "Web responde." : "Web no responde (¿no está arrancada?).",
    action: "bun run dev:mvp (o --rehearse para un ensayo).",
  });

  // Todo lo que exige el juego abierto: nunca se declara PASS offline.
  const untested: [string, string][] = [
    ["gsi-real-payload", "Que Dota ranked entregue draft/events con picks y bans reales (varía por modo; Ranked ≠ lobby)."],
    ["gsi-ranked-phases", "Fases y revelaciones del Ranked All Pick tal como llegan por GSI."],
    ["own-position", "Que la posición declarada coincida con el slot real del jugador en una partida."],
    ["party-real", "Party 5 real: sólo el preset está probado; la party real NO se afirma."],
    ["visual-helper", "Helper visual leyendo el cliente real (requiere ventana de Dota)."],
  ];
  for (const [id, detail] of untested) add({ id, severity: "UNTESTED", ok: false, detail });

  const blocked = findings.some((finding) => finding.severity === "P0" && !finding.ok);
  return { verdict: blocked ? "BLOQUEADO" : "LISTO", findings };
}

export function formatReport(report: Report): string[] {
  const lines: string[] = [];
  for (const finding of report.findings) {
    const mark = finding.severity === "UNTESTED" ? "UNTESTED" : finding.ok ? "OK      " : finding.severity === "P0" ? "FALLA P0" : "AVISO P1";
    lines.push(`[${mark}] ${finding.detail}`);
    if (!finding.ok && finding.action && finding.severity !== "UNTESTED") lines.push(`           → ${finding.action}`);
  }
  lines.push("", report.verdict === "LISTO" ? "== LISTO: se puede abrir Dota ==" : "== BLOQUEADO: no abrir Dota todavía ==");
  return lines;
}
