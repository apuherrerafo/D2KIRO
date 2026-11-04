// Fixtures SINTÉTICOS inline (no son veredictos humanos): solo prueban la lógica de agregación y validación.
import { expect, test } from "bun:test";
import type { StateRecord } from "../wave5/driver";
import { assertLegal, shuffledOrder } from "./build-kit";
import { ADVICE_RATINGS, consolidate, modalWorst, PICK_RATINGS, renderMarkdown, validateResult, type EvalResult, type ScenarioDoc } from "./consolidate";

const SHA = "a".repeat(64);
const DOC: ScenarioDoc = {
  schema: "ff-scenarios/v1",
  count: 2,
  scenarios: [
    { id: "S01", top5: [1, 2, 3, 4, 5].map((rank) => ({ rank, heroId: 100 + rank, name: `H${rank}` })) },
    { id: "S02", top5: [1, 2, 3, 4, 5].map((rank) => ({ rank, heroId: 200 + rank, name: `G${rank}` })) },
  ],
};

type Overrides = Record<string, Partial<EvalResult["items"][number]>>;
function evaluator(name: string, overrides: Overrides = {}, advice: Record<string, string> = {}): EvalResult {
  const items = DOC.scenarios.flatMap((s) =>
    s.top5.map((h) => ({ scenarioId: s.id, rank: h.rank, heroId: h.heroId, hero: h.name, pick: "bueno", explanation: "correcta", position: "ok", reason: "", ...overrides[`${s.id}#${h.rank}`] })),
  );
  const scenarios = DOC.scenarios.map((s) => ({ scenarioId: s.id, advice: advice[s.id] ?? "razonable", adviceReason: advice[s.id] ? "no encaja con lo que falta" : "", missingHero: "", note: "" }));
  return { schema: "ff-eval/v1", scenariosSha256: SHA, evaluator: name, startedAt: "2000-01-01T00:00:00.000Z", finishedAt: "2000-01-01T00:10:00.000Z", items, scenarios };
}
const grave = { pick: "error_grave", reason: "pierde la línea contra los dos stuns" };

test("validateResult: un archivo completo es válido", () => {
  expect(validateResult(evaluator("ana"), DOC, SHA)).toEqual([]);
});

test("validateResult: rechaza otra versión del kit, falta de razón, ítems sin evaluar y valores inventados", () => {
  expect(validateResult({ ...evaluator("ana"), scenariosSha256: "b".repeat(64) }, DOC, SHA).join()).toContain("OTRA versión");
  expect(validateResult(evaluator("ana", { "S01#1": { pick: "malo", reason: "" } }), DOC, SHA).join()).toContain("S01#1: falta la razón");
  const partial = evaluator("ana");
  partial.items = partial.items.slice(1);
  expect(validateResult(partial, DOC, SHA).join()).toContain("S01#1: sin evaluar");
  expect(validateResult(evaluator("ana", { "S02#3": { pick: "genial" } }), DOC, SHA).join()).toContain("S02#3: calidad de pick inválida");
  expect(validateResult({ nada: true }, DOC, SHA)).toEqual(["esquema desconocido (se esperaba ff-eval/v1)"]);
  expect(validateResult(evaluator(""), DOC, SHA).join()).toContain("falta el nombre");
});

test("modalWorst: la mayoría manda y el EMPATE se resuelve por la peor etiqueta", () => {
  expect(modalWorst(PICK_RATINGS, ["bueno", "bueno", "malo"])).toBe("bueno");
  expect(modalWorst(PICK_RATINGS, ["bueno", "malo"])).toBe("malo");
  expect(modalWorst(PICK_RATINGS, ["bueno", "malo", "malo"])).toBe("malo");
  expect(modalWorst(ADVICE_RATINGS, ["razonable", "dudoso"])).toBe("dudoso");
});

test("consenso de error grave: mayoría = consenso; una voz sola = discutido, no bloquea por sí sola", () => {
  const three = [evaluator("ana", { "S01#1": grave }), evaluator("beto", { "S01#1": grave }), evaluator("cleo")];
  const c = consolidate(three, DOC);
  const item = c.items.find((i) => i.scenarioId === "S01" && i.rank === 1)!;
  expect(item.graveConsensus).toBe(true);
  expect(item.pick).toBe("error_grave");

  const one = consolidate([evaluator("ana", { "S01#1": grave }), evaluator("beto"), evaluator("cleo")], DOC);
  const disputed = one.items.find((i) => i.scenarioId === "S01" && i.rank === 1)!;
  expect(disputed.graveConsensus).toBe(false);
  expect(disputed.graveDisputed).toBe(true);
  expect(one.verdict).toBe("REVISAR");
});

