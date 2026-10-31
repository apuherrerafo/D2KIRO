import { describe, expect, test } from "bun:test";
import { captainsModeRecord, LONG_TABLE, TEST_HERO_UNIVERSE } from "./fixtures";
import {
  MAX_EXAMPLES,
  createArrayHistoryIndex,
  relatePatch,
  wilsonInterval95,
  type HistoryHit,
  type HistoryIndex,
  type HistorySearchResult,
} from "./history-index";
import { parseDraftHistory } from "./loader";
import type {
  BanKnowledge,
  CaptainsModeRecord,
  DraftHistoryObservation,
  DraftHistoryRecord,
  MatchOutcome,
  PatchState,
  ProvenanceSource,
  Side,
  UnorderedDraftRecord,
} from "./types";

// Fixtures inline: ni datos curados reales, ni SQLite, ni red (invariantes.md).

const UNIVERSE = { heroUniverse: TEST_HERO_UNIVERSE };
const EXACT_741E: PatchState = { state: "exact", label: "7.41e" };

// Héroes con nombre para leer los escenarios como Dota (ids de fixture, no los reales).
const JUGGERNAUT = 8;
const LION = 20;
const CRYSTAL_MAIDEN = 21;
const AXE = 9;

interface Draft {
  id: string;
  radiant: number[];
  dire: number[];
  winner?: Side | null;
  evidenceClass?: "professional" | "ranked";
  source?: ProvenanceSource;
  patch?: PatchState;
  bans?: BanKnowledge;
  format?: "ranked_all_pick" | "unknown";
  complete?: boolean;
}

// Registro de conjuntos observados. Por defecto es evidencia buscable: profesional con procedencia
// de LIGA (`opendota_league`); `id` se vuelve un match_id de Valve.
function draft(d: Draft): UnorderedDraftRecord {
  if (d.radiant.some((h) => d.dire.includes(h))) throw new Error(`fixture ${d.id}: un héroe en ambos bandos`);
  const outcome: MatchOutcome =
    d.winner === undefined || d.winner === null ? { status: "unknown" } : { status: "known", winner: d.winner };
  const complete = d.complete ?? (d.radiant.length === 5 && d.dire.length === 5);
  return {
    schemaVersion: 1,
    format: d.format ?? "unknown",
    provenance: { source: d.source ?? "opendota_league", sourceMatchId: d.id, fetchedAt: "2026-10-20T12:00:00Z" },
    evidenceClass: d.evidenceClass ?? "professional",
    outcome,
    patch: d.patch ?? EXACT_741E,
    sourceGameMode: null,
    positions: [],
    picks: {
      radiant: { heroIds: [...d.radiant].sort((a, b) => a - b), complete },
      dire: { heroIds: [...d.dire].sort((a, b) => a - b), complete },
    },
    bans: d.bans ?? { status: "unknown" },
  };
}

/** El mismo draft con los bandos intercambiados (y el ganador reflejado). */
function mirror(record: UnorderedDraftRecord, newId: string): UnorderedDraftRecord {
  const winner = record.outcome.status === "known" ? (record.outcome.winner === "radiant" ? "dire" : "radiant") : null;
  return draft({
    id: newId,
    radiant: [...record.picks.dire.heroIds],
    dire: [...record.picks.radiant.heroIds],
    winner,
    patch: record.patch,
    bans: record.bans,
    format: record.format as "ranked_all_pick" | "unknown",
  });
}

function obs(overrides: Partial<DraftHistoryObservation> = {}): DraftHistoryObservation {
  return {
    schemaVersion: 1,
    perspective: "radiant",
    format: "unknown",
    patch: EXACT_741E,
    allyHeroIds: [],
    revealedEnemyHeroIds: [],
    bans: { status: "unknown" },
    ...overrides,
  };
}

function indexOf(records: DraftHistoryRecord[], universe: ReadonlySet<number> = TEST_HERO_UNIVERSE): HistoryIndex {
  return createArrayHistoryIndex(records, { heroUniverse: universe });
}

const allExamples = (r: HistorySearchResult): HistoryHit[] => [
  ...r.examples.wins,
  ...r.examples.losses,
  ...r.examples.unknown,
];
const keysOf = (hits: HistoryHit[]): string[] => hits.map((h) => h.matchKey);

const R = [1, 2, 3, 4, 5];
const D = [6, 7, 8, 9, 10];

