import { describe, expect, test } from "bun:test";
import {
  captainsModeRecord,
  LONG_TABLE,
  SHORT_TABLE,
  TEST_HERO_UNIVERSE,
} from "../../apps/engine/src/draft-history/fixtures";
import {
  createArrayHistoryIndex,
  validateDraftHistoryRecord,
  type DraftHistoryObservation,
} from "../../apps/engine/src/draft-history";
import {
  buildLeagueCatalog,
  certifyProMatch,
  certifyProMatches,
  type CertifyContext,
  type CertifyResult,
} from "./certify-history";

// V7 PR-3A: pruebas del puente de confianza. Todo es fixture INLINE y sintético (ligas ficticias,
// héroes 1..N del universo de prueba): ninguna prueba abre una SQLite, un JSON curado ni la red.
// Estos unit tests son sintéticos; la validación contra partidas profesionales reales vive aparte,
// en un piloto offline (docs/research/pr3a-pilot/) que no forma parte de la suite.

const FETCHED_AT = "2026-10-22T12:00:00Z";
const MATCH_ID = 7100000001;
const LEAGUE_PREMIUM = 15001;
const LEAGUE_PRO = 15002;
const LEAGUE_AMATEUR = 15003;
const LEAGUE_EXCLUDED = 15004;

const CATALOG = buildLeagueCatalog([
  { leagueid: LEAGUE_PREMIUM, tier: "premium", name: "Liga Premium Ficticia" },
  { leagueid: LEAGUE_PRO, tier: "professional", name: "Liga Pro Ficticia" },
  { leagueid: LEAGUE_AMATEUR, tier: "amateur", name: "Liga Amateur Ficticia" },
  { leagueid: LEAGUE_EXCLUDED, tier: "excluded", name: "Liga Excluida Ficticia" },
]).catalog;

function context(overrides: Partial<CertifyContext> = {}): CertifyContext {
  return {
    catalog: CATALOG,
    captainsModeTable: SHORT_TABLE,
    fetchedAt: FETCHED_AT,
    heroUniverse: TEST_HERO_UNIVERSE,
    ...overrides,
  };
}

// SHORT_TABLE: ban F, ban S, pick F, pick S, ban S, pick F. Con Radiant primero (team 0), el héroe
// de la acción i es i + 1 => Radiant elige 3 y 6, Dire elige 4.
function pickBan(order: number, isPick: boolean, heroId: number, team: 0 | 1): Record<string, unknown> {
  return { order, is_pick: isPick, hero_id: heroId, team };
}
function shortPicksBans(): Record<string, unknown>[] {
  return [
    pickBan(0, false, 1, 0),
    pickBan(1, false, 2, 1),
    pickBan(2, true, 3, 0),
    pickBan(3, true, 4, 1),
    pickBan(4, false, 5, 1),
    pickBan(5, true, 6, 0),
  ];
}

function match(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    match_id: MATCH_ID,
    leagueid: LEAGUE_PREMIUM,
    league: { leagueid: LEAGUE_PREMIUM, tier: "premium", name: "Liga Premium Ficticia" },
    game_mode: 2,
    radiant_win: true,
    patch: 60,
    picks_bans: shortPicksBans(),
    ...overrides,
  };
}

function certified(result: CertifyResult) {
  if (result.status !== "certified") throw new Error(`esperaba certified, vino ${result.status}:${result.code}`);
  return result;
}