test("veredicto: PASS limpio, REVISAR con 1 situación grave o 1 solo evaluador, BLOQUEA con 2 situaciones graves, SIN_DATOS sin archivos", () => {
  expect(consolidate([evaluator("ana"), evaluator("beto")], DOC).verdict).toBe("PASS");
  expect(consolidate([evaluator("ana")], DOC).verdict).toBe("REVISAR");
  const oneScenario = { "S01#2": grave };
  expect(consolidate([evaluator("ana", oneScenario), evaluator("beto", oneScenario)], DOC).verdict).toBe("REVISAR");
  const twoScenarios = { "S01#2": grave, "S02#1": grave };
  const blocked = consolidate([evaluator("ana", twoScenarios), evaluator("beto", twoScenarios)], DOC);
  expect(blocked.verdict).toBe("BLOQUEA");
  expect(blocked.totals.scenariosWithGraveTop3).toBe(2);
  expect(consolidate([], DOC).verdict).toBe("SIN_DATOS");
});

test("un error grave fuera del top 3 no cuenta para el bloqueo (pero obliga a REVISAR)", () => {
  const outside = { "S01#5": grave, "S02#4": grave };
  const c = consolidate([evaluator("ana", outside), evaluator("beto", outside)], DOC);
  expect(c.totals.scenariosWithGraveTop3).toBe(0);
  expect(c.verdict).toBe("REVISAR");
});

test("explicaciones incorrectas por consenso sobre el umbral bloquean; el consejo principal malo también", () => {
  const wrong: Overrides = {};
  for (const s of DOC.scenarios) for (const h of s.top5.slice(0, 3)) wrong[`${s.id}#${h.rank}`] = { explanation: "incorrecta", reason: "cita una habilidad que no tiene" };
  expect(consolidate([evaluator("ana", wrong), evaluator("beto", wrong)], DOC).verdict).toBe("BLOQUEA");
  const advice = consolidate([evaluator("ana", {}, { S01: "malo", S02: "malo" }), evaluator("beto", {}, { S01: "malo", S02: "malo" })], DOC);
  expect(advice.totals.badAdviceScenarios).toBe(2); // 2 < umbral 3: no bloquea por sí solo
  expect(advice.verdict).toBe("PASS");
});

test("el informe incluye razones con evaluador y recomendación, y la sospecha solo si se la pasan (organizadores)", () => {
  const md = renderMarkdown(consolidate([evaluator("ana", { "S01#2": grave }), evaluator("beto", { "S01#2": grave })], DOC), { S01: "carries-sin-mid" });
  expect(md).toContain("ERROR GRAVE por consenso");
  expect(md).toContain("ana (error_grave/correcta/ok): pierde la línea");
  expect(md).toContain("carries-sin-mid");
  expect(renderMarkdown(consolidate([evaluator("ana")], DOC))).not.toContain("carries-sin-mid");
});

function stateWithShortlist(banned: number[], own: number[], enemy: number[], shortlist: number[]): StateRecord {
  const output = { shortlist: shortlist.map((heroId) => ({ heroId, position: 1, roleStatus: "LIKELY", confidence: "media", badges: [], rationale: "x" })) };
  return { index: 0, banned, ownPicks: own, revealedEnemy: enemy, raw: JSON.stringify({ output }) } as unknown as StateRecord;
}

test("build-kit: una recomendación ilegal (baneado, ya elegido o repetido) ABORTA la generación", () => {
  expect(() => assertLegal(stateWithShortlist([9], [8], [7], [1, 2, 3, 4, 5]))).not.toThrow();
  expect(() => assertLegal(stateWithShortlist([3], [], [], [1, 2, 3, 4, 5]))).toThrow("ILEGAL");
  expect(() => assertLegal(stateWithShortlist([], [2], [], [1, 2, 3, 4, 5]))).toThrow("ILEGAL");
  expect(() => assertLegal(stateWithShortlist([], [], [5], [1, 2, 3, 4, 5]))).toThrow("ILEGAL");
  expect(() => assertLegal(stateWithShortlist([], [], [], [1, 2, 2, 4, 5]))).toThrow("repetido");
});

test("build-kit: el orden de presentación es estable y no sigue el orden de cobertura", () => {
  const ids = ["E1", "E2", "E3", "C1", "C2", "C3", "N1", "N2", "R1", "R2", "R3", "L1", "L2", "L3", "L4"];
  expect(shuffledOrder(ids)).toEqual(shuffledOrder([...ids].reverse()));
  expect(shuffledOrder(ids)).not.toEqual(ids);
  expect([...shuffledOrder(ids)].sort()).toEqual([...ids].sort());
});
