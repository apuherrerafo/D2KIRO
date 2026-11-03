// Developer tool, after a real match: `bun scripts/live/companion/inventory-report.ts [inventory.json]`.
// Default input: %LOCALAPPDATA%\D2KIRO\Companion\diagnostics\inventory-latest.json (written by the Companion on
// its own, no action needed while playing). Prints a markdown report that is safe to share (no values, no ids).
// Never imported from apps/. Never reads the raw gsi-raw-*.jsonl captures (those stay on the PC).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseInventory, renderReport } from "./inventory-report-core";

const input = process.argv[2] ?? join(process.env.LOCALAPPDATA ?? "", "D2KIRO", "Companion", "diagnostics", "inventory-latest.json");
const inventory = parseInventory(readFileSync(input, "utf8"));
if (inventory === null) {
  console.error("Not a D2KIRO Companion inventory (schema d2kiro-gsi-inventory/v1).");
  process.exit(2);
}
process.stdout.write(renderReport(inventory));
