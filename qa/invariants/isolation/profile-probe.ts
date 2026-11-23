// Sonda de la prueba de aislamiento (R3.3): imprime el perfil completo de la matriz del QA aislado y lo que el motor ve como `hero-counters.json`.
// Se ejecuta en un subproceso: `bun [--preload empty-counters.preload.ts] profile-probe.ts`.
import { enumerateScenarios, createFixtureRoutes, runScenario } from "../../scenarios/generate";
import { matrixProfile } from "../matrix-coverage";
import engineSeenCounters from "../../../apps/engine/src/signals/hero-counters.json";

const matrix: { scenarioId: string; checkpoints: Awaited<ReturnType<typeof runScenario>>["checkpoints"] }[] = [];
for (const spec of enumerateScenarios()) {
  const { store, routes } = createFixtureRoutes();
  const result = await runScenario(routes, store, spec);
  matrix.push({ scenarioId: spec.id, checkpoints: result.checkpoints });
}
console.log(`ISOLATION_PROBE ${JSON.stringify({ engineSeenKeys: Object.keys(engineSeenCounters as Record<string, unknown>).length, profile: matrixProfile(matrix) })}`);