describe("HeroID exacto, coincidencias directas y parciales", () => {
  test("un héroe 'del mismo rol' no cuenta: sólo coincide el HeroID exacto", () => {
    const index = indexOf([draft({ id: "7100000001", radiant: R, dire: D, winner: "radiant" })]);
    const result = index.search(obs({ allyHeroIds: [11, 12] }));
    expect(result.status).toBe("no_matches");
    expect(result.groups).toEqual([]);
    expect(allExamples(result)).toEqual([]);
    expect(result.contrastReferences).toEqual([]);
  });

  test("directa y parcial conviven en grupos separados, la directa primero", () => {
    const index = indexOf([
      draft({ id: "7100000010", radiant: [1, 2, 3, 40, 41], dire: D, winner: "radiant" }),
      draft({ id: "7100000011", radiant: [1, 2, 50, 51, 52], dire: D, winner: "radiant" }),
      draft({ id: "7100000012", radiant: [60, 61, 62, 63, 64], dire: D, winner: "radiant" }),
    ]);
    const result = index.search(obs({ allyHeroIds: [1, 2, 3] }));
    expect(result.status).toBe("ok");
    expect(result.population).toMatchObject({ matchedRecords: 2, directMatches: 1, partialMatches: 1, contrastMatches: 0 });
    expect(result.groups.map((g) => g.key.quality)).toEqual(["direct", "partial"]);
    expect(result.groups.map((g) => g.key.allyHeroIds)).toEqual([[1, 2, 3], [1, 2]]);
    expect(keysOf(result.examples.wins)).toEqual(["valve:7100000010", "valve:7100000011"]);
    expect(result.examples.wins.map((e) => e.quality)).toEqual(["direct", "partial"]);
    expect(result.examples.wins[0]?.matchedAllyHeroIds).toEqual([1, 2, 3]);
  });

  test("aliado y enemigo son campos distintos: el mismo héroe como enemigo exige el bando contrario", () => {
    const index = indexOf([draft({ id: "7100000020", radiant: R, dire: D, winner: "radiant" })]);
    const asAlly = index.search(obs({ allyHeroIds: [1] }));
    expect(asAlly.examples.wins[0]?.matchedEnemyHeroIds).toEqual([]);
    // Héroe 1 como ENEMIGO revelado: nuestros aliados equivalen al equipo Dire histórico, que perdió.
    const asEnemy = index.search(obs({ revealedEnemyHeroIds: [1] }));
    expect(asEnemy.status).toBe("ok");
    expect(asEnemy.groups[0]).toMatchObject({ key: { quality: "direct", allyHeroIds: [], enemyHeroIds: [1] }, wins: 0, losses: 1 });
    expect(asEnemy.examples.wins).toEqual([]);
    expect(keysOf(asEnemy.examples.losses)).toEqual(["valve:7100000020"]);
  });

  test("HeroIDs no consecutivos y fuera de 1..N funcionan igual (universo inyectado)", () => {
    const universe = new Set([3, 17, 42, 99, 135, 250, 7, 88, 120, 5, 61, 77, 200, 201, 202]);
    const index = indexOf(
      [draft({ id: "7100000030", radiant: [3, 42, 135, 250, 200], dire: [17, 99, 7, 88, 120], winner: "dire" })],
      universe,
    );
    const result = index.search(obs({ allyHeroIds: [17, 99], revealedEnemyHeroIds: [135] }));
    expect(result.status).toBe("ok");
    expect(result.examples.wins[0]).toMatchObject({
      matchedAllyHeroIds: [17, 99],
      matchedEnemyHeroIds: [135],
      ourOutcome: "win",
      quality: "direct",
    });
    expect(index.search(obs({ allyHeroIds: [4] })).status).toBe("invalid_observation");
  });
});

describe("Radiant y Dire son irrelevantes para la equivalencia táctica", () => {
  test("Juggernaut en Dire y Lion en Radiant es un MATCH limpio contra 'Juggernaut vs Lion'", () => {
    const index = indexOf([draft({ id: "7110000001", radiant: [LION, 41, 42, 43, 44], dire: [JUGGERNAUT, 51, 52, 53, 54], winner: "dire" })]);
    const result = index.search(obs({ allyHeroIds: [JUGGERNAUT], revealedEnemyHeroIds: [LION] }));
    expect(result.status).toBe("ok");
    expect(result.population).toMatchObject({ directMatches: 1, contrastMatches: 0 });
    expect(result.examples.wins[0]).toMatchObject({
      matchedAllyHeroIds: [JUGGERNAUT],
      matchedEnemyHeroIds: [LION],
      conflictingHeroIds: [],
      ourOutcome: "win", // ganó Dire, que es el equipo histórico equivalente al nuestro
      alliedSide: "dire", // sólo metadato
    });
  });

  test("la perspectiva declarada no cambia NADA del resultado", () => {
    const index = indexOf([
      draft({ id: "7110000010", radiant: [LION, 41, 42, 43, 44], dire: [JUGGERNAUT, 51, 52, 53, 54], winner: "dire" }),
      draft({ id: "7110000011", radiant: [JUGGERNAUT, 45, 46, 47, 48], dire: [LION, 55, 56, 57, 58], winner: "dire" }),
      draft({ id: "7110000012", radiant: [JUGGERNAUT, LION, 59, 60, 61], dire: [62, 63, 64, 65, 66], winner: "radiant" }), // contraste
    ]);
    const base = { allyHeroIds: [JUGGERNAUT], revealedEnemyHeroIds: [LION] };
    const asRadiant = index.search(obs({ ...base, perspective: "radiant" }));
    const asDire = index.search(obs({ ...base, perspective: "dire" }));
    expect(asDire).toEqual(asRadiant);
  });

  test("un draft y su espejo (bandos intercambiados, ganador reflejado) caen en el MISMO grupo", () => {
    const original = draft({ id: "7110000020", radiant: [JUGGERNAUT, 41, 42, 43, 44], dire: [LION, 51, 52, 53, 54], winner: "radiant" });
    const index = indexOf([original, mirror(original, "7110000021")]);
    const result = index.search(obs({ allyHeroIds: [JUGGERNAUT], revealedEnemyHeroIds: [LION] }));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ sampleSize: 2, wins: 2, losses: 0 });
  });

  test("un mismo registro cuenta UNA vez aunque encaje con ambas orientaciones", () => {
    const index = indexOf([draft({ id: "7110000030", radiant: R, dire: D, winner: "radiant" })]);
    const result = index.search(obs({ allyHeroIds: [1], revealedEnemyHeroIds: [6, 7] }));
    expect(result.population.matchedRecords).toBe(1);
    expect(result.groups.reduce((n, g) => n + g.sampleSize, 0)).toBe(1);
  });
});

