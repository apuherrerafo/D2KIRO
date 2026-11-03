import { describe, expect, test } from "bun:test";
import type { PerspectiveDraftView } from "../draft-protocol/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { GOLDEN_CARD_EXCLUDED, selectGoldenCard, type GoldenCardInput } from "./golden-card";

// Card dorada (estándar de dos expertos de Dota, variante "casi siempre"). Fixtures inline: ningún dato curado real.
// Héroes del fixture: ME = el candidato; CORE_A / CORE_B = rivales core (pos 1 / pos 2); SUPPORT = rival pos 5; ALLY = aliado ya elegido.

const ME = 900;
const OTHER = 901;
const CORE_A = 300;
const CORE_B = 301;
const SUPPORT = 302;
const ALLY = 400;
const FREE_HARD_1 = 700;
const FREE_HARD_2 = 701;

const POSITIONS: HeroPositions = {
  [ME]: [{ position: 3, matches: 2000 }, { position: 4, matches: 200 }],
  [OTHER]: [{ position: 3, matches: 2000 }],
  [CORE_A]: [{ position: 1, matches: 3000 }],
  [CORE_B]: [{ position: 2, matches: 3000 }],
  [SUPPORT]: [{ position: 5, matches: 3000 }],
  [ALLY]: [{ position: 1, matches: 3000 }],
  [FREE_HARD_1]: [{ position: 1, matches: 100 }],
  [FREE_HARD_2]: [{ position: 1, matches: 100 }],
};

const hard = (vs: number, why = "razón de fixture"): CuratedCounter => ({ vs, level: "hard", why });
const medium = (vs: number, why = "razón de fixture"): CuratedCounter => ({ vs, level: "medium", why });

/** victim -> quién lo counterea (el formato del archivo). */
function counters(entries: [number, CuratedCounter[]][]): ReadonlyMap<number, readonly CuratedCounter[]> {
  return new Map(entries);
}

function view(options: { enemies?: { heroId: number; visibility: "REVEALED" | "HIDDEN" }[]; own?: number[]; banned?: number[] } = {}): PerspectiveDraftView {
  const enemies = options.enemies ?? [{ heroId: CORE_A, visibility: "REVEALED" }, { heroId: SUPPORT, visibility: "REVEALED" }];
  return {
    bannedHeroes: options.banned ?? [],
    ownPicks: (options.own ?? [ALLY]).map((heroId) => ({ heroId, visibility: "REVEALED" })),
    enemyPicks: enemies,
  } as unknown as PerspectiveDraftView;
}

/** El caso que cumple todo: ME le gana DURO a CORE_A (core) y medio a SUPPORT; nadie lo counterea. */
const BASE_COUNTERS = counters([[CORE_A, [hard(ME)]], [SUPPORT, [medium(ME)]]]);

function input(overrides: Partial<GoldenCardInput> = {}): GoldenCardInput {
  return { view: view(), openPositions: [3, 4], heroPositions: POSITIONS, heroCounters: BASE_COUNTERS, poolFor: () => undefined, excluded: new Set(), ...overrides };
}

describe("selectGoldenCard -- el caso que cumple el estándar", () => {
  test("le gana duro a un core ya sacado, nadie lo counterea, cubre una posición abierta: sale la card", () => {
    const card = selectGoldenCard(input());
    expect(card?.heroId).toBe(ME);
    expect(card?.position).toBe(3); // la posición abierta donde más juega, no la de menos partidas
    expect(card?.wins.map((win) => [win.vsHeroId, win.level, win.core])).toEqual([[CORE_A, "hard", true], [SUPPORT, "medium", false]]);
    expect(card?.stillFreeHardCounters).toEqual([]);
  });
});

