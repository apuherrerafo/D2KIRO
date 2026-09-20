import "@/test-support/happy-dom";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { CoachHeroCard, CoachOutput, CoachStrategy } from "../coach-client";
import { NOT_COMPUTED, type RecommendationSetV2 } from "../protocol-client";
import { CoachPanel } from "./CoachPanel";
import { CopilotPanel } from "./CopilotPanel";

afterEach(cleanup);

function card(heroId: number, overrides: Partial<CoachHeroCard> = {}): CoachHeroCard {
  return { heroId, position: 5, roleStatus: "LIKELY", confidence: "media", badges: [], rationale: `razón ${heroId}`, score: 10, isFromPool: false, ...overrides };
}

function coach(strategy: CoachStrategy, shortlist: CoachHeroCard[] = [card(7), card(8)], label = "Sugerencia: revela Hard support (Pos 5)"): CoachOutput {
  return {
    schema: "recommendation-output/v3",
    sessionId: "s",
    primaryAction: { strategy, label },
    shortlist,
    meta: {
      round: 1,
      phase: "PICK_ROUND_1",
      ownPicksRemaining: 5,
      confidence: "media",
      decisionContext: "team_opening",
      trigger: "DRAFT_PICKS_STARTED",
      revision: 3,
      basedOn: { stateIdentity: "id-1", evidenceVersion: "v" },
    },
  };
}

const ROLE_ACTION: CoachStrategy = { kind: "REVEAL_POSITION", position: 5, rationale: "Prior de apertura." };

