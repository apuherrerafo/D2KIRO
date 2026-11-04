import { describe, expect, test } from "bun:test";
import type { HeroCapabilities } from "../draft-paths/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { winrateClearlyAboveEven } from "../signals/patch-meta";
import { deriveCandidateResult } from "./current-human-decision";
import { eligibilityInputOf } from "./eligibility-input";
import { extractHeroCandidates } from "./hero-card";
import { deriveOpportunity } from "./recommendation-output-v3";
import { evaluateEligibility } from "./recommendation-eligibility";
import { hidden, known, recSet, resolvedImpact, revealed, signal, view, type HeroFixture } from "./test.fixtures";

// CONTRATO DE ELEGIBILIDAD (dueño del producto, 2026-11-03), una prueba por regla. Solo se muestran héroes con al menos un fundamento
// estratégico real, verificable y relevante para el estado actual del draft. NO son fundamento: la posición, ser flex, pertenecer a un pool, la
// popularidad, cubrir un hueco cualquiera, ni una relación "Lo dicen: …" sin porqué. Fixtures inline: ningún dato curado real (familia S9/S10).

const ENEMY = 900;
const ALLY = 901;
const BANNED = 902;
const A = 11; // el héroe bajo prueba
const B = 12;
const POSITIONS: HeroPositions = {
  [A]: [{ position: 1, matches: 3000 }],
  [B]: [{ position: 1, matches: 3000 }],
  13: [{ position: 1, matches: 1500 }, { position: 3, matches: 1500 }], // flex
  20: [{ position: 1, matches: 3000 }],
};

const only = (heroId: number, weighted: number, extra: HeroFixture["signals"] = []): HeroFixture => ({
  heroId,
  signals: [signal("position_fit", 0.9, weighted, { sampleSize: 50_000, explanation: "Evidencia sólida de que funciona como carry (50.000 partidas de alto MMR)" }), ...extra],
  impact: resolvedImpact(1),
});
const WHY = "Orchid lo silencia y no puede hacer nada";
const UNREASONED = "Lo dicen: DotaCoach (7.41f), wiki Fandom (antes de 7.41)";
const counter = (vs: number, why: string, level: "hard" | "medium" = "hard"): CuratedCounter => ({ vs, level, why });

const firstPick = (bans: number[] = []) => view("PICK_ROUND_1", [], [], bans);
const withEnemy = () => view("PICK_ROUND_2", [], [revealed(ENEMY)]);
const withAlly = () => view("PICK_ROUND_2", [known(ALLY)], [hidden()]);

interface Options {
  view?: ReturnType<typeof view>;
  heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>;
  heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]>;
  heroCapabilities?: readonly HeroCapabilities[];
  activePool?: number[];
}
function derive(heroes: HeroFixture[], options: Options = {}) {
  return deriveCandidateResult({
    targetPosition: 1,
    targetRanking: recSet(heroes),
    view: options.view ?? firstPick(),
    heroPositions: POSITIONS,
    heroCounters: options.heroCounters,
    heroSynergies: options.heroSynergies,
    heroCapabilities: options.heroCapabilities,
    activePool: options.activePool,
    personalPoolApplied: false,
  });
}
const shown = (result: ReturnType<typeof derive>): number[] => result.cards.map((card) => card.heroId);