describe("selectGoldenCard -- razones que hablan de la línea", () => {
  // ME cubre la offlane (pos 3): se cruza con el carry rival (CORE_A, pos 1) y NO con el mid rival (CORE_B, pos 2).
  const laneCounters = counters([
    [CORE_A, [hard(ME, "le gana en la línea porque lo apaga")]],
    [CORE_B, [medium(ME, "Lo castiga en la línea con su stun")]],
    [SUPPORT, [medium(ME, "roba su hechizo con facilidad")]],
  ]);
  const threeEnemies = view({ enemies: [{ heroId: CORE_A, visibility: "REVEALED" }, { heroId: CORE_B, visibility: "REVEALED" }, { heroId: SUPPORT, visibility: "REVEALED" }] });
  const winsOfCard = () => selectGoldenCard(input({ heroCounters: laneCounters, view: threeEnemies }))?.wins ?? [];

  test("si se cruzan en la línea la razón queda tal cual; si no se cruzan, lleva '(si se cruzan en la línea)'", () => {
    const byEnemy = Object.fromEntries(winsOfCard().map((win) => [win.vsHeroId, win.why]));
    expect(byEnemy[CORE_A]).toBe("le gana en la línea porque lo apaga");
    expect(byEnemy[CORE_B]).toBe("Lo castiga en la línea con su stun (si se cruzan en la línea)");
  });

  test("una razón que no habla de la línea nunca recibe el aviso, se crucen o no", () => {
    const sameLane = winsOfCard().find((win) => win.vsHeroId === SUPPORT);
    expect(sameLane?.why).toBe("roba su hechizo con facilidad");
    const noLane = selectGoldenCard(input({ heroCounters: counters([[CORE_A, [hard(ME, "lo apaga")]], [CORE_B, [medium(ME, "lo frena")]]]), view: threeEnemies }));
    expect(noLane?.wins.map((win) => win.why)).toEqual(["lo apaga", "lo frena"]);
  });

  test("un rival flex que juega la posición que se cruza (1 de cada 4 partidas o más) cuenta como que se cruza", () => {
    const flexMid: HeroPositions = { ...POSITIONS, [CORE_B]: [{ position: 2, matches: 2000 }, { position: 1, matches: 1000 }] };
    const flexWins = selectGoldenCard(input({ heroCounters: laneCounters, heroPositions: flexMid, view: threeEnemies }))?.wins ?? [];
    expect(flexWins.find((win) => win.vsHeroId === CORE_B)?.why).toBe("Lo castiga en la línea con su stun");
  });
});

describe("selectGoldenCard -- regla 1: hay que ver al menos 2 rivales", () => {
  test("con un solo rival sacado no hay card (no hay a quién ganarle)", () => {
    expect(selectGoldenCard(input({ view: view({ enemies: [{ heroId: CORE_A, visibility: "REVEALED" }] }) }))).toBeNull();
  });

  test("un rival HIDDEN no cuenta como sacado: con 1 revelado + 1 oculto no hay card", () => {
    expect(selectGoldenCard(input({ view: view({ enemies: [{ heroId: CORE_A, visibility: "REVEALED" }, { heroId: SUPPORT, visibility: "HIDDEN" }] }) }))).toBeNull();
  });
});

describe("selectGoldenCard -- regla 3: victoria DURA contra un CORE, con razón real", () => {
  test("solo victorias medias, aunque sean contra cores: no hay card", () => {
    expect(selectGoldenCard(input({ heroCounters: counters([[CORE_A, [medium(ME)]], [CORE_B, [medium(ME)]]]), view: view({ enemies: [{ heroId: CORE_A, visibility: "REVEALED" }, { heroId: CORE_B, visibility: "REVEALED" }] }) }))).toBeNull();
  });

  test("la victoria dura es contra un SUPPORT (no mueve el draft): no hay card", () => {
    expect(selectGoldenCard(input({ heroCounters: counters([[SUPPORT, [hard(ME)]], [CORE_A, [medium(ME)]]]) }))).toBeNull();
  });

  test("la victoria dura solo dice 'Lo dicen: DotaCoach': no cuenta como razón de Dota", () => {
    expect(selectGoldenCard(input({ heroCounters: counters([[CORE_A, [hard(ME, "Lo dicen: DotaCoach (7.41f)")]], [SUPPORT, [medium(ME)]]]) }))).toBeNull();
  });
});

describe("selectGoldenCard -- regla 4: ningún rival ya sacado lo counterea", () => {
  test("un rival ya sacado lo counterea DURO: no hay card", () => {
    expect(selectGoldenCard(input({ heroCounters: counters([[CORE_A, [hard(ME)]], [SUPPORT, [medium(ME)]], [ME, [hard(SUPPORT)]]]) }))).toBeNull();
  });

  test("un rival ya sacado lo counterea MEDIO: solo pasa con 5 o más puntos de victoria (core) y como máximo 1 medio", () => {
    const CORE_C = 303;
    const positions: HeroPositions = { ...POSITIONS, [CORE_C]: [{ position: 3, matches: 3000 }] };
    const enemies3 = [{ heroId: CORE_A, visibility: "REVEALED" as const }, { heroId: CORE_B, visibility: "REVEALED" as const }, { heroId: SUPPORT, visibility: "REVEALED" as const }];
    const fourPoints = counters([[CORE_A, [hard(ME)]], [CORE_B, [hard(ME)]], [ME, [medium(SUPPORT)]]]); // 2 + 2 = 4 puntos: ya no alcanza
    expect(selectGoldenCard(input({ heroCounters: fourPoints, view: view({ enemies: enemies3 }) }))).toBeNull();
    const enemies4 = [...enemies3, { heroId: CORE_C, visibility: "REVEALED" as const }];
    const sixPoints = counters([[CORE_A, [hard(ME)]], [CORE_B, [hard(ME)]], [CORE_C, [hard(ME)]], [ME, [medium(SUPPORT)]]]); // 6 puntos
    expect(selectGoldenCard(input({ heroPositions: positions, heroCounters: sixPoints, view: view({ enemies: enemies4 }) }))?.heroId).toBe(ME);
    const twoMediums = counters([[CORE_A, [hard(ME)]], [CORE_B, [hard(ME)]], [CORE_C, [hard(ME)]], [ME, [medium(SUPPORT), medium(CORE_B)]]]);
    expect(selectGoldenCard(input({ heroPositions: positions, heroCounters: twoMediums, view: view({ enemies: enemies4 }) }))).toBeNull(); // 2 medios rivales: nunca
  });
});

