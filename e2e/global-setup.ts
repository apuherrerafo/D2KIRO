import Database from "better-sqlite3";
import { sealData } from "iron-session";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

// TSK-217: sesión de prueba sin pasar por Steam.
//
// Decisión deliberada: NO se agrega ningún bypass al código de producción. `proxy.ts` sigue
// exigiendo exactamente la misma cookie que en Railway; acá se sella una válida con el
// `SESSION_SECRET` efímero de esta corrida, igual que haría el callback de OpenID tras verificar
// contra Steam. Si el gate de auth se rompiera, este E2E se caería con él — que es lo que se
// quiere de una prueba de extremo a extremo.
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export default async function globalSetup(): Promise<void> {
  try {
    await run();
  } catch (error) {
    console.error("[e2e] global-setup FALLÓ:", error);
    throw error;
  }
}

async function run(): Promise<void> {
  const password = process.env.E2E_SESSION_SECRET;
  const dbPath = process.env.E2E_DB_PATH;
  const baseUrl = process.env.E2E_BASE_URL;
  if (!password || !dbPath || !baseUrl) {
    throw new Error("global-setup: falta E2E_SESSION_SECRET / E2E_DB_PATH / E2E_BASE_URL (los fija playwright.config.ts)");
  }

  // El accountId se LEE de la base, nunca se escribe en el repo: es un Steam32 real y el proyecto
  // lo trata como dato personal (security.md, Fase 1b) — jamás en un archivo, log o ticket.
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare("select steam_account_id as id from accounts limit 1").get() as { id: number } | undefined;
  db.close();
  if (!row) {
    throw new Error("global-setup: la base de prueba no tiene ninguna cuenta; el E2E necesita una sesión válida.");
  }

  const now = Date.now();
  const sealed = await sealData(
    { accountId: row.id, issuedAt: now, firstLoginAt: now },
    { password, ttl: SESSION_TTL_SECONDS },
  );

  const { host } = new URL(baseUrl);
  writeFileSync(
    resolve("e2e/.tmp/session.json"),
    JSON.stringify({
      cookies: [{
        name: "d2k_session",
        value: sealed,
        domain: host.split(":")[0],
        path: "/",
        expires: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      }],
      origins: [],
    }, null, 2),
  );
}
