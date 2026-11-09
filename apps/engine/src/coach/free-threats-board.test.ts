import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { fakeCompute, harness, HERO_POSITIONS as BASE_POSITIONS } from "./session-harness.fixtures";
import { buildTeamCoachBoard, type TeamCoachBoard } from "./team-coach-board";

// ADVERTIR en el tablero (PO 2026-11-05). Dos cosas distintas:
//   1. CABLEADO: el tablero trae `freeThreats` y se actualiza al cambiar picks, bans o posiciones.
//   2. CERO CAMBIOS (el candado de esta prueba): ADVERTIR solo agrega un campo. Sobre los MISMOS drafts, todo lo demás del tablero -- las cinco
//      tarjetas de cada columna (orden, puntaje, fuerza, chips de Robo), el héroe principal, "ELIGE AHORA" y la card dorada -- es idéntico,
//      número por número, al que daba el código ANTERIOR a ADVERTIR. Las huellas de abajo se grabaron con `d768863f` (rama preview antes de este
//      cambio) corriendo estos mismos drafts; si algo mueve una tarjeta, esta prueba se pone en rojo.
// Fixtures inline: ninguna prueba lee hero-counters.json ni hero-positions.json reales.

const ALL: Position[] = [1, 2, 3, 4, 5];
// Las posiciones del fixture compartido traen 1.000 partidas por héroe; el Robo (y por tanto "se puede robar") exige 1.500: se escalan x10 para que el
// Robo SÍ se dispare en estos drafts y el candado de cero cambios tenga dientes (si ADVERTIR moviera un chip de Robo, la huella cambiaría).
const HERO_POSITIONS: HeroPositions = Object.fromEntries(Object.entries(BASE_POSITIONS).map(([hero, shares]) => [hero, shares.map((share) => ({ ...share, matches: share.matches * 10 }))]));
// HERO_POSITIONS: 1 -> pos 1, 2 -> pos 5, 3 -> pos 4, 4 -> pos 2, 5 -> pos 3, 6 -> pos 2/3
const CARRY = 1;
const MID = 4;
const OFFLANER = 5;
const SOFT_SUPPORT = 3;

const hard = (vs: number, why = "razón de fixture"): CuratedCounter => ({ vs, level: "hard", why });
const medium = (vs: number): CuratedCounter => ({ vs, level: "medium", why: "razón de fixture" });
const attribution = (vs: number): CuratedCounter => ({ vs, level: "hard", why: "Lo dicen: DotaCoach (7.41f)" });

const THREATS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([
  [CARRY, [hard(OFFLANER, "Silencia al carry y lo mata antes de que escale"), hard(SOFT_SUPPORT, "Su stun atraviesa el escudo"), medium(MID), attribution(6)]],
  [MID, [hard(OFFLANER, "Le corta la mana en la línea")]],
]);
// Un solo counter fuerte del carry que juega pos 2/3 (héroe 6): en la columna de pos 2 compite con el héroe 4 por puntaje casi igual, así que el ORDEN
// de esa columna depende del bono de Robo. Si ADVERTIR (o cualquier cambio) moviera el bono, el orden cambia y la huella lo delata.
const ORDER_SENSITIVE: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[CARRY, [hard(6, "Su ulti rompe la invisibilidad del carry")]]]);
// P0-04: el winrate global ya no sostiene tarjetas, así que el 4 (pos 2) necesita un fundamento propio para competir con el 6 en esa columna: un counter
// MEDIUM documentado contra un rival ya revelado (WEAK). Es la versión del candado de orden que no depende del meta.
const REVEALED_ENEMY = 7;
const ORDER_SENSITIVE_GROUNDED: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[CARRY, [hard(6, "Su ulti rompe la invisibilidad del carry")]], [REVEALED_ENEMY, [medium(MID)]]]); // la clave es la víctima: el rival revelado 7 pierde contra el 4 (medium)
const NO_THREATS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[CARRY, [medium(OFFLANER)]]]);