describe("selectGoldenCard -- solo cuentan las victorias con razón real y sobre cores", () => {
  test("una victoria que solo dice 'Lo dicen: …' ni cuenta ni se muestra en la card", () => {
    const card = selectGoldenCard(input({ heroCounters: counters([[CORE_A, [hard(ME)]], [SUPPORT, [medium(ME, "Lo dicen: DotaCoach (7.41f)")]]]) }));
    expect(card?.heroId).toBe(ME);
    expect(card?.wins.map((win) => win.vsHeroId)).toEqual([CORE_A]);
  });

  test("las victorias sobre un rival que no es core no suman puntos (no sirven para tolerar un counter medio rival)", () => {
    const SUPPORT_B = 304;
    const SUPPORT_C = 306;
    const positions: HeroPositions = { ...POSITIONS, [SUPPORT_B]: [{ position: 5, matches: 3000 }], [SUPPORT_C]: [{ position: 5, matches: 3000 }] };
    const enemies = [CORE_A, SUPPORT, SUPPORT_B, SUPPORT_C].map((heroId) => ({ heroId, visibility: "REVEALED" as const }));
    // ME le gana duro a un core (2) y a dos supports (si contaran serían 6 >= 5); un support rival lo counterea medio.
    const c = counters([[CORE_A, [hard(ME)]], [SUPPORT, [hard(ME)]], [SUPPORT_B, [hard(ME)]], [ME, [medium(SUPPORT_C)]]]);
    expect(selectGoldenCard(input({ heroPositions: positions, heroCounters: c, view: view({ enemies }) }))).toBeNull(); // cuentan 2 < 5
  });
});

describe("selectGoldenCard -- regla 5: sus counters duros todavía libres", () => {
  test("2 counters duros libres: no hay card", () => {
    expect(selectGoldenCard(input({ heroCounters: counters([[CORE_A, [hard(ME)]], [SUPPORT, [medium(ME)]], [ME, [hard(FREE_HARD_1), hard(FREE_HARD_2)]]]) }))).toBeNull();
  });

  test("1 counter duro libre: sale la card y AVISA cuál (por nombre en la pantalla)", () => {
    const card = selectGoldenCard(input({ heroCounters: counters([[CORE_A, [hard(ME)]], [SUPPORT, [medium(ME)]], [ME, [hard(FREE_HARD_1), hard(FREE_HARD_2)]]]), view: view({ banned: [FREE_HARD_2] }) }));
    expect(card?.heroId).toBe(ME);
    expect(card?.stillFreeHardCounters).toEqual([FREE_HARD_1]);
    expect(card?.counteredOutBy).toEqual([FREE_HARD_2]);
  });
});