test("una acción a nivel de posición muestra el rol y NO nombra ningún héroe; la shortlist aparece después con héroes concretos", () => {
  const view = render(<CoachPanel coach={coach(ROLE_ACTION)} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-primary-label").textContent).toContain("Hard support");
  expect(view.getByTestId("coach-primary-action").getAttribute("data-strategy-kind")).toBe("REVEAL_POSITION");
  expect(view.queryByTestId("coach-named-hero")).toBeNull();
  expect(view.getAllByTestId("coach-hero-card")).toHaveLength(2);
  const primary = view.getByTestId("coach-primary-action");
  const shortlist = view.getByTestId("coach-shortlist");
  // PRIMARY ACTION comes before the SHORTLIST in the document.
  expect(primary.compareDocumentPosition(shortlist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("sólo una acción REVEAL_HERO nombra un héroe", () => {
  const view = render(<CoachPanel coach={coach({ kind: "REVEAL_HERO", heroId: 7, position: 5, rationale: "El counter explica la ventaja." })} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-named-hero").getAttribute("data-hero-id")).toBe("7");
});

test("es una sugerencia: el texto lo dice y nunca marca una elección como incorrecta", () => {
  const view = render(<CoachPanel coach={coach(ROLE_ACTION)} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-primary-action").textContent).toContain("Es una sugerencia");
  expect(view.container.textContent).not.toMatch(/incorrect|equivocad|error|no deberías/i);
});

test("un rol UNRESOLVED se muestra como 'Rol por definir', nunca como una posición cierta", () => {
  const view = render(<CoachPanel coach={coach(ROLE_ACTION, [card(7, { roleStatus: "UNRESOLVED", position: 1 })])} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-hero-card").textContent).toContain("Rol por definir");
  expect(view.getByTestId("coach-hero-card").textContent).not.toContain("Carry");
});

test("las insignias son las de la evidencia real; sin insignias no se renderiza contenedor", () => {
  const withBadges = render(<CoachPanel coach={coach(ROLE_ACTION, [card(7, { badges: ["COUNTER", "META"] })])} heroCatalog={new Map()} />);
  expect(withBadges.getAllByTestId("coach-badge").map((badge) => badge.textContent)).toEqual(["Counter", "Aporta el meta"]);
  cleanup();
  const none = render(<CoachPanel coach={coach(ROLE_ACTION, [card(7)])} heroCatalog={new Map()} />);
  expect(none.queryAllByTestId("coach-badge")).toHaveLength(0);
});

test("sin héroes en la shortlist la acción primaria sigue visible", () => {
  const view = render(<CoachPanel coach={coach(ROLE_ACTION, [])} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-primary-action")).toBeDefined();
  expect(view.queryByTestId("coach-shortlist")).toBeNull();
});

test("only own-team role beliefs expose manual assignment controls", () => {
  const assignments: Array<[number, number | null]> = [];
  const withBeliefs = coach(ROLE_ACTION);
  withBeliefs.roleBeliefs = {
    own: [{ heroId: 7, status: "LIKELY", positions: [3, 4] }],
    enemy: [{ heroId: 8, status: "LIKELY", positions: [2, 3] }],
  };
  const rendered = render(<CoachPanel coach={withBeliefs} heroCatalog={new Map()} onAssignOwnPosition={(hero, position) => assignments.push([hero, position])} />);
  const own = rendered.getByTestId("coach-own-role");
  const enemy = rendered.getByTestId("coach-enemy-role");
  expect(within(own).getAllByRole("button")).toHaveLength(2);
  expect(within(enemy).queryAllByRole("button")).toHaveLength(0);
  fireEvent.click(within(own).getByRole("button", { name: "Pos3" }));
  expect(assignments).toEqual([[7, 3]]);
});

function withOpportunity(): CoachOutput {
  return {
    ...coach(ROLE_ACTION),
    opportunity: {
      subtype: "SAFE_CORE",
      label: "Ventana de core: 2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)",
      heroId: 1,
      evidence: "2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)",
      counterEvidence: { kind: "COUNTER_RELIEF", sourceType: "CURATED", relieved: [{ heroId: 7, level: "hard", status: "BANNED" }, { heroId: 8, level: "hard", status: "BANNED" }], totalHardCounters: 2 },
    },
  };
}

test("Safe Core: el bloque de oportunidad aparece separado, DESPUÉS de la acción primaria y ANTES de la shortlist", () => {
  const view = render(<CoachPanel coach={withOpportunity()} heroCatalog={new Map()} />);
  const primary = view.getByTestId("coach-primary-action");
  const opportunity = view.getByTestId("coach-opportunity");
  const shortlist = view.getByTestId("coach-shortlist");
  expect(primary.compareDocumentPosition(opportunity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(opportunity.compareDocumentPosition(shortlist) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(view.getByTestId("coach-opportunity-label").textContent).toBe("Ventana de core: 2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)");
  expect(opportunity.getAttribute("data-hero-id")).toBe("1");
  // It is not part of the shortlist: the shortlist still holds exactly its own cards.
  expect(view.getAllByTestId("coach-hero-card")).toHaveLength(2);
});

test("Safe Core: la procedencia CURATED se ve como 'Evidencia curada' y nunca como estadística ni parche verificado", () => {
  const view = render(<CoachPanel coach={withOpportunity()} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-opportunity").getAttribute("data-source-type")).toBe("CURATED");
  expect(view.getByTestId("coach-opportunity-source").textContent).toContain("Evidencia curada");
  expect(view.getByTestId("coach-opportunity").textContent).not.toMatch(/estad[ií]stic|7\.41|win ?rate|meta|%/i);
  expect(view.getByTestId("coach-opportunity-source").textContent).toContain("Es informativo");
});

const MIXED_EVIDENCE = "2 de 2 counters duros curados ya no están disponibles para el rival (1 baneado · 1 en tu equipo)";

test("Safe Core: con alivio mixto (BANNED + OWN_PICK) la tarjeta muestra el detalle real y jamás 'baneados' para un pick propio", () => {
  const coachOutput = withOpportunity();
  const mixed: CoachOutput = {
    ...coachOutput,
    opportunity: {
      ...coachOutput.opportunity!,
      label: `Ventana de core: ${MIXED_EVIDENCE}`,
      evidence: MIXED_EVIDENCE,
      counterEvidence: { kind: "COUNTER_RELIEF", sourceType: "CURATED", relieved: [{ heroId: 7, level: "hard", status: "BANNED" }, { heroId: 8, level: "hard", status: "OWN_PICK" }], totalHardCounters: 2 },
    },
  };
  const view = render(<CoachPanel coach={mixed} heroCatalog={new Map()} />);
  const label = view.getByTestId("coach-opportunity-label").textContent ?? "";
  expect(label).toBe(`Ventana de core: ${MIXED_EVIDENCE}`);
  expect(label).toContain("1 baneado · 1 en tu equipo");
  expect(label).not.toMatch(/2 baneados|2 de 2 counters duros curados baneados/);
  expect(view.getByTestId("coach-opportunity-source").textContent).toContain("Evidencia curada");
});

test("Safe Core: la UI no tiene rama ni texto de evidencia estadística (sólo 'Evidencia curada')", () => {
  const source = readFileSync(join(import.meta.dir, "CoachPanel.tsx"), "utf8");
  expect(source).not.toMatch(/STATISTICAL|estad[ií]stic/i);
  expect(source).toContain("Evidencia curada");
  const view = render(<CoachPanel coach={withOpportunity()} heroCatalog={new Map()} />);
  expect(view.getByTestId("coach-opportunity-source").textContent).not.toMatch(/estad[ií]stic|parche|win ?rate/i);
});

test("Safe Core: sin opportunity no se renderiza ningún bloque (ausente por defecto)", () => {
  const view = render(<CoachPanel coach={coach(ROLE_ACTION)} heroCatalog={new Map()} />);
  expect(view.queryByTestId("coach-opportunity")).toBeNull();
});

function v2(): RecommendationSetV2 {
  return {
    schema: "recommendation-set/v2",
    sessionId: "s",
    decision: { actor: "radiant", actionKind: "PICK", controlledSlots: [], actionCount: 1 },
    recommendations: [],
    degradations: [],
    deferred: { opponentResponse: NOT_COMPUTED, steal: NOT_COMPUTED, lookahead: NOT_COMPUTED },
    decisionContext: "team_opening",
  };
}

test("CopilotPanel con Coach: muestra acción primaria + shortlist (no la lista plana de 6) y el contexto de la vista", () => {
  const seen: number[][] = [];
  const view = render(
    <CopilotPanel recommendations={v2()} coach={coach(ROLE_ACTION)} heroCatalog={new Map()} previewStatus="ready" onSuggestedHeroIdsChange={(ids) => seen.push([...ids])} />,
  );
  expect(view.getByTestId("coach-primary-action")).toBeDefined();
  expect(view.queryByText("Calculando recomendación...")).toBeNull();
  expect(view.getByText("Apertura de equipo")).toBeDefined();
  expect(seen.at(-1)).toEqual([7, 8]); // the grid highlights exactly the shortlist
});

test("CopilotPanel sin Coach (Captain's Mode / motor viejo) no muestra sección de Coach", () => {
  const view = render(<CopilotPanel recommendations={v2()} heroCatalog={new Map()} previewStatus="ready" />);
  expect(view.queryByTestId("coach-panel")).toBeNull();
});
