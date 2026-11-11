import "@/test-support/happy-dom";

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { StateTarget } from "./StateTarget";

afterEach(cleanup);

const base = { title: "Pos3 Offlane", value: "Centaur Warrunner" };

describe("StateTarget · prop opcional `pressed` (Fase 3D.2)", () => {
  it("LEGACY intacto: sin `pressed`, aria-pressed sigue a state === \"selected\" y no aparece data-pressed", () => {
    const rest = render(<StateTarget {...base} onPress={() => undefined} state="rest" />).getByRole("button");
    expect(rest.getAttribute("aria-pressed")).toBe("false");
    expect(rest.hasAttribute("data-pressed")).toBe(false);
    cleanup();
    const selected = render(<StateTarget {...base} onPress={() => undefined} state="selected" />).getByRole("button");
    expect(selected.getAttribute("aria-pressed")).toBe("true");
    expect(selected.hasAttribute("data-pressed")).toBe(false);
  });

  it("`recommended` + `pressed`: conserva el estado (muesca) Y anuncia aria-pressed=true", () => {
    const view = render(<StateTarget {...base} notch="ELIGE AHORA" onPress={() => undefined} pressed state="recommended" />);
    const button = view.getByRole("button");
    expect(button.getAttribute("data-state")).toBe("recommended");
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("data-pressed")).toBe("true");
    expect(view.getByText("ELIGE AHORA")).toBeDefined();
  });

  it("`recommended` SIN pressed (explícito false) anuncia aria-pressed=false", () => {
    const button = render(<StateTarget {...base} onPress={() => undefined} pressed={false} state="recommended" />).getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.hasAttribute("data-pressed")).toBe(false);
  });

  it("`pressed` explícito manda sobre el estado: selected + pressed={false} => false", () => {
    const button = render(<StateTarget {...base} onPress={() => undefined} pressed={false} state="selected" />).getByRole("button");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });

  it("un único control: un button y ninguno anidado; Enter/Espacio/clic los da el button nativo", () => {
    let presses = 0;
    const view = render(<StateTarget {...base} onPress={() => { presses += 1; }} pressed state="recommended" />);
    expect(view.container.querySelectorAll("button").length).toBe(1);
    expect(view.container.querySelectorAll("button button, [role=button]").length).toBe(0);
    fireEvent.click(view.getByRole("button"));
    expect(presses).toBe(1);
  });

  it("sin onPress (div) no emite aria-pressed ni data-pressed aunque se pase `pressed`", () => {
    const view = render(<StateTarget {...base} pressed state="recommended" />);
    expect(view.container.querySelector("button")).toBeNull();
    expect(view.container.querySelector("[aria-pressed]")).toBeNull();
    expect(view.container.querySelector("[data-pressed]")).toBeNull();
  });

  it("CSS: el segmento espectral se dibuja para `selected` Y para `[data-pressed=true]`; reduced motion ya cubre `.cx-target-seg`", () => {
    const css = readFileSync(new URL("./primitives.css", import.meta.url), "utf8");
    expect(css).toContain('.cx-target:is([data-state="selected"], [data-pressed="true"]) .cx-target-seg { opacity: 1; transform: scaleX(1); }');
    expect(css).toContain(".cx-target-seg");
    expect(css.match(/\[data-motion="reduced"\] :is\([^)]*\.cx-target-seg/g)?.length).toBe(1);
  });
});
