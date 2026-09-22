import { expect, test } from "bun:test";
import { playerFacingDegradation } from "./degradation-copy";

// The `detail` strings below are the ones the engine really emits (recommendation/build.ts,
// build-from-perspective.ts, role-impact.ts); web never imports the engine, so they are mirrored here.

test("stale_meta se muestra como 'Datos de meta desactualizados', sin V6/flag/stale_meta", () => {
  const text = playerFacingDegradation({ reason: "stale_meta", detail: "V6 degraded flag: stale_meta" });
  expect(text).toBe("Datos de meta desactualizados");
  expect(text).not.toMatch(/V6|flag|stale_meta/i);
});

test("ningún flag legado del mezclador deja escapar vocabulario interno", () => {
  for (const flag of ["partial_signals", "unconfirmed_state", "unknown_format", "no_signal_available"]) {
    const text = playerFacingDegradation({ reason: flag, detail: `V6 degraded flag: ${flag}` });
    expect(text).not.toBeNull();
    expect(text).not.toMatch(/V6|flag|_/);
  }
});

test("un flag desconocido con detalle interno cae a un texto genérico, nunca al detalle crudo", () => {
  const text = playerFacingDegradation({ reason: "future_flag", detail: "V6 degraded flag: future_flag" });
  expect(text).toBe("Recomendación con datos limitados");
});

test("lista de contradicciones vacía: no hay aviso que mostrar", () => {
  expect(playerFacingDegradation({ reason: "ROLE_ASSIGNMENT_IMPOSSIBLE", detail: "confirmaciones de posición contradictorias: []" })).toBeNull();
});

test("contradicciones reales: texto conciso, sin la representación cruda", () => {
  const detail = 'confirmaciones de posición contradictorias: [{"position":1,"heroIds":[8,67]}]';
  const text = playerFacingDegradation({ reason: "ROLE_ASSIGNMENT_IMPOSSIBLE", detail });
  expect(text).toBe("Hay posiciones confirmadas que se contradicen entre sí");
  expect(text).not.toContain("[");
});

test("contradicciones ilegibles no se ocultan", () => {
  expect(playerFacingDegradation({ reason: "ROLE_ASSIGNMENT_IMPOSSIBLE", detail: "confirmaciones de posición contradictorias: [{" })).toBe("Hay posiciones confirmadas que se contradicen entre sí");
});

test("el otro motivo de ROLE_ASSIGNMENT_IMPOSSIBLE (ya en castellano llano) se conserva", () => {
  expect(playerFacingDegradation({ reason: "ROLE_ASSIGNMENT_IMPOSSIBLE", detail: "más de 5 héroes propios simultáneos" })).toBe("más de 5 héroes propios simultáneos");
});

test("motivos sin traducción propia conservan el detalle del motor (no se calla nada)", () => {
  expect(playerFacingDegradation({ reason: "NO_LEGAL_HERO_UNIVERSE", detail: "ningún héroe legal quedó" })).toBe("ningún héroe legal quedó");
});
