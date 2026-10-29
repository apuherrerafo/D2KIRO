import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test } from "bun:test";
import { RoundInstruction } from "./RoundInstruction";

afterEach(cleanup);

describe("RoundInstruction", () => {
  test("dice la ronda y cuántos héroes elegir (plural)", () => {
    const view = render(<RoundInstruction round={2} capacity={2} revealed={false} />);
    expect(view.getByTestId("round-instruction").textContent).toContain("Ronda 2 de 3 · Elige 2 héroes");
  });

  test("con 1 solo espacio dice 'Elige 1 héroe' (singular, nunca '1 héroes')", () => {
    const view = render(<RoundInstruction round={3} capacity={1} revealed={false} />);
    const text = view.getByTestId("round-instruction").textContent ?? "";
    expect(text).toContain("Elige 1 héroe");
    expect(text).not.toContain("1 héroes");
  });

  test("mientras el motor no informa la capacidad no inventa un número", () => {
    const view = render(<RoundInstruction round={1} capacity={null} revealed={false} />);
    const text = view.getByTestId("round-instruction").textContent ?? "";
    expect(text).toContain("Elige tus héroes");
    expect(text).not.toMatch(/Elige \d/);
  });

  test("explica el sellado: el rival ve los picks recién al cerrar la ronda", () => {
    const view = render(<RoundInstruction round={1} capacity={2} revealed={false} />);
    expect(view.getByTestId("round-instruction").textContent).toContain("sellados");
  });

  test("ronda ya revelada: no pide elegir, manda a mirar lo que eligió el rival", () => {
    const view = render(<RoundInstruction round={1} capacity={2} revealed />);
    const text = view.getByTestId("round-instruction").textContent ?? "";
    expect(text).toContain("Ronda 1 terminada");
    expect(text).not.toContain("Elige");
  });
});
