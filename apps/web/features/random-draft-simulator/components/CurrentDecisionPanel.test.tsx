import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import { parseCurrentDecisionOutput, type CandidateResult, type CardBasis, type CardRisk, type CurrentDecisionOutput, type TargetBasis } from "../coach-client";
import type { RecommendationSetV2 } from "../protocol-client";
import { CopilotPanel } from "./CopilotPanel";
import { CurrentDecisionPanel } from "./CurrentDecisionPanel";

// Product Semantics Recovery WP3 -- the ONE visual owner of the current human decision.

afterEach(cleanup);

const STATISTICAL_BASIS: CardBasis = { kind: "statistical", sources: [{ kind: "statistical", sampleSize: 120 }] };

const RANKED: CandidateResult = {
  state: "RANKED",
  targetPosition: 3,
  cards: [
    { heroId: 11, position: 3, rank: 1, score: 30, confidence: "alta", roleStatus: "CONFIRMED_FORCED", badges: [], rationale: "fixture 11", isFromPool: false, poolMembership: "NO_POOL", basis: STATISTICAL_BASIS, risks: [] },
    { heroId: 12, position: 3, rank: 2, score: 20, confidence: "media", roleStatus: "LIKELY", badges: [], rationale: "fixture 12", isFromPool: false, poolMembership: "NO_POOL", basis: STATISTICAL_BASIS, risks: [] },
  ],
  degradations: [],
};

