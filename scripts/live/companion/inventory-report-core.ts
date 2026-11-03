// D2KIRO Companion -- what did player-mode Dota GSI actually expose? Pure: the Companion's inventory JSON in,
// a markdown report out. The inventory already holds shapes and counts only (no value from any payload; key
// digits normalized to #), so the report is safe to paste anywhere. No I/O here (inventory-report.ts reads).

export interface InventoryPath {
  seen: number;
  nonEmpty: number;
  types: string[];
}

export interface InventoryPhase {
  posts: number;
  firstAt: string;
  lastAt: string;
  gameStates: string[];
  paths: Record<string, InventoryPath>;
}

export interface Inventory {
  schema: "d2kiro-gsi-inventory/v1";
  companionVersion: string;
  runId: string;
  updatedAt: string;
  phases: Record<string, InventoryPhase>;
}

export const PHASE_ORDER = ["MENU", "LOADING", "HERO_SELECTION", "STRATEGY_TIME", "MATCH", "POST_GAME", "OTHER"] as const;

/** The research question, one row per fact the coach would want; each matched by JSON path patterns. */
export const RESEARCH_FIELDS: readonly { field: string; paths: RegExp }[] = [
  { field: "draft block (any content)", paths: /^\$\.draft$/ },
  { field: "draft picks (any team)", paths: /^\$\.draft\.team#\.pick#_id$/ },
  { field: "draft bans", paths: /^\$\.draft\.team#\.ban#_id$/ },
  { field: "own hero id", paths: /^\$\.hero\.id$/ },
  { field: "own side (player.team_name)", paths: /^\$\.player\.team_name$/ },
  { field: "other players (team-keyed player/hero)", paths: /^\$\.(player|hero)\.team#/ },
  { field: "minimap unit names", paths: /^\$\.minimap\.o#\.unitname$/ },
  { field: "map.clock_time / game_time", paths: /^\$\.map\.(clock_time|game_time)$/ },
  { field: "map.matchid", paths: /^\$\.map\.matchid$/ },
  { field: "own items", paths: /^\$\.items\.(slot|stash|teleport|neutral)#?\.name$/ },
  { field: "own abilities", paths: /^\$\.abilities\.ability#\.name$/ },
  { field: "own stats (kills/gold/gpm/lh)", paths: /^\$\.player\.(kills|gold|gpm|last_hits)$/ },
  { field: "events", paths: /^\$\.events$/ },
  { field: "buildings / roshan / couriers / neutralitems / league / wearables", paths: /^\$\.(buildings|roshan|couriers|neutralitems|league|wearables)$/ },
];

export function parseInventory(text: string): Inventory | null {
  try {
    const value = JSON.parse(text) as Partial<Inventory>;
    if (value.schema !== "d2kiro-gsi-inventory/v1" || typeof value.phases !== "object" || value.phases === null) return null;
    return value as Inventory;
  } catch {
    return null;
  }
}

function orderedPhases(inventory: Inventory): string[] {
  const rank = (phase: string) => {
    const index = (PHASE_ORDER as readonly string[]).indexOf(phase);
    return index === -1 ? PHASE_ORDER.length : index;
  };
  return Object.keys(inventory.phases).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

/** YES (n/posts) when some matching path carried a non-empty value, EMPTY when only empty ones, NO when absent. */
export function cellFor(phase: InventoryPhase, pattern: RegExp): string {
  const matches = Object.entries(phase.paths).filter(([path]) => pattern.test(path));
  if (matches.length === 0) return "NO";
  const nonEmpty = Math.min(phase.posts, Math.max(...matches.map(([, entry]) => entry.nonEmpty)));
  if (nonEmpty === 0) return "EMPTY";
  return `YES (${nonEmpty}/${phase.posts})`;
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}

export function renderReport(inventory: Inventory): string {
  const phases = orderedPhases(inventory);
  const lines = [
    `# Player-mode GSI inventory (D2KIRO Companion ${inventory.companionVersion}, run ${inventory.runId})`,
    "",
    `Updated ${inventory.updatedAt}. Shapes and counts only -- no payload value is stored in the inventory.`,
    "",
    "## Posts per phase",
    "",
    "| PHASE | POSTS | FIRST | LAST | GAME STATES |",
    "|---|---|---|---|---|",
    ...phases.map((name) => {
      const phase = inventory.phases[name]!;
      return `| ${name} | ${phase.posts} | ${phase.firstAt} | ${phase.lastAt} | ${escapeCell(phase.gameStates.join(", "))} |`;
    }),
    "",
    "## Research fields",
    "",
    `| FIELD | ${phases.join(" | ")} |`,
    `|---|${phases.map(() => "---").join("|")}|`,
    ...RESEARCH_FIELDS.map(({ field, paths }) => `| ${escapeCell(field)} | ${phases.map((name) => cellFor(inventory.phases[name]!, paths)).join(" | ")} |`),
    "",
    "## Every path seen (top two levels)",
    "",
    "| PATH | PHASES (non-empty/seen) | TYPES |",
    "|---|---|---|",
  ];
  const paths = new Map<string, { phases: string[]; types: Set<string> }>();
  for (const name of phases) {
    for (const [path, entry] of Object.entries(inventory.phases[name]!.paths)) {
      if (path.split(".").length > 3) continue;
      const row = paths.get(path) ?? { phases: [], types: new Set<string>() };
      row.phases.push(`${name} ${entry.nonEmpty}/${entry.seen}`);
      for (const type of entry.types) row.types.add(type);
      paths.set(path, row);
    }
  }
  for (const [path, row] of [...paths.entries()].sort(([a], [b]) => a.localeCompare(b))) lines.push(`| ${escapeCell(path)} | ${escapeCell(row.phases.join(", "))} | ${[...row.types].sort().join(", ")} |`);
  return `${lines.join("\n")}\n`;
}
