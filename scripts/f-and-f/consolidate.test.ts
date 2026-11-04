// Fixtures SINTÉTICOS inline (no son veredictos humanos): solo prueban la lógica de agregación y validación.
import { expect, test } from "bun:test";
import type { StateRecord } from "../wave5/driver";
import { assertLegal, shuffledOrder } from "./build-kit";
import { consolidate, kitSha, renderMarkdown, strictMajority, validateDecision, validateInvestigations, validateResult, type EvalResult, type Investigation, type ScenarioDoc } from "./consolidate";

const DOC: ScenarioDoc = {
  schema: "ff-scenarios/v1",
  count: 2,
  scenarios: [
    { id: "S01", top5: [1, 2, 3, 4, 5].map((rank) => ({ rank, heroId: 100 + rank, name: `H${rank}` })) },
    { id: "S02", top5: [1, 2, 3, 4, 5].map((rank) => ({ rank, heroId: 200 + rank, name: `G${rank}` })) },
  ],
};
const SHA = kitSha(JSON.stringify(DOC) + "\n");

type ItemOverrides = Record<string, Partial<EvalResult["items"][number]>>;
type ScenarioOverrides = Record<string, Partial<EvalResult["scenarios"][number]>>;
function evaluator(name: string, items: ItemOverrides = {}, scenarios: ScenarioOverrides = {}): EvalResult {
  return {
    schema: "ff-eval/v2", scenariosSha256: SHA, evaluator: name, comprehension: { passed: true },
    startedAt: "2000-01-01T00:00:00.000Z", finishedAt: "2000-01-01T00:10:00.000Z",
    items: DOC.scenarios.flatMap((s) => s.top5.map((h) => ({ scenarioId: s.id, rank: h.rank, heroId: h.heroId, hero: h.name, pick: "bueno", explanation: "correcta", position: "ok", reason: "", ...items[`${s.id}#${h.rank}`] }))),
    scenarios: DOC.scenarios.map((s) => ({ scenarioId: s.id, positionChoice: "bien", positionChoiceReason: "", betterPosition: "", missingHero: "", note: "", ...scenarios[s.id] })),
  };
}
const grave = { pick: "error_grave", reason: "pierde la línea contra los dos stuns" };
const three = (a: EvalResult, b: EvalResult, c: EvalResult = evaluator("cleo")): EvalResult[] => [a, b, c];
const inv = (scenarioId: string, rank: number, conclusion: Investigation["conclusion"]): Investigation => ({ scenarioId, rank, conclusion, by: "po", note: "revisado a mano en el simulador" });

test("validateResult: un archivo completo es válido", () => {
  expect(validateResult(evaluator("ana"), DOC, SHA)).toEqual([]);
});

test("validateResult: rechaza otra versión del kit, esquema viejo, falta de comprensión, razón ausente y valores inventados", () => {
  expect(validateResult({ ...evaluator("ana"), scenariosSha256: "b".repeat(64) }, DOC, SHA).join()).toContain("OTRA versión");
  expect(validateResult({ ...evaluator("ana"), schema: "ff-eval/v1" }, DOC, SHA)).toEqual(["esquema desconocido (se esperaba ff-eval/v2)"]);
  expect(validateResult({ ...evaluator("ana"), comprehension: { passed: false } }, DOC, SHA).join()).toContain("comprensión");
  expect(validateResult(evaluator("ana", { "S01#1": { pick: "malo", reason: "" } }), DOC, SHA).join()).toContain("S01#1: falta la razón");
  expect(validateResult(evaluator("ana", { "S02#3": { pick: "genial" } }), DOC, SHA).join()).toContain("S02#3: calidad de pick inválida");
  expect(validateResult(evaluator(""), DOC, SHA).join()).toContain("falta el nombre");
  const partial = evaluator("ana");
  partial.items = partial.items.slice(1);
  expect(validateResult(partial, DOC, SHA).join()).toContain("S01#1: sin evaluar");
});

test("validateResult: los ítems deben coincidir con el kit (héroe, rank entero, existencia) y no repetirse", () => {
  expect(validateResult(evaluator("ana", { "S01#1": { heroId: 999, hero: "ZZZ" } }), DOC, SHA).join()).toContain("el héroe no coincide");
  const stringRank = evaluator("ana");
  (stringRank.items[0] as unknown as { rank: unknown }).rank = "1";
  expect(validateResult(stringRank, DOC, SHA).join()).toContain("no existe en el kit");
  const dup = evaluator("ana");
  dup.items.push({ ...dup.items[0]! });
  expect(validateResult(dup, DOC, SHA).join()).toContain("item repetido");
  const dupScenario = evaluator("ana");
  dupScenario.scenarios.push({ ...dupScenario.scenarios[0]! });
  expect(validateResult(dupScenario, DOC, SHA).join()).toContain("situación repetida");
});

