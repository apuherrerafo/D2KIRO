import { expect, test } from "@playwright/test";
import Database from "better-sqlite3";

test.describe("Modern Coach Recommendation Feedback", () => {
  test("flujo completo de feedback: positivo, negativo con motivo y prevención de duplicados", async ({ page, request }) => {
    // 1. Start draft in simulator
    await page.goto("/simulator");
    const startButton = page.getByRole("button", { name: "Iniciar Draft" });
    await expect(startButton).toBeDisabled({ timeout: 60_000 });

    await page.getByRole("group", { name: "Tu lado" }).getByRole("button", { name: "Radiant", exact: true }).click();
    await page.getByRole("group", { name: "Tu posición personal" }).getByRole("button", { name: "Posición 2 — Midlane" }).click();
    await expect(startButton).toBeEnabled();
    await startButton.click();

    // Wait for Round 1 and Coach recommendations
    await expect(page.getByText(/Ronda 1 -- elegí 2 héroes/)).toBeVisible({ timeout: 60_000 });
    const coachPanel = page.locator('[data-testid="coach-panel"]');
    await expect(coachPanel).toBeVisible({ timeout: 30_000 });

    const heroCards = page.locator('[data-testid="coach-hero-card"]');
    await expect(heroCards.first()).toBeVisible({ timeout: 30_000 });
    const cardCount = await heroCards.count();
    expect(cardCount).toBeGreaterThan(0);

    // 2. Feedback POSITIVO (👍) en la primera tarjeta de la shortlist
    const firstCard = heroCards.first();
    const firstHeroId = Number(await firstCard.getAttribute("data-hero-id"));
    expect(firstHeroId).toBeGreaterThan(0);

    const firstControls = firstCard.locator('[data-testid="recommendation-feedback-controls"]');
    await expect(firstControls).toBeVisible();

    const thumbUpBtn = firstCard.locator('[data-testid="feedback-thumb-up"]');
    await thumbUpBtn.click();

    const firstSubmitBtn = firstCard.locator('[data-testid="feedback-submit-btn"]');
    await expect(firstSubmitBtn).toBeVisible();
    await firstSubmitBtn.click();

    // 3. Verificar respuesta visual exitosa
    const firstSubmitted = firstCard.locator('[data-testid="feedback-submitted-state"]');
    await expect(firstSubmitted).toBeVisible({ timeout: 10_000 });
    await expect(firstSubmitted).toContainText("Feedback guardado");

    // 4. Feedback NEGATIVO (👎) en la segunda tarjeta si existe
    if (cardCount > 1) {
      const secondCard = heroCards.nth(1);
      const secondHeroId = Number(await secondCard.getAttribute("data-hero-id"));
      expect(secondHeroId).toBeGreaterThan(0);

      const thumbDownBtn = secondCard.locator('[data-testid="feedback-thumb-down"]');
      await thumbDownBtn.click();

      // Formulario desplegado
      const feedbackForm = secondCard.locator('[data-testid="feedback-form"]');
      await expect(feedbackForm).toBeVisible();

      // Elegir motivo
      const reasonSelect = secondCard.locator('[data-testid="feedback-reason-select"]');
      await reasonSelect.selectOption("poor_hero");

      // Comentario opcional
      const commentInput = secondCard.locator('[data-testid="feedback-comment-input"]');
      await commentInput.fill("E2E feedback test: heroe situacional");

      // Enviar
      const submitBtn = secondCard.locator('[data-testid="feedback-submit-btn"]');
      await submitBtn.click();

      // Verificar respuesta visual exitosa
      const secondSubmitted = secondCard.locator('[data-testid="feedback-submitted-state"]');
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