describe("coincidencia limpia frente a conflictos", () => {
  // Observación: aliados 1-2-3-4, enemigo 6.
  // X: limpia, 1 aliado + enemigo (parcial).  Y: 4 aliados + enemigo en el MISMO bando (conflicto).
  const clean = draft({ id: "7120000001", radiant: [1, 40, 41, 42, 43], dire: [6, 50, 51, 52, 53], winner: "radiant" });
  const conflicted = draft({ id: "7120000002", radiant: [1, 2, 3, 4, 6], dire: [60, 61, 62, 63, 64], winner: "radiant" });
  const index = indexOf([conflicted, clean]);
  const result = index.search(obs({ allyHeroIds: [1, 2, 3, 4], revealedEnemyHeroIds: [6] }));

  test("una partida con conflicto NO supera a una limpia aunque tenga más héroes presentes", () => {
    expect(result.population).toMatchObject({ partialMatches: 1, contrastMatches: 1, directMatches: 0 });
    expect(keysOf(allExamples(result))).toEqual(["valve:7120000001"]);
  });

  test("los ejemplos principales tienen cero conflictos; la de conflicto va a referencias de contraste", () => {
    expect(allExamples(result).every((e) => e.conflictingHeroIds.length === 0)).toBe(true);
    expect(keysOf(result.contrastReferences)).toEqual(["valve:7120000002"]);
    expect(result.contrastReferences[0]).toMatchObject({ quality: "contrast", conflictingHeroIds: [6], matchedAllyHeroIds: [1, 2, 3, 4] });
  });

  test("el grupo de contraste está etiquetado aparte y no se mezcla con el limpio", () => {
    expect(result.groups.map((g) => g.key.quality)).toEqual(["partial", "contrast"]);
    expect(result.groups[1]?.key.conflictHeroIds).toEqual([6]);
    expect(result.groups.reduce((n, g) => n + g.sampleSize, 0)).toBe(2);
  });

  test("la partida con conflicto sigue contada: no se elimina de forma permanente", () => {
    // Sin el enemigo revelado el conflicto desaparece y la partida pasa a ser una coincidencia limpia.
    const widened = index.search(obs({ allyHeroIds: [1, 2, 3, 4], revealedEnemyHeroIds: [] }));
    expect(widened.population).toMatchObject({ directMatches: 1, partialMatches: 1, contrastMatches: 0 });
    expect(keysOf(widened.examples.wins)).toEqual(["valve:7120000002", "valve:7120000001"]);
  });

  test("las referencias de contraste van por menos conflictos, no por más héroes presentes", () => {
    // Observación: aliados 1-2-3-4, enemigos 6-7-8. Ambas coinciden en 4 héroes.
    const oneConflict = draft({ id: "7120000020", radiant: [1, 2, 3, 4, 6], dire: [50, 51, 52, 53, 54], winner: "radiant" });
    const threeConflicts = draft({ id: "7120000021", radiant: [1, 2, 3, 6, 7], dire: [4, 8, 50, 51, 52], winner: "radiant" });
    const r = indexOf([threeConflicts, oneConflict]).search(obs({ allyHeroIds: [1, 2, 3, 4], revealedEnemyHeroIds: [6, 7, 8] }));
    expect(r.contrastReferences.map((h) => [h.matchKey, h.conflictingHeroIds.length])).toEqual([
      ["valve:7120000020", 1],
      ["valve:7120000021", 3],
    ]);
    expect(r.groups.map((g) => g.key.conflictHeroIds.length)).toEqual([1, 3]);
  });

  test("empate de orientaciones: es ambigua, nunca se le asigna victoria ni derrota", () => {
    // Un aliado y un enemigo juntos en el mismo equipo histórico: sirve en las dos orientaciones.
    const tie = indexOf([draft({ id: "7120000010", radiant: [1, 6, 41, 42, 43], dire: [50, 51, 52, 53, 54], winner: "radiant" })]);
    const r = tie.search(obs({ allyHeroIds: [1], revealedEnemyHeroIds: [6] }));
    expect(r.contrastReferences[0]).toMatchObject({ quality: "contrast", orientationAmbiguous: true, ourOutcome: "unknown" });
    expect(r.groups[0]).toMatchObject({ key: { quality: "contrast", orientationAmbiguous: true }, wins: 0, losses: 0, unknownOutcomes: 1 });
    expect(tie.search(obs({ allyHeroIds: [1], revealedEnemyHeroIds: [6], perspective: "dire" }))).toEqual(r);
  });
});

