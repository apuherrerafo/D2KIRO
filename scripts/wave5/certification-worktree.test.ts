import { expect, test } from "bun:test";
import { classifyDirtyPaths } from "./certification-worktree";

test("Wave 1/2 diagnostics quedan excluidos con motivo; el código de Wave 5 y de la Phase A queda incluido", () => {
  const { classified, unclassified } = classifyDirtyPaths([
    "docs/diagnostics/WAVE1_AUTOMATED_ACCEPTANCE.md",
    "docs/diagnostics/WAVE2_INTERMITTENT_REPRO.md",
    "e2e/wave2-acceptance.spec.ts",
    "playwright.config.ts",
    "scripts/wave2-repro.ts",
    "docs/diagnostics/ap-solo-mid-dota-judge.md",
    "docs/agents/journal.md",
    "apps/engine/src/coach/hero-card.ts",
    "apps/web/next.config.ts",
    "scripts/wave5/driver.ts",
    "scripts/wave5-dota-judge-packet.ts",
    "scripts/positions/bounds.ts",
    "scripts/eval/freeze-empirical-snapshot.ts",
    "eval/snapshots/W5-EMP-001.sqlite",
    "docs/diagnostics/WAVE5_DOTA_JUDGE_POST_FIX.json",
  ]);
  const decision = (path: string) => classified.find((entry) => entry.path === path)!.decision;

  expect(unclassified).toEqual([]);
  for (const excluded of ["docs/diagnostics/WAVE1_AUTOMATED_ACCEPTANCE.md", "docs/diagnostics/WAVE2_INTERMITTENT_REPRO.md", "e2e/wave2-acceptance.spec.ts", "playwright.config.ts", "scripts/wave2-repro.ts", "docs/diagnostics/ap-solo-mid-dota-judge.md", "docs/agents/journal.md"]) expect(decision(excluded)).toBe("exclude");
  for (const included of ["apps/engine/src/coach/hero-card.ts", "apps/web/next.config.ts", "scripts/wave5/driver.ts", "scripts/wave5-dota-judge-packet.ts", "scripts/positions/bounds.ts", "scripts/eval/freeze-empirical-snapshot.ts", "eval/snapshots/W5-EMP-001.sqlite", "docs/diagnostics/WAVE5_DOTA_JUDGE_POST_FIX.json"]) expect(decision(included)).toBe("include");
  expect(classified.every((entry) => entry.reason.length > 0)).toBe(true);
});

test("un path que ninguna regla reconoce se reporta como sin clasificar (falla cerrado), nunca se cuela", () => {
  const { classified, unclassified } = classifyDirtyPaths(["scripts/something-new.ts", "apps/engine/src/x.ts"]);

  expect(unclassified).toEqual(["scripts/something-new.ts"]);
  expect(classified.map((entry) => entry.path)).toEqual(["apps/engine/src/x.ts"]);
});
