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
    expect(result.cards[0]?.context.opening.openedBy).toEqual([{ heroId: BANNED, level: "hard", why: WHY }]); // la amenaza que desapareció, con su porqué
    expect(result.cards[0]?.badges).not.toContain("SYNERGY");
    expect(result.cards[0]?.evidenceStrength).toBe("STRONG"); // lo baneado pesa más que lo que queda (nada)
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
    // 3 aliados físicos sin iniciar ni atrapar: huecos críticos = iniciar, atrapar, segundo tipo de daño (3) y quedan 2 picks: cada pick debe cargar con 2.
    const capabilities = [...own.map((id) => caps(id)), caps(A, { hasInitiation: true, hasCatch: true }), caps(B), caps(20, { hasInitiation: true })];
    const closing = view("PICK_ROUND_2", own.map(known), [hidden()]);
    const result = derive([only(A, 70), only(B, 90), only(20, 80)], { view: closing, heroCapabilities: capabilities });
    expect(shown(result)).toEqual([A]); // A llena 2 huecos (su parte justa); 20 llena solo uno y B ninguno
    expect(result.cards[0]?.rationale).toContain("iniciar peleas");
    expect(result.cards[0]?.badges).not.toContain("SYNERGY"); // cubrir un hueco no es sinergia: sin etiqueta "Sinergia", el fundamento va en la frase
    // Con un solo pick propio todo "falta", pero eso no es una necesidad demostrable: nadie pasa por composición.
    const early = view("PICK_ROUND_1", [known(801)], [hidden()]);
    expect(shown(derive([only(A, 70)], { view: early, heroCapabilities: capabilities }))).toEqual([]);
    // Sin capacidades curadas inyectadas la composición no se puede derivar: nunca se adivina.
    expect(shown(derive([only(A, 70)], { view: closing }))).toEqual([]);
  });

  test("la intención de draft que el jugador eligió es una PREFERENCIA: sola no habilita; con evidencia del draft se muestra como complemento", () => {
    const intent = signal("archetype_fit", 0.8, 5, { explanation: "Encaja con tu draft de Push" });
    expect(shown(derive([only(A, 80, [intent])]))).toEqual([]); // sola: nada
    const counters = new Map([[A, [counter(BANNED, WHY)]]]);
    const result = derive([only(A, 80, [intent])], { view: firstPick([BANNED]), heroCounters: counters });
    expect(shown(result)).toEqual([A]);
    expect(result.cards[0]?.rationale).toBe("Encaja con tu draft de Push"); // lo que los chips no muestran: la preferencia que acompaña a la evidencia
    expect(result.cards[0]?.evidenceStrength).toBe("STRONG");
    const noWeight = derive([only(A, 80, [signal("archetype_fit", 0.8, 0)])], { view: firstPick([BANNED]), heroCounters: counters });
    expect(noWeight.cards[0]?.hideRationale).toBe(true); // sin peso no votó: no complementa, y los chips de la amenaza ya dicen todo
  });

  test("P0-04: el winrate global NO es fundamento, con cualquier cifra y cualquier muestra (la función estadística pura se conserva, ya no decide)", () => {
    const meta = (raw: number, games: number) => signal("patch_meta", raw, 4, { sampleSize: games, explanation: `Winrate de ${(raw * 100).toFixed(1)}% este parche en bracket bajo/medio` });
    for (const [raw, games] of [[0.54, 5000], [0.54, 500], [0.505, 270_000], [0.49, 50_000], [0.65, 270_000]] as const) {
      expect(shown(derive([only(A, 80, [meta(raw, games)])]))).toEqual([]);
    }
    expect(winrateClearlyAboveEven(0.54, 5000)).toBe(true);
    expect(winrateClearlyAboveEven(0.54, 500)).toBe(false);
    expect(winrateClearlyAboveEven(0.505, 270_000)).toBe(false);
  });

  test("P0-04: con un fundamento real, el winrate no agrega frase ni etiqueta META", () => {
    const meta = signal("patch_meta", 0.56, 4, { sampleSize: 8000, explanation: "Winrate de 56.0% este parche en bracket bajo/medio" });
    const counters = new Map([[A, [counter(BANNED, WHY)]]]);
    const [card] = derive([only(A, 80, [meta])], { view: firstPick([BANNED]), heroCounters: counters }).cards;
    expect(card?.rationale).not.toContain("Winrate");
    expect(card?.badges).not.toContain("META");
  });

  test("orden: con fundamentos solo se reordena entre los elegibles; con menos de cinco válidos se muestran menos de cinco", () => {
    const counters = new Map([[A, [counter(BANNED, WHY)]], [B, [counter(BANNED, WHY)]]]);
    const result = derive([only(A, 60), only(B, 80), only(20, 99)], { view: firstPick([BANNED]), heroCounters: counters });
    expect(shown(result)).toEqual([B, A]);
    expect(result.cards.map((card) => card.rank)).toEqual([1, 2]);
  });
});