describe("victorias y derrotas desde nuestro equipo", () => {
  const records = [
    draft({ id: "7130000001", radiant: [1, 2, 20, 21, 22], dire: D, winner: "radiant" }), // ganamos
    draft({ id: "7130000002", radiant: [1, 2, 23, 24, 25], dire: D, winner: "dire" }), // perdimos
    draft({ id: "7130000003", radiant: [1, 2, 26, 27, 28], dire: D, winner: null }), // sin ganador
    draft({ id: "7130000004", radiant: D, dire: [1, 2, 29, 30, 31], winner: "dire" }), // ganamos, en Dire
    draft({ id: "7130000005", radiant: D, dire: [1, 2, 32, 33, 34], winner: "radiant" }), // perdimos, en Dire
  ];
  const result = indexOf(records).search(obs({ allyHeroIds: [1, 2] }));

  test("el resultado siempre se lee desde el equipo histórico equivalente al nuestro", () => {
    expect(keysOf(result.examples.wins).sort()).toEqual(["valve:7130000001", "valve:7130000004"]);
    expect(keysOf(result.examples.losses).sort()).toEqual(["valve:7130000002", "valve:7130000005"]);
    expect(keysOf(result.examples.unknown)).toEqual(["valve:7130000003"]);
    expect(result.examples.wins.every((h) => h.ourOutcome === "win")).toBe(true);
    expect(result.examples.losses.every((h) => h.ourOutcome === "loss")).toBe(true);
    expect(result.examples.unknown.every((h) => h.ourOutcome === "unknown")).toBe(true);
  });

  test("las estadísticas cuentan victorias, derrotas y desconocidos por separado", () => {
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ sampleSize: 5, wins: 2, losses: 2, unknownOutcomes: 1 });
    expect(result.groups[0]?.observedWinShare).toBeCloseTo(0.5, 10);
  });

  test("sólo derrotas: aparecen como ejemplos (no se ocultan) y la estadística las cuenta", () => {
    const only = indexOf([draft({ id: "7130000010", radiant: R, dire: D, winner: "dire" })]).search(obs({ allyHeroIds: [1] }));
    expect(only.status).toBe("ok");
    expect(only.examples.wins).toEqual([]);
    expect(keysOf(only.examples.losses)).toEqual(["valve:7130000010"]);
    expect(only.groups[0]).toMatchObject({ sampleSize: 1, wins: 0, losses: 1, observedWinShare: 0 });
  });

  test("no se ordena por haber ganado: la relevancia manda y las derrotas relevantes no se esconden", () => {
    const wins = Array.from({ length: 12 }, (_, i) =>
      draft({ id: String(7130001000 + i), radiant: [1, 40 + (i % 5), 50 + (i % 7), 60 + (i % 3), 70], dire: D, winner: "radiant" }),
    );
    const loss = draft({ id: "7130002000", radiant: [1, 2, 3, 80, 81], dire: D, winner: "dire" });
    const r = indexOf([...wins, loss]).search(obs({ allyHeroIds: [1, 2, 3] }));
    expect(keysOf(r.examples.losses)).toEqual(["valve:7130002000"]);
    expect(r.examples.wins).toHaveLength(MAX_EXAMPLES);
    // Dentro de cada categoría el orden es relevancia de matchup (más coincidencias primero).
    const mixed = indexOf([
      draft({ id: "7130003001", radiant: [1, 40, 41, 42, 43], dire: D, winner: "radiant" }),
      draft({ id: "7130003002", radiant: [1, 2, 3, 44, 45], dire: D, winner: "radiant" }),
    ]).search(obs({ allyHeroIds: [1, 2, 3] }));
    expect(mixed.examples.wins.map((e) => e.matchedAllyHeroIds.length)).toEqual([3, 1]);
  });
});

