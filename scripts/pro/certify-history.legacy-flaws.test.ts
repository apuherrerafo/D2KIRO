import { describe, expect, test } from "bun:test";
import { normalizeDraft, type MatchDetail, type ProMatchSummary } from "./ingest-drafts";

// V7 PR-3A: casos que DEMUESTRAN los defectos del flujo legacy (`ingest-drafts.ts`), sin modificarlo.
// Son pruebas de caracterización: pasan porque el defecto existe hoy. Justifican que el puente nuevo
// (`certify-history.ts`) NO reutilice `normalizeDraft` como fuente confiable.

const SUMMARY: ProMatchSummary = { match_id: 7100000001, start_time: 1_790_000_000, leagueid: 15000 };

function twentyFourTurns(): NonNullable<MatchDetail["picks_bans"]> {
  return Array.from({ length: 24 }, (_, i) => ({ order: i, is_pick: i >= 7 && i < 9, hero_id: i + 1, team: (i % 2) as 0 | 1 }));
}

function detail(overrides: Partial<MatchDetail> = {}): MatchDetail {
  return {
    patch: 60, game_mode: 2, radiant_win: true, leagueid: 15000,
    league: { tier: "premium", name: "Liga ficticia" },
    picks_bans: twentyFourTurns(), players: [], od_data: { has_gcdata: true },
    ...overrides,
  };
}

describe("flujo legacy: defectos demostrados", () => {
  test("ganador ausente se convierte en victoria Dire", () => {
    const { radiant_win: _omitted, ...withoutWinner } = detail();
    expect(normalizeDraft(SUMMARY, withoutWinner, "premium").winningSide).toBe("dire");
  });

  test("el tier lo dicta el propio payload de la partida, no un catálogo de ligas", () => {
    const row = normalizeDraft(SUMMARY, detail({ leagueid: 999999, league: { tier: "premium" } }), "premium");
    expect(row.leagueTier).toBe("premium");
  });

  test("conserva raw_json completo del detalle", () => {
    const row = normalizeDraft(SUMMARY, detail({ players: [{ hero_id: 1, isRadiant: true }] }), "premium");
    expect(row.rawJson).toContain("players");
  });

  test("un draft Captain's Mode incompleto pero legítimo se descarta por exigir 24 turnos", () => {
    const row = normalizeDraft(SUMMARY, detail({ picks_bans: twentyFourTurns().slice(0, 12) }), "premium");
    expect(row.status).toBe("unclassifiable");
    expect(row.reason).toBe("invalid_draft_shape");
  });

  test("el parche queda como cadena de id de la fuente, sin distinguir etiqueta de id", () => {
    expect(normalizeDraft(SUMMARY, detail({ patch: 60 }), "premium").patch).toBe("60");
  });
});