describe("certificación de liga", () => {
  test("liga premium del catálogo -> registro certificado con evidencia separada", () => {
    const result = certified(certifyProMatch({ match: match() }, context()));
    expect(result.record.provenance).toEqual({
      source: "opendota_league",
      sourceMatchId: "7100000001",
      fetchedAt: FETCHED_AT,
    });
    expect(result.record.evidenceClass).toBe("professional");
    expect(result.record.format).toBe("captains_mode");
    expect(result.record.sourceGameMode).toBe(2);
    expect(result.certification).toEqual({
      matchId: "7100000001",
      leagueId: LEAGUE_PREMIUM,
      tier: "premium",
      source: "opendota_leagues_catalog",
      verifiedAt: FETCHED_AT,
    });
    // La evidencia NO vive en el registro canónico (esquema cerrado de PR #49).
    expect(JSON.stringify(result.record)).not.toContain("tier");
    expect(JSON.stringify(result.record)).not.toContain("leagueId");
  });

  test("liga professional del catálogo -> certificada con tier professional", () => {
    const result = certified(
      certifyProMatch(
        { match: match({ leagueid: LEAGUE_PRO, league: { leagueid: LEAGUE_PRO, tier: "professional" } }) },
        context(),
      ),
    );
    expect(result.certification.tier).toBe("professional");
    expect(result.certification.leagueId).toBe(LEAGUE_PRO);
  });

  test("liga inexistente en el catálogo -> cuarentena, sin registro", () => {
    const result = certifyProMatch({ match: match({ leagueid: 99999, league: undefined }) }, context());
    expect(result).toMatchObject({ status: "quarantined", code: "LEAGUE_NOT_IN_CATALOG" });
    expect("record" in result).toBe(false);
  });

  test("liga amateur, excluded o con tier desconocido -> rechazada, sin registro", () => {
    for (const leagueId of [LEAGUE_AMATEUR, LEAGUE_EXCLUDED]) {
      const result = certifyProMatch({ match: match({ leagueid: leagueId, league: undefined }) }, context());
      expect(result).toMatchObject({ status: "rejected", code: "LEAGUE_TIER_NOT_ELIGIBLE" });
      expect("record" in result).toBe(false);
    }
    const weird = buildLeagueCatalog([{ leagueid: 15009, tier: "PREMIUM " }, { leagueid: 15010, tier: null }]).catalog;
    for (const leagueId of [15009, 15010]) {
      const result = certifyProMatch({ match: match({ leagueid: leagueId, league: undefined }) }, context({ catalog: weird }));
      expect(result).toMatchObject({ status: "rejected", code: "LEAGUE_TIER_NOT_ELIGIBLE" });
    }
  });

  test("IDs de liga contradictorios entre resumen, detalle y league -> cuarentena", () => {
    const summaryClash = certifyProMatch({ match: match(), summary: { match_id: MATCH_ID, leagueid: LEAGUE_PRO } }, context());
    expect(summaryClash).toMatchObject({ status: "quarantined", code: "LEAGUE_ID_CONTRADICTION" });
    const nestedClash = certifyProMatch(
      { match: match({ league: { leagueid: LEAGUE_PRO, tier: "professional" } }) },
      context(),
    );
    expect(nestedClash).toMatchObject({ status: "quarantined", code: "LEAGUE_ID_CONTRADICTION" });
  });

  test("ID de liga ausente o malformado -> cuarentena; leagueid 0 -> no es partida de liga", () => {
    expect(certifyProMatch({ match: match({ leagueid: undefined, league: undefined }) }, context())).toMatchObject({
      status: "quarantined",
      code: "LEAGUE_ID_MISSING",
    });
    expect(certifyProMatch({ match: match({ leagueid: "15001", league: undefined }) }, context())).toMatchObject({
      status: "quarantined",
      code: "LEAGUE_ID_INVALID",
    });
    expect(certifyProMatch({ match: match({ leagueid: 0, league: undefined }) }, context())).toMatchObject({
      status: "rejected",
      code: "NOT_A_LEAGUE_MATCH",
    });
  });

  test("tier declarado en match.league sin respaldo del catálogo -> no certificado", () => {
    // Liga que el payload dice 'premium' pero el catálogo no conoce.
    const unknownLeague = certifyProMatch(
      { match: match({ leagueid: 88888, league: { leagueid: 88888, tier: "premium" } }) },
      context(),
    );
    expect(unknownLeague.status).toBe("quarantined");
    // Liga que el payload dice 'premium' pero el catálogo marca amateur: manda el catálogo.
    const amateurInCatalog = certifyProMatch(
      { match: match({ leagueid: LEAGUE_AMATEUR, league: { leagueid: LEAGUE_AMATEUR, tier: "premium" } }) },
      context(),
    );
    expect(amateurInCatalog).toMatchObject({ status: "rejected", code: "LEAGUE_TIER_NOT_ELIGIBLE" });
    // Catálogo premium, payload dice otra cosa: contradicción, no se elige a ojo.
    const contradicted = certifyProMatch(
      { match: match({ league: { leagueid: LEAGUE_PREMIUM, tier: "amateur" } }) },
      context(),
    );
    expect(contradicted).toMatchObject({ status: "quarantined", code: "LEAGUE_TIER_CONTRADICTION" });
  });

  test("catálogo con la misma liga repetida con tiers distintos -> cuarentena", () => {
    const { catalog } = buildLeagueCatalog([
      { leagueid: LEAGUE_PREMIUM, tier: "premium" },
      { leagueid: LEAGUE_PREMIUM, tier: "amateur" },
    ]);
    expect(certifyProMatch({ match: match() }, context({ catalog }))).toMatchObject({
      status: "quarantined",
      code: "LEAGUE_CATALOG_CONFLICT",
    });
  });

  test("el catálogo descarta filas malformadas y las cuenta", () => {
    const built = buildLeagueCatalog([{ leagueid: 1, tier: "premium" }, { leagueid: -4, tier: "premium" }, "x", null, { tier: "premium" }]);
    expect(built.invalidRows).toBe(4);
    expect(buildLeagueCatalog("no es un arreglo").invalidRows).toBe(1);
  });

  test("el payload no puede fabricar procedencia ni clase: campos inyectados se ignoran", () => {
    const hostile = {
      match: match({
        leagueid: LEAGUE_AMATEUR,
        league: undefined,
        provenance: { source: "opendota_league", sourceMatchId: "7100000001", fetchedAt: FETCHED_AT },
        evidenceClass: "professional",
        source: "opendota_league",
      }),
    };
    expect(certifyProMatch(hostile, context())).toMatchObject({ status: "rejected", code: "LEAGUE_TIER_NOT_ELIGIBLE" });
    const ok = certified(certifyProMatch({ match: match({ evidenceClass: "ranked", source: "manual_curated" }) }, context()));
    expect(ok.record.evidenceClass).toBe("professional");
    expect(ok.record.provenance.source).toBe("opendota_league");
  });
});