describe("estadística correcta: sin mezclar estrategias distintas", () => {
  const records = [
    draft({ id: "7140000001", radiant: [JUGGERNAUT, LION, 41, 42, 43], dire: [AXE, 51, 52, 53, 54], winner: "radiant" }),
    draft({ id: "7140000002", radiant: [JUGGERNAUT, LION, 44, 45, 46], dire: [AXE, 55, 56, 57, 58], winner: "radiant" }),
    draft({ id: "7140000003", radiant: [JUGGERNAUT, CRYSTAL_MAIDEN, 47, 48, 49], dire: [AXE, 59, 60, 61, 62], winner: "dire" }),
  ];
  const index = indexOf(records);

  test("Juggernaut+Lion y Juggernaut+Crystal Maiden contra Axe son grupos distintos", () => {
    const result = index.search(obs({ allyHeroIds: [JUGGERNAUT, LION, CRYSTAL_MAIDEN], revealedEnemyHeroIds: [AXE] }));
    expect(result.groups).toHaveLength(2);
    const byAllies = new Map(result.groups.map((g) => [g.key.allyHeroIds.join("+"), g]));
    expect(byAllies.get(`${JUGGERNAUT}+${LION}`)).toMatchObject({ sampleSize: 2, wins: 2, observedWinShare: 1 });
    expect(byAllies.get(`${JUGGERNAUT}+${CRYSTAL_MAIDEN}`)).toMatchObject({ sampleSize: 1, losses: 1, observedWinShare: 0 });
    expect(result.groups.some((g) => g.sampleSize === 3)).toBe(false); // nunca un 2/3 como si fuera una sola composición
  });

  test("si la afirmación es sólo 'Juggernaut vs Axe', los tres sí son comparables y se agrupan", () => {
    const result = index.search(obs({ allyHeroIds: [JUGGERNAUT], revealedEnemyHeroIds: [AXE] }));
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ sampleSize: 3, wins: 2, losses: 1 });
  });

  test("grupos por separado cuando difiere el parche o el formato", () => {
    const mixedContext = indexOf([
      draft({ id: "7140000010", radiant: R, dire: D, winner: "radiant", patch: EXACT_741E }),
      draft({ id: "7140000011", radiant: R, dire: D, winner: "radiant", patch: { state: "exact", label: "7.40" } }),
      draft({ id: "7140000012", radiant: R, dire: D, winner: "dire", format: "ranked_all_pick" }),
    ]).search(obs({ allyHeroIds: [1], format: "ranked_all_pick" }));
    expect(mixedContext.groups).toHaveLength(3);
  });

  test("no hay porcentaje global ni veredicto de superioridad", () => {
    const result = index.search(obs({ allyHeroIds: [JUGGERNAUT] }));
    expect(result).not.toHaveProperty("winRate");
    expect(result).not.toHaveProperty("observedWinShare");
    expect(result.interpretation).toBe("descriptive_only");
    expect(JSON.stringify(result)).not.toMatch(/superior|better|causal/i);
  });

  test("las partidas del resultado suman exactamente las de los grupos", () => {
    const result = index.search(obs({ allyHeroIds: [JUGGERNAUT, LION, CRYSTAL_MAIDEN], revealedEnemyHeroIds: [AXE] }));
    expect(result.groups.reduce((n, g) => n + g.sampleSize, 0)).toBe(result.population.matchedRecords);
  });

  function manyWins(count: number): DraftHistoryRecord[] {
    return Array.from({ length: count }, (_, i) =>
      draft({ id: String(7200000000 + i), radiant: [1, 2, 3, 40 + (i % 5), 50 + (i % 7)], dire: D, winner: "radiant" }),
    );
  }

  test("los ejemplos son ilustrativos (<= 10 por categoría) pero la estadística cuenta el grupo completo", () => {
    const wins = indexOf(manyWins(25));
    const result = wins.search(obs({ allyHeroIds: [1, 2, 3] }));
    expect(result.examples.wins).toHaveLength(MAX_EXAMPLES);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]).toMatchObject({ sampleSize: 25, wins: 25 });
    expect(wins.search(obs({ allyHeroIds: [1, 2, 3] }), { maxExamples: 3 }).examples.wins).toHaveLength(3);
    expect(wins.search(obs({ allyHeroIds: [1, 2, 3] }), { maxExamples: 999 }).examples.wins).toHaveLength(10);
    expect(wins.search(obs({ allyHeroIds: [1, 2, 3] }), { maxExamples: 0 }).examples.wins).toHaveLength(0);
  });

  test("muestra pequeña: se informa tal cual, con intervalo ancho y sin mínimo rígido", () => {
    const group = indexOf(manyWins(2)).search(obs({ allyHeroIds: [1, 2, 3] })).groups[0];
    expect(group).toMatchObject({ sampleSize: 2, wins: 2, observedWinShare: 1 });
    expect(group?.winShareInterval95?.lower).toBeLessThan(0.5);
    expect(group?.winShareInterval95?.upper).toBe(1);
  });

  test("sin partidas con ganador conocido no hay porcentaje ni intervalo", () => {
    const result = indexOf([draft({ id: "7200000200", radiant: R, dire: D, winner: null })]).search(obs({ allyHeroIds: [1] }));
    expect(result.groups[0]).toMatchObject({ sampleSize: 1, unknownOutcomes: 1, observedWinShare: null, winShareInterval95: null });
  });

  test("wilsonInterval95: caso calculado a mano y bordes", () => {
    const half = wilsonInterval95(5, 10);
    expect(half?.lower).toBeCloseTo(0.2366, 3);
    expect(half?.upper).toBeCloseTo(0.7634, 3);
    expect(wilsonInterval95(0, 0)).toBeNull();
    const all = wilsonInterval95(30, 30);
    expect(all?.upper).toBe(1);
    expect(all?.lower).toBeGreaterThan(0.85);
  });
});

describe("procedencia: sólo evidencia profesional verificable", () => {
  test("Ranked nunca es buscable ni suma a la estadística; se cuenta aparte", () => {
    const index = indexOf([
      draft({ id: "7300000001", radiant: R, dire: D, winner: "radiant", evidenceClass: "ranked" }),
      draft({ id: "7300000002", radiant: R, dire: D, winner: "radiant", evidenceClass: "ranked" }),
      draft({ id: "7300000003", radiant: [1, 2, 60, 61, 62], dire: D, winner: "dire" }),
    ]);
    const result = index.search(obs({ allyHeroIds: [1, 2, 3, 4, 5] }));
    expect(result.population).toMatchObject({ indexedRecords: 3, eligibleRecords: 1, excludedByEvidenceClass: 2, matchedRecords: 1 });
    expect(result.groups[0]).toMatchObject({ sampleSize: 1, losses: 1 });
  });

  test("la etiqueta 'professional' por sí sola no verifica: manual_curated y opendota_match sin liga se excluyen", () => {
    const index = indexOf([
      draft({ id: "7300000010", radiant: R, dire: D, winner: "radiant", source: "opendota_league" }),
      draft({ id: "7300000011", radiant: R, dire: D, winner: "radiant", source: "opendota_match" }),
      draft({ id: "casemanual1", radiant: R, dire: D, winner: "radiant", source: "manual_curated" }),
    ]);
    const result = index.search(obs({ allyHeroIds: [1] }));
    expect(result.population).toMatchObject({
      indexedRecords: 3,
      eligibleRecords: 1,
      excludedByEvidenceClass: 0,
      excludedUnverifiedProvenance: 2,
      matchedRecords: 1,
    });
    expect(keysOf(allExamples(result))).toEqual(["valve:7300000010"]);
  });

  test("un historial sin evidencia verificable equivale a no tener evidencia profesional", () => {
    const index = indexOf([
      draft({ id: "7300000020", radiant: R, dire: D, winner: "radiant", evidenceClass: "ranked" }),
      draft({ id: "casemanual2", radiant: R, dire: D, winner: "radiant", source: "manual_curated" }),
    ]);
    expect(index.search(obs({ allyHeroIds: [1] })).status).toBe("no_eligible_records");
  });

  test("el mismo match_id por dos vías cuenta una vez y se conserva la primera", () => {
    const viaLeague = draft({ id: "7300000030", radiant: R, dire: D, winner: "radiant", source: "opendota_league" });
    const viaMatch = draft({ id: "7300000030", radiant: R, dire: D, winner: "radiant", source: "opendota_match" });
    const index = indexOf([viaLeague, viaMatch]);
    const result = index.search(obs({ allyHeroIds: [1] }));
    expect(index.size).toBe(1);
    expect(result.population).toMatchObject({ duplicatesDropped: 1, eligibleRecords: 1 });
  });
});

