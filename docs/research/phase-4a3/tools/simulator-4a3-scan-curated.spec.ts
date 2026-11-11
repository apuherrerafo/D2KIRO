import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/failure-evidence";

// Fase 4A.3 · BARRIDO DE BANS CURADOS (diagnóstico). Para cada héroe H se nomina como ban personal a sus counters curados más pesados (lo que un jugador
// real puede hacer: «Mi lista de bans», hasta 4) y se deja que el motor REAL (V6 intacto) resuelva el resto con una semilla fija. Se registra si
// aparece una tarjeta STRONG. Este archivo LEE hero-counters.json solo para elegir qué nominar; el escenario final lleva los ids como literales.
const OUT = resolve(process.cwd(), "docs/research/phase-4a3");
mkdirSync(OUT, { recursive: true });
const COUNTERS = JSON.parse(readFileSync(resolve(process.cwd(), "apps/engine/src/signals/hero-counters.json"), "utf8")) as Record<string, Array<{ vs: number; level: string }>>;
const CASES = [
  { name: "solo", size: 1, positions: [2], human: 2 },
  { name: "party2", size: 2, positions: [2, 5], human: 5 },
];
const SEEDS = ["CURATED1", "CURATED2", "CURATED3"];

test("4A.3 · barrido de bans curados Solo / Party 2", async ({ page, request }) => {
  test.setTimeout(1_500_000);
  await page.goto("/simulator");
  const found: unknown[] = [];
  let tried = 0;
  for (const item of CASES) {
    for (const [heroKey, entries] of Object.entries(COUNTERS)) {
      const nominations = [...entries].sort((a, b) => (a.level === b.level ? 0 : a.level === "hard" ? -1 : 1)).slice(0, 4).map((entry) => entry.vs);
      for (const seed of SEEDS) {
        tried += 1;
        const created = await request.post("/engine/api/session/protocol", {
          data: { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", partyContext: { partySize: item.size, side: "radiant", controlledSlots: [] }, controlledPositions: item.positions, humanPosition: item.human, simulatorSeed: seed },
        });
        if (!created.ok()) continue;
        const { sessionId } = (await created.json()) as { sessionId: string };
        const banned = await request.post(`/engine/api/session/protocol/${sessionId}/resolve-bans`, { data: { playerBanPreferences: nominations } });
        if (!banned.ok()) continue;
        const bans = ((await banned.json()) as { resolvedBans: number[] }).resolvedBans;
        const board = await request.get(`/engine/api/session/protocol/${sessionId}/team-recommendations`);
        if (!board.ok()) continue;
        const body = (await board.json()) as { positions: Array<{ position: number; top: Array<{ heroId: number; evidenceStrength: string; isPrimary: boolean }> }>; currentDecision: { recommendedPosition: number | null; recommendedHeroId: number | null; targetBasis: string | null; reason: string } };
        const strong = body.positions.flatMap((column) => column.top.filter((card) => card.evidenceStrength === "STRONG").map((card) => ({ position: column.position, heroId: card.heroId })));
        if (strong.length > 0 || body.currentDecision.recommendedHeroId !== null) {
          found.push({ case: item.name, target: Number(heroKey), seed, nominations, bans, strong, decision: body.currentDecision });
        }
      }
    }
  }
  writeFileSync(resolve(OUT, "scan-curated.json"), JSON.stringify({ tried, found }, null, 2));
  expect(tried).toBeGreaterThan(0);
});
