import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { bootstrapE2eDatabase } from "./e2e/bootstrap-db";
import { buildFixtureCmEligibilitySnapshot } from "./e2e/fixtures/cm-eligibility";
import { FIXTURE_HERO_IDS } from "./e2e/fixtures/hero-catalog";

// TSK-217: hasta acá, NINGÚN test del proyecto abría la app real. El harness de Fase 9 mide el
// motor offline con 2.164 replays y dice la verdad sobre el motor — pero el bug de TSK-214 vivió
// semanas en la capa de transporte, donde ninguna métrica miraba. Esto es el lazo que faltaba.
//
// R1 S7 (Blocker 1): el E2E ya no depende de la base de desarrollo del owner (que exigía un login
// real de Steam previo -- ver e2e/bootstrap-db.ts). Corre sobre una base temporal, determinista,
// construida desde las migraciones reales + un catálogo de héroes fijo, reproducible en un
// checkout limpio o en CI sin ningún paso manual.

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

const TMP_DIR = resolve("e2e/.tmp");
const E2E_DB = resolve(TMP_DIR, "e2e.sqlite");
const CM_ELIGIBILITY_PATH = resolve(TMP_DIR, "cm-hero-eligibility.json");

// Misma razón que arriba: este bloque recrea `e2e/.tmp` UNA sola vez por corrida. Re-ejecutarlo
// en cada worker borraría la cookie que `global-setup` acaba de escribir ("Error reading storage
// state") y reconstruiría la base a mitad de una corrida en curso.
if (!process.env.E2E_PREPARED) {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });
  bootstrapE2eDatabase(E2E_DB);
  // Captain's Mode es fail-closed sin un artefacto de elegibilidad certificado server-side (no hay
  // depot real de Dota 2 en este entorno -- ver e2e/fixtures/cm-eligibility.ts). Mismo mecanismo
  // que produccion usaría (CM_ELIGIBILITY_ARTIFACT_PATH -> loadTrustedEligibilityArtifact), leído
  // únicamente por apps/engine/src/index.e2e.ts (nunca por index.ts, el entrypoint real de
  // Railway/"start"/"dev") -- ver el webServer.command de abajo (R1 S7, Blocker 1).
  writeFileSync(CM_ELIGIBILITY_PATH, JSON.stringify(buildFixtureCmEligibilitySnapshot(FIXTURE_HERO_IDS)));
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
      // R1 S7 (final blocker repair, Blocker 1): index.e2e.ts, NOT index.ts -- a structurally
      // separate file that Railway/`apps/engine`'s "start"/"dev" scripts never reference. It
      // hardcodes `allowClientForcedBotSelection: true` itself (not from an env var); the only
      // thing this config still passes by env is CM_ELIGIBILITY_ARTIFACT_PATH, which index.e2e.ts
      // reads -- index.ts does not, so this variable is inert for every process that file starts.
      command: "bun run src/index.e2e.ts",
      cwd: "apps/engine",
      port: ENGINE_PORT,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        ENGINE_PORT: String(ENGINE_PORT),
        ENGINE_DB_PATH: E2E_DB,
        INTERNAL_AUTH_SECRET,
        CM_ELIGIBILITY_ARTIFACT_PATH: CM_ELIGIBILITY_PATH,
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