describe("ELEGIBILIDAD != FUERZA: un héroe puede aparecer sin poder ser acción principal", () => {
  const MEDIUM_A = 701;
  // P0-04: el fundamento DÉBIL de estas pruebas ya no es el winrate sino un ban equilibrado (baneado 2 = libre 2: aparece, pero no sostiene la acción).
  const balanced = (hero: number) => [counter(BANNED, WHY), counter(MEDIUM_A, "Su stun lo corta a media pelea", "medium"), counter(701 + hero, "Su silencio le apaga el hechizo clave", "medium")];
  const MEDIUM_B = 702;

  test("un fundamento DÉBIL solo (ban equilibrado): el héroe aparece, marcado WEAK", () => {
    const result = derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: new Map([[A, balanced(A)]]) });
    expect(shown(result)).toEqual([A]);
    expect(result.cards[0]?.evidenceStrength).toBe("WEAK");
  });

  test("débil + un fundamento fuerte = FUERTE (el fuerte manda)", () => {
    const counters = new Map([[A, [counter(BANNED, WHY)]]]);
    const result = derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: counters });
    expect(result.cards[0]?.evidenceStrength).toBe("STRONG");
  });

  test("la fuerza NO cambia el orden ni el puntaje de V6: el débil con más puntaje sigue primero en la lista", () => {
    const counters = new Map([[A, balanced(A)], [B, [counter(BANNED, WHY)]]]);
    const withoutStrength = derive([only(A, 90), only(B, 60)], { view: firstPick([BANNED]), heroCounters: counters });
    expect(shown(withoutStrength)).toEqual([A, B]);
    expect(withoutStrength.cards.map((card) => card.evidenceStrength)).toEqual(["WEAK", "STRONG"]);
    expect(withoutStrength.cards.map((card) => card.score)).toEqual([90, 60]); // el puntaje es el de V6, intacto
  });

  test("un ban NO abre automáticamente: lo baneado debe pesar MÁS que lo que sigue libre para que sea FUERTE", () => {
    const clearly = new Map([[A, [counter(BANNED, WHY), counter(MEDIUM_A, "Su stun lo corta a media pelea", "medium")]]]); // baneado 2 > libre 1
    const balanced = new Map([[A, [counter(BANNED, WHY), counter(MEDIUM_A, "Su stun lo corta a media pelea", "medium"), counter(MEDIUM_B, "Su silencio le apaga el hechizo clave", "medium")]]]); // baneado 2 = libre 2
    const strong = derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: clearly });
    const weak = derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: balanced });
    expect(strong.cards[0]?.evidenceStrength).toBe("STRONG");
    expect(weak.cards[0]?.evidenceStrength).toBe("WEAK"); // aparece, pero el ban no lo sostiene como acción principal
    // Lo que se muestra identifica la amenaza que desapareció y las que quedan, cada una con su mecanismo.
    expect(weak.cards[0]?.context.opening.openedBy).toEqual([{ heroId: BANNED, level: "hard", why: WHY }]);
    expect(weak.cards[0]?.context.opening.stillFree.map((note) => [note.heroId, note.why])).toEqual([[MEDIUM_A, "Su stun lo corta a media pelea"], [MEDIUM_B, "Su silencio le apaga el hechizo clave"]]);
  });

  test("si queda libre un counter DURO probable, el ban no abre nada (no hay tarjeta por ban)", () => {
    const stillThreat = new Map([[A, [counter(BANNED, WHY), counter(MEDIUM_A, "Lo mata antes de que juegue", "hard")]]]);
    expect(shown(derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: stillThreat }))).toEqual([]);
  });

  test("un counter ESTADÍSTICO solo complementa: con un fundamento aparece como frase; solo, no habilita", () => {
    const statistical = signal("counter", 0.12, 5, { explanation: "58.0% de victorias vs Enemy (400 partidas analizadas)", hasRevealedEnemyCounterEvidence: true, sampleSize: 400 });
    expect(shown(derive([only(A, 90, [statistical])], { view: withEnemy() }))).toEqual([]);
    const pairs = new Map([[A, [{ with: ALLY, why: "Combo de stun y daño en área" }]]]);
    const result = derive([only(A, 90, [statistical])], { view: view("PICK_ROUND_2", [known(ALLY)], [revealed(ENEMY)]), heroSynergies: pairs });
    expect(shown(result)).toEqual([A]);
    // P0-05D: el fundamento (la pareja) abre la frase; el dato estadístico va detrás, neutral, y nunca la sustituye.
    expect(result.cards[0]?.rationale).toBe("Hace pareja con un aliado ya elegido · 58.0% de victorias vs Enemy (400 partidas analizadas)");
    expect(result.cards[0]?.badges).toEqual(["SYNERGY"]); // COUNTER es solo para el counter curado con porqué
  });
});