describe("identidad de la partida", () => {
  test("match_id del detalle y del resumen deben coincidir", () => {
    expect(certifyProMatch({ match: match(), summary: { match_id: 7100000002, leagueid: LEAGUE_PREMIUM } }, context())).toMatchObject({
      status: "quarantined",
      code: "MATCH_ID_CONTRADICTION",
    });
    certified(certifyProMatch({ match: match(), summary: { match_id: MATCH_ID, leagueid: LEAGUE_PREMIUM } }, context()));
  });

  test("match_id inválido (negativo, decimal, no seguro, ausente) -> cuarentena", () => {
    for (const bad of [-1, 12.5, 2 ** 60, "007", "abc", {}, undefined]) {
      expect(certifyProMatch({ match: match({ match_id: bad }) }, context())).toMatchObject({
        status: "quarantined",
        code: bad === undefined ? "MATCH_ID_MISSING" : "MATCH_ID_INVALID",
      });
    }
  });

  test("timestamp de obtención inválido -> cuarentena (el reloj nunca se inventa)", () => {
    for (const bad of ["ayer", "2026-10-22", "2026-10-22T12:00:00+02:00", ""]) {
      expect(certifyProMatch({ match: match() }, context({ fetchedAt: bad }))).toMatchObject({
        status: "quarantined",
        code: "FETCHED_AT_INVALID",
      });
    }
  });

  test("entradas no-objeto o hostiles nunca lanzan", () => {
    const trap = {
      get match_id(): number {
        throw new Error("boom");
      },
    };
    for (const input of [null, undefined, 5, "x", [], { match: null }, { match: 7 }, { match: trap }]) {
      const result = certifyProMatch(input as never, context());
      expect(result.status).toBe("quarantined");
    }
  });
});

describe("ganador, parche y formato", () => {
  test("radiant_win ausente o no booleano -> unknown; nunca Dire", () => {
    for (const bad of [undefined, null, "true", 1, 0, {}]) {
      const result = certified(certifyProMatch({ match: match({ radiant_win: bad }) }, context()));
      expect(result.record.outcome).toEqual({ status: "unknown" });
    }
    expect(certified(certifyProMatch({ match: match({ radiant_win: true }) }, context())).record.outcome).toEqual({
      status: "known",
      winner: "radiant",
    });
    expect(certified(certifyProMatch({ match: match({ radiant_win: false }) }, context())).record.outcome).toEqual({
      status: "known",
      winner: "dire",
    });
  });

  test("patch numérico de la fuente -> source_id_only, jamás una etiqueta inventada", () => {
    const result = certified(certifyProMatch({ match: match({ patch: 60 }) }, context()));
    expect(result.record.patch).toEqual({ state: "source_id_only", sourceId: "60" });
    for (const bad of [undefined, null, "7.41e", 7.41, -3, "60"]) {
      expect(certified(certifyProMatch({ match: match({ patch: bad }) }, context())).record.patch).toEqual({ state: "unknown" });
    }
  });

  test("game_mode distinto de Captain's Mode (o ausente) -> rechazada", () => {
    for (const mode of [22, 1, 16, undefined, null, "2"]) {
      expect(certifyProMatch({ match: match({ game_mode: mode }) }, context())).toMatchObject({
        status: "rejected",
        code: "GAME_MODE_NOT_CAPTAINS_MODE",
      });
    }
  });

  test("sin tabla de Captain's Mode disponible -> cuarentena", () => {
    expect(certifyProMatch({ match: match() }, context({ captainsModeTable: null }))).toMatchObject({
      status: "quarantined",
      code: "CM_TABLE_UNAVAILABLE",
    });
  });
});

