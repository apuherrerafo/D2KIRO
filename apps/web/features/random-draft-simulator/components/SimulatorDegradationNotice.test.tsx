import "@/test-support/happy-dom";

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, mock, test } from "bun:test";

let metaStatus: { isStale: boolean; syncedAt: string | null } | undefined;

mock.module("@/lib/engine-api", () => ({
  useGetMetaStatusQuery: () => ({ data: metaStatus }),
}));

const { SimulatorDegradationNotice } = await import("./SimulatorDegradationNotice");

afterEach(() => {
  cleanup();
  metaStatus = undefined;
});

test("sin degradaciones no dibuja nada", () => {
  const { queryByTestId } = render(<SimulatorDegradationNotice degradations={[]} />);
  expect(queryByTestId("simulator-degradations")).toBeNull();
});

test("una degradación del motor se dice en lenguaje de jugador, una sola vez", () => {
  const { getByTestId } = render(
    <SimulatorDegradationNotice
      degradations={[
        { reason: "partial_signals", detail: "V6 degraded flag: partial_signals" },
        { reason: "partial_signals", detail: "V6 degraded flag: partial_signals" },
      ]}
    />,
  );
  const notice = getByTestId("simulator-degradations");
  expect(notice.textContent).toContain("Recomendación con señales parciales");
  expect(notice.textContent).not.toContain("V6 degraded flag");
  expect(notice.querySelectorAll("p")).toHaveLength(1);
});

test("meta desactualizada: el motor lo dice y el banner del estado del meta NO está visible -> se conserva aquí", () => {
  metaStatus = { isStale: false, syncedAt: null };
  const { getByTestId } = render(<SimulatorDegradationNotice degradations={[{ reason: "stale_meta", detail: "V6 degraded flag: stale_meta" }]} />);
  expect(getByTestId("simulator-degradations").textContent).toContain("Datos de meta desactualizados");
});

test("meta desactualizada con el StaleWarningBanner ya visible: no se repite el mismo aviso", () => {
  metaStatus = { isStale: true, syncedAt: null };
  const { queryByTestId } = render(<SimulatorDegradationNotice degradations={[{ reason: "stale_meta", detail: "V6 degraded flag: stale_meta" }]} />);
  expect(queryByTestId("simulator-degradations")).toBeNull();
});
