#!/usr/bin/env bun
// Certification remediation (Phase A, A2) -- what the floor-truncated `hero-positions.json` can and cannot prove, and how much of a
// given Dota Judge packet rests on admissions it cannot prove.
//
//   bun scripts/positions/audit-bounds.ts --snapshot=eval/snapshots/W5-EMP-001.sqlite --packet=WAVE5_DOTA_JUDGE_POST_FIX.json \
//       --out=WAVE5_POSITION_DATA_AUDIT           -> docs/diagnostics/WAVE5_POSITION_DATA_AUDIT.{md,json}
//
// Read-only over every input, no clock, no network: the same inputs give byte-identical output. It NEVER forces a hero in or out --
// it grades each admission PROVEN / UNPROVEN under the bound derived in ./bounds.ts and stops there. Refuses to overwrite an output.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyLegacyPositions, summarizeUniverse, type AdmissionGrade, type PositionBound } from "./bounds";

const ROOT = resolve(import.meta.dir, "../..");
const LEGACY = join(ROOT, "apps/engine/src/signals/hero-positions.json");
const DIAG = join(ROOT, "docs/diagnostics");

/** The 13 (hero, position) admissions the independent forensic review named; the audit reports them by name, it does not treat them specially. */
const REVIEW_NAMED: readonly string[] = ["Chaos Knight", "Riki", "Marci", "Silencer", "Earthshaker", "Razor", "Necrophos", "Venomancer", "Pugna", "Enchantress", "Gyrocopter", "Dark Willow", "Hoodwink"];

const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const sha256 = (buf: Uint8Array | string): string => createHash("sha256").update(buf).digest("hex");
const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;

interface PacketHero { heroId: number; name: string }
interface PacketCard extends PacketHero { positionShown?: string }
interface PacketScenario {
  id: string;
  viewpoint: { playerPersonalPosition: string };
  decisionPoints: { label: string; coach: { teamShortlist: PacketCard[]; personalHeroView?: { ranking?: PacketHero[] } } }[];
}

const positionOf = (text: string | undefined): number | null => {
  const found = /Pos\s*([1-5])/.exec(text ?? "");
  return found ? Number(found[1]) : null;
};