describe("secuencia de Captain's Mode contra la tabla existente", () => {
  test("bando incorrecto en un turno -> cuarentena con la ruta del validador", () => {
    const wrong = shortPicksBans();
    wrong[2] = pickBan(2, true, 3, 1); // el turno 2 es de 'first' (Radiant, team 0)
    const result = certifyProMatch({ match: match({ picks_bans: wrong }) }, context());
    expect(result).toMatchObject({ status: "quarantined", code: "RECORD_VALIDATION_FAILED" });
    if (result.status === "certified") throw new Error("no debía certificarse");
    expect(result.validatorRejections).toContainEqual({ code: "CM_SEQUENCE_MISMATCH", path: "$.actions[2].side" });
  });

  test("acción incorrecta (pick donde la tabla manda ban) -> cuarentena", () => {
    const wrong = shortPicksBans();
    wrong[0] = pickBan(0, true, 1, 0);
    const result = certifyProMatch({ match: match({ picks_bans: wrong }) }, context());
    expect(result).toMatchObject({ status: "quarantined", code: "RECORD_VALIDATION_FAILED" });
    if (result.status === "certified") throw new Error("no debía certificarse");
    expect(result.validatorRejections).toContainEqual({ code: "CM_SEQUENCE_MISMATCH", path: "$.actions[0].action" });
  });

  test("orden con huecos, repetido o no entero -> cuarentena, no se repara", () => {
    const gap = shortPicksBans();
    gap[3] = pickBan(7, true, 4, 1);
    const dup = shortPicksBans();
    dup[3] = pickBan(2, true, 4, 1);
    const fractional = shortPicksBans();
    fractional[1] = pickBan(1.5, false, 2, 1);
    for (const picksBans of [gap, dup, fractional]) {
      expect(certifyProMatch({ match: match({ picks_bans: picksBans }) }, context())).toMatchObject({
        status: "quarantined",
        code: "CM_SEQUENCE_INVALID",
      });
    }
  });

  test("picks_bans ausente o vacío, team o is_pick inválidos -> cuarentena", () => {
    expect(certifyProMatch({ match: match({ picks_bans: undefined }) }, context())).toMatchObject({ code: "PICKS_BANS_MISSING" });
    expect(certifyProMatch({ match: match({ picks_bans: [] }) }, context())).toMatchObject({ code: "PICKS_BANS_MISSING" });
    const badTeam = shortPicksBans();
    badTeam[0] = pickBan(0, false, 1, 2 as never);
    expect(certifyProMatch({ match: match({ picks_bans: badTeam }) }, context())).toMatchObject({ code: "CM_SEQUENCE_INVALID" });
    const badFlag = shortPicksBans();
    badFlag[0] = { order: 0, is_pick: "no", hero_id: 1, team: 0 };
    expect(certifyProMatch({ match: match({ picks_bans: badFlag }) }, context())).toMatchObject({ code: "CM_SEQUENCE_INVALID" });
  });

  test("héroe repetido o fuera del universo -> el validador de PR #49 lo rechaza", () => {
    const repeated = shortPicksBans();
    repeated[5] = pickBan(5, true, 3, 0);
    expect(certifyProMatch({ match: match({ picks_bans: repeated }) }, context())).toMatchObject({
      status: "quarantined",
      code: "RECORD_VALIDATION_FAILED",
    });
    const outside = shortPicksBans();
    outside[5] = pickBan(5, true, 500, 0);
    expect(certifyProMatch({ match: match({ picks_bans: outside }) }, context())).toMatchObject({
      status: "quarantined",
      code: "RECORD_VALIDATION_FAILED",
    });
  });

  test("draft incompleto -> prefix, jamás 'complete'", () => {
    const prefix = certified(certifyProMatch({ match: match({ picks_bans: shortPicksBans().slice(0, 4) }) }, context()));
    expect(prefix.record.format).toBe("captains_mode");
    if (prefix.record.format !== "captains_mode") throw new Error("formato");
    expect(prefix.record.completeness).toBe("prefix");
    expect(prefix.record.actions).toHaveLength(4);
    const full = certified(certifyProMatch({ match: match() }, context()));
    if (full.record.format !== "captains_mode") throw new Error("formato");
    expect(full.record.completeness).toBe("complete");
  });

  test("más acciones que la tabla -> cuarentena (no se trunca)", () => {
    const extra = [...shortPicksBans(), pickBan(6, true, 7, 1)];
    expect(certifyProMatch({ match: match({ picks_bans: extra }) }, context())).toMatchObject({
      status: "quarantined",
      code: "RECORD_VALIDATION_FAILED",
    });
  });

  test("el bando que abre sale de la acción 0, no se asume Radiant (tabla de 24)", () => {
    const record = captainsModeRecord(LONG_TABLE, "dire");
    const picksBans = record.actions.map((a) => pickBan(a.order, a.action === "pick", a.heroId, a.side === "dire" ? 1 : 0));
    const result = certified(
      certifyProMatch({ match: match({ picks_bans: picksBans }) }, context({ captainsModeTable: LONG_TABLE })),
    );
    if (result.record.format !== "captains_mode") throw new Error("formato");
    expect(result.record.firstActionSide).toBe("dire");
    expect(result.record.completeness).toBe("complete");
    expect(result.record.actions).toEqual(record.actions);
  });
});

