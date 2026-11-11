import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canHighlightAsRecommended, hasLimitedEvidence, isPlannedCandidate } from "./eligibility";
import { recommendationOf } from "@/features/simulator-light/view-model";
import type { TeamCoachBoardData, TeamCoachCandidate } from "./types";

// Fase 4A.2 · reemplaza la garantía que se perdió al permitir dos superficies («una sola implementación»): ahora la regla de elegibilidad tiene UNA definición
// (`eligibility.ts`) y estas pruebas fijan que Live (`TeamCoachBoard`) y el Simulador Light (`simulator-light`) la usan y no la reescriben.
const webRoot = resolve(import.meta.dir, "../..");
const read = (path: string) => readFileSync(resolve(webRoot, path), "utf8");

function card(extra: Partial<TeamCoachCandidate>): TeamCoachCandidate {
  return { heroId: 10, rank: 1, score: null, reasons: [], isPrimary: true, evidenceStrength: "STRONG", ...extra };
}

function boardFor(candidate: TeamCoachCandidate): TeamCoachBoardData {
  return {
    currentDecision: { recommendedPosition: 3, recommendedHeroId: candidate.heroId, targetBasis: "STRATEGIC", reason: "r" },
    positions: [{ position: 3, top: [candidate] }],
  } as unknown as TeamCoachBoardData;
}

function productionFiles(): string[] {
  return Array.from(new Bun.Glob("features/simulator-light/**/*.{ts,tsx}").scanSync({ cwd: webRoot })).filter((file) => !/\.test\./.test(file));
}

describe("eligibility.ts · la regla única", () => {
  test("WEAK: evidencia limitada, ni destacable ni «plan»; STRONG primaria: las dos cosas", () => {
    expect(hasLimitedEvidence(card({ evidenceStrength: "WEAK" }))).toBe(true);
    expect(canHighlightAsRecommended(card({ evidenceStrength: "WEAK" }))).toBe(false);
    expect(isPlannedCandidate(card({ evidenceStrength: "WEAK" }))).toBe(false);
    expect(canHighlightAsRecommended(card({}))).toBe(true);
    expect(isPlannedCandidate(card({}))).toBe(true);
  });
  test("STRONG que no es primaria: se puede destacar si el motor la recomienda, pero no es «plan»", () => {
    expect(canHighlightAsRecommended(card({ isPrimary: false }))).toBe(true);
    expect(isPlannedCandidate(card({ isPrimary: false }))).toBe(false);
  });
});

describe("paridad Live ↔ Simulador Light (misma matriz de casos, mismo veredicto)", () => {
  const cases: Array<{ name: string; candidate: TeamCoachCandidate; highlighted: boolean }> = [
    { name: "STRONG primaria", candidate: card({}), highlighted: true },
    { name: "STRONG no primaria", candidate: card({ isPrimary: false }), highlighted: true },
    { name: "WEAK primaria", candidate: card({ evidenceStrength: "WEAK" }), highlighted: false },
    { name: "WEAK no primaria", candidate: card({ evidenceStrength: "WEAK", isPrimary: false }), highlighted: false },
  ];
  for (const { name, candidate, highlighted } of cases) {
    test(`${name}: el Simulador ${highlighted ? "destaca" : "no destaca"} lo mismo que la regla compartida`, () => {
      expect(canHighlightAsRecommended(candidate)).toBe(highlighted);
      expect(recommendationOf(boardFor(candidate), [3], 3) !== null).toBe(highlighted);
    });
  }
});

describe("ninguna superficie reescribe la regla", () => {
  test("TeamCoachBoard y simulator-light importan eligibility.ts", () => {
    expect(read("features/team-coach/components/TeamCoachBoard.tsx")).toContain('from "../eligibility"');
    expect(read("features/simulator-light/view-model.ts")).toContain('from "@/features/team-coach/eligibility"');
  });
  test("ningún archivo de producción de simulator-light compara evidenceStrength a mano ni mira isPrimary", () => {
    const files = productionFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const source = read(file).replace(/\/\/.*$/gm, "");
      expect({ file, handRolled: /evidenceStrength\s*[!=]==/.test(source) }).toEqual({ file, handRolled: false });
      expect({ file, primaryFlag: /\.isPrimary\b/.test(source) }).toEqual({ file, primaryFlag: false });
    }
  });
  test("el Light no re-rankea ni calcula: sin sort(, reduce( ni Math. (motion.ts, que es geometría de animación, queda fuera)", () => {
    for (const file of productionFiles().filter((entry) => !entry.endsWith("motion.ts"))) {
      const source = read(file).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect({ file, calculates: /\.sort\(|\.reduce\(|Math\./.test(source) }).toEqual({ file, calculates: false });
    }
  });
});