interface Scenario {
  name: string;
  own: number[];
  assigned?: [number, Position][];
  banned?: number[];
  enemies?: number[];
  counters?: ReadonlyMap<number, readonly CuratedCounter[]>;
  controlled?: Position[];
  /** Relaciones habilitadas para ADVERTIR. Ausente = todas las del fixture (el filtro se prueba en su propio describe). */
  approved?: ReadonlySet<string>;
}

// Todas las relaciones fuertes del fixture habilitadas para ADVERTIR ("counter>víctima").
const FIXTURE_APPROVED: ReadonlySet<string> = new Set([`${OFFLANER}>${CARRY}`, `${SOFT_SUPPORT}>${CARRY}`, `6>${CARRY}`, `${OFFLANER}>${MID}`]);

async function boardOf(scenario: Scenario): Promise<TeamCoachBoard> {
  const h = harness({ adapterKind: "simulator", controlledPositions: scenario.controlled ?? ALL });
  const base = h.store.perspectiveRecommendationContext(h.id)!;
  const context = {
    ...base,
    playerPoolsByPosition: null,
    ownAssignedPositions: new Map(scenario.assigned ?? []),
    view: {
      ...base.view,
      bannedHeroes: scenario.banned ?? [],
      ownPicks: scenario.own.map((heroId) => ({ heroId, visibility: "KNOWN" as const })),
      enemyPicks: (scenario.enemies ?? []).map((heroId) => ({ heroId, visibility: "REVEALED" as const })),
    },
  } as unknown as PerspectiveRecommendationContext;
  const board = await buildTeamCoachBoard({
    context,
    playerPersonalPosition: 4,
    heroPositions: HERO_POSITIONS,
    heroCounters: scenario.counters,
    advertirApproved: scenario.approved ?? FIXTURE_APPROVED,
    buildTargetRanking: (ctx, targetPosition) =>
      buildRecommendationSetFromPerspective({ context: ctx, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
  });
  return board!;
}

/** Todo el tablero MENOS el campo nuevo: lo que ADVERTIR no puede mover. (El tipo admite el campo ausente: así corre igual en el código anterior.) */
function withoutAdvertir(board: TeamCoachBoard): Record<string, unknown> {
  const { freeThreats: _freeThreats, ...rest } = board as TeamCoachBoard & { freeThreats?: unknown };
  return rest;
}

const fingerprint = (board: TeamCoachBoard): string => createHash("sha256").update(JSON.stringify(withoutAdvertir(board))).digest("hex").slice(0, 16);

/** Lectura humana de lo que ve el jugador: por columna, las tarjetas en orden con su puntaje y chips de Robo, más el héroe principal y "ELIGE AHORA". */
function readable(board: TeamCoachBoard): string {
  const columns = board.positions.map((column) => {
    const cards = column.top.map((card) => {
      const robo = card.steals.length > 0 ? `+robo${card.steals.map((steal) => `${steal.protectsHeroId}${steal.level[0]}`).join("")}` : "";
      return `${card.heroId}@${card.score?.toFixed(3) ?? "-"}${card.evidenceStrength[0]}${robo}`;
    });
    return `p${column.position}:${column.state}:primary=${column.primaryHeroId ?? "-"}:[${cards.join(",")}]`;
  });
  return `${columns.join(" | ")} || ELIGE AHORA=p${board.currentDecision.recommendedPosition ?? "-"}/h${board.currentDecision.recommendedHeroId ?? "-"} golden=${board.goldenCard?.heroId ?? "-"}`;
}

const SCENARIOS: Scenario[] = [
  { name: "draft vacío, sin counters", own: [], counters: undefined },
  { name: "un pick (carry) con dos amenazas fuertes libres", own: [CARRY], assigned: [[CARRY, 1]], counters: THREATS },
  { name: "lo mismo con el offlaner baneado", own: [CARRY], assigned: [[CARRY, 1]], banned: [OFFLANER], counters: THREATS },
  { name: "lo mismo con la amenaza ya elegida por el rival", own: [CARRY], assigned: [[CARRY, 1]], enemies: [OFFLANER], counters: THREATS },
  { name: "dos picks (carry y mid), posiciones 1 y 2 llenas", own: [CARRY, MID], assigned: [[CARRY, 1], [MID, 2]], counters: THREATS },
  { name: "un pick con solo relaciones medium (nada que avisar)", own: [CARRY], assigned: [[CARRY, 1]], counters: NO_THREATS },
  { name: "draft donde el orden de pos 2 depende del bono de Robo", own: [CARRY], assigned: [[CARRY, 1]], counters: ORDER_SENSITIVE },
  { name: "el jugador solo controla pos 1 y pos 2", own: [CARRY], assigned: [[CARRY, 1]], counters: THREATS, controlled: [1, 2] },
  { name: "orden de pos 2 con dos héroes sustentados (el 6 por Robo, el 4 por counter medium)", own: [CARRY], assigned: [[CARRY, 1]], enemies: [REVEALED_ENEMY], counters: ORDER_SENSITIVE_GROUNDED },
];

// BASELINE RE-GRABADO en P0-04 (neutralidad del winrate global). El original se grabó con d768863f (antes de ADVERTIR), cuando el winrate global
// sostenía tarjetas WEAK y sumaba +1 al puntaje. Comparación semántica antes/después, escenario por escenario:
//   - los puntajes bajan exactamente 1.000 (el peso de `patch_meta` que ya no vota); la fuerza (S/W), los chips de Robo, el héroe principal, ELIGE AHORA
//     y la card dorada de CADA tarjeta que sobrevive son los mismos;
//   - lo único que desaparece son tarjetas que existían SOLO por el winrate (sin counter, ban, pareja ni Robo detrás): Dota no las recomendaba.
// El candado de que ADVERTIR no mueve nada ya no depende de estas huellas: el test "INDEPENDIENTE DE LAS HUELLAS" compara, para CADA escenario, el
// tablero con la sección y sin ella (lista aprobada vacía) en el mismo código. Las huellas quedan como regresión del resto del motor.
const BASELINE: Record<string, { readable: string; fingerprint: string }> = {
  "draft vacío, sin counters": {
    readable: "p1:RANKED:primary=-:[] | p2:RANKED:primary=-:[] | p3:RANKED:primary=-:[] | p4:RANKED:primary=-:[] | p5:RANKED:primary=-:[] || ELIGE AHORA=p-/h- golden=-",
    fingerprint: "588ea0ba29ece43e",
  },
  "un pick (carry) con dos amenazas fuertes libres": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=-:[4@20.000W+robo1m] | p3:RANKED:primary=5:[5@20.000S+robo1h] | p4:RANKED:primary=3:[3@20.000S+robo1h] | p5:RANKED:primary=-:[] || ELIGE AHORA=p4/h3 golden=-",
    fingerprint: "12cbc02ff3d6784a",
  },
  "lo mismo con el offlaner baneado": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=4:[4@20.000S+robo1m] | p3:RANKED:primary=-:[] | p4:RANKED:primary=3:[3@20.000S+robo1h] | p5:RANKED:primary=-:[] || ELIGE AHORA=p4/h3 golden=-",
    fingerprint: "b99905e9b0bbfdce",
  },
  "lo mismo con la amenaza ya elegida por el rival": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=-:[] | p3:RANKED:primary=-:[] | p4:RANKED:primary=3:[3@20.000S+robo1h] | p5:RANKED:primary=-:[] || ELIGE AHORA=p4/h3 golden=-",
    fingerprint: "aee5b41b76faa637",
  },
  "dos picks (carry y mid), posiciones 1 y 2 llenas": {
    readable: "p1:FILLED:primary=-:[] | p2:FILLED:primary=-:[] | p3:RANKED:primary=5:[5@20.000S+robo1h4h] | p4:RANKED:primary=3:[3@20.000S+robo1h] | p5:RANKED:primary=-:[] || ELIGE AHORA=p4/h3 golden=-",
    fingerprint: "77fe78288d414b2e",
  },
  "un pick con solo relaciones medium (nada que avisar)": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=-:[] | p3:RANKED:primary=-:[5@20.000W+robo1m] | p4:RANKED:primary=-:[] | p5:RANKED:primary=-:[] || ELIGE AHORA=p-/h- golden=-",
    fingerprint: "85c1351568060226",
  },
  "draft donde el orden de pos 2 depende del bono de Robo": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=6:[6@19.000S+robo1h] | p3:RANKED:primary=-:[] | p4:RANKED:primary=-:[] | p5:RANKED:primary=-:[] || ELIGE AHORA=p2/h6 golden=-",
    fingerprint: "0af1792fad9565b6",
  },
  "el jugador solo controla pos 1 y pos 2": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=-:[4@20.000W+robo1m] || ELIGE AHORA=p-/h- golden=-",
    fingerprint: "7595df3bc45f39a7",
  },
  "orden de pos 2 con dos héroes sustentados (el 6 por Robo, el 4 por counter medium)": {
    readable: "p1:FILLED:primary=-:[] | p2:RANKED:primary=6:[6@19.000S+robo1h,4@20.000W] | p3:RANKED:primary=-:[] | p4:RANKED:primary=-:[] | p5:RANKED:primary=-:[] || ELIGE AHORA=p2/h6 golden=-",
    fingerprint: "6de651096b08e85e",
  },
};

