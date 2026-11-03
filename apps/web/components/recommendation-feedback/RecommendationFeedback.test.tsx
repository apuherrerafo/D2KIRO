import "@/test-support/happy-dom";

import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  clearSubmittedFeedbackKeysForTesting,
  RecommendationFeedback,
} from "./RecommendationFeedback";

const originalFetch = global.fetch;

describe("RecommendationFeedback", () => {
  beforeEach(() => {
    clearSubmittedFeedbackKeysForTesting();
  });

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  test("renderiza botones iniciales de pulgar arriba y abajo sin vocabulario prohibido", () => {
    const view = render(
      <RecommendationFeedback
        sessionId="session-1"
        heroId={7}
        targetPosition={4}
        stateIdentity="state-hash-1"
        rulesetVersion="7.41e"
      />,
    );

    expect(view.getByTestId("feedback-thumb-up")).toBeDefined();
    expect(view.getByTestId("feedback-thumb-down")).toBeDefined();
    expect(view.container.textContent).toContain("¿Te sirvió?");
    // Asegurar que no activa la trampa de CoachPanel.test.tsx
    expect(view.container.textContent).not.toMatch(/incorrect|equivocad|error|no deberías/i);
  });

  test("al hacer clic en pulgar arriba muestra formulario positivo y envía con la identidad completa", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    global.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as unknown as typeof fetch;

    const view = render(
      <RecommendationFeedback
        sessionId="session-1"
        heroId={7}
        targetPosition={4}
        stateIdentity="state-hash-1"
        rulesetVersion="7.41e"
      />,
    );

    fireEvent.click(view.getByTestId("feedback-thumb-up"));
    expect(view.getByTestId("feedback-form")).toBeDefined();
    expect(view.container.textContent).toContain("Feedback positivo");

    const commentInput = view.getByTestId("feedback-comment-input") as HTMLTextAreaElement;
    act(() => {
      commentInput.value = "Excelente recomendación para support";
      commentInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    fireEvent.click(view.getByTestId("feedback-submit-btn"));

    await waitFor(() => {
      expect(view.getByTestId("feedback-submitted-state")).toBeDefined();
    });

    expect(capturedUrl).toContain("/api/session/session-1/feedback");
    expect(capturedBody).toEqual({
      rating: "positive",
      heroId: 7,
      targetPosition: 4,
      stateIdentity: "state-hash-1",
      rulesetVersion: "7.41e",
      comment: "Excelente recomendación para support",
    });

    expect(view.container.textContent).toContain("Feedback guardado. ¡Gracias!");
    expect(view.container.textContent).not.toMatch(/incorrect|equivocad|error|no deberías/i);
  });

  test("al hacer clic en pulgar abajo permite seleccionar motivo negativo y enviar", async () => {
    let capturedBody: Record<string, unknown> = {};

    global.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as unknown as typeof fetch;

    const view = render(
      <RecommendationFeedback
        sessionId="session-2"
        heroId={25}
        targetPosition={2}
        stateIdentity="state-hash-2"
      />,
    );

    fireEvent.click(view.getByTestId("feedback-thumb-down"));
    expect(view.getByTestId("feedback-reason-select")).toBeDefined();

    fireEvent.change(view.getByTestId("feedback-reason-select"), {
      target: { value: "wrong_position" },
    });
    const commentInput = view.getByTestId("feedback-comment-input") as HTMLTextAreaElement;
    act(() => {
      commentInput.value = "No va mid en este parche";
      commentInput.dispatchEvent(new Event("input", { bubbles: true }));
    });

    fireEvent.click(view.getByTestId("feedback-submit-btn"));

    await waitFor(() => {
      expect(view.getByTestId("feedback-submitted-state")).toBeDefined();
    });

    expect(capturedBody).toEqual({
      rating: "negative",
      heroId: 25,
      targetPosition: 2,
      reason: "wrong_position",
      comment: "No va mid en este parche",
      stateIdentity: "state-hash-2",
    });
  });

  test("previene envíos repetidos deshabilitando y marcando el estado ya registrado", async () => {
    global.fetch = (async () => {
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as unknown as typeof fetch;

    const view = render(
      <RecommendationFeedback
        sessionId="session-3"
        heroId={1}
        stateIdentity="state-hash-3"
      />,
    );

    fireEvent.click(view.getByTestId("feedback-thumb-up"));
    fireEvent.click(view.getByTestId("feedback-submit-btn"));

    await waitFor(() => {
      expect(view.getByTestId("feedback-submitted-state")).toBeDefined();
    });

    // Desmontar y volver a montar con la misma clave de recomendación: debe inicializarse como ya enviado
    view.unmount();

    const view2 = render(
      <RecommendationFeedback
        sessionId="session-3"
        heroId={1}
        stateIdentity="state-hash-3"
      />,
    );

    expect(view2.getByTestId("feedback-submitted-state")).toBeDefined();
    expect(view2.queryByTestId("feedback-thumb-up")).toBeNull();
  });

  test("maneja respuesta duplicate_submission del servidor mostrando aviso y bloqueando nuevo envío", async () => {
    global.fetch = (async () => {
      return new Response(JSON.stringify({ error: "duplicate_submission" }), { status: 409 });
    }) as unknown as typeof fetch;

    const view = render(
      <RecommendationFeedback
        sessionId="session-4"
        heroId={1}
        stateIdentity="state-hash-4"
      />,
    );

    fireEvent.click(view.getByTestId("feedback-thumb-up"));
    fireEvent.click(view.getByTestId("feedback-submit-btn"));

    await waitFor(() => {
      expect(view.getByTestId("feedback-submitted-state")).toBeDefined();
    });

    expect(view.container.textContent).toContain("Ya enviaste feedback para esta recomendación.");
  });

  test("maneja respuesta sensitive_data_rejected del servidor", async () => {
    global.fetch = (async () => {
      return new Response(JSON.stringify({ error: "sensitive_data_rejected" }), { status: 400 });
    }) as unknown as typeof fetch;

    const view = render(
      <RecommendationFeedback
        sessionId="session-5"
        heroId={1}
      />,
    );

    fireEvent.click(view.getByTestId("feedback-thumb-up"));
    fireEvent.click(view.getByTestId("feedback-submit-btn"));

    await waitFor(() => {
      expect(view.getByTestId("feedback-status-message")).toBeDefined();
    });

    expect(view.getByTestId("feedback-status-message").textContent).toContain("El comentario contiene datos no permitidos.");
    expect(view.container.textContent).not.toMatch(/incorrect|equivocad|error|no deberías/i);
  });

  test("botón cancelar vuelve a la vista inicial", () => {
    const view = render(
      <RecommendationFeedback
        sessionId="session-6"
        heroId={1}
      />,
    );

    fireEvent.click(view.getByTestId("feedback-thumb-up"));
    expect(view.getByTestId("feedback-form")).toBeDefined();

    fireEvent.click(view.getByTestId("feedback-cancel-btn"));
    expect(view.queryByTestId("feedback-form")).toBeNull();
    expect(view.getByTestId("feedback-thumb-up")).toBeDefined();
  });
});