const RETRACTION_RECORDS: DraftHistoryRecord[] = [
  draft({ id: "7400000001", radiant: [1, 2, 3, 40, 41], dire: [6, 7, 8, 9, 10], winner: "radiant" }),
  draft({ id: "7400000002", radiant: [1, 2, 50, 51, 52], dire: [6, 70, 71, 72, 73], winner: "radiant" }),
  draft({ id: "7400000003", radiant: [80, 81, 82, 83, 84], dire: [1, 2, 3, 85, 86], winner: "dire" }),
];

describe("retractaciones y recálculo completo", () => {
  const index = indexOf(RETRACTION_RECORDS);
  const base = obs({ allyHeroIds: [1, 2], revealedEnemyHeroIds: [6] });
  const grown = obs({ allyHeroIds: [1, 2, 3], revealedEnemyHeroIds: [6, 7] });

  test("quitar un pick (retractación) da exactamente lo mismo que no haberlo visto nunca", () => {
    const before = index.search(base);
    index.search(grown);
    expect(index.search(base)).toEqual(before);
    expect(indexOf(RETRACTION_RECORDS).search(base)).toEqual(before);
  });

  test("retractar un enemigo revelado ensancha la búsqueda en vez de arrastrar el filtro anterior", () => {
    const withEnemies = index.search(grown);
    const retracted = index.search(obs({ allyHeroIds: [1, 2, 3], revealedEnemyHeroIds: [6] }));
    expect(withEnemies.groups.every((g) => g.key.enemyHeroIds.length <= 2)).toBe(true);
    expect(retracted.groups.every((g) => g.key.enemyHeroIds.length <= 1)).toBe(true);
    expect(retracted.population.matchedRecords).toBeGreaterThanOrEqual(withEnemies.population.matchedRecords);
  });

  test("agregar un pick no elimina partidas para siempre: reaparecen al retractarlo", () => {
    const narrow = index.search(obs({ allyHeroIds: [1, 2, 3] }));
    const wide = index.search(obs({ allyHeroIds: [1, 2] }));
    expect(narrow.population.matchedRecords).toBe(3); // la 7400000002 (sin el 3) sigue como parcial
    expect(wide.population.matchedRecords).toBe(3);
    expect(narrow.population.partialMatches).toBe(1);
    expect(wide.population.directMatches).toBe(3);
  });

  test("el orden de las consultas no importa: cada una recalcula desde el universo completo", () => {
    const a = index.search(grown);
    const b = index.search(base);
    expect(index.search(grown)).toEqual(a);
    expect(index.search(base)).toEqual(b);
  });

  test("retractar todo deja una observación vacía, no un error ni los resultados viejos", () => {
    index.search(base);
    const empty = index.search(obs());
    expect(empty.status).toBe("empty_observation");
    expect(empty.groups).toEqual([]);
    expect(allExamples(empty)).toEqual([]);
  });

  test("el orden de entrada de los registros no cambia el resultado", () => {
    const reversed = indexOf([...RETRACTION_RECORDS].reverse());
    expect(reversed.search(grown)).toEqual(index.search(grown));
    expect(reversed.search(base)).toEqual(index.search(base));
  });
});

describe("enemigos ocultos", () => {
  test("una observación con campos de enemigos ocultos o posiciones se rechaza (esquema cerrado)", () => {
    const index = indexOf([draft({ id: "7500000001", radiant: R, dire: D, winner: "radiant" })]);
    for (const field of ["hiddenEnemyHeroIds", "enemyPositions", "positions"]) {
      const result = index.search({ ...obs({ allyHeroIds: [1] }), [field]: [6] });
      expect(result.status).toBe("invalid_observation");
      expect(result.rejections).toContainEqual({ code: "UNKNOWN_FIELD", path: `$.${field}` });
    }
  });

  test("los enemigos que el registro tiene y la observación no reveló no penalizan ni cuentan", () => {
    const index = indexOf([draft({ id: "7500000010", radiant: R, dire: D, winner: "radiant" })]);
    const result = index.search(obs({ allyHeroIds: [1, 2], revealedEnemyHeroIds: [] }));
    expect(result.groups[0]?.key).toMatchObject({ quality: "direct", allyHeroIds: [1, 2], enemyHeroIds: [], conflictHeroIds: [] });
  });

  test("el rechazo no repite el valor recibido", () => {
    const result = indexOf([]).search({ ...obs(), account_id: 987654321 });
    expect(result.status).toBe("invalid_observation");
    expect(JSON.stringify(result)).not.toContain("987654321");
  });
});

