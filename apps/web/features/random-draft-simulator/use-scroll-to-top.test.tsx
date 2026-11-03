import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { useScrollToTop } from "./use-scroll-to-top";

afterEach(cleanup);

function Probe({ round }: { round: number }) {
  useScrollToTop(round);
  return null;
}

describe("useScrollToTop", () => {
  const calls: number[] = [];
  beforeEach(() => {
    calls.length = 0;
    window.scrollTo = ((options: ScrollToOptions) => {
      calls.push(options.top ?? -1);
    }) as typeof window.scrollTo;
  });

  test("al montar sube al inicio (el draft arranca desde el final de un formulario largo)", () => {
    render(<Probe round={1} />);
    expect(calls).toEqual([0]);
  });

  test("al cambiar de ronda vuelve a subir", () => {
    const view = render(<Probe round={1} />);
    view.rerender(<Probe round={2} />);
    expect(calls).toEqual([0, 0]);
  });

  test("CANDADO: re-renderizar dentro de la misma ronda NO mueve el scroll (el jugador está eligiendo en la grilla)", () => {
    const view = render(<Probe round={2} />);
    view.rerender(<Probe round={2} />);
    view.rerender(<Probe round={2} />);
    expect(calls).toEqual([0]);
  });
});
