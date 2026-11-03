import type { CaptainsModeTurnTable } from "../draft/draft-format-turns";
import type { CaptainsModeRecord, UnorderedDraftRecord } from "./types";

// Fixtures INLINE para las pruebas de draft-history. Jamás se lee `draft-format-turns.json` ni dato
// curado real (invariantes.md): la tabla de abajo sólo tiene la FORMA de la real, con el largo que
// cada prueba necesite -- el validador no conoce ningún número de turnos.

// Universo de héroes FIXTURE (ids 1..100). Las pruebas lo inyectan: jamás leen `CURATED_HERO_IDS`
// real, que se regenera por parche. `OUT_OF_UNIVERSE_HERO` es un HeroID entero válido fuera de él.
export const TEST_HERO_UNIVERSE: ReadonlySet<number> = new Set(Array.from({ length: 100 }, (_, i) => i + 1));
export const OUT_OF_UNIVERSE_HERO = 500;

const BAN = 15000;
const PICK = 30000;

// 6 acciones: ban F, ban S, pick F, pick S, ban S, pick F. Asimétrica a propósito (un solo
// alternado A-B-A-B no distinguiría una tabla leída de una suposición).
export const SHORT_TABLE: CaptainsModeTurnTable = {
  reserveTimeMs: 130000,
  turns: [
    { action: "ban", team: "first", standardTimeMs: BAN },
    { action: "ban", team: "second", standardTimeMs: BAN },
    { action: "pick", team: "first", standardTimeMs: PICK },
    { action: "pick", team: "second", standardTimeMs: PICK },
    { action: "ban", team: "second", standardTimeMs: PICK },
    { action: "pick", team: "first", standardTimeMs: PICK },
  ],
};

// 24 acciones con la estructura documentada de Captain's Mode (7 bans + 2 picks + 3 bans + 6 picks
// + 4 bans + 2 picks), copiada a mano -- no se importa la tabla real.
function makeLongTable(): CaptainsModeTurnTable {
  const shape: Array<["ban" | "pick", "first" | "second"]> = [
    ["ban", "first"], ["ban", "first"], ["ban", "second"], ["ban", "second"],
    ["ban", "first"], ["ban", "second"], ["ban", "second"],
    ["pick", "first"], ["pick", "second"],
    ["ban", "first"], ["ban", "first"], ["ban", "second"],
    ["pick", "second"], ["pick", "first"], ["pick", "first"],
    ["pick", "second"], ["pick", "second"], ["pick", "first"],
    ["ban", "first"], ["ban", "second"], ["ban", "first"], ["ban", "second"],
    ["pick", "first"], ["pick", "second"],
  ];
  return {
    reserveTimeMs: 130000,
    turns: shape.map(([action, team]) => ({
      action,
      team,
      standardTimeMs: action === "ban" ? BAN : PICK,
    })),
  };
}
export const LONG_TABLE: CaptainsModeTurnTable = makeLongTable();

/** Sello de certificación de liga de ejemplo (liga ficticia): lo que `scripts/pro/certify-history.ts` escribe tras contrastar la liga. */
export const CERTIFIED_STAMP = { leagueId: 15001, tier: "premium", verifiedAt: "2026-10-20T12:00:00Z" } as const;

/** Procedencia de una partida de liga CERTIFICADA: la única que el índice considera elegible. */
export function certifiedLeagueProvenance(sourceMatchId: string, fetchedAt: string | null = null) {
  return { source: "opendota_league", sourceMatchId, fetchedAt, leagueCertification: CERTIFIED_STAMP } as const;
}

export function validProvenance(sourceMatchId = "7000000001") {
  return { source: "opendota_match", sourceMatchId, fetchedAt: "2026-10-20T12:00:00Z" } as const;
}

// Registro Captain's Mode completo sobre `table`: héroe `i + 1` en la acción `i`.
export function captainsModeRecord(
  table: CaptainsModeTurnTable,
  firstActionSide: "radiant" | "dire" = "radiant",
  overrides: Partial<CaptainsModeRecord> = {},
): CaptainsModeRecord {
  const second = firstActionSide === "radiant" ? "dire" : "radiant";
  return {
    schemaVersion: 1,
    format: "captains_mode",
    provenance: validProvenance(),
    evidenceClass: "professional",
    outcome: { status: "known", winner: "radiant" },
    patch: { state: "exact", label: "7.41e" },
    sourceGameMode: 2,
    positions: [],
    firstActionSide,
    completeness: "complete",
    actions: table.turns.map((turn, i) => ({
      order: i,
      action: turn.action,
      side: turn.team === "first" ? firstActionSide : second,
      heroId: i + 1,
    })),
    ...overrides,
  };
}

export function rankedAllPickRecord(overrides: Partial<UnorderedDraftRecord> = {}): UnorderedDraftRecord {
  return {
    schemaVersion: 1,
    format: "ranked_all_pick",
    provenance: validProvenance("7000000002"),
    evidenceClass: "ranked",
    outcome: { status: "unknown" },
    patch: { state: "exact", label: "7.41e" },
    sourceGameMode: 22,
    positions: [],
    picks: {
      radiant: { heroIds: [11, 12, 13, 14, 15], complete: true },
      dire: { heroIds: [21, 22, 23, 24, 25], complete: true },
    },
    bans: { status: "confirmed_visible", heroIds: [31, 32, 33] },
    ...overrides,
  };
}
