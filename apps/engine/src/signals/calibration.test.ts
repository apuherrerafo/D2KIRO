import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FALLBACK_RAW_RANGE,
  calibratedNormalize,
  enrich,
  evidenceConfidenceOf,
  loadCalibration,
  parseCalibration,
  type Calibration,
} from "./calibration";
import type { SignalContribution } from "./types";

// Costura S18 (testing-seams.md): ninguna prueba lee `data/generated/percentiles.json` real --
// fixtures sintéticos inline o un archivo temporal escrito por el test. Ese archivo se regenera
// por parche; un test atado a sus números se rompería en silencio con cada regeneración.

function contribution(over: Partial<SignalContribution>): SignalContribution {
  return { signal: "counter", raw: 0, weighted: 0, explanation: "", sampleSize: 0, ...over };
}

const VALID_FIXTURE = {
  schemaVersion: 1 as const,
  trainSplitHash: "deadbeef",
  corpusPatchOverride: "7.41e",
  signals: {
    counter: { global: { p05: -0.04, p95: 0.06, n: 47466 } },
    position_fit: { global: { p05: 0, p95: 1, n: 66615 } },
    hero_pool_fit: null,
    archetype_fit: null,
  },
};

// ---------- parseCalibration / loadCalibration : validación de borde ----------

test("parseCalibration acepta un fixture válido y expone sólo las señales con banda utilizable", () => {
  const cal = parseCalibration(VALID_FIXTURE);
  expect(cal.source).toBe("percentiles.json");
  expect(cal.signals.counter?.global).toEqual({ p05: -0.04, p95: 0.06, n: 47466 });
  expect(cal.signals.position_fit?.global).toEqual({ p05: 0, p95: 1, n: 66615 });
  // `null` en el archivo -> la señal no queda calibrada (cae a RAW_RANGE en el motor).
  expect(cal.signals.hero_pool_fit).toBeUndefined();
  expect(cal.signals.archetype_fit).toBeUndefined();
});

test("parseCalibration degrada a Calibration vacía ante forma inesperada, sin lanzar", () => {
  for (const bad of [null, 42, "nope", [], {}, { schemaVersion: 2, signals: {} }, { schemaVersion: 1 }, { schemaVersion: 1, signals: null }]) {
    const cal = parseCalibration(bad);
    expect(cal.source).toBe("fallback");
    expect(cal.signals).toEqual({});
  }
});

test("parseCalibration descarta bandas con p05 >= p95, NaN, o no numéricas (y señales desconocidas)", () => {
  const cal = parseCalibration({
    schemaVersion: 1,
    signals: {
      counter: { global: { p05: 0.2, p95: 0.1, n: 10 } }, // invertida
      patch_meta: { global: { p05: Number.NaN, p95: 0.5, n: 10 } }, // NaN
      team_synergy: { global: { p05: "0", p95: "1", n: 10 } }, // no numérica
      position_fit: { global: { p05: 0.1, p95: 0.9, n: 100 } }, // única válida
      not_a_signal: { global: { p05: 0, p95: 1, n: 10 } }, // clave desconocida
    },
  });
  expect(Object.keys(cal.signals)).toEqual(["position_fit"]);
  expect(cal.source).toBe("percentiles.json");
});

test("parseCalibration: si ninguna señal queda utilizable -> Calibration vacía", () => {
  const cal = parseCalibration({ schemaVersion: 1, signals: { counter: { global: { p05: 1, p95: 1, n: 5 } } } });
  expect(cal.source).toBe("fallback");
  expect(cal.signals).toEqual({});
});

