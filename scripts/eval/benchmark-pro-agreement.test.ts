import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { loadReplayCasesFromDb, runProAgreement, type ProAgreementResult } from "./benchmark-pro-agreement";
import { buildReplayCases } from "./replay";
import { buildSplit } from "./split";
import type { ProDraftTurn, ReplayCase } from "./types";

function fixtureMeta(): MetaSnapshot {
  const heroes: Record<number, { id: number; localizedName: string }> = {};
  for (let i = 1; i <= 30; i++) heroes[i] = { id: i, localizedName: `H${i}` };
  return { heroes, matchups: {}, patchStats: {} } as unknown as MetaSnapshot;
}

// 24 turnos: 6 bans (0-5), 10 picks (6-15), 8 bans (16-23). Héroes 1..24 (heroBase suma un offset).
function draft(_matchId: string, heroBase: number): ProDraftTurn[] {
  const h = (n: number): number => heroBase + n + 1; // +1: nunca hero 0
  const turns: ProDraftTurn[] = [];
  for (let o = 0; o < 6; o++) turns.push({ order: o, isPick: false, hero: h(o), team: (o % 2) as 0 | 1 });
  for (let k = 0; k < 10; k++) turns.push({ order: 6 + k, isPick: true, hero: h(6 + k), team: (k % 2) as 0 | 1 });
  for (let o = 16; o < 24; o++) turns.push({ order: o, isPick: false, hero: h(o), team: (o % 2) as 0 | 1 });
  return turns;
}

function fixtureCases(): ReplayCase[] {
  const cases: ReplayCase[] = [];
  // 2 torneos, 3 drafts cada uno; héroes por draft acotados a 1..24 (existen en el meta)
  const specs: [string, number, number, "professional" | "premium"][] = [
    ["A1", 100, 0, "professional"],
    ["A2", 100, 0, "professional"],
    ["A3", 100, 0, "professional"],
    ["B1", 200, 0, "premium"],
    ["B2", 200, 0, "premium"],
    ["B3", 200, 0, "premium"],
  ];
  for (const [mid, league, base, tier] of specs) {
    const r = buildReplayCases(draft(mid, base), { matchId: mid, leagueId: league, tier, patch: "60" });
    cases.push(...r.cases);
  }
  return cases;
}