describe("selectGoldenCard -- fuera de pool, posición abierta, exclusión", () => {
  test("si el héroe está en TU pool de esa posición no es card dorada (es para lo que NO encaja en tu pool)", () => {
    expect(selectGoldenCard(input({ poolFor: (position) => (position === 3 ? [ME] : undefined) }))).toBeNull();
  });

  test("una posición que ya no te falta no cuenta: sin posición abierta donde juegue 1/4 de sus partidas no hay card", () => {
    expect(selectGoldenCard(input({ openPositions: [1, 2, 5] }))).toBeNull();
    expect(selectGoldenCard(input({ openPositions: [4] }))).toBeNull(); // 200 de 2200 partidas en pos 4: menos de 1/4
  });

  test("un héroe de la lista de exclusión de ejecución difícil nunca sale, aunque cumpla todo", () => {
    const rubick = 86;
    expect(GOLDEN_CARD_EXCLUDED.has(rubick)).toBe(true);
    const positions: HeroPositions = { ...POSITIONS, [rubick]: [{ position: 3, matches: 2000 }] };
    const c = counters([[CORE_A, [hard(rubick)]], [SUPPORT, [medium(rubick)]]]);
    expect(selectGoldenCard({ ...input({ heroPositions: positions, heroCounters: c }), excluded: undefined })).toBeNull();
  });

  test("Storm Spirit, Puck y Void Spirit también están excluidos (criterio del auditor de Dota)", () => {
    for (const heroId of [17, 13, 126]) expect(GOLDEN_CARD_EXCLUDED.has(heroId)).toBe(true);
  });

  test("un héroe que el RIVAL ya sacó no se ofrece como card aunque cumpla (ya no está disponible)", () => {
    const c = counters([[CORE_A, [hard(SUPPORT)]], [CORE_B, [medium(SUPPORT)]]]);
    const enemies = [{ heroId: CORE_A, visibility: "REVEALED" as const }, { heroId: CORE_B, visibility: "REVEALED" as const }, { heroId: SUPPORT, visibility: "REVEALED" as const }];
    expect(selectGoldenCard(input({ heroCounters: c, openPositions: [5], view: view({ enemies }) }))).toBeNull();
  });

  test("si está en tu pool de una posición abierta pero juega otra posición abierta fuera de pool, sale por la segunda", () => {
    const JUMP = 902;
    const positions: HeroPositions = { ...POSITIONS, [JUMP]: [{ position: 3, matches: 2000 }, { position: 4, matches: 1500 }] };
    const c = counters([[CORE_A, [hard(JUMP)]], [SUPPORT, [medium(JUMP)]]]);
    const card = selectGoldenCard(input({ heroPositions: positions, heroCounters: c, poolFor: (position) => (position === 3 ? [JUMP] : undefined) }));
    expect(card?.heroId).toBe(JUMP);
    expect(card?.position).toBe(4);
  });

  test("el borde exacto cuenta: 1/4 de sus partidas en esa posición (1.000 de 4.000) alcanza", () => {
    const EDGE = 903;
    const positions: HeroPositions = { ...POSITIONS, [EDGE]: [{ position: 3, matches: 1000 }, { position: 4, matches: 3000 }] };
    const c = counters([[CORE_A, [hard(EDGE)]], [SUPPORT, [medium(EDGE)]]]);
    expect(selectGoldenCard(input({ heroPositions: positions, heroCounters: c, openPositions: [3] }))?.heroId).toBe(EDGE);
    const below: HeroPositions = { ...POSITIONS, [EDGE]: [{ position: 3, matches: 999 }, { position: 4, matches: 3001 }] };
    expect(selectGoldenCard(input({ heroPositions: below, heroCounters: c, openPositions: [3] }))).toBeNull();
  });

  test("pieza decorativa: si algo lanza por dentro, devuelve null (el tablero nunca cae por la card)", () => {
    expect(selectGoldenCard(input({ poolFor: () => { throw new Error("falla de fixture"); } }))).toBeNull();
  });

  test("un héroe baneado o ya pickeado no sale", () => {
    expect(selectGoldenCard(input({ view: view({ banned: [ME] }) }))).toBeNull();
    expect(selectGoldenCard(input({ view: view({ own: [ME] }) }))).toBeNull();
  });
});

describe("selectGoldenCard -- entre varios que cumplen, manda el orden (no son condiciones)", () => {
  const both = (extra: [number, CuratedCounter[]][] = []) => counters([[CORE_A, [hard(ME), hard(OTHER)]], [SUPPORT, [medium(ME), medium(OTHER)]], ...extra]);

  test("más counters suyos ya baneados gana el desempate", () => {
    const c = both([[OTHER, [hard(FREE_HARD_1)]], [ME, [hard(FREE_HARD_2)]]]);
    expect(selectGoldenCard(input({ heroCounters: c, view: view({ banned: [FREE_HARD_2] }) }))?.heroId).toBe(ME);
    expect(selectGoldenCard(input({ heroCounters: c, view: view({ banned: [FREE_HARD_1] }) }))?.heroId).toBe(OTHER);
  });

  test("con todo igual manda el id más bajo (determinista)", () => {
    expect(selectGoldenCard(input({ heroCounters: both() }))?.heroId).toBe(ME);
  });

  test("una pareja con un aliado ya elegido desempata a favor del que la tiene", () => {
    const synergies: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map([[OTHER, [{ with: ALLY, why: "Combo de fixture." }]]]);
    const card = selectGoldenCard(input({ heroCounters: both(), heroSynergies: synergies }));
    expect(card?.heroId).toBe(OTHER);
    expect(card?.synergies).toEqual([{ withHeroId: ALLY, why: "Combo de fixture" }]);
  });
});
