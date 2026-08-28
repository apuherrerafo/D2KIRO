import { expect, test } from "bun:test";
import type { ProDraft } from "../../apps/engine/src/pro/types";
import { parseCaptainsModeTurnTable, type CaptainsModeTurnTable } from "../../apps/engine/src/draft/draft-format-turns";
import { normalizeDraft, type DraftPhase } from "./normalize";

const table: CaptainsModeTurnTable = parseCaptainsModeTurnTable({
  reserveTimeMs: 130000,
  turns: [
    ...Array.from({ length: 7 }, () => ({ action: "ban", team: "first", standardTimeMs: 15000 })),
    { action: "pick", team: "first", standardTimeMs: 30000 }, { action: "pick", team: "second", standardTimeMs: 30000 },
    { action: "ban", team: "first", standardTimeMs: 30000 }, { action: "ban", team: "first", standardTimeMs: 30000 }, { action: "ban", team: "second", standardTimeMs: 30000 },
    ...Array.from({ length: 6 }, () => ({ action: "pick", team: "first", standardTimeMs: 30000 })),
    ...Array.from({ length: 4 }, () => ({ action: "ban", team: "first", standardTimeMs: 30000 })),
    { action: "pick", team: "first", standardTimeMs: 30000 }, { action: "pick", team: "second", standardTimeMs: 30000 },
  ],
})!;

const draft = (overrides: Partial<ProDraft> = {}): ProDraft => ({
  matchId: "m", leagueId: 1, patch: "7.41e", startTime: 1, gameMode: 2,
  radiantTeamId: null, direTeamId: null, winningSide: "radiant",
  turns: Array.from({ length: 24 }, (_, order) => ({ order, isPick: table.turns[order].action === "pick", heroId: order + 1, team: order % 2 as 0 | 1 })),
  slots: [
    { heroId: 1, team: 0, positionEst: 1, laneRole: 3, isRoaming: false, netWorth: 100 },
    { heroId: 2, team: 0, positionEst: 2, laneRole: 3, isRoaming: false, netWorth: 200 },
  ],
  ref: { source: "opendota_match", fetchedAt: "2026-01-01T00:00:00Z", sampleSize: 1 },
  ...overrides,
});

const expected: DraftPhase[] = [
  "opening_bans", "opening_bans", "opening_bans", "opening_bans", "opening_bans", "opening_bans", "opening_bans",
  "opening_picks", "opening_picks", "mid_bans", "mid_bans", "mid_bans", "mid_picks", "mid_picks", "mid_picks", "mid_picks", "mid_picks", "mid_picks",
  "closing_bans", "closing_bans", "closing_bans", "closing_bans", "closing_picks", "closing_picks",
];

test.each(expected.map((phase, order) => [order, phase] as const))("normaliza el turno %d con la fase de la tabla", (order, phase) => {
  const result = normalizeDraft(draft(), table);
  expect(result.turns.find((turn) => turn.order === order)?.phase).toBe(phase);
});

test("deriva cuándo se reveló cada héroe y conserva las dos señales de posición", () => {
  const result = normalizeDraft(draft(), table);
  expect(result.revealedAtTurnByHero["8"]).toBe(7);
  expect(result.slots[1]).toMatchObject({ positionEst: 2, laneRole: 3, isRoaming: false, netWorth: 200, netWorthRank: 1 });
});

test("draft incompleto no lanza y marca turnos ausentes", () => {
  const result = normalizeDraft(draft({ turns: draft().turns.slice(0, 3) }), table);
  expect(result.missingOrders).toHaveLength(21);
  expect(result.turns).toHaveLength(3);
});

test("All Pick (game_mode distinto de 2) devuelve turnos sin fase", () => {
  const result = normalizeDraft(draft({ gameMode: 1 }), table);
  expect(result.turns.every((turn) => turn.phase === null)).toBe(true);
  expect(result.unsupportedGameMode).toBe(true);
});
