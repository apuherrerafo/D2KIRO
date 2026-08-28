import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { FakeSocket } from "@/features/draft/fake-socket";
import { useDraftStore } from "@/features/draft/store";
import { DraftIntentSelector, DraftIntentSelectorConnected, isIntentActive } from "./DraftIntentSelector";

afterEach(cleanup);

describe("isIntentActive", () => {
  test("un chip está activo solo si es exactamente la intención actual", () => {
    expect(isIntentActive("push", "push")).toBe(true);
    expect(isIntentActive("push", "scaling")).toBe(false);
  });

  test('"Sin intención" (null) está activo solo cuando no hay intención', () => {
    expect(isIntentActive(null, null)).toBe(true);
    expect(isIntentActive("teamfight", null)).toBe(false);
  });
});

describe("DraftIntentSelector (prop-driven)", () => {
  test("elegir un chip llama onChange con el literal correcto", () => {
    const onChange = mock((_: unknown) => {});
    const { getByRole } = render(<DraftIntentSelector value={null} onChange={onChange} />);
    getByRole("button", { name: "Teamfight" }).click();
    expect(onChange).toHaveBeenCalledWith("teamfight");
  });

  test('"Sin intención" llama onChange con null', () => {
    const onChange = mock((_: unknown) => {});
    const { getByRole } = render(<DraftIntentSelector value="pickoff" onChange={onChange} />);
    getByRole("button", { name: "Sin intención" }).click();
    expect(onChange).toHaveBeenCalledWith(null);
  });

  test("el chip activo se marca con aria-pressed", () => {
    const { getByRole } = render(<DraftIntentSelector value="push" onChange={() => {}} />);
    expect(getByRole("button", { name: "Push" }).getAttribute("aria-pressed")).toBe("true");
    expect(getByRole("button", { name: "Scaling" }).getAttribute("aria-pressed")).toBe("false");
  });
});

describe("DraftIntentSelectorConnected (/live-draft)", () => {
  beforeEach(() => {
    useDraftStore.setState({ connectionStatus: "desconectado", sessionId: null, socket: null, archetypeIntent: null });
  });

  test("elegir un chip actualiza el store y manda set_intent por el socket", () => {
    const socket = new FakeSocket();
    useDraftStore.getState().connect(socket, "s1", "test-token");
    socket.sentMessages.length = 0;

    const { getByRole } = render(<DraftIntentSelectorConnected />);
    getByRole("button", { name: "Teamfight" }).click();

    expect(useDraftStore.getState().archetypeIntent).toBe("teamfight");
    expect(socket.sentMessages).toEqual([{ schema: "draft-ws/v1", type: "set_intent", sessionId: "s1", archetypeIntent: "teamfight" }]);
  });
});
