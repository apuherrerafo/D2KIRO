import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { parseCurrentDecisionOutput, type CandidateResult, type CurrentDecisionOutput, type TargetBasis } from "../coach-client";
import type { RecommendationSetV2 } from "../protocol-client";
import { CopilotPanel } from "./CopilotPanel";
import { CurrentDecisionPanel } from "./CurrentDecisionPanel";

// Product Semantics Recovery WP3 -- the ONE visual owner of the current human decision.

afterEach(cleanup);

const RANKED: CandidateResult = {
  state: "RANKED",
  targetPosition: 3,
  cards: [
    { heroId: 11, position: 3, rank: 1, score: 30, confidence: "alta", roleStatus: "CONFIRMED_FORCED", badges: [], rationale: "fixture 11", isFromPool: false },
    { heroId: 12, position: 3, rank: 2, score: 20, confidence: "media", roleStatus: "LIKELY", badges: [], rationale: "fixture 12", isFromPool: false },
  ],
  degradations: [],
};

function output(candidates: CandidateResult, targetBasis: TargetBasis = "STRATEGIC", actionablePositions: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5], recommended: 1 | 2 | 3 | 4 | 5 = candidates.targetPosition): CurrentDecisionOutput {
  return {
    schema: "recommendation-output/v4",
    sessionId: "s",
    decision: { kind: "ACTIONABLE", actionablePositions, roundCapacity: 2, targetPosition: recommended, targetBasis, targetRationale: "rationale fixture", viewedPosition: candidates.targetPosition, candidates, personalPoolApplied: false },
    roleBeliefs: { own: [], enemy: [] },
    meta: { round: 1, phase: "PICK_ROUND_1", decisionContext: "team_opening", trigger: "DRAFT_PICKS_STARTED", revision: 1, basedOn: { stateIdentity: "id", evidenceVersion: "v" } },
  };
}

test("STRATEGIC: 'Objetivo recomendado' + 'Ranking para Pos3' con cartas numeradas", () => {
  const view = render(<CurrentDecisionPanel output={output(RANKED)} heroCatalog={new Map()} />);
  expect(view.getByTestId("current-decision-target").textContent).toContain("Objetivo recomendado: Pos3 Offlane");
  expect(view.getByTestId("current-decision-candidates").textContent).toContain("Ranking para Pos3 Offlane");
  expect(view.getAllByTestId("current-decision-card").map((card) => card.getAttribute("data-rank"))).toEqual(["1", "2"]);
  expect(view.getAllByTestId("feedback-thumb-up")).toHaveLength(2); // feedback attaches to the displayed ranked result only
});

test("COHERENCE-005: DETERMINISTIC_DEFAULT nunca usa el texto de objetivo recomendado", () => {
  const view = render(<CurrentDecisionPanel output={output(RANKED, "DETERMINISTIC_DEFAULT")} heroCatalog={new Map()} />);
  const target = view.getByTestId("current-decision-target").textContent ?? "";
  expect(target).toContain("No hay una prioridad estratégica clara");
  expect(target).toContain("Vista inicial sugerida: Pos3 Offlane");
  expect(target).not.toContain("Objetivo recomendado");
  expect(view.queryByTestId("current-decision-viewed")).toBeNull(); // viewing the recommended position: no second notice
});

test("PSR-002: mirando una posición distinta de la recomendada -> 'Coach sugiere PosR' + 'Estás viendo PosV'; el banner de recomendación no cambia", () => {
  const rankedPos5: CandidateResult = { ...RANKED, targetPosition: 5, cards: RANKED.state === "RANKED" ? RANKED.cards.map((card) => ({ ...card, position: 5 as const })) : [] };
  const view = render(<CurrentDecisionPanel output={output(rankedPos5, "DETERMINISTIC_DEFAULT", [1, 2, 3, 4, 5], 1)} heroCatalog={new Map()} />);
  const banner = view.getByTestId("current-decision-target");
  expect(banner.getAttribute("data-target-position")).toBe("1"); // still the Coach's recommendation
  expect(banner.textContent).toContain("Vista inicial sugerida: Pos1");
  const notice = view.getByTestId("current-decision-viewed");
  expect(notice.textContent).toContain("Estás viendo Pos5");
  expect(view.getByTestId("current-decision-coach-suggests").textContent).toBe("Coach sugiere Pos1 Carry");
  expect(view.getByTestId("current-decision-candidates").textContent).toContain("Ranking para Pos5");
  expect(view.getAllByTestId("current-decision-target")).toHaveLength(1); // one recommendation owner
});

test("DETERMINISTIC_DEFAULT con una sola posición: 'Única posición pendiente'", () => {
  const view = render(<CurrentDecisionPanel output={output(RANKED, "DETERMINISTIC_DEFAULT", [3])} heroCatalog={new Map()} />);
  expect(view.getByTestId("current-decision-target").textContent).toContain("Única posición pendiente: Pos3 Offlane");
});