describe("runProAgreement — Benchmark B", () => {
  test("corrida válida: estructura completa, ConstraintViolationRate 0, segmentada", () => {
    const cases = fixtureCases();
    const split = buildSplit([100, 200], { folds: 2, seed: 1 });
    const res: ProAgreementResult = runProAgreement(cases, fixtureMeta(), split, { bootstrapIterations: 50 });

    expect(res.valid).toBe(true);
    expect(res.constraintViolationRate).toBe(0);
    expect(res.violations).toHaveLength(0);

    // los 4 baselines presentes, cada uno con overall + por contexto + por tier
    for (const b of ["random", "patchMetaOnly", "v6NoCuratedCounters", "v6Full"] as const) {
      const seg = res.perBaseline[b];
      expect(seg.overall.n).toBeGreaterThan(0);
      expect(seg.byTier.professional.n + seg.byTier.premium.n).toBe(seg.overall.n);
      expect(Object.keys(seg.byDecisionContext)).toEqual(["team_opening", "blind_second_pick", "response_pick", "closing_pick"]);
      for (const k of [1, 3, 5, 6] as const) {
        expect(seg.overall.recall[k]).toBeGreaterThanOrEqual(0);
        expect(seg.overall.recall[k]).toBeLessThanOrEqual(1);
      }
    }

    // bootstrap: uno por torneo, uno por draft (marcado optimista)
    expect(res.bootstrap.map((b) => b.level).sort()).toEqual(["draft", "tournament"]);
    expect(res.bootstrap.find((b) => b.level === "draft")!.note).toContain("OPTIMISTA");
    expect(res.recallCeilingK).toBe(6);
    expect(res.omittedBaselines.map((o) => o.id)).toContain("positionFitOnly");
  });

  test("gate duro: un ranker roto que devuelve un héroe pickeado invalida la corrida entera", () => {
    const cases = fixtureCases().filter((c) => c.state.picks.radiant.length + c.state.picks.dire.length >= 2);
    expect(cases.length).toBeGreaterThan(0);
    const split = buildSplit([100, 200], { folds: 2, seed: 1 });

    // ranker deliberadamente roto: devuelve un héroe que YA está pickeado en el estado.
    const brokenRandom = (state: ReplayCase["state"]): number[] => {
      const picked = [...state.picks.radiant, ...state.picks.dire];
      return picked.length > 0 ? [picked[0]!] : [];
    };

    const res = runProAgreement(cases, fixtureMeta(), split, {
      bootstrapIterations: 10,
      rankers: { random: brokenRandom as never },
    });

    expect(res.valid).toBe(false);
    expect(res.constraintViolationRate).toBeGreaterThan(0);
    expect(res.violations[0]!.why).toContain("baneado o pickeado");
    expect(res.perBaseline).toEqual({}); // no se reporta ninguna otra métrica
  });

  test("loadReplayCasesFromDb: lee una pro-drafts.sqlite en memoria, tier_not_accepted entra como unknown", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE tournaments (league_id INTEGER PRIMARY KEY, tier TEXT NOT NULL);
      CREATE TABLE pro_drafts (match_id TEXT PRIMARY KEY, league_id INTEGER NOT NULL, patch TEXT NOT NULL, ingest_reason TEXT);
      CREATE TABLE pro_draft_turns (match_id TEXT NOT NULL, draft_order INTEGER NOT NULL, is_pick INTEGER NOT NULL, hero_id INTEGER NOT NULL, team INTEGER NOT NULL, PRIMARY KEY (match_id, draft_order));
    `);
    db.query("INSERT INTO tournaments VALUES (100, 'professional'), (200, 'excluded')").run();
    db.query(
      "INSERT INTO pro_drafts VALUES ('OK1', 100, '60', NULL), ('UNK1', 200, '60', NULL), ('BAD1', 100, '60', 'invalid_draft_shape'), ('BAD2', 100, '60', NULL)",
    ).run();
    for (const mid of ["OK1", "UNK1"]) {
      draft(mid, 0).forEach((t) => {
        db.query("INSERT INTO pro_draft_turns VALUES (?, ?, ?, ?, ?)").run(mid, t.order, t.isPick ? 1 : 0, t.hero, t.team);
      });
    }
    // BAD1: ingest_reason='invalid_draft_shape' -> lo filtra el SQL, ni siquiera llega al replay.
    db.query("INSERT INTO pro_draft_turns VALUES ('BAD1', 0, 0, 1, 0)").run();
    // BAD2: ingest_reason NULL (pasa el SQL) pero sólo 5 turnos -> shape inválido -> skipped con motivo.
    for (let o = 0; o < 5; o++) db.query("INSERT INTO pro_draft_turns VALUES ('BAD2', ?, 0, ?, 0)").run(o, o + 1);

    // escribimos a un archivo temporal porque loadReplayCasesFromDb abre por path
    const path = `/tmp/d2k-pro-${Math.random().toString(36).slice(2)}.sqlite`;
    db.exec(`VACUUM INTO '${path}'`);
    db.close();

    const res = loadReplayCasesFromDb(path);
    const tiers = new Set(res.cases.map((c) => c.tier));
    expect(tiers.has("professional")).toBe(true);
    expect(tiers.has("unknown")).toBe(true); // 'excluded' -> unknown
    expect(res.cases.some((c) => c.matchId === "BAD1")).toBe(false); // filtrado por SQL
    expect(res.cases.some((c) => c.matchId === "BAD2")).toBe(false);
    expect(res.skipped.some((s) => s.matchId === "BAD2")).toBe(true); // shape inválido -> skipped con motivo
    rmSync(path, { force: true });
  });
});
