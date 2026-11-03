/**
 * D2KIRO Phase 1 -- mechanical independence guard for `qa/invariants/**`.
 *
 * The ownership oracle (`ownership.test.ts`) must never import decision logic from
 * `apps/engine/src/coach/**` or `apps/engine/src/recommendation/**` -- it may only observe the
 * public HTTP route surface and serialized JSON. This test scans the raw source text of every
 * `.ts` file under `qa/invariants/` (itself included) for an import specifier that resolves into
 * either forbidden tree, mechanically -- no heuristic, no allowlist of "this one's fine".
 *
 * A future file that adds such an import fails THIS test, not silently.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const INVARIANTS_DIR = resolve(import.meta.dir);
const FORBIDDEN_SEGMENT = /apps\/engine\/src\/(coach|recommendation)(\/|["'`])/;
// Import specifiers use forward slashes even on Windows (ES module resolution), but normalize
// backslashes too in case a future file is generated with OS-specific path text.
function normalize(text: string): string {
  return text.replace(/\\/g, "/");
}

function listTsFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      files.push(...listTsFiles(fullPath));
      continue;
    }
    if (entry.endsWith(".ts") || entry.endsWith(".tsx")) files.push(fullPath);
  }
  return files;
}

describe("oracle independence guard", () => {
  test("no file under qa/invariants/** imports apps/engine/src/coach/** or apps/engine/src/recommendation/**", () => {
    const files = listTsFiles(INVARIANTS_DIR);
    expect(files.length).toBeGreaterThan(0); // the guard itself must find files to scan, or it is vacuous

    const offenders: { file: string; line: number; text: string }[] = [];
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      const lines = content.split("\n");
      lines.forEach((line, index) => {
        const importLine = /\bimport\b|\brequire\s*\(/.test(line);
        if (!importLine) return;
        if (FORBIDDEN_SEGMENT.test(normalize(line))) {
          offenders.push({ file, line: index + 1, text: line.trim() });
        }
      });
    }

    if (offenders.length > 0) {
      console.error(JSON.stringify({ guard: "oracle-independence", offenders }, null, 2));
    }
    expect(offenders).toEqual([]);
  });

  test("the guard is not itself vacuous: it detects a planted forbidden import in a scratch fixture", () => {
    // Assembled from parts at runtime (never a contiguous forbidden substring in THIS file's own
    // source text) so this self-test does not trip the real scan above over its own fixture data.
    // Proves the regex/scan logic actually catches the pattern it claims to catch, using an
    // in-memory string, not a file on disk.
    const forbiddenCoachPath = ["..", "..", "apps", "engine", "src", "coach", "reveal-strategy"].join("/");
    const plantedLine = `import { deriveRevealStrategy } from "${forbiddenCoachPath}";`;
    expect(FORBIDDEN_SEGMENT.test(normalize(plantedLine))).toBe(true);
    const forbiddenRecommendationPath = ["..", "..", "apps", "engine", "src", "recommendation", "build"].join("/");
    const plantedRecommendationLine = `const x = require('${forbiddenRecommendationPath}');`;
    expect(FORBIDDEN_SEGMENT.test(normalize(plantedRecommendationLine))).toBe(true);
    // A legitimate import (routes/session store) must NOT be flagged.
    const legitimatePath = ["..", "..", "apps", "engine", "src", "server", "protocol-session"].join("/");
    const legitimateLine = `import { ProtocolSessionStore } from "${legitimatePath}";`;
    expect(FORBIDDEN_SEGMENT.test(normalize(legitimateLine))).toBe(false);
  });
});
