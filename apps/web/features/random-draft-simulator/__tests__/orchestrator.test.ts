// Feature: random-draft-simulator
// Property 7: La Pick_Phase sigue exactamente la distribución 2-2-1
// Property 16: Reproducibilidad completa dado el mismo (draftSeed, personalBanList)
// Validates: Requirements 3.1, 8.5

import { test, expect } from "bun:test";
import { initDraft, type OrchestratorConfig } from "../orchestrator";
import type { MetaHeroEntry, MetaSnapshot } from "../bot-drafter";
import type { HeroId } from "../types";

// TSK-083: initDraft ya no es puro -- le pide cada pick del bot al motor real
// (botPickHeroFromEngine). Estas pruebas nunca dependen de que un motor real esté corriendo
// (costura S6/S7, testing-seams.md) -- `fetchImpl` siempre rechaza, forzando el camino de
// fallback determinístico (botPickHero, el scoring simplificado) en las 100 corridas de cada
// prueba. Es exactamente el camino que corre en producción si el motor está caído -- las
// propiedades que estas pruebas verifican (distribución 2-2-1, sin héroes repetidos,
// reproducibilidad del fallback) siguen siendo reales y valiosas con este camino.
const NO_ENGINE: OrchestratorConfig["remoteBotPick"] = {
  fetchImpl: (async () => {
    throw new Error("sin motor real en las pruebas -- fuerza el fallback a propósito");
  }) as unknown as typeof fetch,
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SEED_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const HERO_POOL_SIZE = 130;

function randomValidSeed(): string {
  return Array.from(
    { length: 8 },
    () => SEED_CHARS[Math.floor(Math.random() * SEED_CHARS.length)],
  ).join("");
}

const ROLES = ["carry", "support", "mid", "offlane", "soft_support"];

function buildMetaSnapshot(): MetaSnapshot {
  const heroes: Record<HeroId, MetaHeroEntry> = {};
  const patchStats: MetaSnapshot["patchStats"] = {};

  for (let id = 1; id <= HERO_POOL_SIZE; id++) {
    heroes[id] = { id, localizedName: `Hero ${id}`, roles: [ROLES[id % ROLES.length]!] };
    patchStats![id] = [
      { patch: "7.37d", bracket: "all", picks: 100 + id, wins: 40 + (id % 60) },
    ];
  }

  return { heroes, patchStats };
}

function baseConfig(overrides: Partial<OrchestratorConfig> = {}): OrchestratorConfig {
  const pool = Array.from({ length: HERO_POOL_SIZE }, (_, i) => i + 1);
  return {
    draftSeed: randomValidSeed(),
    userSide: "radiant",
    personalBanList: [],
    meta: buildMetaSnapshot(),
    metaBanPool: pool.slice().reverse(),
    patch: "7.37d",
    remoteBotPick: NO_ENGINE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Property 7: distribución exacta 2-2-1
// Validates: Requirements 3.1
// ---------------------------------------------------------------------------

test("Property 7: initDraft produce 3 rondas con distribución de botPicks 2-2-1 (100 casos)", async () => {
  // Feature: random-draft-simulator, Property 7: La Pick_Phase sigue exactamente la distribución 2-2-1
  const expectedLengths = [2, 2, 1];

  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const userSide = caseIndex % 2 === 0 ? "radiant" : "dire";
    const result = await initDraft(baseConfig({ userSide }));

    expect(result.rounds).toHaveLength(3);
    result.rounds.forEach((round, i) => {
      expect(round.round).toBe((i + 1) as 1 | 2 | 3);
      expect(round.botPicks.length).toBe(expectedLengths[i]);
    });
  }
});

// ---------------------------------------------------------------------------
// Property 16: reproducibilidad completa dado el mismo (draftSeed, personalBanList)
// Validates: Requirements 8.5
// ---------------------------------------------------------------------------

// TSK-083: la reproducibilidad bit a bit del pick del bot ya no es una garantía general -- con
// el motor real disponible, depende de su estado en el momento de cada llamada, no solo del
// seed (trade-off aceptado a propósito, ver orchestrator.ts). Esta prueba sigue verificando algo
// real y valioso: con el motor inalcanzable (NO_ENGINE), el camino de fallback SÍ sigue siendo
// 100% determinístico desde (draftSeed, personalBanList) -- exactamente lo que corre en
// producción si el motor está caído.
test("Property 16 (fallback): con el motor inalcanzable, mismo draftSeed y personalBanList producen el mismo OrchestratorResult (100 casos)", async () => {
  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const draftSeed = randomValidSeed();
    const personalBanList: HeroId[] = Array.from({ length: caseIndex % 5 }, (_, i) => i + 1);

    const config = baseConfig({ draftSeed, personalBanList });
    const first = await initDraft(config);
    const second = await initDraft(config);

    expect(second).toEqual(first);
  }
});

// ---------------------------------------------------------------------------
// Extra: nunca hay picks duplicados entre bans resueltos y botPicks de todas las rondas
// ---------------------------------------------------------------------------

test("initDraft nunca repite un héroe entre resolvedBans y los botPicks pre-calculados", async () => {
  const result = await initDraft(baseConfig());
  const allBotPicks = result.rounds.flatMap((round) => round.botPicks);
  const bannedSet = new Set(result.resolvedBans);

  for (const heroId of allBotPicks) {
    expect(bannedSet.has(heroId)).toBe(false);
  }
  expect(new Set(allBotPicks).size).toBe(allBotPicks.length);
});