describe("bans desconocidos: nunca inventados", () => {
  const known: BanKnowledge = { status: "confirmed_visible", heroIds: [30, 31] };

  test("bans desconocidos en la observación, en el registro, o en ambos -> banMatches null", () => {
    const withBans = draft({ id: "7600000001", radiant: R, dire: D, winner: "radiant", bans: known });
    const withoutBans = draft({ id: "7600000002", radiant: R, dire: D, winner: "radiant" });
    expect(indexOf([withBans]).search(obs({ allyHeroIds: [1] })).examples.wins[0]?.banMatches).toBeNull();
    const recordUnknown = indexOf([withoutBans]).search(obs({ allyHeroIds: [1], bans: known }));
    expect(recordUnknown.examples.wins[0]?.banMatches).toBeNull();
    expect(recordUnknown.status).toBe("ok");
  });

  test("bans conocidos en ambos lados se comparan; 'se vio y no hubo ninguno' es 0, no null", () => {
    const index = indexOf([draft({ id: "7600000010", radiant: R, dire: D, winner: "radiant", bans: known })]);
    expect(index.search(obs({ allyHeroIds: [1], bans: { status: "confirmed_visible", heroIds: [30, 99] } })).examples.wins[0]?.banMatches).toBe(1);
    expect(index.search(obs({ allyHeroIds: [1], bans: { status: "confirmed_visible", heroIds: [] } })).examples.wins[0]?.banMatches).toBe(0);
  });

  test("los bans coincidentes desempatan ejemplos igual de relevantes, sin pesar más que la coincidencia", () => {
    const index = indexOf([
      draft({ id: "7600000030", radiant: [1, 2, 40, 41, 42], dire: D, winner: "radiant", bans: { status: "confirmed_visible", heroIds: [97] } }),
      draft({ id: "7600000031", radiant: [1, 2, 43, 44, 45], dire: D, winner: "radiant", bans: { status: "confirmed_visible", heroIds: [30, 31] } }),
      draft({ id: "7600000032", radiant: [1, 46, 47, 48, 49], dire: D, winner: "radiant", bans: { status: "confirmed_visible", heroIds: [30, 31] } }),
    ]);
    const r = index.search(obs({ allyHeroIds: [1, 2], bans: { status: "confirmed_visible", heroIds: [30, 31] } }));
    expect(keysOf(r.examples.wins)).toEqual(["valve:7600000031", "valve:7600000030", "valve:7600000032"]);
  });

  test("Captain's Mode: los bans salen de las acciones; sin acciones de ban son desconocidos", () => {
    // captainsModeRecord(LONG_TABLE): la acción `i` usa el héroe `i + 1`; las acciones 0..6 son bans y la 7 el pick 8.
    const full = captainsModeRecord(LONG_TABLE, "radiant", {
      provenance: { source: "opendota_league", sourceMatchId: "7600000040", fetchedAt: null },
    });
    const compared = indexOf([full]).search(obs({ allyHeroIds: [8], bans: { status: "confirmed_visible", heroIds: [1, 2, 99] } }));
    expect(compared.examples.wins[0]?.banMatches).toBe(2);

    const pickOnly: CaptainsModeRecord = {
      ...full,
      completeness: "prefix",
      outcome: { status: "unknown" },
      actions: [{ order: 0, action: "pick", side: "radiant", heroId: 8 }],
    };
    const unknownBans = indexOf([pickOnly]).search(obs({ allyHeroIds: [8], bans: { status: "confirmed_visible", heroIds: [1] } }));
    expect(unknownBans.status).toBe("ok");
    expect(unknownBans.examples.unknown[0]).toMatchObject({ banMatches: null, recordPicksComplete: false });
  });

  test("ningún hit inventa posiciones", () => {
    const result = indexOf([draft({ id: "7600000050", radiant: R, dire: D, winner: "radiant" })]).search(obs({ allyHeroIds: [1] }));
    expect(result.examples.wins[0]).not.toHaveProperty("positions");
  });
});

describe("parches: exacto, antiguo, más nuevo y desconocido", () => {
  const patches: Array<[string, PatchState]> = [
    ["7700000001", { state: "exact", label: "7.41e" }],
    ["7700000002", { state: "exact", label: "7.41c" }],
    ["7700000003", { state: "exact", label: "7.40" }],
    ["7700000004", { state: "exact", label: "7.42" }],
    ["7700000005", { state: "source_id_only", sourceId: "60" }],
    ["7700000006", { state: "unknown" }],
  ];
  const index = indexOf(patches.map(([id, patch]) => draft({ id, radiant: R, dire: D, winner: "radiant", patch })));

  test("cada vigencia es un grupo propio y ninguna se descarta", () => {
    const result = index.search(obs({ allyHeroIds: [1] }));
    const relation = new Map(result.groups.map((g) => [g.key.patchRelation, g.sampleSize]));
    expect(relation.get("same")).toBe(1);
    expect(relation.get("older")).toBe(2);
    expect(relation.get("newer")).toBe(1);
    expect(relation.get("unknown")).toBe(2);
    expect(result.groups).toHaveLength(4);
  });

  test("el parche vigente va primero y lo desconocido al final", () => {
    const result = index.search(obs({ allyHeroIds: [1] }));
    expect(result.groups.map((g) => g.key.patchRelation)[0]).toBe("same");
    expect(result.groups.map((g) => g.key.patchRelation).at(-1)).toBe("unknown");
    expect(result.examples.wins[0]?.patchRelation).toBe("same");
  });

  test("observación con parche desconocido: nada es 'mismo parche', todo cae en 'unknown'", () => {
    const result = index.search(obs({ allyHeroIds: [1], patch: { state: "unknown" } }));
    expect(result.groups.map((g) => g.key.patchRelation)).toEqual(["unknown"]);
    expect(result.population.matchedRecords).toBe(6);
  });

  test("relatePatch: id de la fuente jamás se convierte en etiqueta; etiquetas ordenadas por mayor, menor y letra", () => {
    const exact = (label: string): PatchState => ({ state: "exact", label });
    expect(relatePatch(exact("7.41e"), exact("7.41e"))).toBe("same");
    expect(relatePatch(exact("7.41e"), exact("7.41"))).toBe("older");
    expect(relatePatch(exact("7.41"), exact("7.41a"))).toBe("newer");
    expect(relatePatch(exact("7.9"), exact("7.10"))).toBe("newer");
    expect(relatePatch(exact("7.41e"), { state: "source_id_only", sourceId: "7.41e" })).toBe("unknown");
    expect(relatePatch(exact("rc-1"), exact("rc-2"))).toBe("unknown");
    expect(relatePatch(exact("rc-1"), exact("rc-1"))).toBe("same");
  });
});

