import { expect, test } from "bun:test";
import { diffPackets, type Packet } from "./packet-diff";

const hero = (heroId: number, name: string) => ({ heroId, name });
const point = (shortlist: string[], personal: string[] | "covered", label = "Reveal Support") => ({
  label: "decision",
  coach: {
    primaryAction: { kind: "REVEAL_POSITION", positionsNamed: ["Support (Pos 4)"], label },
    teamShortlist: shortlist.map((name, i) => hero(i + 1, name)),
    personalHeroView: personal === "covered" ? { label: "TU CARRY AHORA", seatCovered: true } : { label: "TU CARRY AHORA", ranking: personal.map((name, i) => hero(i + 100, name)) },
  },
});
const packet = (key: string, points: ReturnType<typeof point>[]): Packet => ({ scenarios: [{ id: "S01", opaqueScenarioKey: key, selection: "by-definition", decisionPoints: points }] });

test("dos paquetes idénticos no producen ningún cambio", () => {
  const a = packet("k1", [point(["Techies", "Lion"], ["Weaver", "Riki"])]);
  const result = diffPackets(a, JSON.parse(JSON.stringify(a)) as Packet);

  expect(result.changes).toEqual([]);
  expect(result.pointsChanged).toBe(0);
  expect(result.scenariosOnDifferentDrafts).toEqual([]);
});

test("reporta sólo las superficies que cambiaron, con antes/después, y marca los drafts que divergieron", () => {
  const a = packet("k1", [point(["Techies", "Lion"], ["Weaver", "Riki"])]);
  const b = packet("k2", [point(["Techies", "Lion"], ["Weaver", "Pugna"])]);
  const result = diffPackets(a, b);

  expect(result.changes).toEqual([{ scenario: "S01", point: "decision", surface: "personal ranking", before: "Weaver, Riki", after: "Weaver, Pugna" }]);
  expect(result.pointsChanged).toBe(1);
  expect(result.scenariosOnDifferentDrafts).toEqual(["S01"]);
});

test("distingue 'asiento cubierto' de una lista y detecta un cambio de acción principal", () => {
  const a = packet("k1", [point(["Techies"], "covered", "Reveal Support")]);
  const b = packet("k1", [point(["Techies"], ["Weaver"], "Reveal Carry")]);
  const surfaces = diffPackets(a, b).changes.map((change) => change.surface);

  expect(surfaces).toEqual(["primary action", "personal ranking"]);
});
