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
