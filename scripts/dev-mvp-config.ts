import { isAbsolute, resolve } from "node:path";

export function defaultMvpPublicBaseUrl(webPort: string): string {
  return `http://localhost:${webPort}`;
}

// apps/engine resolves a relative ENGINE_DB_PATH from its own working directory. Resolve it
// exactly the same way here before using it to run the real migrations.
export function resolveMvpDatabasePath(root: string, configuredPath?: string): string {
  if (!configuredPath) return resolve(root, "apps/engine/data/dota2coach.sqlite");
  return isAbsolute(configuredPath) ? configuredPath : resolve(root, "apps/engine", configuredPath);
}

export interface EngineLaunch {
  /** Argumentos de `bun` para apps/engine. */
  args: string[];
  /** Escribe el artefacto de elegibilidad de Captains Mode (FIXTURE de pruebas). Nunca en modo real. */
  writeCmFixture: boolean;
}

/**
 * Qué motor arranca el runner local.
 *  - `live: false` (dev:mvp, simulador): `index.e2e.ts` con `--watch`, como siempre. Trae capacidades de PRUEBA
 *    (bot forzado, reloj de prueba) y un artefacto de CM de fixture: sólo para desarrollo.
 *  - `live: true` (prueba con Dota real): el MISMO entrypoint que Railway (`index.ts`), sin capacidades de
 *    prueba, sin fixture de CM y SIN `--watch` (un reinicio por guardar un archivo borraría la sesión Live en memoria).
 */
export function engineLaunch(live: boolean): EngineLaunch {
  if (live) return { args: ["run", "src/index.ts"], writeCmFixture: false };
  return { args: ["run", "--watch", "src/index.e2e.ts"], writeCmFixture: true };
}

export type EngineEntrypointKind = "production" | "test" | "unknown";

/** Clasifica la línea de comandos del proceso que escucha en el puerto del motor. Pura. */
export function classifyEngineCommand(commandLine: string): EngineEntrypointKind {
  const text = commandLine.replace(/[\\]/g, "/").toLowerCase();
  if (/index\.e2e\.ts/.test(text)) return "test";
  if (/src\/index\.ts/.test(text)) return "production";
  return "unknown";
}