function main(): void {
  const snapshotPath = arg("snapshot");
  const packetName = arg("packet");
  const outName = arg("out");
  if (!snapshotPath || !packetName || !outName || !/^[A-Za-z0-9_]+$/.test(outName)) throw new Error("usage: --snapshot=<sqlite> --packet=<file in docs/diagnostics> --out=<basename>");
  if (existsSync(join(DIAG, `${outName}.json`)) || existsSync(join(DIAG, `${outName}.md`))) throw new Error(`${outName} already exists -- historical evidence is never overwritten`);

  const db = new Database(resolve(snapshotPath), { readonly: true });
  const names = new Map((db.query("SELECT id, localized_name AS n FROM heroes").all() as { id: number; n: string }[]).map((row) => [row.id, row.n]));
  db.close();
  const name = (id: number): string => names.get(id) ?? `#${id}`;

  const legacyBytes = readFileSync(LEGACY);
  const bounds = classifyLegacyPositions(JSON.parse(legacyBytes.toString("utf8")));
  const grade = new Map<string, PositionBound>(bounds.map((b) => [`${b.hero}:${b.position}`, b]));
  const universe = summarizeUniverse(bounds);
  const unproven = bounds.filter((b) => b.grade === "unproven-by-share").sort((a, b) => a.position - b.position || a.hero - b.hero);
  const heroesInFile = new Set(bounds.map((b) => b.hero));
  const withoutEvidence = [...names.keys()].filter((id) => !heroesInFile.has(id)).sort((a, b) => a - b).map((id) => ({ id, name: name(id), status: "UNAVAILABLE -- no position at/above the floor was retained; position_fit raw:null; no position invented" }));

  // ---- how much of the judged packet rests on admissions the data cannot prove ----
  const packet = JSON.parse(readFileSync(join(DIAG, packetName), "utf8")) as { gitHead: string; scenarios: PacketScenario[] };
  const tally: Record<AdmissionGrade, number> = { dominant: 0, "proven-by-share": 0, "unproven-by-share": 0, "not-admitted": 0 };
  const exposed: { scenario: string; point: string; surface: "personal ranking" | "team shortlist"; hero: string; position: number; grade: AdmissionGrade; shareRange: string }[] = [];
  const surfaces = { "personal ranking": { ...tally }, "team shortlist": { ...tally } };
  const record = (scenario: PacketScenario, point: string, surface: "personal ranking" | "team shortlist", hero: PacketHero, position: number | null): void => {
    if (position === null) return;
    const found = grade.get(`${hero.heroId}:${position}`);
    const g: AdmissionGrade = found?.grade ?? "not-admitted";
    tally[g] += 1;
    surfaces[surface][g] += 1;
    if (g === "unproven-by-share" || g === "not-admitted") exposed.push({ scenario: scenario.id, point, surface, hero: hero.name, position, grade: g, shareRange: found ? `${pct(found.shareLower)}–${pct(found.shareUpper)}` : "n/a" });
  };
  for (const scenario of packet.scenarios) {
    const personal = positionOf(scenario.viewpoint.playerPersonalPosition);
    scenario.decisionPoints.forEach((point, index) => {
      const label = `${scenario.id}/${index === 0 ? "decision" : "next"}`;
      for (const hero of point.coach.personalHeroView?.ranking ?? []) record(scenario, label, "personal ranking", hero, personal);
      for (const card of point.coach.teamShortlist) record(scenario, label, "team shortlist", card, positionOf(card.positionShown));
    });
  }
  const judged = Object.values(tally).reduce((sum, n) => sum + n, 0);

  const doc = {
    schema: "wave5-position-data-audit/v1",
    inputs: {
      positionsFile: { path: "apps/engine/src/signals/hero-positions.json", sha256: sha256(legacyBytes), format: "v1-floor-truncated" },
      snapshotUsedForNamesOnly: snapshotPath,
      packet: { file: packetName, gitHead: packet.gitHead },
    },
    method: "For each hero: S = sum of the listed (>= floor) positions, k = 5 - listed positions, each unlisted count is in [0, floor-1]. True share of a listed position is in [m/(S+k*(floor-1)), m/S]; m/S is what the legacy code used. Dominance can never be overturned; share admissions can only be overturned, never added.",
    universeByPosition: universe,
    unprovenAdmissions: unproven.map((b) => ({ hero: name(b.hero), heroId: b.hero, position: b.position, matches: b.matches, listedTotal: b.listedTotal, unlistedPositions: b.unlistedPositions, shareRange: [b.shareLower, b.shareUpper], namedByReview: REVIEW_NAMED.includes(name(b.hero)) })),
    reviewNamedHeroesCoveredByUnproven: REVIEW_NAMED.filter((n) => unproven.some((b) => name(b.hero) === n)),
    reviewNamedHeroesNotCovered: REVIEW_NAMED.filter((n) => !unproven.some((b) => name(b.hero) === n)),
    heroesWithoutPositionEvidence: withoutEvidence,
    packetExposure: { entriesGraded: judged, total: tally, bySurface: surfaces, unprovenOrWorse: exposed },
  };
  const json = `${JSON.stringify(doc, null, 2)}\n`;

  const lines: string[] = [];
  lines.push(`# ${outName} — what the floor-truncated position data can and cannot prove`, "");
  lines.push("**Generated by** `scripts/positions/audit-bounds.ts` (read-only, deterministic). **It forces no hero in or out.**", "");
  lines.push(`- Positions file: \`${doc.inputs.positionsFile.path}\` · sha256 \`${doc.inputs.positionsFile.sha256}\` · format **v1, floor-truncated**`);
  lines.push(`- Packet audited: \`${packetName}\` (git \`${packet.gitHead.slice(0, 7)}\`)`, "");
  lines.push("## Method", "", doc.method, "");
  lines.push("## Candidate universe by position (legacy admission → guaranteed core)", "", "| Position | Legacy admitted | Guaranteed (dominant or proven share) | Unproven (needs raw counts) |", "| --- | --- | --- | --- |");
  for (const row of universe) lines.push(`| Pos${row.position} | ${row.legacy} | ${row.guaranteed} | ${row.unproven} |`);
  lines.push("", `## Admissions the data cannot prove (${unproven.length})`, "", "| Hero | Pos | Matches at Pos | Listed total | Unlisted positions | True share lies in | Named by review |", "| --- | --- | --- | --- | --- | --- | --- |");
  for (const b of unproven) lines.push(`| ${name(b.hero)} | Pos${b.position} | ${b.matches} | ${b.listedTotal} | ${b.unlistedPositions} | ${pct(b.shareLower)} – ${pct(b.shareUpper)} | ${REVIEW_NAMED.includes(name(b.hero)) ? "yes" : "no"} |`);
  lines.push("", `Review-named heroes covered by an unproven admission: ${doc.reviewNamedHeroesCoveredByUnproven.length}/${REVIEW_NAMED.length}` + (doc.reviewNamedHeroesNotCovered.length > 0 ? ` (not covered: ${doc.reviewNamedHeroesNotCovered.join(", ")})` : ""), "");
  lines.push("## Heroes with no position evidence", "", ...withoutEvidence.map((h) => `- **${h.name}** (id ${h.id}): ${h.status}`), "");
  lines.push(`## Exposure of the audited packet (${judged} hero/position pairs graded)`, "", "| Surface | dominant | proven-by-share | unproven-by-share | not-admitted |", "| --- | --- | --- | --- | --- |");
  for (const surface of ["personal ranking", "team shortlist"] as const) lines.push(`| ${surface} | ${surfaces[surface].dominant} | ${surfaces[surface]["proven-by-share"]} | ${surfaces[surface]["unproven-by-share"]} | ${surfaces[surface]["not-admitted"]} |`);
  lines.push("", `Pairs resting on an unproven admission or worse: **${exposed.length}** of ${judged}.`, "");
  if (exposed.length > 0) {
    lines.push("| Where | Surface | Hero | Pos | Grade | True share lies in |", "| --- | --- | --- | --- | --- | --- |");
    for (const row of exposed) lines.push(`| ${row.scenario} · ${row.point} | ${row.surface} | ${row.hero} | Pos${row.position} | ${row.grade} | ${row.shareRange} |`);
    lines.push("");
  }
  writeFileSync(join(DIAG, `${outName}.json`), json);
  writeFileSync(join(DIAG, `${outName}.md`), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ out: `docs/diagnostics/${outName}.{md,json}`, universe, unproven: unproven.length, reviewNamedCovered: doc.reviewNamedHeroesCoveredByUnproven.length, packetPairs: judged, packetUnprovenOrWorse: exposed.length, tally }, null, 2));
}

main();
