import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { HeroPositions } from "../signals/hero-positions";
import { compositionNeedForContext, deriveCompositionNeed, uncoveredPositions } from "./composition-need";
import { known, view } from "./test.fixtures";

// Posiciones habituales de los héroes de prueba -- fixtures inline (S10): nunca el archivo curado, que se regenera por parche.
const share = (position: Position, matches: number) => ({ position, matches });
const LION = 101; // soft/hard support con un poco de mid (como Lion)
const CRYSTAL = 102; // hard support con un poco de mid
const RUBICK = 103; // soft support con un poco de mid
const WITCH = 104; // otro support con un poco de mid
const CARRY = 201;
const OFFLANE = 202;
const MID = 203;
const OGRE = 301; // flex de verdad: offlane / soft / hard
const ZEUS = 302; // flex de verdad: mid / soft
const PURE_A = 401; // supports sin ninguna otra posición en los datos
const PURE_B = 402;
const PURE_C = 403;
const PURE_D = 404;
const PUDGE = 501; // soft support con offlane posible
const UNDYING = 502; // soft support con offlane posible
const SPREAD_A = 601; // reparte su juego entre offlane (60%) y soft support (40%)
const SPREAD_B = 602; // reparte su juego entre soft support (40%) y hard support (60%)

const POSITIONS: HeroPositions = {
  [LION]: [share(4, 5000), share(5, 3500), share(2, 1000)],
  [CRYSTAL]: [share(5, 6000), share(4, 2500), share(2, 700)],
  [RUBICK]: [share(4, 4000), share(5, 3800), share(2, 800)],
  [WITCH]: [share(5, 4500), share(4, 3500), share(2, 700)],
  [CARRY]: [share(1, 9000)],
  [OFFLANE]: [share(3, 9000)],
  [MID]: [share(2, 9000)],
  [OGRE]: [share(3, 2500), share(4, 4000), share(5, 3500)],
  [ZEUS]: [share(2, 2500), share(4, 6000), share(5, 1500)],
  [PURE_A]: [share(4, 6000), share(5, 4000)],
  [PURE_B]: [share(5, 6000), share(4, 4000)],
  [PURE_C]: [share(4, 5000), share(5, 5000)],
  [PURE_D]: [share(5, 5000), share(4, 5000)],
  [PUDGE]: [share(4, 6800), share(3, 2400), share(2, 700), share(1, 100)],
  [UNDYING]: [share(4, 7200), share(3, 2800)],
  [SPREAD_A]: [share(3, 6000), share(4, 4000)],
  [SPREAD_B]: [share(4, 4000), share(5, 6000)],
};

const covered = (ownHeroes: number[], confirmed?: [number, Position][]) =>
  deriveCompositionNeed({ ownHeroes, confirmed: confirmed ? new Map(confirmed) : undefined, heroPositions: POSITIONS });

