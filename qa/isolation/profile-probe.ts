// Sonda de la prueba de aislamiento: imprime el perfil completo de la matriz del QA aislado y cuantas claves ve el motor en cada JSON curado.
// Vive FUERA de qa/invariants/ a proposito: importa el JSON curado del Coach (dato, no logica de decision) solo para contar sus claves, y
// `oracle-independence.test.ts` prohibe cualquier import desde coach/** bajo qa/invariants/**. Se ejecuta en un subproceso: `bun [--preload empty-counters.preload.ts] profile-probe.ts`.
import { enumerateScenarios, createFixtureRoutes, runScenario } from "../scenarios/generate";
import { matrixProfile } from "../invariants/matrix-coverage";
import counters from "../../apps/engine/src/signals/hero-counters.json";
import synergies from "../../apps/engine/src/signals/hero-synergies.json";
import positions from "../../apps/engine/src/signals/hero-positions.json";
import approved from "../../apps/engine/src/coach/advertir-approved.json";

const matrix: { scenarioId: string; checkpoints: Awaited<ReturnType<typeof runScenario>>["checkpoints"] }[] = [];
for (const spec of enumerateScenarios()) {
  const { store, routes } = createFixtureRoutes();
  const result = await runScenario(routes, store, spec);
  matrix.push({ scenarioId: spec.id, checkpoints: result.checkpoints });
}
const keys = (value: unknown): number => Object.keys(value as Record<string, unknown>).length;
console.log(`ISOLATION_PROBE ${JSON.stringify({ seen: { counters: keys(counters), synergies: keys(synergies), positions: keys(positions), approved: keys(approved) }, profile: matrixProfile(matrix) })}`);
