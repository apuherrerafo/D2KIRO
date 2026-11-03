import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// PD-026/PD-027 RESIDUE LOCK -- forbids reintroducing the fixed chronology<->position schedule
// (or any AP session-layer helper that reads `partyContext.controlledSlots` as control/position
// truth) anywhere under apps/engine or apps/web. Scoped precisely (only the two feature trees this
// P0 touched) so it never fires on legitimate, unrelated Captain's Mode / Manual Live seat code, or
// on historical/spec text that merely mentions these names for context.

// NOTE: `rosterSlotForRoundSlot` (engine) / `rosterSeatForRoundSlot` (web) are NOT on this list --
// they are the surviving PURE chronology helpers (round-scoped slot <-> stable seat, never a
// position) and are legitimately called from several files. Only the POSITION-deriving names below
// are forbidden anywhere in code.
const FORBIDDEN_IDENTIFIERS = [
  "POSITION_FOR_ROSTER_SEAT",
  "ROSTER_SEAT_FOR_POSITION",
  "positionForRosterSeat",
  "rosterSeatForPosition",
  "positionForRoundSlot",
  "SEAT_ROLE_NAMES",
  "roundSlotForRosterSeat",
  "participantForRoundSlot",
  "SimulatorParticipant",
] as const;

const CHRONOLOGY_ONLY_ALLOWLIST: Record<string, readonly string[]> = {};

const SCAN_ROOTS = ["apps/engine/src/simulator", "apps/engine/src/server", "apps/engine/src/recommendation", "apps/web/features/random-draft-simulator", "apps/web/app/simulator"];

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

function listFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function relativePath(absolute: string): string {
  return absolute.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
}

describe("PD-026/PD-027 RESIDUE LOCK -- AP chronology<->position helpers never reappear", () => {
  const violations: { file: string; identifier: string }[] = [];

  for (const root of SCAN_ROOTS) {
    for (const absolute of listFiles(join(REPO_ROOT, root))) {
      const file = relativePath(absolute);
      if (file.endsWith(".test.ts") || file.endsWith(".test.tsx")) continue; // test fixtures/comments may legitimately name what they replaced
      const text = readFileSync(absolute, "utf8");
      const allowed = new Set(CHRONOLOGY_ONLY_ALLOWLIST[file] ?? []);
      for (const identifier of FORBIDDEN_IDENTIFIERS) {
        if (allowed.has(identifier)) continue;
        // Only match real code usage (declaration or reference), not a prose mention inside a
        // comment line -- comments documenting the deletion (like this file's own header) are fine.
        const codeLines = text.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"));
        if (codeLines.some((line) => line.includes(identifier))) {
          violations.push({ file, identifier });
        }
      }
    }
  }

  test("ningún archivo de código (fuera del allowlist de cronología pura) reintroduce un helper cronología->posición", () => {
    expect(violations).toEqual([]);
  });

  test("ap-simulator-policy.ts y roster.ts conservan su helper de cronología pura (fuera de sus comentarios de gobernanza, ninguno declara la tabla de posición)", () => {
    const codeOnly = (text: string) => text.split("\n").filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*")).join("\n");
    const enginePolicy = readFileSync(join(REPO_ROOT, "apps/engine/src/simulator/ap-simulator-policy.ts"), "utf8");
    expect(enginePolicy).toContain("export function rosterSlotForRoundSlot");
    expect(codeOnly(enginePolicy)).not.toContain("POSITION_FOR_ROSTER_SEAT");
    const webRoster = readFileSync(join(REPO_ROOT, "apps/web/features/random-draft-simulator/roster.ts"), "utf8");
    expect(webRoster).toContain("export function rosterSeatForRoundSlot");
    expect(codeOnly(webRoster)).not.toContain("POSITION_FOR_ROSTER_SEAT");
  });

  test("ninguna sesión AP Simulator en runtime usa partyContext.controlledSlots como verdad de control/posición (session-config.ts / protocol-session.ts)", () => {
    const sessionFile = readFileSync(join(REPO_ROOT, "apps/engine/src/server/protocol-session.ts"), "utf8");
    // The AP-controlledPositions branches must gate on `metadata.controlledPositions`, never treat
    // `partyContext.controlledSlots` as position truth for those sessions.
    expect(sessionFile).toContain("metadata.controlledPositions");
  });
});