describe("composición: necesidad concreta según aliados conocidos y picks que quedan (sin ventana fija)", () => {
  const caps = (hero: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...overrides });
  const OWN = [801, 802];
  const own = (picks: number[]) => view("PICK_ROUND_2", picks.map(known), [hidden()]);

  test("aliados sin iniciar ni atrapar y picks que no alcanzan para todos los huecos: quien inicia es FUERTE y la frase nombra el hueco y la presión", () => {
    // 2 aliados físicos sin iniciar ni atrapar: huecos críticos = iniciar, atrapar, segundo tipo de daño (3) >= picks que quedan (3).
    const capabilities = [...OWN.map((id) => caps(id)), caps(A, { hasInitiation: true }), caps(B)];
    const result = derive([only(A, 70), only(B, 90)], { view: own(OWN), heroCapabilities: capabilities });
    expect(shown(result)).toEqual([A]);
    expect(result.cards[0]?.evidenceStrength).toBe("STRONG");
    expect(result.cards[0]?.rationale).toContain("iniciar peleas");
    expect(result.cards[0]?.rationale).toContain("te quedan 3 picks para 3 huecos");
  });

  test("con margen (menos huecos que picks por jugar) NO es necesidad todavía, aunque el héroe cubra un hueco", () => {
    const capabilities = [...OWN.map((id) => caps(id, { hasInitiation: true, hasCatch: true })), caps(A, { damageType: "magical" }), caps(B)];
    // Solo falta un segundo tipo de daño (1 hueco) y quedan 3 picks: se puede esperar.
    expect(shown(derive([only(A, 70)], { view: own(OWN), heroCapabilities: capabilities }))).toEqual([]);
  });

  test("con un aliado SIN capacidades curadas la cobertura es desconocida: nunca se declara una necesidad", () => {
    const capabilities = [caps(801), caps(A, { hasInitiation: true })]; // 802 no está curado
    expect(shown(derive([only(A, 70)], { view: own(OWN), heroCapabilities: capabilities }))).toEqual([]);
  });

  test("cubrir un rol vacío NO basta: un héroe que no llena ninguno de los huecos críticos no pasa", () => {
    const capabilities = [...OWN.map((id) => caps(id)), caps(A), caps(B, { hasInitiation: true })];
    expect(shown(derive([only(A, 90)], { view: own(OWN), heroCapabilities: capabilities }))).toEqual([]);
  });
});

