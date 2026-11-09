import "@/test-support/happy-dom";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { CoachHeroCard } from "../../random-draft-simulator/coach-client";
import type { CaptainsModeBanCard, CaptainsModeOutput } from "../cm-client";
import { CaptainsModeCopilot } from "./CaptainsModeCopilot";

// Contrato de elegibilidad en Captains Mode (dueño del producto, 2026-11-04): el panel solo pinta lo que el motor ya filtró. Cero V2 crudo.
// Fixtures inline: ningún dato curado real.

afterEach(cleanup);

const CATALOG = new Map<number, HeroMeta>();

function pick(heroId: number, overrides: Partial<CoachHeroCard> = {}): CoachHeroCard {
  return { heroId, position: 1, roleStatus: "LIKELY", confidence: "alta", badges: ["COUNTER"], rationale: "", hideRationale: true, evidenceStrength: "STRONG", score: 10, isFromPool: false, ...overrides };
}

function ban(heroId: number, overrides: Partial<CaptainsModeBanCard> = {}): CaptainsModeBanCard {
  return { heroId, evidenceStrength: "STRONG", beatsYourPicks: [{ vsHeroId: 50, level: "hard", why: "Orchid lo silencia" }], pairsWithTheirPicks: [], score: 1, ...overrides };
}

function output(overrides: Partial<CaptainsModeOutput>): CaptainsModeOutput {
  return { schema: "recommendation-output/cm-v1", sessionId: "s", actionKind: "PICK", step: 8, picks: [], bans: [], primaryHeroId: null, ...overrides };
}

const noop = () => undefined;
const renderPanel = (value: CaptainsModeOutput | null, previewStatus: "idle" | "loading" | "ready" | "failed" = "ready", onRetry = noop) =>
  render(<CaptainsModeCopilot output={value} heroCatalog={CATALOG} previewStatus={previewStatus} onRetry={onRetry} />);

test("PICK con evidencia FUERTE: la tarjeta se destaca como recomendada y no lleva la marca de evidencia limitada", () => {
  const view = renderPanel(output({ picks: [pick(7)], primaryHeroId: 7 }));
  expect(view.getAllByTestId("coach-hero-card")).toHaveLength(1);
  expect(view.getByTestId("recommended-mark").textContent).toBe("Recomendado");
  expect(view.queryByTestId("evidence-limited-mark")).toBeNull();
});

test("PICK con evidencia DEBIL: aparece con 'Evidencia limitada' y NUNCA como recomendado", () => {
  const view = renderPanel(output({ picks: [pick(7, { evidenceStrength: "WEAK" }), pick(8)], primaryHeroId: null }));
  expect(view.getAllByTestId("coach-hero-card")).toHaveLength(2);
  expect(view.getAllByTestId("evidence-limited-mark")).toHaveLength(1);
  expect(view.queryByTestId("recommended-mark")).toBeNull();
});

test("sin ningun heroe elegible (listo): el panel no pinta heroes, ni 'Calculando' eterno, ni mensaje de falta de informacion, ni cuerpo V2", () => {
  for (const kind of ["PICK", "BAN"] as const) {
    const view = renderPanel(output({ actionKind: kind }));
    expect(view.queryAllByTestId("coach-hero-card")).toHaveLength(0);
    expect(view.queryAllByTestId("cm-ban-card")).toHaveLength(0);
    const text = view.container.textContent ?? "";
    for (const forbidden of ["Calculando", "Sin candidatos", "Dupla sugerida", "Paquetes V2", "osición y momento", "falta información"]) expect(text).not.toContain(forbidden);
    cleanup();
  }
});

test("'Calculando' solo mientras de verdad se calcula; si falla, ofrece reintentar", () => {
  expect(renderPanel(null, "loading").container.textContent).toContain("Calculando");
  cleanup();
  let retried = 0;
  const view = renderPanel(null, "failed", () => { retried += 1; });
  fireEvent.click(view.getByText("Reintentar"));
  expect(retried).toBe(1);
});

test("BAN: cada ban dice a que pick tuyo le gana o con que pick rival hace pareja (con el porque); el debil lleva la marca y no se destaca", () => {
  const view = renderPanel(output({
    actionKind: "BAN",
    bans: [ban(3, { pairsWithTheirPicks: [{ withHeroId: 60, why: "Su stun encadena con el ult" }] }), ban(4, { evidenceStrength: "WEAK", beatsYourPicks: [{ vsHeroId: 51, level: "medium", why: "Lo frena con su silencio" }] })],
    primaryHeroId: 3,
  }));
  const cards = view.getAllByTestId("cm-ban-card");
  expect(cards).toHaveLength(2);
  expect(cards[0]?.textContent).toContain("Le gana a tu Héroe 50: Orchid lo silencia");
  expect(cards[0]?.textContent).toContain("Hace pareja con el Héroe 60 del rival: Su stun encadena con el ult");
  expect(cards[0]?.textContent).toContain("Ban recomendado");
  expect(cards[1]?.textContent).toContain("Evidencia limitada");
  expect(cards[1]?.textContent).not.toContain("Ban recomendado");
});

test("Captains Mode ya no monta el cuerpo V2 crudo: ni CopilotPanel ni fetchRecommendations en su cadena", () => {
  const root = join(import.meta.dir, "..");
  const simulator = readFileSync(join(root, "components", "CaptainsModeSimulator.tsx"), "utf8");
  const hook = readFileSync(join(root, "use-captains-mode-session.ts"), "utf8");
  expect(simulator).not.toContain("CopilotPanel");
  expect(simulator).toContain("CaptainsModeCopilot");
  expect(hook).not.toContain("fetchRecommendations(");
  expect(hook).toContain("fetchCaptainsModeOutput(");
});
