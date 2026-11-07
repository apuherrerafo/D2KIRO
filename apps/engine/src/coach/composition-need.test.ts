import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { HeroPositions } from "../signals/hero-positions";
import { compositionNeedForContext, deriveCompositionNeed } from "./composition-need";
import { known, view } from "./test.fixtures";

// Posiciones habituales de los héroes de prueba -- fixtures inline (S10): nunca el archivo curado, que se regenera por parche.
const share = (position: Position, matches: number) => ({ position, matches });
const LION = 101; // soft/hard support, con un poco de mid (como Lion)
const CRYSTAL = 102; // hard support puro con un poco de mid
const RUBICK = 103; // soft support con un poco de mid
const WITCH = 104; // otro support
const CARRY = 201;
const OFFLANE = 202;
const MID = 203;
const OGRE = 301; // flex de verdad: offlane / soft / hard
const ZEUS = 302; // flex de verdad: mid / soft

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
};

describe("deriveCompositionNeed -- qué le falta a la composición cuando no se sabe quién es quién", () => {
  test("Lion + Crystal Maiden + Rubick: carry y offlane quedan sin cubrir, support y hard support están cubiertos", () => {
    const need = deriveCompositionNeed({ ownHeroes: [LION, CRYSTAL, RUBICK], heroPositions: POSITIONS })!;
    expect(need[1]).toBeCloseTo(1, 6);
    expect(need[3]).toBeCloseTo(1, 6);
    expect(need[4]).toBeLessThan(0.05);
    expect(need[5]).toBeLessThan(0.05);
  });

  test("un solo support: sus dos asientos están casi cubiertos y los cores siguen faltando (no se obliga a nada)", () => {
    const need = deriveCompositionNeed({ ownHeroes: [CRYSTAL], heroPositions: POSITIONS })!;
    expect(need[1]).toBeCloseTo(1, 6);
    expect(need[2]).toBeGreaterThan(0.5);
    expect(need[3]).toBeCloseTo(1, 6);
    expect(need[5]).toBeLessThan(need[3]);
  });

  test("los flex cuentan con toda su distribución, no con su posición más popular: Ogre Magi (offlane/soft/hard) deja el offlane sin cerrar", () => {
    const need = deriveCompositionNeed({ ownHeroes: [OGRE, ZEUS], heroPositions: POSITIONS })!;
    // Si Ogre se tomara sólo por su posición más popular (soft support) el offlane quedaría en 1; con la distribución completa
    // puede ser el offlane de Ogre, así que algo de él está cubierto.
    expect(need[3]).toBeLessThan(1);
    expect(need[1]).toBeCloseTo(1, 6); // nadie puede ser carry
  });

  test("una posición confirmada por una fuente es un hecho: queda cubierta y el resto se infiere alrededor", () => {
    const need = deriveCompositionNeed({ ownHeroes: [OGRE, CARRY], confirmed: new Map<number, Position>([[CARRY, 1]]), heroPositions: POSITIONS })!;
    expect(need[1]).toBeCloseTo(0, 6);
  });

  test("nada que inferir -> null: sin picks, sin datos de posición, o con todos los picks ya confirmados", () => {
    expect(deriveCompositionNeed({ ownHeroes: [], heroPositions: POSITIONS })).toBeNull();
    expect(deriveCompositionNeed({ ownHeroes: [LION], heroPositions: undefined })).toBeNull();
    const all = new Map<number, Position>([[LION, 4], [CARRY, 1]]);
    expect(deriveCompositionNeed({ ownHeroes: [LION, CARRY], confirmed: all, heroPositions: POSITIONS })).toBeNull();
  });

  test("cuatro supports para los asientos que pueden cubrir (alguno juega fuera de rol): se conserva lo que se sabe, carry y offlane siguen sin cubrir", () => {
    const need = deriveCompositionNeed({ ownHeroes: [LION, CRYSTAL, RUBICK, WITCH], heroPositions: POSITIONS })!;
    expect(need[1]).toBeCloseTo(1, 6);
    expect(need[3]).toBeCloseTo(1, 6);
    expect(need[4]).toBeLessThan(0.05);
    expect(need[5]).toBeLessThan(0.05);
  });

  test("dos picks que una fuente afirmó en la misma posición es un choque real: no se repara, null", () => {
    const clash = new Map<number, Position>([[CARRY, 1], [OFFLANE, 1]]);
    expect(deriveCompositionNeed({ ownHeroes: [CARRY, OFFLANE, LION], confirmed: clash, heroPositions: POSITIONS })).toBeNull();
  });

  test("más de cinco héroes no es un equipo: null", () => {
    expect(deriveCompositionNeed({ ownHeroes: [LION, CRYSTAL, RUBICK, WITCH, CARRY, OFFLANE], heroPositions: POSITIONS })).toBeNull();
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

  test("en el Live con tres supports devuelve la necesidad de carry y offlane", () => {
    const need = compositionNeedForContext(context(true, [LION, CRYSTAL, RUBICK]), POSITIONS)!;
    expect(need[1]).toBeCloseTo(1, 6);
    expect(need[3]).toBeCloseTo(1, 6);
  });

  test("sin picks propios (primer pick) es null: el primer pick queda idéntico", () => {
    expect(compositionNeedForContext(context(true, []), POSITIONS)).toBeNull();
  });
});