test("COHERENCE-003/004: UNRANKED_POSITIONAL se identifica como sin ranking, sin confianza, sin numeración y sin feedback", () => {
  const unranked: CandidateResult = { state: "UNRANKED_POSITIONAL", targetPosition: 3, alternatives: [{ heroId: 11, position: 3 }, { heroId: 12, position: 3 }], reason: "sin ranking", degradations: [{ reason: "no_signal_available", detail: "V6 degraded flag: no_signal_available" }] };
  const view = render(<CurrentDecisionPanel output={output(unranked, "DETERMINISTIC_DEFAULT")} heroCatalog={new Map()} />);
  const section = view.getByTestId("current-decision-candidates");
  expect(section.getAttribute("data-candidate-state")).toBe("UNRANKED_POSITIONAL");
  expect(section.textContent).toContain("Alternativas posicionales para Pos3 Offlane — sin ranking disponible");
  expect(section.textContent).not.toMatch(/Confianza|Ranking para/);
  expect(view.queryAllByTestId("current-decision-card")).toHaveLength(0);
  expect(view.getAllByTestId("current-decision-alternative")).toHaveLength(2);
  expect(view.queryAllByTestId("feedback-thumb-up")).toHaveLength(0); // no recommendation result to rate
  expect(view.getByTestId("current-decision-degradations").textContent).toContain("Sin señales suficientes para recomendar");
});

test("UNAVAILABLE: 'No hay candidatos disponibles para PosX'", () => {
  const view = render(<CurrentDecisionPanel output={output({ state: "UNAVAILABLE", targetPosition: 3, reason: "nada", degradations: [] }, "DETERMINISTIC_DEFAULT")} heroCatalog={new Map()} />);
  expect(view.getByTestId("current-decision-candidates").textContent).toContain("No hay candidatos disponibles para Pos3 Offlane");
});

test("NO_HUMAN_ACTION (YIELDED): sin objetivo ni candidatos", () => {
  const noAction: CurrentDecisionOutput = { ...output(RANKED), decision: { kind: "NO_HUMAN_ACTION", actionablePositions: [], roundCapacity: 0, reason: "YIELDED" } };
  const view = render(<CurrentDecisionPanel output={noAction} heroCatalog={new Map()} />);
  expect(view.getByTestId("current-decision-no-action").getAttribute("data-reason")).toBe("YIELDED");
  expect(view.queryByTestId("current-decision-target")).toBeNull();
  expect(view.queryByTestId("current-decision-candidates")).toBeNull();
});

const LEGACY_V2: RecommendationSetV2 = {
  schema: "recommendation-set/v2",
  sessionId: "s",
  basedOn: { protocolId: "dota2/ranked-all-pick", stateIdentity: "id", evidenceVersion: "v" },
  decision: { actor: "radiant", actionKind: "PICK", phase: "PICK_ROUND_1", round: 1, step: null, controlledSlots: [{ side: "radiant", slotIndex: 0, position: 1 }, { side: "radiant", slotIndex: 1, position: 2 }], actionCount: 2 },
  recommendations: [],
  degradations: [{ reason: "stale_meta", detail: "V6 degraded flag: stale_meta" }],
  deferred: { opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED" },
  decisionContext: "team_opening",
} as unknown as RecommendationSetV2;

test("COHERENCE-001/010/012: con V4 presente el Copilot NO muestra V3, V2 legacy ni degradaciones de otro ranking", () => {
  const view = render(<CopilotPanel recommendations={LEGACY_V2} currentDecision={output(RANKED)} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getByTestId("current-decision-panel")).toBeDefined();
  expect(view.queryByTestId("coach-panel")).toBeNull();
  expect(view.queryByTestId("round-recommendation-columns")).toBeNull();
  expect(view.queryByTestId("copilot-degradations")).toBeNull();
  expect(view.container.textContent).not.toContain("Datos de meta desactualizados"); // LEGACY_V2's degradation
  expect(view.getAllByTestId("current-decision-target")).toHaveLength(1);
  expect(view.getAllByTestId("current-decision-candidates")).toHaveLength(1);
});

test("borde: una salida V4 con cartas rankeadas junto a un estado UNRANKED es rechazada entera", () => {
  const bad = { ...output(RANKED), decision: { ...output(RANKED).decision, candidates: { state: "UNRANKED_POSITIONAL", targetPosition: 3, alternatives: [{ heroId: 11, position: 3, rank: 1, confidence: "alta" }], reason: "x", degradations: [] } } };
  expect(parseCurrentDecisionOutput(bad)).toBeNull();
  const offTarget = { ...output(RANKED), decision: { ...output(RANKED).decision, candidates: { ...RANKED, cards: [{ ...RANKED.cards[0], position: 5 }] } } };
  expect(parseCurrentDecisionOutput(offTarget)).toBeNull();
  const poolWithoutPersonal = { ...output(RANKED), decision: { ...output(RANKED).decision, candidates: { ...RANKED, cards: [{ ...RANKED.cards[0], isFromPool: true }] } } };
  expect(parseCurrentDecisionOutput(poolWithoutPersonal)).toBeNull();
  expect(parseCurrentDecisionOutput(output(RANKED))).not.toBeNull();
});
