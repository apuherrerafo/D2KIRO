import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "./support/failure-evidence";

// Fase 4A.3 · DIAGNÓSTICO (no certifica nada por sí mismo). Corre el MOTOR REAL (V6 intacto, sin page.route ni fixtures) contra muchas semillas
// de bans para Solo y Party 2, en la ronda 1 (sin rivales revelados), y registra qué tarjetas hay, su fuerza y el porqué.
// La semilla es una entrada determinista del producto (campo «Semilla del draft»): misma semilla -> mismos bans -> misma respuesta.
const OUT = resolve(process.cwd(), "docs/research/phase-4a3");
mkdirSync(OUT, { recursive: true });

interface Case { name: string; size: 1 | 2; positions: number[]; human: number }
const CASES: Case[] = [
  { name: "solo", size: 1, positions: [2], human: 2 },
  { name: "party2", size: 2, positions: [2, 5], human: 5 },
];
const SEEDS = Array.from({ length: Number(process.env.SCAN_SEEDS ?? 40) }, (_, index) => `SCAN${String(index).padStart(4, "0")}`);

test("4A.3 · barrido de semillas Solo / Party 2 contra el motor real", async ({ page, request }) => {
  test.setTimeout(900_000);
  await page.goto("/simulator");
  const metaResponse = await request.get("/engine/api/meta/snapshot").catch(() => null);
  const patch = "7.41e";
  const rows: unknown[] = [];
  for (const item of CASES) {
    for (const seed of SEEDS) {
      const created = await request.post("/engine/api/session/protocol", {
        data: {
          rulesetId: "dota2/ranked-all-pick", patch, localSide: "radiant", adapterKind: "simulator",
          partyContext: { partySize: item.size, side: "radiant", controlledSlots: [] },
          controlledPositions: item.positions, humanPosition: item.human, simulatorSeed: seed,
        },
      });
      if (!created.ok()) { rows.push({ case: item.name, seed, error: `create_${created.status()}` }); continue; }
      const { sessionId } = (await created.json()) as { sessionId: string };
      const banned = await request.post(`/engine/api/session/protocol/${sessionId}/resolve-bans`, { data: { playerBanPreferences: [] } });
      if (!banned.ok()) { rows.push({ case: item.name, seed, error: `bans_${banned.status()}` }); continue; }
      const bansBody = (await banned.json()) as { resolvedBans: number[] };
      const board = await request.get(`/engine/api/session/protocol/${sessionId}/team-recommendations`);
      if (!board.ok()) { rows.push({ case: item.name, seed, bans: bansBody.resolvedBans, error: `board_${board.status()}` }); continue; }
      const body = (await board.json()) as {
        positions: Array<{ position: number; state: string; primaryHeroId: number | null; top: Array<{ heroId: number; evidenceStrength: string; isPrimary: boolean; rationale?: string }> }>;
        currentDecision: { recommendedPosition: number | null; recommendedHeroId: number | null; targetBasis: string | null; reason: string };
      };
      rows.push({
        case: item.name, seed, bans: bansBody.resolvedBans,
        columns: body.positions.map((column) => ({ position: column.position, state: column.state, cards: column.top.length, strong: column.top.filter((card) => card.evidenceStrength === "STRONG").length, weak: column.top.filter((card) => card.evidenceStrength === "WEAK").length })),
        decision: body.currentDecision,
      });
    }
  }
  writeFileSync(resolve(OUT, "scan-seeds.json"), JSON.stringify({ patch, metaStatus: metaResponse?.status() ?? null, rows }, null, 2));
  expect(rows.length).toBe(CASES.length * SEEDS.length);
});