describe("deriveCompositionNeed -- qué cubren los picks propios cuando no se sabe (del todo) quién es quién", () => {
  test("Lion + Crystal Maiden + Rubick: sólo support y hard support quedan cubiertos; carry, mid y offlane faltan", () => {
    const result = covered([LION, CRYSTAL, RUBICK])!;
    expect(result.covered).toEqual([4, 5]);
    expect(result.need[1]).toBeCloseTo(1, 6);
    expect(result.need[3]).toBeCloseTo(1, 6);
  });

  test("un rol muy improbable NO es cobertura garantizada: tres supports 'caben' en {mid, soft, hard} pero el mid sigue faltando", () => {
    // Sólo con la factibilidad (asignación conjunta) el mid saldría cubierto con certeza, porque alguno TIENE que sentarse ahí.
    const result = covered([LION, CRYSTAL, RUBICK])!;
    expect(result.need[2]).toBeGreaterThan(0.5);
    expect(result.covered).not.toContain(2);
  });

  test("lo mismo con cuatro supports que ya no caben: se conserva lo que se sabe y el mid / carry / offlane siguen faltando", () => {
    const result = covered([LION, CRYSTAL, RUBICK, WITCH])!;
    expect(result.covered).toEqual([4, 5]);
    expect(result.need[2]).toBeGreaterThan(0.5);
  });

  test("cuatro supports PUROS 4/5 (sin ningún mid en los datos) tampoco devuelven null: se sacan los que hagan falta hasta que quepan", () => {
    const result = covered([PURE_A, PURE_B, PURE_C, PURE_D])!;
    expect(result).not.toBeNull();
    expect(result.covered).toEqual([4, 5]);
    expect(result.need[1]).toBeCloseTo(1, 6);
    expect(result.need[3]).toBeCloseTo(1, 6);
  });

  test("posición declarada + el resto sin declarar: el asiento declarado queda cubierto y los pendientes se infieren con el equipo completo", () => {
    const result = covered([LION, CRYSTAL, RUBICK], [[LION, 4]])!;
    expect(result.need[4]).toBeCloseTo(0, 6);
    expect(result.covered).toEqual([4, 5]);
    expect(result.need[1]).toBeCloseTo(1, 6);
    expect(result.need[3]).toBeCloseTo(1, 6);
  });

  test("con cuatro supports y uno declarado el declarado NUNCA se saca de la cuenta (y la cuenta no cae a null)", () => {
    for (const confirmed of [[[PURE_A, 4]], [[PURE_B, 5]], [[PURE_C, 4]]] as [number, Position][][]) {
      const result = covered([PURE_A, PURE_B, PURE_C, PURE_D], confirmed)!;
      expect(result).not.toBeNull();
      expect(result.need[confirmed[0]![1]]).toBeCloseTo(0, 6);
    }
  });

  test("un solo support: sólo su asiento más probable queda cubierto; no se obliga a nada más", () => {
    expect(covered([CRYSTAL])!.covered).toEqual([5]);
    expect(covered([LION])!.covered).toEqual([4]);
  });

  test("los flex cuentan con toda su distribución: Ogre Magi + Zeus dejan el hard support sin cubrir y no cierran carry ni offlane", () => {
    const result = covered([OGRE, ZEUS])!;
    expect(result.covered).not.toContain(1);
    expect(result.covered).not.toContain(5);
    expect(result.need[3]).toBeGreaterThan(0.5);
  });

  test("Pudge + Undying (soft supports con offlane posible): el offlane NO cuenta como cubierto por una mayoría aparente", () => {
    const result = covered([PUDGE, UNDYING])!;
    expect(result.covered).not.toContain(3);
    expect(result.need[3]).toBeGreaterThan(0.5);
  });

  test("dos héroes que repartidos 'cubren' tres posiciones a la vez: sólo dos quedan cubiertas (nunca más posiciones que héroes), las de mayor cobertura", () => {
    const result = covered([SPREAD_A, SPREAD_B])!;
    expect(result.covered).toHaveLength(2);
    expect(result.covered).not.toContain(4); // la del medio es la menos cubierta de las tres
  });

  test("nunca hay más posiciones cubiertas que héroes propios (límite estructural), en cualquier combinación", () => {
    const heroes = Object.keys(POSITIONS).map(Number);
    for (const a of heroes) {
      for (const b of heroes) {
        if (a === b) continue;
        const pair = covered([a, b]);
        if (pair) expect(pair.covered.length).toBeLessThanOrEqual(2);
        for (const c of heroes) {
          if (c === a || c === b) continue;
          const trio = covered([a, b, c]);
          if (trio) expect(trio.covered.length).toBeLessThanOrEqual(3);
        }
      }
    }
  });

  test("héroes repetidos cuentan una sola vez", () => {
    expect(covered([LION, LION, CRYSTAL])).toEqual(covered([LION, CRYSTAL]));
  });

  test("nada que inferir -> null: sin picks, sin datos de posición, o con todos los picks ya confirmados", () => {
    expect(covered([])).toBeNull();
    expect(deriveCompositionNeed({ ownHeroes: [LION], heroPositions: undefined })).toBeNull();
    expect(covered([LION, CARRY], [[LION, 4], [CARRY, 1]])).toBeNull();
  });

  test("dos picks que una fuente afirmó en el mismo asiento es un choque real: no se repara, null", () => {
    expect(covered([CARRY, OFFLANE, LION], [[CARRY, 1], [OFFLANE, 1]])).toBeNull();
  });

  test("más de cinco héroes no es un equipo: null", () => {
    expect(covered([LION, CRYSTAL, RUBICK, WITCH, CARRY, OFFLANE])).toBeNull();
  });

  test("es determinista: el mismo equipo da el mismo resultado, en cualquier orden de los picks", () => {
    expect(covered([RUBICK, LION, CRYSTAL])).toEqual(covered([LION, CRYSTAL, RUBICK]));
  });
});

describe("uncoveredPositions", () => {
  test("devuelve lo accionable que los picks no cubren, conservando el orden dado", () => {
    const need = covered([LION, CRYSTAL, RUBICK])!;
    expect(uncoveredPositions([5, 4, 3, 1, 2], need)).toEqual([3, 1, 2]);
    expect(uncoveredPositions([4, 5], need)).toEqual([]);
  });
});

describe("compositionNeedForContext -- sólo el Live, sólo lo que el jugador ve", () => {
  const context = (live: boolean, own: number[]): PerspectiveRecommendationContext =>
    ({
      view: view("PICK_ROUND_2", own.map((heroId) => known(heroId)), []),
      openOwnSlots: [],
      partyContext: null,
      patch: "7.41f",
      liveCapture: live,
    }) as PerspectiveRecommendationContext;

  test("en el simulador (sin liveCapture) es null aunque haya tres supports: el simulador queda idéntico", () => {
    expect(compositionNeedForContext(context(false, [LION, CRYSTAL, RUBICK]), POSITIONS)).toBeNull();
  });

  test("en el Live con tres supports devuelve lo cubierto (support y hard support)", () => {
    expect(compositionNeedForContext(context(true, [LION, CRYSTAL, RUBICK]), POSITIONS)!.covered).toEqual([4, 5]);
  });

  test("sin picks propios (primer pick) es null: el primer pick queda idéntico", () => {
    expect(compositionNeedForContext(context(true, []), POSITIONS)).toBeNull();
  });

  test("nunca lanza: con datos de posición corruptos devuelve null y el Coach sigue como siempre", () => {
    const broken = { [LION]: [{ position: 9, matches: Number.NaN }] } as unknown as HeroPositions;
    expect(() => compositionNeedForContext(context(true, [LION, CRYSTAL]), broken)).not.toThrow();
  });
});