describe("formato: Captain's Mode vs Ranked All Pick", () => {
  test("se anota, no se esconde ni se presenta como directamente equivalente", () => {
    const cm = captainsModeRecord(LONG_TABLE, "radiant", {
      provenance: { source: "opendota_league", sourceMatchId: "7800000001", fetchedAt: null },
    });
    const ap = draft({ id: "7800000002", radiant: [8, 20, 21, 22, 23], dire: [60, 61, 62, 63, 64], winner: "radiant", format: "ranked_all_pick" });
    const unk = draft({ id: "7800000003", radiant: [8, 24, 25, 26, 27], dire: [60, 61, 62, 63, 64], winner: "radiant", format: "unknown" });
    const result = indexOf([cm, ap, unk]).search(obs({ format: "ranked_all_pick", allyHeroIds: [8] }));
    expect(result.groups.map((g) => g.key.formatRelation).sort()).toEqual(["different_format", "same_format", "unknown"]);
    expect(result.groups[0]?.key.formatRelation).toBe("same_format");
    expect(result.examples.wins.map((h) => h.format).sort()).toEqual(["captains_mode", "ranked_all_pick", "unknown"]);
  });
});

describe("ausencia y entradas límite", () => {
  test("índice vacío -> no_eligible_records; sin solapamiento -> no_matches", () => {
    expect(indexOf([]).search(obs({ allyHeroIds: [1] })).status).toBe("no_eligible_records");
    const one = indexOf([draft({ id: "7900000001", radiant: R, dire: D, winner: "radiant" })]);
    expect(one.search(obs({ allyHeroIds: [90, 91] }))).toMatchObject({
      status: "no_matches",
      groups: [],
      contrastReferences: [],
      examples: { wins: [], losses: [], unknown: [] },
      population: { matchedRecords: 0 },
    });
  });

  test("observación malformada -> invalid_observation, nunca lanza", () => {
    const index = indexOf([]);
    for (const bad of [null, undefined, 3, "x", [], { schemaVersion: 1 }]) {
      expect(index.search(bad).status).toBe("invalid_observation");
    }
  });

  test("registro repetido (misma partida) cuenta una vez y se informa", () => {
    const record = draft({ id: "7900000010", radiant: R, dire: D, winner: "radiant" });
    const index = indexOf([record, { ...record }]);
    const result = index.search(obs({ allyHeroIds: [1] }));
    expect(index.size).toBe(1);
    expect(result.population.duplicatesDropped).toBe(1);
    expect(result.groups[0]?.sampleSize).toBe(1);
  });

  test("registro incompleto (prefijo): se conserva, marcado como no completo", () => {
    const record = draft({ id: "7900000020", radiant: [1, 2], dire: [6], winner: null, complete: false });
    const result = indexOf([record]).search(obs({ allyHeroIds: [1] }));
    expect(result.groups[0]).toMatchObject({ unknownOutcomes: 1 });
    expect(result.examples.unknown[0]?.recordPicksComplete).toBe(false);
  });

  test("copias defensivas: mutar los registros o el resultado después no altera búsquedas futuras", () => {
    const record = draft({ id: "7900000030", radiant: R, dire: D, winner: "radiant" });
    const index = indexOf([record]);
    const first = index.search(obs({ allyHeroIds: [1] }));
    const snapshot = JSON.parse(JSON.stringify(first));
    record.picks.radiant.heroIds.length = 0;
    first.examples.wins[0]?.historicalAllyHeroIds.push(999);
    first.groups[0]?.key.allyHeroIds.push(999);
    first.groups.length = 0;
    expect(JSON.parse(JSON.stringify(index.search(obs({ allyHeroIds: [1] }))))).toEqual(snapshot);
  });
});

describe("integración con el cargador de PR-1", () => {
  test("registros validados por el cargador (Captain's Mode + conjuntos) alimentan el índice", () => {
    const raw = {
      schemaVersion: 1,
      records: [
        captainsModeRecord(LONG_TABLE, "radiant", {
          provenance: { source: "opendota_league", sourceMatchId: "7000000101", fetchedAt: null },
        }),
        draft({ id: "7000000102", radiant: [8, 30, 31, 32, 33], dire: [60, 61, 62, 63, 64], winner: "radiant" }),
        { ...draft({ id: "7000000103", radiant: R, dire: D }), account_id: 1 }, // rechazado por PR-1
      ],
    };
    const loaded = parseDraftHistory(raw, { captainsModeTable: LONG_TABLE, heroUniverse: TEST_HERO_UNIVERSE });
    expect(loaded.status).toBe("ok");
    expect(loaded.records).toHaveLength(2);
    const result = createArrayHistoryIndex(loaded.records, UNIVERSE).search(obs({ allyHeroIds: [8] }));
    expect(result.status).toBe("ok");
    expect(result.population.matchedRecords).toBe(2);
  });
});
