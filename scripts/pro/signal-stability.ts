export interface SignalSnapshot { readonly signal: string; readonly raw: number | null; }
export interface SignalStability { readonly signal: string; readonly meanAbsoluteDelta: number; readonly changed: boolean; }
export interface SignalContribution extends SignalStability {
  readonly weightedContribution: number;
  readonly changedPairs: number;
}

export function classifyPressurePair(banPressureDelta: number, irrelevantThreshold = 0.15): "irrelevant" | "pivotal" {
  return banPressureDelta < irrelevantThreshold ? "irrelevant" : "pivotal";
}

export function analyzeSignalContributions(
  before: readonly (readonly SignalSnapshot[])[],
  after: readonly (readonly SignalSnapshot[])[],
  weights: Readonly<Record<string, number>>,
  threshold = 0.05,
): readonly SignalContribution[] {
  const totals = new Map<string, { delta: number; changed: number }>();
  const pairs = Math.min(before.length, after.length);
  for (let i = 0; i < pairs; i += 1) {
    const left = new Map(before[i]!.map((entry) => [entry.signal, entry.raw]));
    const right = new Map(after[i]!.map((entry) => [entry.signal, entry.raw]));
    for (const signal of new Set([...left.keys(), ...right.keys()])) {
      const a = left.get(signal);
      const b = right.get(signal);
      // null means “no evidence”; appearance/disappearance is not a measured delta.
      const delta = a === null || a === undefined || b === null || b === undefined ? 0 : Math.abs(b - a);
      const current = totals.get(signal) ?? { delta: 0, changed: 0 };
      current.delta += delta;
      if (delta > threshold) current.changed += 1;
      totals.set(signal, current);
    }
  }
  return [...totals.entries()].map(([signal, value]) => {
    const mean = pairs === 0 ? 0 : Math.round((value.delta / pairs) * 1_000_000) / 1_000_000;
    const weighted = Math.round(mean * (weights[signal] ?? 0) * 1_000_000) / 1_000_000;
    return { signal, meanAbsoluteDelta: mean, weightedContribution: weighted, changedPairs: value.changed };
  }).sort((a, b) => b.weightedContribution - a.weightedContribution || a.signal.localeCompare(b.signal));
}

export function compareSignalSnapshots(before: readonly SignalSnapshot[], after: readonly SignalSnapshot[], threshold = 0.05): readonly SignalStability[] {
  const right = new Map(after.map((entry) => [entry.signal, entry.raw]));
  return before.map((entry) => {
    const next = right.get(entry.signal);
    const rawDelta = entry.raw === null || next === undefined || next === null ? 0 : Math.abs(next - entry.raw);
    const delta = Math.round(rawDelta * 1_000_000) / 1_000_000;
    return { signal: entry.signal, meanAbsoluteDelta: delta, changed: delta > threshold };
  }).sort((a, b) => a.signal.localeCompare(b.signal));
}
