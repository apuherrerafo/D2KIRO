// Fase 9.0, TSK-206 — ÚNICA prueba que lee el eval/golden/dataset.json REAL.
// Valida la FORMA, nunca el contenido: no comprueba qué héroe está en qué lista, sólo que el
// archivo carga sin rechazos, tiene el volumen mínimo y cubre los contextos/estratos. Excepción
// explícita a la regla S17 (documentada en eval/golden/README.md y ADR-005).

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CURATED_HERO_IDS } from "../../apps/engine/src/signals/curated-hero-ids";
import { GOLDEN_STRATA, loadGoldenDataset } from "./golden";

const DATASET = join(import.meta.dir, "..", "..", "eval", "golden", "dataset.json");

describe("eval/golden/dataset.json — smoke de forma (TSK-206)", () => {
  test("carga sin rechazos y tiene >= 30 casos", () => {
    expect(existsSync(DATASET)).toBe(true);

    // TSK-206 abría `apps/engine/data/dota2coach.sqlite` (dev DB gitignoreada) para el set de
    // héroes -> el test rompía en CI, que no tiene esa SQLite. `CURATED_HERO_IDS` es el snapshot
    // canónico de IDs de héroe, versionado en el repo, sin dependencia de datos locales.
    const { cases, rejected } = loadGoldenDataset(readFileSync(DATASET, "utf-8"), { knownHeroIds: CURATED_HERO_IDS });
    expect(rejected).toHaveLength(0);
    expect(cases.length).toBeGreaterThanOrEqual(30);
  });

  test("cubre los 4 contextos de decisión y al menos 4 estratos", () => {
    const { cases } = loadGoldenDataset(readFileSync(DATASET, "utf-8"));
    const contexts = new Set(cases.map((c) => c.decisionContext));
    for (const ctx of ["team_opening", "blind_second_pick", "response_pick", "closing_pick"]) {
      expect(contexts.has(ctx as never)).toBe(true);
    }
    const strata = new Set(cases.flatMap((c) => c.strata));
    expect(strata.size).toBeGreaterThanOrEqual(4);
    for (const s of strata) expect(GOLDEN_STRATA).toContain(s);
  });

  test("todos los casos tienen excellent no vacío y un why por héroe", () => {
    const { cases } = loadGoldenDataset(readFileSync(DATASET, "utf-8"));
    for (const c of cases) {
      expect(c.labels.excellent.length).toBeGreaterThan(0);
      for (const e of [...c.labels.excellent, ...c.labels.acceptable, ...c.labels.bad]) {
        expect(e.why.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