test("loadCalibration con archivo ausente o JSON corrupto -> Calibration vacía, cero excepción", () => {
  expect(() => loadCalibration("/no/existe/percentiles.json")).not.toThrow();
  expect(loadCalibration("/no/existe/percentiles.json").source).toBe("fallback");

  const dir = mkdtempSync(join(tmpdir(), "d2k-cal-"));
  try {
    const broken = join(dir, "broken.json");
    writeFileSync(broken, "{ not json ");
    expect(loadCalibration(broken).source).toBe("fallback");

    const good = join(dir, "good.json");
    writeFileSync(good, JSON.stringify(VALID_FIXTURE));
    expect(loadCalibration(good).signals.counter?.global?.p95).toBe(0.06);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- calibratedNormalize : byBracket -> global -> RAW_RANGE ----------

test("calibratedNormalize usa la banda global calibrada cuando existe", () => {
  const cal = parseCalibration(VALID_FIXTURE);
  // counter global [-0.04, 0.06]: raw 0.01 -> (0.01 - -0.04)/(0.06 - -0.04) * 100 = 50
  expect(calibratedNormalize("counter", 0.01, null, cal)).toBeCloseTo(50, 6);
  // clamp: raw por encima de p95 satura a 100
  expect(calibratedNormalize("counter", 0.5, null, cal)).toBe(100);
  expect(calibratedNormalize("counter", -0.5, null, cal)).toBe(0);
});

test("calibratedNormalize prefiere byBracket[bracket] sobre global", () => {
  const cal = parseCalibration({
    schemaVersion: 1,
    signals: {
      counter: {
        global: { p05: -0.04, p95: 0.06, n: 100 },
        byBracket: { herald: { p05: 0, p95: 0.1, n: 40 } },
      },
    },
  });
  // con bracket herald: (0.05 - 0)/(0.1 - 0) * 100 = 50
  expect(calibratedNormalize("counter", 0.05, "herald", cal)).toBeCloseTo(50, 6);
  // bracket sin entrada -> cae a global
  expect(calibratedNormalize("counter", 0.01, "divine", cal)).toBeCloseTo(50, 6);
  // sin bracket -> global
  expect(calibratedNormalize("counter", 0.01, null, cal)).toBeCloseTo(50, 6);
});

test("calibratedNormalize cae a FALLBACK_RAW_RANGE para señales sin calibración y con Calibration vacía", () => {
  const empty: Calibration = { schemaVersion: 1, source: "fallback", signals: {} };
  const cal = parseCalibration(VALID_FIXTURE); // no calibra patch_meta

  // Réplica exacta de normalize() de mix.ts con RAW_RANGE.
  const normalizeLegacy = (signal: Parameters<typeof calibratedNormalize>[0], raw: number): number => {
    const [min, max] = FALLBACK_RAW_RANGE[signal];
    const clamped = Math.min(max, Math.max(min, raw));
    return ((clamped - min) / (max - min)) * 100;
  };

  for (const raw of [-0.3, -0.05, 0, 0.05, 0.3]) {
    expect(calibratedNormalize("counter", raw, null, empty)).toBe(normalizeLegacy("counter", raw));
    expect(calibratedNormalize("patch_meta", raw + 0.5, null, cal)).toBe(normalizeLegacy("patch_meta", raw + 0.5));
  }
  // FALLBACK_RAW_RANGE es el espejo de mix.ts:RAW_RANGE.
  expect(FALLBACK_RAW_RANGE.counter).toEqual([-0.12, 0.12]);
  expect(FALLBACK_RAW_RANGE.patch_meta).toEqual([0.3, 0.7]);
});

// ---------- evidenceConfidenceOf / enrich ----------

test("evidenceConfidenceOf: raw null -> 0; categóricas -> 1; estadísticas -> sampleSize/(sampleSize+K)", () => {
  expect(evidenceConfidenceOf(contribution({ signal: "counter", raw: null }))).toBe(0);
  expect(evidenceConfidenceOf(contribution({ signal: "team_synergy", raw: 0.5, sampleSize: 0 }))).toBe(1);
  expect(evidenceConfidenceOf(contribution({ signal: "hero_pool_fit", raw: null }))).toBe(0);
  expect(evidenceConfidenceOf(contribution({ signal: "archetype_fit", raw: 0.7, sampleSize: 0 }))).toBe(1);

  // counter K=20
  expect(evidenceConfidenceOf(contribution({ signal: "counter", raw: 0.02, sampleSize: 20 }))).toBeCloseTo(0.5, 6);
  // position_fit K=200
  expect(evidenceConfidenceOf(contribution({ signal: "position_fit", raw: 0.4, sampleSize: 200 }))).toBeCloseTo(0.5, 6);
  // patch_meta K=200: sampleSize grande -> cerca de 1
  expect(evidenceConfidenceOf(contribution({ signal: "patch_meta", raw: 0.5, sampleSize: 4000 }))).toBeGreaterThan(0.95);
  // sampleSize chico -> bajo
  expect(evidenceConfidenceOf(contribution({ signal: "position_fit", raw: 0.4, sampleSize: 5 }))).toBeLessThan(0.05);
});

test("enrich agrega normalized (null si raw es null) y evidenceConfidence sin tocar los demás campos", () => {
  const cal = parseCalibration(VALID_FIXTURE);

  const withData = enrich(contribution({ signal: "counter", raw: 0.01, sampleSize: 60, explanation: "x", weighted: 0 }), null, cal);
  expect(withData.normalized).toBeCloseTo(50, 6);
  expect(withData.evidenceConfidence).toBeCloseTo(60 / 80, 6);
  expect(withData.explanation).toBe("x");
  expect(withData.raw).toBe(0.01);

  const noData = enrich(contribution({ signal: "counter", raw: null, sampleSize: 0 }), null, cal);
  expect(noData.normalized).toBeNull();
  expect(noData.evidenceConfidence).toBe(0);
});

// ---------- smoke: el archivo real carga y es válido (estructural, no de contenido) ----------

test("loadCalibration() carga el percentiles.json real sin lanzar y con forma válida", () => {
  const cal = loadCalibration();
  expect(cal.schemaVersion).toBe(1);
  for (const sig of Object.values(cal.signals)) {
    if (sig?.global) {
      expect(sig.global.p05).toBeLessThan(sig.global.p95);
      expect(Number.isFinite(sig.global.p05)).toBe(true);
      expect(Number.isFinite(sig.global.p95)).toBe(true);
    }
  }
});