test("la elección de posición dudosa o mala exige razón Y qué posición habría mostrado", () => {
  expect(validateResult(evaluator("ana", {}, { S01: { positionChoice: "mala" } }), DOC, SHA).join()).toContain("falta la razón de la elección");
  expect(validateResult(evaluator("ana", {}, { S01: { positionChoice: "mala", positionChoiceReason: "ya hay tres carries sin mid" } }), DOC, SHA).join()).toContain("habrías mostrado");
  expect(validateResult(evaluator("ana", {}, { S01: { positionChoice: "mala", positionChoiceReason: "ya hay tres carries sin mid", betterPosition: "2" } }), DOC, SHA)).toEqual([]);
  expect(validateResult(evaluator("ana", {}, { S01: { positionChoice: "mala", positionChoiceReason: "ya hay tres carries sin mid", betterPosition: "esperar" } }), DOC, SHA)).toEqual([]);
});

test("strictMajority: solo hay consenso con mayoría estricta; un empate NO elige la peor opinión", () => {
  expect(strictMajority(["bueno", "bueno", "malo"])).toBe("bueno");
  expect(strictMajority(["bueno", "malo"])).toBeNull();
  expect(strictMajority(["bueno", "aceptable", "malo"])).toBeNull();
});

test("0 errores graves sin investigar: UN evaluador que marca error grave basta para REVISAR, aunque los otros lo vean bueno", () => {
  const c = consolidate(three(evaluator("ana", { "S01#4": grave }), evaluator("beto"), evaluator("cleo")), DOC);
  expect(c.totals.gravesAnyUninvestigated).toBe(1);
  expect(c.verdict).toBe("REVISAR");
  expect(c.verdictReasons.join()).toContain("SIN investigar");
});

test("investigar y descartar el error grave lo cierra; confirmarlo BLOQUEA; aceptarlo como limitación deja de bloquear", () => {
  const rs = three(evaluator("ana", { "S01#4": grave }), evaluator("beto"), evaluator("cleo"));
  const discarded = consolidate(rs, DOC, [inv("S01", 4, "descartado")]);
  expect(discarded.totals.gravesAnyUninvestigated).toBe(0);
  expect(discarded.verdict).toBe("REVISAR"); // aún queda el desacuerdo entre evaluadores
  expect(consolidate(rs, DOC, [inv("S01", 4, "confirmado")]).verdict).toBe("BLOQUEA");
  expect(consolidate(rs, DOC, [inv("S01", 4, "limitacion_aceptada")]).verdict).toBe("REVISAR");
});

test("desacuerdo entre evaluadores (bueno vs malo) => REVISAR; NO se asume que la peor opinión es la correcta", () => {
  const c = consolidate(three(evaluator("ana", { "S02#5": { pick: "malo", reason: "se castiga en línea" } }), evaluator("beto"), evaluator("cleo")), DOC);
  const item = c.items.find((i) => i.scenarioId === "S02" && i.rank === 5)!;
  expect(item.disagreement).toBe(true);
  expect(item.consensusPick).toBe("bueno"); // la mayoría manda; la discrepancia se marca, no se promedia hacia abajo
  expect(c.verdict).toBe("REVISAR");
  const tie = consolidate([evaluator("ana", { "S02#5": { pick: "malo", reason: "se castiga en línea" } }), evaluator("beto")], DOC);
  expect(tie.items.find((i) => i.scenarioId === "S02" && i.rank === 5)!.consensusPick).toBe("sin_consenso");
});

test("desacuerdo sobre la POSICIÓN que eligió el coach (bien vs mala) => REVISAR", () => {
  const mala = { positionChoice: "mala", positionChoiceReason: "falta mid y muestra carries", betterPosition: "2" };
  const c = consolidate(three(evaluator("ana", {}, { S01: mala }), evaluator("beto"), evaluator("cleo")), DOC);
  expect(c.scenarios.find((s) => s.scenarioId === "S01")!.disagreement).toBe(true);
  expect(c.verdict).toBe("REVISAR");
});

const approve = { decision: "aprobado_para_beta" as const, by: "po", note: "probado a mano; los hallazgos no bloquean la beta" };

test("modo PO (un solo evaluador): sin errores graves => PENDIENTE_DECISION_PO; solo con la decisión explícita del PO => MVP_OWNER_TESTED", () => {
  const pending = consolidate([evaluator("po")], DOC);
  expect(pending.verdict).toBe("PENDIENTE_DECISION_PO");
  const done = consolidate([evaluator("po")], DOC, [], approve);
  expect(done.verdict).toBe("MVP_OWNER_TESTED");
  expect(done.verdictReasons.join()).toContain("NO certifica calidad estratégica");
  expect(consolidate([evaluator("po")], DOC, [], { ...approve, decision: "no_aprobado" }).verdict).toBe("REVISAR");
});

