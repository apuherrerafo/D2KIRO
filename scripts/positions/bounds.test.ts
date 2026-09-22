import { expect, test } from "bun:test";
import { isCredibleForPosition, parseHeroPositions, positionShare } from "../../apps/engine/src/signals/hero-positions";
import { classifyLegacyPositions, summarizeUniverse, withWidestDenominator } from "./bounds";

// Inline fixtures only (S10): never the real hero-positions.json.
const legacy = [
  // Earthshaker-like: 1026/3995 = 25.7% legacy share, but with 2 unlisted positions (< 200 each) the share can fall to 1026/4393 = 23.4%.
  { hero: 1, positions: [{ position: 1, matches: 2969 }, { position: 3, matches: 1026 }] },
  // Solid secondary: 2000/6000 = 33% legacy; even with 2 unlisted positions at 199 the share is 2000/6398 = 31% >= 25%.
  { hero: 2, positions: [{ position: 1, matches: 3000 }, { position: 4, matches: 2000 }, { position: 5, matches: 1000 }] },
  // Dominant single survivor with 4 unlisted positions.
  { hero: 3, positions: [{ position: 5, matches: 300 }] },
  // Below both rules: legacy share 10%.
  { hero: 4, positions: [{ position: 1, matches: 900 }, { position: 3, matches: 100 + 100 }] },
];

test("clasifica dominante / probada / no probada con el denominador más ancho posible", () => {
  const bounds = classifyLegacyPositions(legacy);
  const grade = (hero: number, position: number) => bounds.find((b) => b.hero === hero && b.position === position)!.grade;

  expect(grade(1, 1)).toBe("dominant");
  expect(grade(1, 3)).toBe("unproven-by-share");
  expect(grade(2, 4)).toBe("proven-by-share");
  expect(grade(2, 5)).toBe("not-admitted"); // 16.7% legacy share: no denominator can raise it
  expect(grade(3, 5)).toBe("dominant"); // dominance can never be overturned by unlisted (< floor) positions
  expect(grade(4, 3)).toBe("not-admitted");
});

test("las cotas son consistentes: shareLower <= shareUpper y shareUpper es exactamente el share legado m/S", () => {
  const b = classifyLegacyPositions(legacy).find((x) => x.hero === 1 && x.position === 3)!;

  expect(b.listedTotal).toBe(3995);
  expect(b.unlistedPositions).toBe(3);
  expect(b.shareUpper).toBeCloseTo(1026 / 3995, 12);
  expect(b.shareLower).toBeCloseTo(1026 / (3995 + 3 * 199), 12);
  expect(b.shareLower).toBeLessThan(b.shareUpper);
});

test("el universo corregido es un subconjunto del legado: guaranteed + unproven = legacy, por posición", () => {
  const summary = summarizeUniverse(classifyLegacyPositions(legacy));

  for (const row of summary) expect(row.guaranteed + row.unproven).toBe(row.legacy);
  expect(summary.find((row) => row.position === 3)!.unproven).toBe(1);
});

test("el envelope pesimista sólo baja shares: el dominante sigue admitido, el secundario no probado deja de estarlo, nada se agrega", () => {
  const positions = parseHeroPositions(legacy);
  const widest = withWidestDenominator(positions);

  expect(positionShare(1, 3, positions)).toBeGreaterThanOrEqual(0.25); // legacy: admitted by share
  expect(isCredibleForPosition(1, 3, positions)).toBe(true);
  expect(positionShare(1, 3, widest)).toBeCloseTo(1026 / (3995 + 3 * 199), 12);
  expect(isCredibleForPosition(1, 3, widest)).toBe(false);
  expect(isCredibleForPosition(1, 1, widest)).toBe(true); // dominance is denominator-proof
  expect(isCredibleForPosition(2, 4, widest)).toBe(true); // proven-by-share stays admitted
  expect(Object.keys(widest)).toEqual(Object.keys(positions));
  expect(widest[1]!.map((s) => s.position)).toEqual(positions[1]!.map((s) => s.position));
});
