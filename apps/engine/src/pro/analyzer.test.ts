import { expect, test } from "bun:test";
import { analyzeCandidate, analyzeDraft } from "./analyzer";
import type { ProQueryContext } from "./query";
import type { SignalContribution } from "../signals/types";

const context: ProQueryContext = { patch: "7.41e", observedBans: [20], confirmedAllies: [10], revealedRivals: [30], targetPosition: 5, currentTurn: 6 };
const signal = (value: number | null, applicable?: boolean): SignalContribution => ({ signal: "counter", raw: value, weighted: value ?? 0, explanation: "fixture", sampleSize: value === null ? 0 : 30, ...(applicable === undefined ? {} : { applicable }) });

test("registra señales usadas y ausentes con motivos distintos", () => {
  const report = analyzeCandidate({ heroId: 1, score: 72, signals: [signal(.4), signal(null), signal(null, false)], discardedReason: "fuera del top" });
  expect(report.signalsUsed).toHaveLength(1);
  expect(report.signalsAbsent.map((item) => item.reason)).toEqual(["raw:null — falta de dato", "applicable:false — señal no configurada"]);
  expect(report.discardedReason).toBe("fuera del top");
});

test("el informe conserva contexto completo, evidencia y orden determinista", () => {
  const report = analyzeDraft(context, [
    { heroId: 9, score: 2, signals: [], diagnostic: "sin datos" },
    { heroId: 1, score: 8, signals: [], publicEvidence: [{ kind: "matchup", detail: "fixture" }] },
  ]);
  expect(report.context).toEqual(context);
  expect(report.candidates.map((candidate) => candidate.heroId)).toEqual([1, 9]);
  expect(report.candidates[0]?.publicEvidence[0]?.kind).toBe("matchup");
});