describe("lo que NO es fundamento: no hay tarjeta, ni relleno, ni mensaje", () => {
  test("solo posición / popularidad: ningún héroe, en ningún momento del draft; el resultado no trae alternativas ni razón", () => {
    for (const draft of [firstPick(), withEnemy(), withAlly()]) {
      const result = derive([only(A, 90), only(B, 80)], { view: draft });
      expect(result.state).toBe("RANKED");
      expect(shown(result)).toEqual([]);
      expect(result.poolCards).toEqual([]);
      expect(Object.keys(result).sort()).toEqual(["cards", "degradations", "poolCards", "state", "targetPosition"]);
    }
  });

  test("pertenecer al pool NO es fundamento (ni en la lista general ni en la del pool)", () => {
    const result = derive([only(A, 90), only(B, 80)], { activePool: [A] });
    expect(shown(result)).toEqual([]);
    expect(result.poolCards).toEqual([]);
  });

  test("ser flex (dos posiciones curadas) NO es fundamento", () => {
    expect(shown(derive([only(13, 90)]))).toEqual([]);
  });

  test("una relación curada que solo atribuye la fuente ('Lo dicen: …') NO es fundamento: ni abre por bans, ni es counter, ni es pareja", () => {
    const counters = new Map([[A, [counter(BANNED, UNREASONED)]], [ENEMY, [counter(A, UNREASONED)]]]);
    expect(shown(derive([only(A, 90)], { view: firstPick([BANNED]), heroCounters: counters }))).toEqual([]);
    expect(shown(derive([only(A, 90)], { view: withEnemy(), heroCounters: counters }))).toEqual([]);
    const pairs = new Map([[A, [{ with: ALLY, why: UNREASONED }]]]);
    expect(shown(derive([only(A, 90)], { view: withAlly(), heroSynergies: pairs }))).toEqual([]);
  });

  test("tampoco se MUESTRA como razón: con un fundamento real al lado, la tarjeta no trae la relación 'Lo dicen'", () => {
    const pairs = new Map([[A, [{ with: ALLY, why: UNREASONED }, { with: 905, why: "Combo de stun y daño en área" }]]]);
    const result = derive([only(A, 90)], { view: view("PICK_ROUND_2", [known(ALLY), known(905)], [hidden()]), heroSynergies: pairs });
    expect(result.cards[0]?.context.synergies).toEqual([{ withHeroId: 905, why: "Combo de stun y daño en área" }]);
  });

  test("cubrir un hueco cualquiera (team_synergy con raw > 0) NO es sinergia: sin hueco CRÍTICO demostrable no hay tarjeta", () => {
    const composition = signal("team_synergy", 0.4, 6, { explanation: "Aporta catch y daño a estructuras que a tu equipo le falta" });
    expect(shown(derive([only(A, 90, [composition])], { view: withAlly() }))).toEqual([]);
  });
});

