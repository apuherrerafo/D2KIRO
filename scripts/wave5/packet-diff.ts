#!/usr/bin/env bun
// Certification remediation (Phase A, A3) -- what changed between two Dota Judge packets, decision point by decision point.
//
//   bun scripts/wave5/packet-diff.ts --a=<packet.json> --b=<packet.json> --out=<basename>     (files in docs/diagnostics)
//
// It reports differences; it does not judge them and never says one side is better. It also states, from each packet's evidence identity,
// WHICH inputs differ (code / snapshot / positions / ...), so a change is only ever attributed to what actually changed. Refuses to
// overwrite an output. Pure over its inputs: same inputs, same bytes (no clock).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { compareIdentities, type EvidenceIdentity } from "./evidence-identity";

const DIAG = resolve(import.meta.dir, "../../docs/diagnostics");

interface Hero { heroId: number; name: string }
interface PacketPoint {
  label: string;
  coach: {
    primaryAction: { kind: string; positionsNamed: string[]; label: string };
    teamShortlist: Hero[];
    personalHeroView?: { label: string; seatCovered?: boolean; ranking?: Hero[] };
    safeCoreOpportunity?: Hero;
    outsidePoolRecommendation?: Hero;
  };
}
interface PacketScenario { id: string; opaqueScenarioKey: string; selection: string; decisionPoints: PacketPoint[] }
export interface Packet { evidenceIdentity?: EvidenceIdentity; scenarios: PacketScenario[] }

export interface SurfaceChange { scenario: string; point: string; surface: string; before: string; after: string }

const names = (heroes: readonly Hero[] | undefined): string => (heroes && heroes.length > 0 ? heroes.map((hero) => hero.name).join(", ") : "—");

export function diffPackets(a: Packet, b: Packet): { changes: SurfaceChange[]; scenariosCompared: number; scenariosOnDifferentDrafts: string[]; pointsCompared: number; pointsChanged: number } {
  const changes: SurfaceChange[] = [];
  const differentDrafts: string[] = [];
  let pointsCompared = 0;
  let pointsChanged = 0;
  for (const left of a.scenarios) {
    const right = b.scenarios.find((scenario) => scenario.id === left.id);
    if (!right) continue;
    if (left.opaqueScenarioKey !== right.opaqueScenarioKey) differentDrafts.push(left.id);
    left.decisionPoints.forEach((leftPoint, index) => {
      const rightPoint = right.decisionPoints[index];
      if (!rightPoint) return;
      pointsCompared += 1;
      const before = changes.length;
      const at = (surface: string, x: string, y: string): void => { if (x !== y) changes.push({ scenario: left.id, point: index === 0 ? "decision" : "next", surface, before: x, after: y }); };
      at("primary action", `${leftPoint.coach.primaryAction.kind}: ${leftPoint.coach.primaryAction.label}`, `${rightPoint.coach.primaryAction.kind}: ${rightPoint.coach.primaryAction.label}`);
      at("team shortlist", names(leftPoint.coach.teamShortlist), names(rightPoint.coach.teamShortlist));
      at("personal ranking", leftPoint.coach.personalHeroView?.seatCovered ? "COVERED" : names(leftPoint.coach.personalHeroView?.ranking), rightPoint.coach.personalHeroView?.seatCovered ? "COVERED" : names(rightPoint.coach.personalHeroView?.ranking));
      at("safe core window", leftPoint.coach.safeCoreOpportunity?.name ?? "—", rightPoint.coach.safeCoreOpportunity?.name ?? "—");
      at("outside-pool recommendation", leftPoint.coach.outsidePoolRecommendation?.name ?? "—", rightPoint.coach.outsidePoolRecommendation?.name ?? "—");
      if (changes.length > before) pointsChanged += 1;
    });
  }
  return { changes, scenariosCompared: a.scenarios.length, scenariosOnDifferentDrafts: differentDrafts, pointsCompared, pointsChanged };
}

function main(): void {
  const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const [aName, bName, out] = [arg("a"), arg("b"), arg("out")];
  if (!aName || !bName || !out || !/^[A-Za-z0-9_]+$/.test(out)) throw new Error("usage: --a=<packet.json> --b=<packet.json> --out=<basename>");
  if (existsSync(join(DIAG, `${out}.md`)) || existsSync(join(DIAG, `${out}.json`))) throw new Error(`${out} already exists -- historical evidence is never overwritten`);
  const read = (name: string): Packet => JSON.parse(readFileSync(join(DIAG, name), "utf8")) as Packet;
  const a = read(aName);
  const b = read(bName);
  const result = diffPackets(a, b);
  const identityDifferences = a.evidenceIdentity && b.evidenceIdentity ? compareIdentities(a.evidenceIdentity, b.evidenceIdentity) : ["(one packet carries no evidence identity: the systems cannot be compared)"];

  const lines: string[] = [`# ${out} — ${aName} → ${bName}`, ""];
  lines.push("A difference report, not a verdict: it never says which side is better.", "");
  lines.push(`- **Inputs that differ between the two packets:** ${identityDifferences.length === 0 ? "none (same code, same data)" : identityDifferences.join("; ")}`);
  lines.push(`- **Decision points compared:** ${result.pointsCompared} · **with any change:** ${result.pointsChanged} · **individual surface changes:** ${result.changes.length}`);
  lines.push(`- **Scenarios whose draft diverged (different trajectory, so the comparison stops being like-for-like):** ${result.scenariosOnDifferentDrafts.length === 0 ? "none" : result.scenariosOnDifferentDrafts.join(", ")}`, "");
  if (result.changes.length > 0) {
    lines.push("| Scenario | Point | Surface | Before | After |", "| --- | --- | --- | --- | --- |");
    for (const change of result.changes) lines.push(`| ${change.scenario} | ${change.point} | ${change.surface} | ${change.before.replaceAll("|", "\\|")} | ${change.after.replaceAll("|", "\\|")} |`);
    lines.push("");
  }
  writeFileSync(join(DIAG, `${out}.json`), `${JSON.stringify({ a: aName, b: bName, identityDifferences, ...result }, null, 2)}\n`);
  writeFileSync(join(DIAG, `${out}.md`), `${lines.join("\n")}\n`);
  console.log(JSON.stringify({ out, identityDifferences, pointsCompared: result.pointsCompared, pointsChanged: result.pointsChanged, changes: result.changes.length, differentDrafts: result.scenariosOnDifferentDrafts }, null, 2));
}

if (import.meta.main) main();
