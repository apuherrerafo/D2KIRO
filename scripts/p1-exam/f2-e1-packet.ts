// F2-E1 blind packet: the decisions E1 CHANGED, shown as two anonymous options (A / B). Which side is F1 lives only in a private key;
// the packet carries a SALTED commitment to that key, so it cannot be recovered from the repository (a plain hash of ~16 binary choices
// is brute-forceable). No risk annotations are printed: a CRITICAL_GAP line would reveal which side is E1.
//
//   bun scripts/p1-exam/f2-e1-packet.ts --moments=<set> --f1=<run> --e1=<run> --count=16 --seed=F2E1-v1 --packet=<md> --key-dir=<dir OUTSIDE the repo>
//
// Measurement tool, not a test; never imported from apps/ (invariantes.md).
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import { loadWorldData } from "../wave5/driver";
import { boardTop3, classify } from "./f2-e1-analysis";
import { fingerprint, type DecisionMoment, type MomentOutput, type ReplayResult } from "./replay";

const ROOT = resolve(import.meta.dir, "../..");
const sha = (data: string | Buffer): string => createHash("sha256").update(data).digest("hex");
const arg = (name: string): string | undefined => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Deterministic order and side assignment from a seed: reproducible, and independent of anything the engine says. */
export const orderKey = (seed: string, id: string): string => sha(`${seed}|order|${id}`);
export const flips = (seed: string, id: string): boolean => parseInt(sha(`${seed}|ab|${id}`).slice(0, 2), 16) % 2 === 1;

/** Take the changed moments, pin the ones that carry a known concern, then fill by the seeded order spread over rounds. */
export function pickMoments(changed: DecisionMoment[], count: number, seed: string, pinned: Set<string>): DecisionMoment[] {
  const pins = changed.filter((m) => pinned.has(m.id));
  const rest = changed.filter((m) => !pinned.has(m.id)).sort((a, b) => orderKey(seed, a.id).localeCompare(orderKey(seed, b.id)));
  const out = [...pins];
  for (const m of rest) { if (out.length >= count) break; out.push(m); }
  return out.sort((a, b) => orderKey(seed, a.id).localeCompare(orderKey(seed, b.id)));
}

const line = (name: (id: number) => string, output: MomentOutput): string => {
  const column = output.board.columns.find((c) => c.position === output.board.recommendedPosition);
  const cards = (column?.top ?? []).slice().sort((a, b) => a.rank - b.rank).slice(0, 3);
  return cards.map((c) => `**${name(c.heroId)}** — ${c.reasons[0] ?? "—"}`).join("  \n  ");
};

if (import.meta.main) {
  const moments = (JSON.parse(readFileSync(resolve(ROOT, arg("moments")!), "utf8")) as { moments: DecisionMoment[] }).moments;
  const load = (p: string): Map<string, ReplayResult> => new Map((JSON.parse(readFileSync(resolve(ROOT, p), "utf8")) as { results: ReplayResult[] }).results.map((r) => [r.id, r]));
  const f1 = load(arg("f1")!), e1 = load(arg("e1")!);
  const caps = new Map(loadHeroCapabilities().map((c) => [c.hero, c]));
  const world = loadWorldData();
  const seed = arg("seed") ?? "F2E1-v1";
  const changed = moments.filter((m) => classify(m, caps).a && fingerprint(boardTop3(f1.get(m.id)!.output!)) !== fingerprint(boardTop3(e1.get(m.id)!.output!)));
  // Pinned: every moment where an uncurated hero entered a top-3 (the P4 concern), so the judge sees them.
  const pinned = new Set(changed.filter((m) => boardTop3(e1.get(m.id)!.output!).some((h) => [131, 145, 155].includes(h) && !boardTop3(f1.get(m.id)!.output!).includes(h))).map((m) => m.id));
  const chosen = pickMoments(changed, Number(arg("count") ?? 16), seed, pinned);

  const key: Record<string, { A: "F1" | "E1"; B: "F1" | "E1" }> = {};
  const blocks = chosen.map((m, i) => {
    const flipped = flips(seed, m.id);
    const sides = flipped ? { A: "E1" as const, B: "F1" as const } : { A: "F1" as const, B: "E1" as const };
    key[`Q${i + 1}`] = sides;
    const run = { F1: f1.get(m.id)!.output!, E1: e1.get(m.id)!.output! };
    const v = m.visible;
    return [
      `### Q${i + 1}`, "",
      `Ronda ${v.round} · lado ${v.side} · posición a decidir: **Pos ${run.F1.board.recommendedPosition}** (la misma en A y B)`,
      `- Bans: ${v.bans.map(world.name).join(", ")}`,
      `- Tus picks (con posición): ${v.ownPicks.map((p) => `${world.name(p.heroId)} (Pos ${p.assignedPosition})`).join(", ") || "—"}`,
      `- Rivales visibles: ${v.revealedEnemy.map(world.name).join(", ") || "—"} · picks rivales aún ocultos: ${v.hiddenEnemySlots}`,
      `- Te quedan ${5 - v.ownPicks.length} pick(s) propios.`, "",
      `**A**  \n  ${line(world.name, run[sides.A])}`, "",
      `**B**  \n  ${line(world.name, run[sides.B])}`, "",
      "Mejor (A / B / equivalente): _______ · ¿alguna lista tiene un héroe dañino aquí? cuál y por qué (una frase de Dota): _______", "",
    ].join("\n");
  });

  const keyDir = resolve(arg("key-dir")!);
  if (keyDir.toLowerCase().startsWith(ROOT.toLowerCase())) throw new Error("--key-dir must be OUTSIDE the repository");
  mkdirSync(keyDir, { recursive: true });
  const keyBytes = Buffer.from(`${JSON.stringify({ schema: "f2-e1-judge-key/v1", seed, keys: key }, null, 2)}\n`);
  const salt = randomBytes(32);
  writeFileSync(join(keyDir, "F2_E1_JUDGE_KEY.json"), keyBytes);
  writeFileSync(join(keyDir, "F2_E1_JUDGE_KEY.salt"), salt);
  const commitment = sha(Buffer.concat([salt, keyBytes]));

  const header = [
    "# F2-E1 — paquete ciego de las decisiones que cambió E1", "",
    "**Sin respuestas.** Cada pregunta es un momento real del simulador (estado congelado, sin información de picks futuros). A y B son las dos listas que propondrían dos versiones del Coach; no se dice cuál es cuál. No se imprimen avisos de riesgo para no delatar la versión.", "",
    "Responde, por pregunta: **A / B / equivalente**, y si alguna lista contiene un héroe claramente dañino en ese estado, cuál y por qué en una frase de Dota. \"No sé\" es válido. La pregunta es qué lista elegirías tú en ese estado.", "",
    `Compromiso con sal de la clave (se revela junto con su sal después de responder): \`${commitment}\``, "",
    `Semilla del orden y de la asignación A/B: \`${seed}\` · preguntas: ${chosen.length} de ${changed.length} momentos cambiados.`, "",
  ].join("\n");
  writeFileSync(resolve(ROOT, arg("packet")!), `${header}\n${blocks.join("\n")}`);
  console.log(JSON.stringify({ questions: chosen.length, changedMoments: changed.length, pinnedUncurated: pinned.size, commitment }));
}