describe("ronda 3: la fuerza del ban se pesa sobre listas completas y solo con porqué; lo ya counterado no es fuerte", () => {
  const med = (vs: number) => counter(vs, `Su control ${vs} lo corta a media pelea`, "medium");

  test("un counter baneado SIN porqué ('Lo dicen') no suma del lado baneado: lo que se muestra es lo que pesa", () => {
    const counters = new Map([[A, [counter(BANNED, UNREASONED), med(701), med(702), med(703)]]]); // baneado con porqué: el medio 701 baneado?? no: solo el hard está baneado
    const sinPorque = derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: counters });
    expect(shown(sinPorque)).toEqual([]); // sin ningún counter baneado con porqué no hay "abre" que mostrar
    const mixed = new Map([[A, [counter(BANNED, UNREASONED), med(704), med(701), med(702)]]]);
    const result = derive([only(A, 80)], { view: firstPick([BANNED, 704]), heroCounters: mixed });
    // Baneados: hard sin porqué (no cuenta) + medio con porqué (1). Libres probables: 2 medios (2). 1 > 2 es falso -> DÉBIL, aunque el duro sin porqué sumara 3.
    expect(result.cards[0]?.evidenceStrength).toBe("WEAK");
  });

  test("sin el corte de lo listado: 2 duros baneados (4) contra 6 medios libres (6) es DÉBIL aunque se muestren solo 3 libres", () => {
    const counters = new Map([[A, [counter(BANNED, WHY), counter(705, WHY), med(701), med(702), med(703), med(706), med(707), med(708)]]]);
    const result = derive([only(A, 80)], { view: firstPick([BANNED, 705]), heroCounters: counters });
    expect(result.cards[0]?.context.opening.stillFree.length).toBeLessThanOrEqual(3); // lo que se muestra está acotado...
    expect(result.cards[0]?.evidenceStrength).toBe("WEAK"); // ...pero el peso se calcula sobre TODO lo que queda libre
  });

  test("un héroe al que un rival YA revelado le gana (counter curado) puede aparecer pero nunca como recomendación FUERTE", () => {
    const counters = new Map([[A, [counter(BANNED, WHY), counter(ENEMY, "Lo silencia y lo deja sin hechizos")]]]);
    const threatened = derive([only(A, 80)], { view: view("PICK_ROUND_2", [], [revealed(ENEMY)], [BANNED]), heroCounters: counters });
    expect(shown(threatened)).toEqual([A]);
    expect(threatened.cards[0]?.evidenceStrength).toBe("WEAK");
    const calm = derive([only(A, 80)], { view: firstPick([BANNED]), heroCounters: new Map([[A, [counter(BANNED, WHY)]]]) });
    expect(calm.cards[0]?.evidenceStrength).toBe("STRONG");
  });

  test("el meta DÉBIL no se queda con la frase cuando hay un fundamento FUERTE: la tarjeta no cita el winrate como motivo", () => {
    const meta = signal("patch_meta", 0.58, 4, { sampleSize: 20_000, explanation: "Winrate de 58.0% este parche en bracket bajo/medio" });
    const counters = new Map([[A, [counter(BANNED, WHY)]]]);
    const result = derive([only(A, 80, [meta])], { view: firstPick([BANNED]), heroCounters: counters });
    expect(result.cards[0]?.evidenceStrength).toBe("STRONG");
    expect(result.cards[0]?.hideRationale).toBe(true);
    expect(result.cards[0]?.rationale).not.toContain("Winrate");
  });

  test("Safe Core exige evidencia FUERTE: con 2 duros baneados pero 4 medios libres (4 contra 4) la ventana NO se destaca", () => {
    const counters = new Map([[A, [counter(801, WHY), counter(802, WHY), med(711), med(712), med(713), med(714)]]]);
    const state = firstPick([801, 802]);
    const candidates = extractHeroCandidates(recSet([only(A, 90)]), POSITIONS);
    const strong = (candidate: (typeof candidates)[number]) => evaluateEligibility(candidate, eligibilityInputOf(state, { heroCounters: counters, heroPositions: POSITIONS }, candidate.position)).strength === "STRONG";
    expect(deriveOpportunity(candidates, state, counters, strong)).toBeNull();
    expect(deriveOpportunity(candidates, state, counters, () => true)?.heroId).toBe(A); // sin la exigencia, la ventana sí saldría
  });

  test("composición: quien solo cubre UNO de 3 huecos con 2 picks por jugar no resuelve la presión (parte justa = 2)", () => {
    const caps = (hero: number, overrides: Partial<HeroCapabilities> = {}): HeroCapabilities => ({ hero, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "low", ...overrides });
    const own = [801, 802, 803];
    const capabilities = [...own.map((id) => caps(id)), caps(A, { hasInitiation: true }), caps(B, { hasInitiation: true, hasCatch: true })];
    const closing = view("PICK_ROUND_2", own.map(known), [hidden()]);
    expect(shown(derive([only(A, 90), only(B, 70)], { view: closing, heroCapabilities: capabilities }))).toEqual([B]);
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
    const fromStats = statCounter("58.0% de victorias vs Enemy (400 partidas analizadas)");
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
    const eligible = (candidate: (typeof candidates)[number]) => evaluateEligibility(candidate, eligibilityInputOf(state, { heroCounters: counters, heroPositions: POSITIONS }, candidate.position)).strength === "STRONG";
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
