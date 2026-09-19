import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// AP Ranked Roles V1 / Wave 1: the recovery build's Radiant / Pos2 / roster-slot-4 policy must have
// no functional influence left anywhere in production code. This guard fails if any of its
// identifiers (or its hardcoded `humanRosterSlot` plumbing) reappears in a non-test source file.

const REPO_ROOT = resolve(import.meta.dir, "../../../..");
const SCAN_ROOTS = ["apps/engine/src", "apps/web/features", "apps/web/app", "apps/web/components", "apps/web/lib"];
const FORBIDDEN = [
  "SOLO_MID_SIMULATOR_POLICY",
  "isSoloMidSimulatorMetadata",
  "SOLO_MID_RECOMMENDATION_OUTPUT_LIMIT",
  "humanRosterSlot",
  "rosterPositions",
  "requestSoloMidAutoDrive",
];

function walk(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe("sin residuo de la politica Solo Mid", () => {
  test("ningun identificador de la politica vieja existe en codigo de produccion", () => {
    const offenders: string[] = [];
    for (const root of SCAN_ROOTS) {
      for (const file of walk(join(REPO_ROOT, root))) {
        const text = readFileSync(file, "utf8");
        for (const token of FORBIDDEN) if (text.includes(token)) offenders.push(`${file} -> ${token}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("ningun archivo de produccion del Simulator fija Radiant o Pos2 como jugador humano", () => {
    const policyFiles = [
      "apps/engine/src/simulator/ap-simulator-policy.ts",
      "apps/engine/src/simulator/session-config.ts",
      "apps/engine/src/server/protocol-session.ts",
      "apps/engine/src/server/routes/protocol-sessions.ts",
    ];
    for (const file of policyFiles) {
      const text = readFileSync(join(REPO_ROOT, file), "utf8");
      expect(text).not.toMatch(/humanSide\s*[:=]\s*["']radiant["']/);
      expect(text).not.toMatch(/humanPosition\s*(===|:)\s*2\b/);
    }
  });
});

describe("collision #3 authority: sin PRNG, sin seed", () => {
  test("simulator-authority.ts no contiene ninguna fuente de azar ni de desempate por seed/hash", () => {
    const text = readFileSync(join(REPO_ROOT, "apps/engine/src/draft-protocol/adapters/simulator-authority.ts"), "utf8");
    // Comments are stripped: the header legitimately explains what the module does NOT use.
    const code = text.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    for (const forbidden of ["mulberry32", "seedToUint32", "Math.random", "stableHash", "crypto", "seed", "Seed"]) {
      expect(code.includes(forbidden)).toBe(false);
    }
  });

  test("las rutas no le pasan una seed a la autoridad de colision", () => {
    const text = readFileSync(join(REPO_ROOT, "apps/engine/src/server/routes/protocol-sessions.ts"), "utf8");
    expect(text).not.toMatch(/resolveSimulatorCollisionAuthority\([^)]*[sS]eed/);
    expect(text).not.toContain(":collision:");
  });
});