describe("posiciones", () => {
  const players = [
    { hero_id: 3, isRadiant: true, position_est: 1 },
    { hero_id: 6, isRadiant: true, position_est: 2 },
    { hero_id: 4, player_slot: 128, position_est: 5 },
  ];

  test("posiciones estimadas por la fuente -> source_estimated", () => {
    const result = certified(certifyProMatch({ match: match({ players }) }, context()));
    expect(result.record.positions).toEqual([
      { heroId: 3, side: "radiant", position: 1, basis: "source_estimated" },
      { heroId: 6, side: "radiant", position: 2, basis: "source_estimated" },
      { heroId: 4, side: "dire", position: 5, basis: "source_estimated" },
    ]);
  });

  test("sin posiciones -> lista vacía; nunca se fabrican", () => {
    expect(certified(certifyProMatch({ match: match() }, context())).record.positions).toEqual([]);
    const noEstimates = [{ hero_id: 3, isRadiant: true }, { hero_id: 4, isRadiant: false, position_est: 9 }];
    expect(certified(certifyProMatch({ match: match({ players: noEstimates }) }, context())).record.positions).toEqual([]);
  });

  test("jugador sin bando verificable se omite (no hay 'team ?? 0')", () => {
    const ambiguous = [{ hero_id: 3, position_est: 1 }, { hero_id: 4, team: 0, position_est: 5 }];
    expect(certified(certifyProMatch({ match: match({ players: ambiguous }) }, context())).record.positions).toEqual([]);
  });

  test("héroe no pickeado por ese bando no genera claim; bando con posiciones repetidas se descarta entero", () => {
    const stray = [{ hero_id: 99, isRadiant: true, position_est: 3 }, { hero_id: 3, isRadiant: false, position_est: 3 }];
    expect(certified(certifyProMatch({ match: match({ players: stray }) }, context())).record.positions).toEqual([]);
    const clash = [
      { hero_id: 3, isRadiant: true, position_est: 1 },
      { hero_id: 6, isRadiant: true, position_est: 1 },
      { hero_id: 4, isRadiant: false, position_est: 5 },
    ];
    expect(certified(certifyProMatch({ match: match({ players: clash }) }, context())).record.positions).toEqual([
      { heroId: 4, side: "dire", position: 5, basis: "source_estimated" },
    ]);
  });
});

