import type { Locator } from "@playwright/test";
import { expect, test } from "./support/failure-evidence";
import Database from "better-sqlite3";
import { boardOf, latestDecision, waitForBoard } from "./support/decision";
import { record } from "./support/wave1";

test.describe("Modern Coach Recommendation Feedback", () => {
  test("flujo completo de feedback: positivo, negativo con motivo y prevención de duplicados", async ({ page, request }) => {
    // 1. Start draft in simulator
    record(page);
    await page.goto("/simulator");
    const startButton = page.getByRole("button", { name: "Iniciar Draft" });
    await expect(startButton).toBeDisabled({ timeout: 60_000 });

    await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
    await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait for Round 1 and Coach recommendations
    await expect(page.getByText(/Ronda 1 de 3 · Elige 2 héroes/)).toBeVisible({ timeout: 60_000 });
    // MIGRADO (Canonical Light): el 👍/👎 por tarjeta vivía en el Copilot eliminado. Hoy es UN control dentro del ANÁLISIS del candidato abierto en el tablero
    // (`sl-feedback`), no un panel duplicado. Misma garantía: se opina sobre una recomendación que el Coach SÍ mostró, queda guardada con su identidad de estado
    // y no se puede votar dos veces la misma. Contrato de elegibilidad: sin tarjetas no hay nada que valorar, por eso se exige al menos una.
    await waitForBoard(page);
    await expect.poll(() => latestDecision(page) !== null, { timeout: 30_000 }).toBe(true);
    await expect(page.getByTestId("copilot-panel")).toHaveCount(0); // no reaparece el Copilot duplicado
    const board = boardOf(page);
    // El voto se emite sobre la decisión V4 de la posición VISTA (su identidad de estado): se busca, entre las posiciones pendientes, la primera cuya decisión trae
    // recomendaciones. Contrato de elegibilidad: puede que la posición propia no tenga ninguna; el selector del buscador cambia la posición vista.
    const positionSelector = page.getByRole("group", { name: "Posición para el próximo pick" });
    for (const position of [1, 3, 4, 5]) {
      if ((latestDecision(page)?.ranked.length ?? 0) > 0) break;
      const answered = page.waitForResponse((response) => /recommendations\?format=v4/.test(response.url()), { timeout: 30_000 });
      await positionSelector.getByRole("button", { name: new RegExp(`Pos${position} `) }).click();
      await answered;
      await page.waitForTimeout(500);
    }
    const decision = latestDecision(page)!;
    expect(decision.ranked.length, "at least one pending position has a recommendation to rate").toBeGreaterThan(0);
    const viewedColumn = board.getByTestId(`team-coach-column-${decision.viewedPosition}`);
    const cards = viewedColumn.locator("[data-card-key]").filter({ has: page.locator("button") });
    await expect(cards.first()).toBeVisible({ timeout: 30_000 });
    const rankedCardIds = (await cards.evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute("data-hero-id"))))).filter((id) => decision.ranked.includes(id));
    expect(rankedCardIds.length).toBeGreaterThan(0);

    async function openCard(heroId: number): Promise<{ heroId: number; controls: Locator }> {
      const card = viewedColumn.locator(`[data-card-key][data-hero-id="${heroId}"]`);
      await card.locator("button").click();
      await expect(card.locator("button")).toHaveAttribute("aria-pressed", "true");
      const controls = board.getByTestId("sl-feedback");
      await expect(controls).toBeVisible();
      return { heroId, controls };
    }

    // Un candidato de OTRA columna (no de la decisión vista) se puede abrir, pero NO ofrece voto: no es lo que esa decisión recomendó.
    // (`data-card-key` es `<posición>:<héroe>`: se excluye por prefijo de posición; `hasNot` con un locator del tablero no excluía nada.)
    const otherColumnCard = board.locator(`[data-card-key]:not([data-card-key^="${decision.viewedPosition}:"])`).filter({ has: page.locator("button") }).first();
    if ((await otherColumnCard.count()) > 0) {
      await otherColumnCard.locator("button").click();
      await expect(board.getByTestId("sl-feedback")).toHaveCount(0);
    }

    // 2. Feedback POSITIVO (👍) sobre la primera recomendación
    const first = await openCard(rankedCardIds[0]!);
    const firstHeroId = first.heroId;
    await expect(first.controls.locator('[data-testid="recommendation-feedback-controls"]')).toBeVisible();
    await first.controls.locator('[data-testid="feedback-thumb-up"]').click();
    const firstSubmitBtn = first.controls.locator('[data-testid="feedback-submit-btn"]');
    await expect(firstSubmitBtn).toBeVisible();
    await firstSubmitBtn.click();

    // 3. Verificar respuesta visual exitosa
    const firstSubmitted = first.controls.locator('[data-testid="feedback-submitted-state"]');
    await expect(firstSubmitted).toBeVisible({ timeout: 10_000 });
    await expect(firstSubmitted).toContainText("Feedback guardado");

    // 4. Feedback NEGATIVO (👎) sobre otra recomendación de la misma decisión (otro héroe) si existe
    if (rankedCardIds.length > 1) {
      const second = await openCard(rankedCardIds[1]!);
      expect(second.heroId).not.toBe(firstHeroId);
      await second.controls.locator('[data-testid="feedback-thumb-down"]').click();
      await expect(second.controls.locator('[data-testid="feedback-form"]')).toBeVisible();
      await second.controls.locator('[data-testid="feedback-reason-select"]').selectOption("poor_hero");
      await second.controls.locator('[data-testid="feedback-comment-input"]').fill("E2E feedback test: heroe situacional");
      await second.controls.locator('[data-testid="feedback-submit-btn"]').click();
      const secondSubmitted = second.controls.locator('[data-testid="feedback-submitted-state"]');
      await expect(secondSubmitted).toBeVisible({ timeout: 10_000 });
      await expect(secondSubmitted).toContainText("Feedback guardado");
    }

    // 5. Verificar persistencia en base de datos del servidor
    const dbPath = process.env.E2E_DB_PATH;
    expect(dbPath).toBeDefined();
    const db = new Database(dbPath!, { readonly: true });
    try {
      const rows = db.prepare("SELECT * FROM recommendation_feedback WHERE hero_id = ?").all(firstHeroId) as {
        hero_id: number;
        rating: string;
        reason: string | null;
        comment: string | null;
        ruleset_id: string;
        ruleset_version: string;
        account_id: number | null;
        session_id: string;
        state_identity: string | null;
      }[];

      expect(rows.length).toBe(1);
      const row = rows[0]!;
      expect(row.rating).toBe("positive");
      expect(row.reason).toBeNull();
      expect(row.comment).toBeNull();
      expect(row.ruleset_id).toBe("dota2/ranked-all-pick");
      expect(row.ruleset_version).toBe("7.41f");
      expect(row.account_id).toBeGreaterThan(0);

      // 6. Intento de envío duplicado a nivel de API (mismo session, hero, stateIdentity)
      const duplicateRes = await request.post(`/engine/api/session/${encodeURIComponent(row.session_id)}/feedback`, {
        headers: { "content-type": "application/json" },
        data: {
          rating: "positive",
          heroId: firstHeroId,
          stateIdentity: row.state_identity,
        },
      });

      // El servidor rechaza con 409 duplicate_submission
      expect(duplicateRes.status()).toBe(409);
      const dupJson = await duplicateRes.json();
      expect(dupJson.error).toBe("duplicate_submission");

      // Verificar que sigue habiendo exactamente 1 fila para esa recomendación
      const rowsAfterDup = db.prepare("SELECT COUNT(*) as count FROM recommendation_feedback WHERE session_id = ? AND hero_id = ?").get(row.session_id, firstHeroId) as { count: number };
      expect(rowsAfterDup.count).toBe(1);
    } finally {
      db.close();
    }
  });
});