describe("lo que SÍ es fundamento: verificable, con su porqué, y la tarjeta lo dice", () => {
  test("los bans abren al héroe (se baneó un counter suyo con porqué de Dota)", () => {
    const counters = new Map([[A, [counter(BANNED, WHY)]]]);
    const result = derive([only(A, 80), only(B, 90)], { view: firstPick([BANNED]), heroCounters: counters });
    expect(shown(result)).toEqual([A]); // B tiene más puntaje de V6 pero solo posición: queda fuera
    expect(result.cards[0]?.context.opening.openedBy).toEqual([{ heroId: BANNED, level: "hard" }]);
    expect(result.cards[0]?.badges).not.toContain("SYNERGY");
  });

  test("le gana a un rival YA revelado (counter con porqué); si el rival no se ve, no", () => {
    const counters = new Map([[ENEMY, [counter(A, WHY)]]]);
    const seen = derive([only(A, 80)], { view: withEnemy(), heroCounters: counters });
    expect(shown(seen)).toEqual([A]);
    expect(seen.cards[0]?.badges).toContain("COUNTER");
    expect(shown(derive([only(A, 80)], { view: withAlly(), heroCounters: counters }))).toEqual([]);
  });

  test("hace pareja curada (con porqué) con un aliado YA elegido; sin ese aliado, no", () => {
    const pairs = new Map([[A, [{ with: ALLY, why: "Combo de stun y daño en área" }]]]);
    const result = derive([only(A, 80)], { view: withAlly(), heroSynergies: pairs });
    expect(shown(result)).toEqual([A]);
    expect(result.cards[0]?.hideRationale).toBe(true); // el chip de contexto ya dice la pareja: la frase no se repite
    expect(shown(derive([only(A, 80)], { view: withEnemy(), heroSynergies: pairs }))).toEqual([]);
  });

  test("necesidad de composición: solo si el hueco es CRÍTICO y demostrable (ventana de cierre, picks propios curados) y el héroe lo llena", () => {
    const own = [801, 802, 803];
    const caps = (hero: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...overrides });
    const capabilities = [...own.map((id) => caps(id)), caps(A, { hasInitiation: true }), caps(B)];
    const closing = view("PICK_ROUND_2", own.map(known), [hidden()]);
    const result = derive([only(A, 70), only(B, 90)], { view: closing, heroCapabilities: capabilities });
    expect(shown(result)).toEqual([A]); // A llena "iniciar peleas"; B no llena ningún hueco crítico
    expect(result.cards[0]?.rationale).toContain("iniciar peleas");
    expect(result.cards[0]?.badges).not.toContain("SYNERGY"); // cubrir un hueco no es sinergia: sin etiqueta "Sinergia", el fundamento va en la frase
    // Con un solo pick propio todo "falta", pero eso no es una necesidad demostrable: nadie pasa por composición.
    const early = view("PICK_ROUND_1", [known(801)], [hidden()]);
    expect(shown(derive([only(A, 70)], { view: early, heroCapabilities: capabilities }))).toEqual([]);
    // Sin capacidades curadas inyectadas la composición no se puede derivar: nunca se adivina.
    expect(shown(derive([only(A, 70)], { view: closing }))).toEqual([]);
  });

  test("la intención de draft que el jugador eligió (archetype_fit con datos) es fundamento y la frase es la suya", () => {
    const intent = signal("archetype_fit", 0.8, 5, { explanation: "Encaja con tu draft de Push" });
    const result = derive([only(A, 80, [intent])]);
    expect(shown(result)).toEqual([A]);
    expect(result.cards[0]?.rationale).toBe("Encaja con tu draft de Push");
    expect(shown(derive([only(A, 80, [signal("archetype_fit", 0.8, 0)])]))).toEqual([]); // sin peso: no votó
  });

  test("el meta vigente cuenta SOLO con evidencia suficiente: 54 % sobre 5000 partidas sí; 54 % sobre 500 no; un winrate bajo no", () => {
    const meta = (raw: number, games: number) => signal("patch_meta", raw, 4, { sampleSize: games, explanation: `Winrate de ${(raw * 100).toFixed(1)}% este parche en bracket bajo/medio` });
    expect(shown(derive([only(A, 80, [meta(0.54, 5000)])]))).toEqual([A]);
    expect(shown(derive([only(A, 80, [meta(0.54, 500)])]))).toEqual([]);
    expect(shown(derive([only(A, 80, [meta(0.505, 270_000)])]))).toEqual([]); // significativo pero irrelevante: con muestras enormes casi todo "supera 50 %"
    expect(shown(derive([only(A, 80, [meta(0.49, 50_000)])]))).toEqual([]);
    expect(winrateClearlyAboveEven(0.54, 5000)).toBe(true);
    expect(winrateClearlyAboveEven(0.54, 500)).toBe(false);
    expect(winrateClearlyAboveEven(0.505, 270_000)).toBe(false);
  });

  test("la frase y las etiquetas salen de los fundamentos: el meta se dice con su cifra y NUNCA aparece 'Por su posición'", () => {
    const meta = signal("patch_meta", 0.56, 4, { sampleSize: 8000, explanation: "Winrate de 56.0% este parche en bracket bajo/medio" });
    const [card] = derive([only(A, 80, [meta])]).cards;
    expect(card?.rationale).toContain("Winrate de 56.0%");
    expect(card?.badges).toEqual(["META"]);
    expect(card?.rationale.startsWith("Por su posición")).toBe(false);
  });

  test("orden: con fundamentos solo se reordena entre los elegibles; con menos de cinco válidos se muestran menos de cinco", () => {
    const counters = new Map([[A, [counter(BANNED, WHY)]], [B, [counter(BANNED, WHY)]]]);
    const result = derive([only(A, 60), only(B, 80), only(20, 99)], { view: firstPick([BANNED]), heroCounters: counters });
    expect(shown(result)).toEqual([B, A]);
    expect(result.cards.map((card) => card.rank)).toEqual([1, 2]);
  });
});

