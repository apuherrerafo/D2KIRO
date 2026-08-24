import { expect, test } from "bun:test";
import { extractCandidateFeatures } from "./feature-extractor";
import type { HeroLineProfile } from "../lane/profiles";
import type { DraftState, HeroId } from "../draft/reducer";

// Local builder, autocontenido por archivo (mismo criterio que el resto del motor,
// testing-seams.md): un cambio en otro archivo de test nunca debería poder romper este.
function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.35d",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: new Date(0).toISOString(),
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

// Fixture inyectado, nunca el hero-line-profiles.json real (mismo criterio S9/S10,
// testing-seams.md): la lógica de mapeo/filtrado no puede depender de qué héroes existan hoy en
// la curación real de Fase 6.
const FIXTURE_PROFILES = new Map<HeroId, HeroLineProfile>([
  [1, { heroId: 1, sustain: 0.3, killPressure: 0.2, harassRange: 0.1, dispelSave: 0.1, creepControl: 0.6 }],
  [2, { heroId: 2, sustain: 0.4, killPressure: 0.6, harassRange: 0.2, dispelSave: 0.3, creepControl: 0.3 }],
]);

test("mapea candidatos con perfil activo -- valores exactos del fixture inyectado", () => {
  const result = extractCandidateFeatures(draftState(), [1, 2], FIXTURE_PROFILES);

  expect(result.get(1)).toEqual(FIXTURE_PROFILES.get(1));
  expect(result.get(2)).toEqual(FIXTURE_PROFILES.get(2));
  expect(result.size).toBe(2);
});

test("omite candidatos sin perfil -- nunca undefined en el mapa resultante", () => {
  const result = extractCandidateFeatures(draftState(), [1, 999], FIXTURE_PROFILES);

  expect(result.has(999)).toBe(false);
  expect(result.size).toBe(1);
  expect([...result.values()].every((p) => p !== undefined)).toBe(true);
});

test("pool de candidatos vacío -> Map vacío, sin lanzar", () => {
  const result = extractCandidateFeatures(draftState(), [], FIXTURE_PROFILES);
  expect(result.size).toBe(0);
});

test("un candidato baneado o pickeado en state se excluye aunque tenga perfil y esté en candidates", () => {
  const state = draftState({ banned: [1], picks: { radiant: [2], dire: [] } });
  const result = extractCandidateFeatures(state, [1, 2], FIXTURE_PROFILES);

  expect(result.size).toBe(0);
});

test("solo excluye al héroe efectivamente baneado/pickeado, el resto del pool sigue vivo", () => {
  const state = draftState({ banned: [1] });
  const result = extractCandidateFeatures(state, [1, 2], FIXTURE_PROFILES);

  expect(result.has(1)).toBe(false);
  expect(result.get(2)).toEqual(FIXTURE_PROFILES.get(2));
});

// Smoke test contra el archivo real (parámetro `profiles` por defecto) -- estructural, no de
// contenido (S9/S10): confirma que el contrato se respeta sin acoplarse a qué héroes estén
// curados hoy en hero-line-profiles.json.
test("con el archivo real (sin fixture inyectado) no lanza y respeta la forma del contrato", () => {
  const result = extractCandidateFeatures(draftState(), [1, 2, 3, 999999]);

  for (const [heroId, profile] of result) {
    expect(profile.heroId).toBe(heroId);
  }
});
