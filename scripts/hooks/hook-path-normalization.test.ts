import { expect, test } from "bun:test";
import { join } from "node:path";

// R0.1 — Task 4 / CP6 (design §10, requisito 1.3).
// Candado de regresión OS-independiente para la normalización de ruta de los hooks.
// Ejercita `_hook_lib.to_repo_relative` / `matches_any` vía un probe Python (mismo
// patrón de spawn que hook-guards.test.ts). Sin librería PBT nueva: tabla determinista.
//
// El probe NO usa literales de backslash: construye el separador de Windows con
// chr(92), para poder incrustarse en un template literal sin escapado ambiguo.

const REPO = join(import.meta.dir, "..", "..");

const PROBE = `
import json, sys
from pathlib import Path

repo = Path(sys.argv[1])
sys.path.insert(0, str(repo / "scripts" / "hooks"))
from _hook_lib import to_repo_relative, matches_any

BS = chr(92)  # '\\' sin escribir el literal

logical = [
    "data/curated/hero-positions.json",
    "apps/engine/src/signals/mix.ts",
    "docs/agents/journal.md",
    "eval/golden/x.json",
    "scripts/hooks/_hook_lib.py",
]

norm = {}
for p in logical:
    posix_abs = (repo / p).as_posix()
    win_abs = posix_abs.replace("/", BS)
    rel_win = p.replace("/", BS)
    norm[p] = [
        to_repo_relative(posix_abs, repo),
        to_repo_relative(win_abs, repo),
        to_repo_relative(p, repo),
        to_repo_relative(rel_win, repo),
    ]

canonical = matches_any("data/curated/x.json", ["data/curated/**"])
try:
    matches_any("data" + BS + "curated" + BS + "x.json", ["data/curated/**"])
    backslash_raises = False
except Exception:
    backslash_raises = True

print(json.dumps({
    "norm": norm,
    "matches_any_canonical": canonical,
    "matches_any_backslash_raises": backslash_raises,
}))
`;

interface ProbeResult {
  norm: Record<string, string[]>;
  matches_any_canonical: boolean;
  matches_any_backslash_raises: boolean;
}

async function runProbe(): Promise<ProbeResult> {
  const proc = Bun.spawn(["python3", "-", REPO], {
    stdin: Buffer.from(PROBE),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) {
    throw new Error(`probe exited ${code}\n${err}`);
  }
  return JSON.parse(out.trim()) as ProbeResult;
}

test("CP6: to_repo_relative colapsa Windows y POSIX al MISMO repo-relative canónico", async () => {
  const { norm } = await runProbe();
  for (const [logical, variants] of Object.entries(norm)) {
    for (const variant of variants) {
      // norm(winPath) == norm(posixPath) == la ruta lógica, siempre con '/'
      expect(variant).toBe(logical);
      expect(variant.includes("\\")).toBe(false);
    }
  }
});

test("CP6: matches_any opera sobre formato canónico y nunca compara contra '\\'", async () => {
  const { matches_any_canonical, matches_any_backslash_raises } = await runProbe();
  expect(matches_any_canonical).toBe(true);
  expect(matches_any_backslash_raises).toBe(true);
});

test("fail-closed: data-boundary-guard bloquea una ruta ambigua que referencia data/curated/", async () => {
  // Ruta que escapa del repo por '..' pero apunta a un subpath data/curated/:
  // la normalización no puede garantizar repo-relative => se deniega (no fail-open).
  const ambiguous = "../dota2coach-sibling/data/curated/hero-x.json";
  const proc = Bun.spawn(["python3", join(REPO, "scripts", "hooks", "data-boundary-guard.py")], {
    stdin: Buffer.from(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: ambiguous } })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  expect(await proc.exited).toBe(2);
});

test("fail-closed: una ruta ambigua ajena a data/curated/ no amplía el bloqueo", async () => {
  const ambiguousUnrelated = "../dota2coach-sibling/apps/engine/src/mix.ts";
  const proc = Bun.spawn(["python3", join(REPO, "scripts", "hooks", "data-boundary-guard.py")], {
    stdin: Buffer.from(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: ambiguousUnrelated } })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  expect(await proc.exited).toBe(0);
});