describe("ramas del contrato que no pueden colarse por otro camino", () => {
  const statCounter = (explanation: string, raw = 0.12) => signal("counter", raw, 5, { explanation, hasRevealedEnemyCounterEvidence: true, sampleSize: 400 });

  test("la señal `counter` NO habilita por una relación curada 'Lo dicen: …': la marca de evidencia nace del counter duro curado y su frase sería la atribución", () => {
    const counters = new Map([[ENEMY, [counter(A, UNREASONED)]]]);
    const fromCurated = statCounter(`Le ganas a Enemy: ${UNREASONED}`);
    expect(shown(derive([only(A, 90, [fromCurated])], { view: withEnemy(), heroCounters: counters }))).toEqual([]);
  });

  test("counter ESTADÍSTICO contra un rival ya revelado (sin relación curada) NO es fundamento: no nombra un mecanismo y la mayoría es indistinguible del azar", () => {
    const fromStats = statCounter("Fuerte contra Enemy (58.0% en 400 partidas)");
    for (const state of [withEnemy(), firstPick()]) expect(shown(derive([only(A, 90, [fromStats])], { view: state }))).toEqual([]);
  });

  test("el meta con la instantánea degradada (degraded_meta) no es evidencia vigente, aunque el winrate y la muestra sobren", () => {
    const meta = signal("patch_meta", 0.58, 4, { sampleSize: 20_000, explanation: "Winrate de 58.0% este parche en bracket bajo/medio" });
    const stale: HeroFixture = { ...only(A, 80, [meta]) };
    const set = recSet([stale]);
    const degraded = { ...set, recommendations: set.recommendations.map((rec) => ({ ...rec, risks: [{ kind: "degraded_meta" as const, detail: "meta viejo" }] })) };
    const result = deriveCandidateResult({ targetPosition: 1, targetRanking: degraded as never, view: firstPick(), heroPositions: POSITIONS, personalPoolApplied: false });
    expect(result.cards).toEqual([]);
  });

  test("la intención con explicación 'Sin …' (sin datos) no habilita", () => {
    expect(shown(derive([only(A, 80, [signal("archetype_fit", 0.8, 5, { explanation: "Sin datos de capacidades" })])]))).toEqual([]);
  });

  test("el robo (le quita un counter a un pick tuyo) es fundamento, con su porqué curado", () => {
    const stolen = 777;
    const counters = new Map([[stolen, [counter(A, "Una vez fuera, su silencio ya no te corta el combo")]]]);
    const positions: HeroPositions = { ...POSITIONS, [A]: [{ position: 1, matches: 5000 }] };
    const result = deriveCandidateResult({ targetPosition: 1, targetRanking: recSet([only(A, 80)]), view: view("PICK_ROUND_2", [known(stolen)], [hidden()]), heroPositions: positions, heroCounters: counters, personalPoolApplied: false });
    expect(shown(result)).toEqual([A]);
    expect(result.cards[0]?.context.steals.length).toBeGreaterThan(0);
  });
});

describe("fallbacks: un ranking degradado nunca se rescata con héroes sin fundamento", () => {
  test("ranking inválido (NO_LEGAL_HERO_UNIVERSE, SNAPSHOT_UNAVAILABLE): cero tarjetas, aunque los héroes tengan fundamento en V6", () => {
    const counters = new Map([[A, [counter(BANNED, WHY)]]]);
    for (const reason of ["NO_LEGAL_HERO_UNIVERSE", "SNAPSHOT_UNAVAILABLE"] as const) {
      const result = deriveCandidateResult({
        targetPosition: 1 as Position,
        targetRanking: recSet([only(A, 90)], { degradations: [{ reason, detail: "fixture" }] }),
        view: firstPick([BANNED]),
        heroPositions: POSITIONS,
        heroCounters: counters,
        personalPoolApplied: false,
      });
      expect(result.cards).toEqual([]);
      expect(result.degradations.map((entry) => entry.reason)).toEqual([reason]);
    }
  });
});

describe("Safe Core ('Ventana de core') también pasa por el contrato: nombra a un héroe", () => {
  const BAN_A = 801;
  const BAN_B = 802;
  const run = (why: string, withContract: boolean) => {
    const counters = new Map([[A, [counter(BAN_A, why), counter(BAN_B, why)]]]);
    const state = firstPick([BAN_A, BAN_B]);
    const candidates = extractHeroCandidates(recSet([only(A, 90)]), POSITIONS);
    const eligible = (candidate: (typeof candidates)[number]) => evaluateEligibility(candidate, eligibilityInputOf(state, { heroCounters: counters, heroPositions: POSITIONS }, candidate.position)).grounds.length > 0;
    return deriveOpportunity(candidates, state, counters, withContract ? eligible : undefined);
  };

  test("la ventana con counters que traen porqué (el ban abre al héroe) sale; con solo 'Lo dicen: …' NO (la evidencia de la ventana ya no sale de atribuciones)", () => {
    expect(run(WHY, true)?.heroId).toBe(A);
    expect(run(UNREASONED, false)).toBeNull();
    expect(run(UNREASONED, true)).toBeNull();
  });

  test("y el héroe de la ventana pasa por el MISMO contrato de elegibilidad: si no tiene fundamento, no se nombra", () => {
    const counters = new Map([[A, [counter(BAN_A, WHY), counter(BAN_B, WHY)]]]);
    const state = firstPick([BAN_A, BAN_B]);
    const candidates = extractHeroCandidates(recSet([only(A, 90)]), POSITIONS);
    expect(deriveOpportunity(candidates, state, counters, () => true)?.heroId).toBe(A);
    expect(deriveOpportunity(candidates, state, counters, () => false)).toBeNull();
  });
});