test("modo PO: la aprobación NO tapa errores graves — sin investigar REVISAR, confirmado BLOQUEA, limitación aceptada permite avanzar", () => {
  const rs = [evaluator("po", { "S01#4": grave })];
  expect(consolidate(rs, DOC, [], approve).verdict).toBe("REVISAR");
  expect(consolidate(rs, DOC, [inv("S01", 4, "confirmado")], approve).verdict).toBe("BLOQUEA");
  expect(consolidate(rs, DOC, [inv("S01", 4, "descartado")], approve).verdict).toBe("MVP_OWNER_TESTED");
  expect(consolidate(rs, DOC, [inv("S01", 4, "limitacion_aceptada")], approve).verdict).toBe("MVP_OWNER_TESTED");
});

test("un coach mediocre no pasa en silencio: los hallazgos no graves se listan en el veredicto y el PO decide a la vista", () => {
  const malo = { pick: "malo", reason: "no encaja con lo que falta" };
  const dudosa = { positionChoice: "dudosa", positionChoiceReason: "otro rol era igual de válido", betterPosition: "sin_opinion" };
  const wrong = { explanation: "incorrecta", reason: "cita una habilidad que no tiene" };
  const c = consolidate([evaluator("po", { "S01#1": malo, "S02#2": wrong }, { S01: dudosa })], DOC);
  expect(c.verdict).toBe("PENDIENTE_DECISION_PO");
  expect(c.verdictReasons.join()).toContain('1 pick(s) del top 3 "malo(s)"');
  expect(c.verdictReasons.join()).toContain("POSICIÓN elegida por el coach en duda");
  expect(c.verdictReasons.join()).toContain('1 explicación(es) "incorrecta(s)"');
  const md = renderMarkdown(c);
  expect(md).toContain("S01 · #1 H1 — pick malo");
  expect(md).toContain("S02 · #2 G2");
});

test("con varios evaluadores el desacuerdo sigue siendo REVISAR (no gana la opinión más dura)", () => {
  expect(consolidate(three(evaluator("ana", { "S02#5": { pick: "malo", reason: "se castiga en línea" } }), evaluator("beto"), evaluator("cleo")), DOC, [], approve).verdict).toBe("REVISAR");
});

test("validateDecision: exige decisión válida, quién y nota", () => {
  expect(validateDecision({ decision: "aprobado_para_beta", by: "po", note: "listo para beta cerrada" })).toEqual({ decision: "aprobado_para_beta", by: "po", note: "listo para beta cerrada" });
  expect(typeof validateDecision({ decision: "sí", by: "po", note: "x" })).toBe("string");
  expect(typeof validateDecision(null)).toBe("string");
});

test("SIN_DATOS sin archivos; y el informe nunca presenta un porcentaje global de acierto", () => {
  expect(consolidate([], DOC).verdict).toBe("SIN_DATOS");
  const md = renderMarkdown(consolidate(three(evaluator("ana"), evaluator("beto")), DOC));
  expect(md).toContain("no un porcentaje de acierto");
  expect(md).not.toMatch(/\d+\s?%/);
});

test("el informe incluye razones con evaluador, quién dudó de la posición y la sospecha solo si se la pasan", () => {
  const mala = { positionChoice: "mala", positionChoiceReason: "falta mid y muestra carries", betterPosition: "2" };
  const rs = three(evaluator("ana", { "S01#2": grave }, { S01: mala }), evaluator("beto"), evaluator("cleo"));
  const md = renderMarkdown(consolidate(rs, DOC), { S01: "carries-sin-mid" });
  expect(md).toContain("SIN INVESTIGAR");
  expect(md).toContain("ana (error_grave/correcta/ok): pierde la línea");
  expect(md).toContain("ana: mala; habría mostrado pos 2 — falta mid");
  expect(md).toContain("carries-sin-mid");
  expect(renderMarkdown(consolidate(rs, DOC))).not.toContain("carries-sin-mid");
});

test("validateInvestigations: exige conclusión válida, quién y una nota", () => {
  expect(validateInvestigations([{ scenarioId: "S01", rank: 4, conclusion: "confirmado", by: "po", note: "reproducido en el simulador" }]).errors).toEqual([]);
  expect(validateInvestigations([{ scenarioId: "S01", rank: 4, conclusion: "quizás", by: "po", note: "x" }]).errors.length).toBe(1);
  expect(validateInvestigations({}).errors.length).toBe(1);
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