describe("ADVERTIR -- cero cambios en recomendaciones (mismos drafts, con y sin la sección)", () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name}: tarjetas, orden, puntajes, ELIGE AHORA y card dorada idénticos al código anterior`, async () => {
      const board = await boardOf(scenario);
      if (process.env.RECORD_ADVERTIR === "1") console.log(`RECORD ${JSON.stringify({ name: scenario.name, readable: readable(board), fingerprint: fingerprint(board) })}`);
      const expected = BASELINE[scenario.name];
      expect(expected).toBeDefined();
      expect(readable(board)).toBe(expected!.readable);
      expect(fingerprint(board)).toBe(expected!.fingerprint);
    });
  }

  test("INDEPENDIENTE DE LAS HUELLAS: en cada escenario, el tablero con ADVERTIR activo y con la lista vacía es idéntico salvo `freeThreats`", async () => {
    for (const scenario of SCENARIOS) {
      const withAdvertir = await boardOf(scenario);
      const withoutAdvertirBoard = await boardOf({ ...scenario, approved: new Set() });
      expect(withoutAdvertirBoard.freeThreats).toEqual([]);
      expect(readable(withoutAdvertirBoard)).toBe(readable(withAdvertir));
      expect(JSON.stringify(withoutAdvertir(withoutAdvertirBoard))).toBe(JSON.stringify(withoutAdvertir(withAdvertir)));
    }
  });

  test("el candado tiene dientes: en estos drafts el Robo SÍ está activo (hay chips de Robo en las tarjetas)", async () => {
    expect(readable(await boardOf(SCENARIOS[1]!))).toContain("+robo");
  });

  test("lo único que ADVERTIR agrega al tablero es el campo `freeThreats`", async () => {
    const board = await boardOf(SCENARIOS[1]!);
    expect(Object.keys(board).sort()).toEqual(["currentDecision", "freeThreats", "goldenCard", "positions", "schema", "sessionId", "stateIdentity", "unboundOwnHeroIds"]);
    expect(Object.keys(withoutAdvertir(board)).sort()).toEqual(["currentDecision", "goldenCard", "positions", "schema", "sessionId", "stateIdentity", "unboundOwnHeroIds"]);
  });
});

describe("ADVERTIR -- el tablero trae las amenazas y se actualiza", () => {
  test("con un pick tuyo: avisa solo los counters FUERTES con porqué (no medium, no 'Lo dicen'), nombrando al aliado, al counter y el mecanismo", async () => {
    const board = await boardOf(SCENARIOS[1]!);
    expect(board.freeThreats.map((threat) => [threat.ownHeroId, threat.threatHeroId, threat.why])).toEqual([
      [CARRY, SOFT_SUPPORT, "Su stun atraviesa el escudo"],
      [CARRY, OFFLANER, "Silencia al carry y lo mata antes de que escale"],
    ]);
  });

  test("distingue las que se pueden robar en una posición que te falta de las que no", async () => {
    const board = await boardOf(SCENARIOS[1]!);
    expect(board.freeThreats.find((threat) => threat.threatHeroId === OFFLANER)?.stealPositions).toEqual([3]);
    expect(board.freeThreats.find((threat) => threat.threatHeroId === SOFT_SUPPORT)?.stealPositions).toEqual([4]);
    const onlyCarryAndMid = await boardOf(SCENARIOS[7]!);
    expect(onlyCarryAndMid.freeThreats.length).toBe(2);
    expect(onlyCarryAndMid.freeThreats.every((threat) => threat.stealPositions.length === 0)).toBe(true); // pos 3 y pos 4 no son del jugador: no se pueden robar
  });

  test("al banear un counter o si el rival lo elige, esa amenaza sale de la sección", async () => {
    expect((await boardOf(SCENARIOS[2]!)).freeThreats.map((threat) => threat.threatHeroId)).toEqual([SOFT_SUPPORT]);
    expect((await boardOf(SCENARIOS[3]!)).freeThreats.map((threat) => threat.threatHeroId)).toEqual([SOFT_SUPPORT]);
  });

  test("al elegir ese counter tú, o llenar la posición donde se jugaba, deja de ser robable", async () => {
    const chosen = await boardOf({ name: "x", own: [CARRY, OFFLANER], assigned: [[CARRY, 1], [OFFLANER, 3]], counters: THREATS });
    expect(chosen.freeThreats.map((threat) => threat.threatHeroId)).toEqual([SOFT_SUPPORT]); // el offlaner ya es tuyo: sale
    const filled = await boardOf({ name: "x", own: [CARRY, 6], assigned: [[CARRY, 1], [6, 3]], counters: THREATS });
    expect(filled.freeThreats.find((threat) => threat.threatHeroId === OFFLANER)?.stealPositions).toEqual([]); // pos 3 llena: se avisa, ya no es robable
  });

  test("sin picks propios, o con solo relaciones medium, la sección está vacía", async () => {
    expect((await boardOf(SCENARIOS[0]!)).freeThreats).toEqual([]);
    expect((await boardOf(SCENARIOS[5]!)).freeThreats).toEqual([]);
  });
});

describe("ADVERTIR -- filtro explícito en el tablero", () => {
  test("solo avisa las relaciones aprobadas; las demás fuertes no aparecen", async () => {
    const board = await boardOf({ ...SCENARIOS[1]!, approved: new Set([`${OFFLANER}>${CARRY}`]) });
    expect(board.freeThreats.map((threat) => threat.threatHeroId)).toEqual([OFFLANER]);
  });

  test("sin lista aprobada no avisa nada, y el resto del tablero es idéntico (el filtro no toca tarjetas, Robo ni ELIGE AHORA)", async () => {
    const withList = await boardOf(SCENARIOS[1]!);
    const withoutList = await boardOf({ ...SCENARIOS[1]!, approved: new Set() });
    expect(withoutList.freeThreats).toEqual([]);
    expect(fingerprint(withoutList)).toBe(fingerprint(withList));
    expect(readable(withoutList)).toBe(readable(withList));
  });
});
