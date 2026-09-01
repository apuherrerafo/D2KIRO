import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

// TSK-217: hasta acá, NINGÚN test del proyecto abría la app real. El harness de Fase 9 mide el
// motor offline con 2.164 replays y dice la verdad sobre el motor — pero el bug de TSK-214 vivió
// semanas en la capa de transporte, donde ninguna métrica miraba. Esto es el lazo que faltaba.

const ENGINE_PORT = 4100; // no 4000: no puede chocar con un `bun run dev` abierto del usuario
const WEB_PORT = 3100;

// Secretos SOLO de este proceso de prueba, generados en runtime. Nunca literales en el repo
// (`verify-simplicity.sh` §2 lo bloquea, y con razón).
//
// El guardado en `process.env` NO es cosmético: Playwright vuelve a importar este archivo en cada
// worker, y los workers heredan el entorno del proceso principal. Sin reutilizar los valores ya
// fijados, cada worker generaría secretos distintos de los que recibió el servidor web, y la
// cookie sellada dejaría de abrirse.
const SESSION_SECRET = process.env.E2E_SESSION_SECRET ?? randomBytes(32).toString("hex");
const INTERNAL_AUTH_SECRET = process.env.E2E_INTERNAL_AUTH_SECRET ?? randomBytes(32).toString("hex");

// El E2E jamás escribe sobre la base de desarrollo: corre sobre una copia desechable.
const SOURCE_DB = resolve("apps/engine/data/dota2coach.sqlite");
const TMP_DIR = resolve("e2e/.tmp");
const E2E_DB = resolve(TMP_DIR, "e2e.sqlite");

// Misma razón que arriba, con una consecuencia peor: este bloque borra y recrea `e2e/.tmp`. Al
// re-importarse en un worker se llevaba puesta la cookie que `global-setup` acababa de escribir,
// y el test moría con "Error reading storage state". La preparación corre UNA sola vez.
if (!process.env.E2E_PREPARED) {
  if (!existsSync(SOURCE_DB)) {
    throw new Error(
      `No existe ${SOURCE_DB}. El E2E necesita la base de desarrollo con meta sincronizada ` +
      "(héroes + patchStats); corré el motor y sincronizá el meta antes.",
    );
  }
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  copyFileSync(SOURCE_DB, E2E_DB);
  // WAL: sin estos dos, la copia puede quedar sin las escrituras más recientes.
  for (const suffix of ["-wal", "-shm"]) {
    if (existsSync(SOURCE_DB + suffix)) copyFileSync(SOURCE_DB + suffix, E2E_DB + suffix);
  }
  process.env.E2E_PREPARED = "1";
}

// El global setup necesita los mismos valores para sellar la cookie de sesión.
process.env.E2E_SESSION_SECRET = SESSION_SECRET;
process.env.E2E_INTERNAL_AUTH_SECRET = INTERNAL_AUTH_SECRET;
process.env.E2E_DB_PATH = E2E_DB;
process.env.E2E_BASE_URL = `http://127.0.0.1:${WEB_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  // Un draft completo con sus pausas de revelación tarda; el default de 30 s no alcanza. Pero
  // tampoco conviene pasarse: medido, el caso verde tarda ~11 s y el caso roto (transporte caído)
  // sólo consume timeouts. Con 120 s un fallo se ve en minutos, no en un cuarto de hora.
  timeout: 240_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    storageState: "e2e/.tmp/session.json",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "bun run src/index.ts",
      cwd: "apps/engine",
      port: ENGINE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ENGINE_PORT: String(ENGINE_PORT),
        ENGINE_DB_PATH: E2E_DB,
        INTERNAL_AUTH_SECRET,
      },
    },
    {
      // Build de producción, no `next dev`, por dos razones concretas:
      //  1. Bajo `next dev` la app NO hidrata en este entorno — medido: ni el botón "Generar"
      //     cambia la semilla ni un chip de intención se marca. Sin hidratación no hay E2E.
      //  2. Es lo que corre en Railway. Un smoke que valida algo distinto de lo que se despliega
      //     vale bastante menos.
      command: `npx next build && npx next start -p ${WEB_PORT}`,
      cwd: "apps/web",
      port: WEB_PORT,
      reuseExistingServer: false,
      timeout: 420_000,
      env: {
        ENGINE_INTERNAL_URL: `http://127.0.0.1:${ENGINE_PORT}`,
        SESSION_SECRET,
        INTERNAL_AUTH_SECRET,
        // Directorio de build propio: no choca con el `next dev` del desarrollador ni le pisa
        // su `.next` (Next admite un solo servidor de desarrollo por directorio de build).
        NEXT_DIST_DIR: ".next-e2e",
      },
    },
  ],
});
