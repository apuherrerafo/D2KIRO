import { describe, expect, test } from "bun:test";
import type { SignalContribution, SignalId } from "@/features/draft/types";
import { sortByPriority } from "./SignalBreakdown";

function signal(id: SignalId): SignalContribution {
  return { signal: id, raw: 0.5, weighted: 0.1, explanation: `explicación de ${id}`, sampleSize: 10 };
}

describe("sortByPriority", () => {
  test("reordena las señales tácticas (team_synergy/counter/position_fit) antes que patch_meta/hero_pool_fit", () => {
    // Orden de wire real del motor (STATIC_SCORERS de mix.ts): counter, patch_meta,
    // hero_pool_fit, position_fit, team_synergy -- deliberadamente NO es el orden de prioridad.
    const wireOrder = [signal("counter"), signal("patch_meta"), signal("hero_pool_fit"), signal("position_fit"), signal("team_synergy")];

    const result = sortByPriority(wireOrder).map((s) => s.signal);

    expect(result).toEqual(["team_synergy", "counter", "position_fit", "patch_meta", "hero_pool_fit"]);
  });

  test("no muta el array original", () => {
    const original = [signal("patch_meta"), signal("counter")];
    const originalOrder = original.map((s) => s.signal);

    sortByPriority(original);

    expect(original.map((s) => s.signal)).toEqual(originalOrder);
  });

  test("un subconjunto de señales (ej. solo 2 presentes) se ordena igual de bien", () => {
    const result = sortByPriority([signal("hero_pool_fit"), signal("position_fit")]).map((s) => s.signal);

    expect(result).toEqual(["position_fit", "hero_pool_fit"]);
  });
});