function output(candidates: CandidateResult, targetBasis: TargetBasis = "STRATEGIC", actionablePositions: (1 | 2 | 3 | 4 | 5)[] = [1, 2, 3, 4, 5], recommended: 1 | 2 | 3 | 4 | 5 = candidates.targetPosition): CurrentDecisionOutput {
  return {
    schema: "recommendation-output/v4",
    sessionId: "s",
    decision: { kind: "ACTIONABLE", actionablePositions, roundCapacity: 2, targetPosition: recommended, targetBasis, targetRationale: "rationale fixture", viewedPosition: candidates.targetPosition, candidates, personalPoolApplied: false, poolState: "NONE", poolOwner: null },
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

function withPool(owner: "PLAYER" | "TEAMMATE", memberships: ("IN_POOL" | "OUTSIDE_POOL")[], poolState: "ACTIVE" | "EXHAUSTED" = "ACTIVE"): CurrentDecisionOutput {
  const base = output(RANKED);
  if (base.decision.kind !== "ACTIONABLE" || base.decision.candidates.state !== "RANKED") throw new Error("fixture");
  const cards = base.decision.candidates.cards.map((card, index) => ({ ...card, poolMembership: memberships[index]!, isFromPool: memberships[index] === "IN_POOL" }));
  return { ...base, decision: { ...base.decision, poolState, poolOwner: owner, candidates: { ...base.decision.candidates, cards } } };
}

test("Hero Pools V2: el pool de un compañero NUNCA se rotula 'Tu pool'; se rotula como del compañero, y lo de fuera, fuera", () => {
  const view = render(<CurrentDecisionPanel output={withPool("TEAMMATE", ["IN_POOL", "OUTSIDE_POOL"])} heroCatalog={new Map()} />);
  expect(view.getByTestId("current-decision-pool-badge").textContent).toBe("Pool del compañero");
  expect(view.getByTestId("current-decision-outside-pool-badge").textContent).toBe("Fuera del pool del compañero");
  expect(view.container.textContent).not.toContain("Tu pool");
});

test("Hero Pools V2: el pool del propio jugador sí es 'Tu pool'; sin pool no hay ni 'dentro' ni 'fuera'", () => {
  const own = render(<CurrentDecisionPanel output={withPool("PLAYER", ["IN_POOL", "OUTSIDE_POOL"])} heroCatalog={new Map()} />);
  expect(own.getByTestId("current-decision-pool-badge").textContent).toBe("Tu pool");
  expect(own.getByTestId("current-decision-outside-pool-badge").textContent).toBe("Fuera de tu pool");
  cleanup();
  const none = render(<CurrentDecisionPanel output={output(RANKED)} heroCatalog={new Map()} />);
  expect(none.queryByTestId("current-decision-pool-badge")).toBeNull();
  expect(none.queryByTestId("current-decision-outside-pool-badge")).toBeNull();
});

test("Hero Pools V2: un pool agotado deja las alternativas creíbles, todas rotuladas fuera del pool", () => {
  const view = render(<CurrentDecisionPanel output={withPool("TEAMMATE", ["OUTSIDE_POOL", "OUTSIDE_POOL"], "EXHAUSTED")} heroCatalog={new Map()} />);
  expect(view.getAllByTestId("current-decision-outside-pool-badge")).toHaveLength(2);
  expect(view.queryByTestId("current-decision-pool-badge")).toBeNull();
});

test("Hero Pools V2: la validación rechaza etiquetas deshonestas (NO_POOL con un pool activo, o un dueño sin estado)", () => {
  const lying = withPool("TEAMMATE", ["IN_POOL", "OUTSIDE_POOL"]);
  if (lying.decision.kind !== "ACTIONABLE" || lying.decision.candidates.state !== "RANKED") throw new Error("fixture");
  const noPoolCards = lying.decision.candidates.cards.map((card) => ({ ...card, poolMembership: "NO_POOL", isFromPool: false }));
  expect(parseCurrentDecisionOutput({ ...lying, decision: { ...lying.decision, candidates: { ...lying.decision.candidates, cards: noPoolCards } } })).toBeNull();
  expect(parseCurrentDecisionOutput({ ...lying, decision: { ...lying.decision, poolOwner: null } })).toBeNull();
  expect(parseCurrentDecisionOutput(lying)).not.toBeNull();
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
  // A card claiming a pool when the decision says no pool voted is a contract violation (labels must be honest).
  const poolWithoutPool = { ...output(RANKED), decision: { ...output(RANKED).decision, candidates: { ...RANKED, cards: [{ ...RANKED.cards[0], isFromPool: true, poolMembership: "IN_POOL" }] } } };
  expect(parseCurrentDecisionOutput(poolWithoutPool)).toBeNull();
  const inconsistentFlag = { ...output(RANKED), decision: { ...output(RANKED).decision, candidates: { ...RANKED, cards: [{ ...RANKED.cards[0], isFromPool: true }] } } };
  expect(parseCurrentDecisionOutput(inconsistentFlag)).toBeNull();
  expect(parseCurrentDecisionOutput(output(RANKED))).not.toBeNull();
});

// Greptile PR #9 (P1) -- Simulation (V4) keeps ONE current-action surface: no V3 "TU <POS> AHORA" / "solo tu asiento"
// panel, even if a stale V3 coach (with personalHeroView) were still around -- CopilotPanel returns on V4 first.
test("Simulation / V4: ningún panel personal paralelo ('TU <POS> AHORA' / 'solo tu asiento')", () => {
  const staleV3 = { schema: "recommendation-output/v3", sessionId: "s", primaryAction: { strategy: { kind: "REVEAL_POSITION", position: 5, rationale: "x" }, label: "Sugerencia" }, shortlist: [], personalHeroView: { position: 2, positionLabel: "TU MID AHORA", seatCovered: false, heroes: [{ heroId: 7, rank: 1, score: 10, isFromPool: true }] }, meta: { round: 1, phase: "PICK_ROUND_1", ownPicksRemaining: 5, confidence: "media", decisionContext: "team_opening", trigger: "DRAFT_PICKS_STARTED", revision: 3, basedOn: { stateIdentity: "id", evidenceVersion: "v" } } } as unknown as Parameters<typeof CopilotPanel>[0]["coach"];
  const view = render(<CopilotPanel recommendations={null} coach={staleV3} currentDecision={output(RANKED)} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.queryByTestId("coach-panel")).toBeNull();
  expect(view.queryByTestId("coach-personal-hero-view")).toBeNull();
  expect(view.container.textContent).not.toContain("TU MID AHORA");
  expect(view.container.textContent).not.toContain("solo tu asiento");
  expect(view.getAllByTestId("current-decision-panel")).toHaveLength(1);
});

const SAFE_CORE = {
  subtype: "SAFE_CORE" as const,
  label: "Ventana de core: 2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)",
  heroId: 99,
  evidence: "2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)",
  counterEvidence: { kind: "COUNTER_RELIEF" as const, sourceType: "CURATED" as const, relieved: [{ heroId: 7, level: "hard" as const, status: "BANNED" as const }, { heroId: 8, level: "hard" as const, status: "BANNED" as const }], totalHardCounters: 2 },
};

test("Safe Core en V4: se muestra como bloque informativo y no cambia objetivo, vista ni cartas", () => {
  const withWindow = { ...output(RANKED), opportunity: SAFE_CORE };
  const view = render(<CopilotPanel recommendations={null} currentDecision={withWindow} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.getByTestId("coach-opportunity-label").textContent).toBe(SAFE_CORE.label);
  expect(view.getByTestId("coach-opportunity-source").textContent).toContain("Es informativo");
  expect(view.queryByTestId("coach-panel")).toBeNull(); // the V3 Coach panel is NOT back
  expect(view.getAllByTestId("current-decision-target")).toHaveLength(1);
  expect(view.getByTestId("current-decision-target").getAttribute("data-target-position")).toBe("3");
  expect(view.getAllByTestId("current-decision-card").map((card) => card.getAttribute("data-rank"))).toEqual(["1", "2"]);
  cleanup();
  const without = render(<CopilotPanel recommendations={null} currentDecision={output(RANKED)} heroCatalog={new Map()} previewStatus="ready" />);
  expect(without.queryByTestId("coach-opportunity")).toBeNull();
});

test("borde: una oportunidad V4 malformada rechaza la salida entera; una válida pasa", () => {
  expect(parseCurrentDecisionOutput({ ...output(RANKED), opportunity: SAFE_CORE })?.opportunity?.heroId).toBe(99);
  expect(parseCurrentDecisionOutput({ ...output(RANKED), opportunity: { ...SAFE_CORE, subtype: "OTHER" } })).toBeNull();
  expect(parseCurrentDecisionOutput({ ...output(RANKED), opportunity: { ...SAFE_CORE, counterEvidence: { ...SAFE_CORE.counterEvidence, sourceType: "STATISTICAL" } } })).toBeNull();
});

// TSK-254 -- each card says where its reason comes from and which risks apply; the border rejects dishonest labels.
function withCard(patch: { basis?: unknown; risks?: unknown }): unknown {
  const base = output(RANKED);
  if (base.decision.kind !== "ACTIONABLE" || base.decision.candidates.state !== "RANKED") throw new Error("fixture");
  const cards = base.decision.candidates.cards.map((card, index) => (index === 0 ? { ...card, ...patch } : card));
  return { ...base, decision: { ...base.decision, candidates: { ...base.decision.candidates, cards } } };
}

const CURATED_BASIS: CardBasis = { kind: "curated", sources: [{ kind: "curated", sampleSize: null }] };
const MIXED_BASIS: CardBasis = { kind: "mixed", sources: [{ kind: "statistical", sampleSize: 240 }, { kind: "curated", sampleSize: null }] };
const INFERRED_BASIS: CardBasis = { kind: "inferred", sources: [{ kind: "inferred", sampleSize: null }] };

test("TSK-254: la base se distingue en la tarjeta -- estadística con su n, curada, mixta con cada fuente, inferida", () => {
  const texts: [CardBasis, string][] = [
    [STATISTICAL_BASIS, "Base: estadística (120 partidas)"],
    [CURATED_BASIS, "Base: criterio curado"],
    [MIXED_BASIS, "Base mixta: estadística (240 partidas) + criterio curado"],
    [INFERRED_BASIS, "Base: inferido de la posición"],
  ];
  for (const [basis, text] of texts) {
    const parsed = parseCurrentDecisionOutput(withCard({ basis }));
    expect(parsed).not.toBeNull();
    const view = render(<CurrentDecisionPanel output={parsed!} heroCatalog={new Map()} />);
    const label = view.getAllByTestId("current-decision-basis")[0]!;
    expect(label.textContent).toBe(text);
    expect(label.getAttribute("data-basis-kind")).toBe(basis.kind);
    cleanup();
  }
});

test("TSK-254: los riesgos se ven con los héroes nombrados desde el catálogo; sin riesgos no hay recuadro", () => {
  const risks: CardRisk[] = [
    { kind: "countered_by_revealed", detail: "1 counter duro curado de este héroe ya está revelado en el equipo rival.", heroIds: [50] },
    { kind: "exposed_to_counter", detail: "2 counters duros curados siguen disponibles y el rival todavía puede elegir después de ver tu pick.", heroIds: [51, 52] },
  ];
  const catalog = new Map([[50, { localizedName: "Axe" }], [51, { localizedName: "Pudge" }]]) as never;
  const view = render(<CurrentDecisionPanel output={parseCurrentDecisionOutput(withCard({ risks }))!} heroCatalog={catalog} />);
  const items = view.getAllByTestId("current-decision-risk");
  expect(items.map((item) => item.getAttribute("data-risk-kind"))).toEqual(["countered_by_revealed", "exposed_to_counter"]);
  expect(items[0]!.textContent).toContain("Counter duro ya revelado: Axe");
  expect(items[1]!.textContent).toContain("Counter duro aún disponible: Pudge, Héroe 52");
  expect(view.getAllByTestId("current-decision-risks")).toHaveLength(1); // only the card that carries risks
});

test("TSK-254: CRITICAL_GAP se ve con su título y su detalle, sin nombrar héroes (el hueco es del equipo)", () => {
  const risks: CardRisk[] = [{ kind: "CRITICAL_GAP", detail: "A tu equipo le falta iniciación y te quedan 2 picks; este héroe no lo cubre (según las capacidades curadas).", heroIds: [] }];
  const view = render(<CurrentDecisionPanel output={parseCurrentDecisionOutput(withCard({ risks }))!} heroCatalog={new Map() as never} />);
  const item = view.getByTestId("current-decision-risk");
  expect(item.getAttribute("data-risk-kind")).toBe("CRITICAL_GAP");
  expect(item.textContent).toContain("Hueco crítico del equipo");
  expect(item.textContent).not.toContain("Hueco crítico del equipo:"); // no hero list after the title
  expect(item.textContent).toContain("A tu equipo le falta iniciación");
  expect(item.textContent).toContain("según las capacidades curadas");
});

test("TSK-254 borde: un riesgo desconocido, una base incoherente o un riesgo de héroes sin héroes rechazan la salida entera", () => {
  expect(parseCurrentDecisionOutput(withCard({ risks: [{ kind: "NOT_A_RISK", detail: "x", heroIds: [] }] }))).toBeNull(); // a kind the contract does not know
  expect(parseCurrentDecisionOutput(withCard({ risks: [{ kind: "CRITICAL_GAP", detail: "x", heroIds: [] }] }))).not.toBeNull(); // a team-level gap names no heroes
  expect(parseCurrentDecisionOutput(withCard({ risks: [{ kind: "CRITICAL_GAP", detail: 7, heroIds: [] }] }))).toBeNull();
  expect(parseCurrentDecisionOutput(withCard({ risks: [{ kind: "exposed_to_counter", detail: "x", heroIds: [] }] }))).toBeNull();
  expect(parseCurrentDecisionOutput(withCard({ risks: [{ kind: "low_evidence", detail: "x", heroIds: [0] }] }))).toBeNull();
  expect(parseCurrentDecisionOutput(withCard({ risks: "none" }))).toBeNull();
  expect(parseCurrentDecisionOutput(withCard({ basis: undefined }))).toBeNull(); // required: a card never ships without its basis
  expect(parseCurrentDecisionOutput(withCard({ basis: { kind: "statistical", sources: [] } }))).toBeNull();
  expect(parseCurrentDecisionOutput(withCard({ basis: { kind: "mixed", sources: [{ kind: "curated", sampleSize: null }] } }))).toBeNull(); // mixed needs 2+ kinds
  expect(parseCurrentDecisionOutput(withCard({ basis: { kind: "curated", sources: [{ kind: "curated", sampleSize: 50 }] } }))).toBeNull(); // curated claims no sample
  expect(parseCurrentDecisionOutput(withCard({ basis: { kind: "mixed", sources: [{ kind: "curated", sampleSize: null }, { kind: "curated", sampleSize: null }] } }))).toBeNull();
  expect(parseCurrentDecisionOutput(withCard({ basis: MIXED_BASIS, risks: [] }))).not.toBeNull();
});