describe("datos personales", () => {
  const PII = ["987654321", "NombreSecreto", "persona@example.com", "RAWBLOB", "76561198000000000"];

  test("account_id, nombres y raw nunca aparecen en la salida (certificada ni rechazada)", () => {
    const players = [
      { hero_id: 3, isRadiant: true, position_est: 1, account_id: 987654321, personaname: "NombreSecreto", steamid: "76561198000000000" },
      { hero_id: 4, isRadiant: false, position_est: 5, account_id: 987654321, name: "persona@example.com" },
    ];
    const dirty = { account_id: 987654321, raw_json: "RAWBLOB", players };
    const ok = certifyProMatch({ match: match({ ...dirty }), summary: { match_id: MATCH_ID, leagueid: LEAGUE_PREMIUM, account_id: 987654321 } }, context());
    const rejected = certifyProMatch({ match: match({ ...dirty, leagueid: LEAGUE_AMATEUR, league: undefined }) }, context());
    const quarantined = certifyProMatch({ match: match({ ...dirty, picks_bans: [] }) }, context());
    expect(ok.status).toBe("certified");
    expect(rejected.status).toBe("rejected");
    expect(quarantined.status).toBe("quarantined");
    for (const result of [ok, rejected, quarantined]) {
      const text = JSON.stringify(result);
      for (const marker of PII) expect(text).not.toContain(marker);
      expect(text.toLowerCase()).not.toContain("account");
    }
  });

  test("un valor hostil en un campo inválido no se refleja en el motivo", () => {
    const result = certifyProMatch({ match: match({ leagueid: "SECRETO-HOSTIL", league: undefined }) }, context());
    expect(result.status).toBe("quarantined");
    expect(JSON.stringify(result)).not.toContain("SECRETO-HOSTIL");
  });
});

describe("lote y duplicados", () => {
  test("la misma partida dos veces cuenta una sola", () => {
    const batch = certifyProMatches([{ match: match() }, { match: match() }, { match: match({ match_id: 7100000009 }) }], context());
    expect(batch.certified).toHaveLength(2);
    expect(batch.duplicatesDropped).toBe(1);
    expect(batch.conflictingDuplicates).toEqual([]);
  });

  test("la misma partida con contenido distinto se descarta entera y se reporta", () => {
    const batch = certifyProMatches([{ match: match({ radiant_win: true }) }, { match: match({ radiant_win: false }) }], context());
    expect(batch.certified).toHaveLength(0);
    expect(batch.conflictingDuplicates).toEqual(["valve:7100000001"]);
  });

  test("las no certificadas quedan reportadas con su código, no se pierden", () => {
    const batch = certifyProMatches([{ match: match() }, { match: match({ match_id: 7100000003, leagueid: LEAGUE_AMATEUR, league: undefined }) }], context());
    expect(batch.certified).toHaveLength(1);
    expect(batch.notCertified).toEqual([{ status: "rejected", code: "LEAGUE_TIER_NOT_ELIGIBLE", matchId: "7100000003" }]);
  });
});

describe("integración con PR #49 y PR #50", () => {
  const OBSERVATION: DraftHistoryObservation = {
    schemaVersion: 1,
    perspective: "radiant",
    format: "captains_mode",
    patch: { state: "unknown" },
    allyHeroIds: [3],
    revealedEnemyHeroIds: [],
    bans: { status: "unknown" },
  };

  test("registro certificado pasa el validador de PR #49 y es elegible en la búsqueda de PR #50", () => {
    const result = certified(certifyProMatch({ match: match() }, context()));
    const revalidated = validateDraftHistoryRecord(result.record, {
      captainsModeTable: SHORT_TABLE,
      heroUniverse: TEST_HERO_UNIVERSE,
    });
    expect(revalidated.ok).toBe(true);
    const search = createArrayHistoryIndex([result.record], { heroUniverse: TEST_HERO_UNIVERSE }).search(OBSERVATION);
    expect(search.population.eligibleRecords).toBe(1);
    expect(search.population.excludedUnverifiedProvenance).toBe(0);
    expect(search.status).toBe("ok");
  });

  test("lo no certificado nunca llega al índice, y cambiar la etiqueta a mano no lo hace elegible", () => {
    const rejected = certifyProMatch({ match: match({ leagueid: LEAGUE_AMATEUR, league: undefined }) }, context());
    expect(rejected.status).toBe("rejected");
    expect("record" in rejected).toBe(false);
    expect(createArrayHistoryIndex([], { heroUniverse: TEST_HERO_UNIVERSE }).search(OBSERVATION).status).toBe("no_eligible_records");

    // Lo que hacía el flujo viejo: un registro 'professional' con procedencia opendota_match sigue
    // fuera de la búsqueda; sólo la certificación de liga lo vuelve elegible.
    const labelOnly = captainsModeRecord(SHORT_TABLE, "radiant", {
      provenance: { source: "opendota_match", sourceMatchId: "7100000001", fetchedAt: FETCHED_AT },
      evidenceClass: "professional",
    });
    const search = createArrayHistoryIndex([labelOnly], { heroUniverse: TEST_HERO_UNIVERSE }).search(OBSERVATION);
    expect(search.population.eligibleRecords).toBe(0);
    expect(search.population.excludedUnverifiedProvenance).toBe(1);
  });
});
