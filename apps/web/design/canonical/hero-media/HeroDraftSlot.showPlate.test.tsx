import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "bun:test";
import { HeroDraftSlot } from "./HeroDraftSlot";

afterEach(cleanup);

describe("HeroDraftSlot · prop opcional `showPlate` (Fase 3D.2)", () => {
  it("DEFAULT intacto: la placa con el nombre se muestra (consumidores existentes no cambian)", () => {
    const view = render(<HeroDraftSlot hero="Tusk" state="available" />);
    expect(view.container.querySelector(".chm-portrait-plate")).not.toBeNull();
    expect(view.container.querySelector(".chm-portrait-name")?.textContent).toBe("Tusk");
  });

  it("showPlate={true} explícito = default", () => {
    const view = render(<HeroDraftSlot hero="Tusk" showPlate state="available" />);
    expect(view.container.querySelector(".chm-portrait-plate")).not.toBeNull();
  });

  it("showPlate={false} oculta SOLO la placa: retrato, riel de atributo, marco de esquinas y segmento siguen", () => {
    const view = render(<HeroDraftSlot hero="Tusk" showPlate={false} state="selected" />);
    expect(view.container.querySelector(".chm-portrait-plate")).toBeNull();
    expect(view.container.querySelector(".chm-portrait-img, .chm-portrait-fallback")).not.toBeNull();
    expect(view.container.querySelector(".chm-portrait-rail")).not.toBeNull();
    expect(view.container.querySelector(".chm-slot-frame")).not.toBeNull();
    expect(view.container.querySelector(".chm-slot-seg")).not.toBeNull();
    expect(view.container.querySelector(".chm-slot")?.getAttribute("data-state")).toBe("selected");
  });

  it("showPlate={false} no cambia el comportamiento interactivo ni el estado recomendado", () => {
    let clicks = 0;
    const view = render(<HeroDraftSlot hero="Tusk" onClick={() => { clicks += 1; }} showPlate={false} state="recommended" />);
    const slot = view.getByRole("button");
    slot.click();
    expect(clicks).toBe(1);
    expect(slot.getAttribute("data-state")).toBe("recommended");
  });

  it("un asiento `unknown` sigue sin placa con o sin la prop", () => {
    expect(render(<HeroDraftSlot state="unknown" />).container.querySelector(".chm-portrait-plate")).toBeNull();
  });
});
