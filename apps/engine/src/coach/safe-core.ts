import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { RoleImpactStatus } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { SignalContribution } from "../signals/types";

// AP Ranked Roles V1 / Wave 4A (task 24) -- Safe Core V1: "this core can be revealed now, its known
// hard counters are already off the table". A CONTEXTUAL CONCLUSION, not a V6 score and not a win rate.
//
// EVIDENCE IT USES (all legally visible, all curated):
//   - `hero-counters.json` (curated domain reasoning, keyed by the victim): which heroes counter this one HARD.
//   - `view.bannedHeroes`: confirmed bans (visible to both sides).
//   - `view.ownPicks`: our own picks (an ally cannot counter us on the enemy team).
//   - `view.enemyPicks` -- only REVEALED ones: a curated counter already on the enemy team is live exposure.
//   - the hero's `position_fit` signal only as "has its own positional data" (never its magnitude).
//
// EVIDENCE IT DELIBERATELY DOES NOT USE:
//   - the V6 `counter` signal: its raw mixes curated and statistical (`hero_matchups`, no patch column)
//     evidence; folding it in would silently merge two evidence types into one confidence.
//   - `patch_meta`: unverified patch provenance (WAVE4_DATA_READINESS §7) must never read as "safe".
//   - side, hero pool, a hidden enemy pick: not inputs of this function at all.
//
// ONE PRODUCT CONSTANT: `MIN_CURATED_HARD_COUNTER_COVERAGE`. The rest of the rule is structural: at least one
// curated HARD counter is banned AND no curated hard counter remains available AND no curated counter of this
// hero is already revealed on the enemy team. The coverage floor is not an invented threshold: it is the
// Product-Owner-approved requirement derived from the Wave 4A incidence audit (a one-counter hero produced ~98-100%
// of all triggers, i.e. "its single catalogued counter is gone" is sparse evidence, not safety). A hero with a
// single curated hard counter may still receive the existing V6 `counter` relief (BAN_RELIEF) when that counter is
// banned -- it just never yields the full Safe Core opportunity. The catalog does not claim to hold every real
// counter; the floor exists precisely so sparse curated evidence is not over-claimed.
//
// The relationship data and the "banned" semantic are the ones `signals/counter.ts` already applies in
// production (BAN_RELIEF, TSK-188). This file reads the same curated map; it does not re-score anything and
// adds no weight to V6.
//
// Pure: no I/O, no clock. Same inputs -> same output.

export type CounterReliefStatus = "BANNED" | "OWN_PICK";

export interface CounterReliefEvidence {
  kind: "COUNTER_RELIEF";
  /**
   * Where the counter relationship comes from. Safe Core V1 has exactly one approved source: "CURATED", a
   * human/domain-maintained relationship, not a verified current-patch statistic. There is deliberately no
   * statistical variant: no statistical/current-patch counter source is approved, so the type cannot express one.
   */
  sourceType: "CURATED";
  /** The curated hard counters that are off the table, and why. */
  relieved: { heroId: HeroId; level: CuratedCounter["level"]; status: CounterReliefStatus }[];
  /** How many curated hard counters this hero has in total. */
  totalHardCounters: number;
}

export interface SafeCoreSignal {
  isSafeWindow: boolean;
  /** Human-readable, derived from the data actually inspected (also when the window is NOT safe). */
  evidence: string;
  /** Present only when `isSafeWindow` is true. */
  counterEvidence?: CounterReliefEvidence;
}

export interface SafeCoreRole {
  position: Position;
  roleStatus: RoleImpactStatus;
}

/**
 * Safe Core V1 needs at least this many curated HARD counters known for the hero before "all of them are gone"
 * means anything. Product-Owner-approved from the Wave 4A incidence audit (see the header).
 */
export const MIN_CURATED_HARD_COUNTER_COVERAGE = 2;

/** Cores are Pos 1-3 (Carry, Midlane, Offlane); Pos 4/5 are the supports (same split reveal-strategy.ts uses). */
const CORE_POSITIONS: ReadonlySet<Position> = new Set<Position>([1, 2, 3]);

function counterNoun(total: number): string {
  return total === 1 ? "counter duro curado" : "counters duros curados";
}

// The headline counts counters that are off the table for the RIVAL, whatever the reason: a banned hero and
// a hero on our own team are different facts, so only the compact detail says which (never "baneado" for an
// own pick). Everything here is curated evidence; no statistic is implied.
function describeExposure(banned: number, own: number, available: number, total: number): string {
  const relieved = banned + own;
  const unavailable = total === 1 ? "ya no está disponible" : "ya no están disponibles";
  const detailParts: string[] = [];
  if (banned > 0) detailParts.push(`${banned} ${banned === 1 ? "baneado" : "baneados"}`);
  if (own > 0) detailParts.push(`${own} en tu equipo`);
  const detail = detailParts.length > 0 ? ` (${detailParts.join(" · ")})` : "";
  const availableText = available > 0 ? `; ${available} ${available === 1 ? "sigue disponible" : "siguen disponibles"}` : "";
  return `${relieved} de ${total} ${counterNoun(total)} ${unavailable} para el rival${detail}${availableText}`;
}

function hasOwnPositionData(signals: readonly SignalContribution[]): boolean {
  const positionFit = signals.find((signal) => signal.signal === "position_fit");
  return positionFit !== undefined && positionFit.raw !== null && positionFit.applicable !== false;
}

function visibleIds(slots: PerspectiveDraftView["ownPicks"], allowed: ReadonlyArray<"KNOWN" | "REVEALED">): Set<HeroId> {
  const ids = new Set<HeroId>();
  for (const slot of slots) if (slot.visibility !== "HIDDEN" && allowed.includes(slot.visibility)) ids.add(slot.heroId);
  return ids;
}

// The coverage floor is NOT a parameter: no caller (route, orchestrator, script) can lower it. The offline
// incidence audit replays the pre-calibration rule with its own private copy (scripts/wave4a-safe-core-incidence.ts).
export function detectSafeCoreWindow(
  heroId: HeroId,
  view: PerspectiveDraftView,
  v6Signals: readonly SignalContribution[],
  heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]>,
  role: SafeCoreRole,
): SafeCoreSignal {
  if (role.roleStatus === "UNRESOLVED" || !CORE_POSITIONS.has(role.position)) {
    return { isSafeWindow: false, evidence: "No es un core con posición resuelta: la ventana de core no aplica." };
  }

  const curated = heroCounters.get(heroId) ?? [];
  // Coverage counts DISTINCT counter heroes: a list that repeats one hard counter is still one counter.
  const seenHard = new Set<HeroId>();
  const hard = curated.filter((entry) => {
    if (entry.level !== "hard" || seenHard.has(entry.vs)) return false;
    seenHard.add(entry.vs);
    return true;
  });
  if (hard.length === 0) {
    return { isSafeWindow: false, evidence: "Sin counters duros curados para este héroe: no hay evidencia de alivio." };
  }
  if (hard.length < MIN_CURATED_HARD_COUNTER_COVERAGE) {
    return {
      isSafeWindow: false,
      evidence: `Solo ${hard.length} counter duro curado para este héroe: cobertura insuficiente para afirmar una ventana de core (mínimo ${MIN_CURATED_HARD_COUNTER_COVERAGE}).`,
    };
  }

  if (!hasOwnPositionData(v6Signals)) {
    return { isSafeWindow: false, evidence: "Sin evidencia de posición propia para este héroe: no se afirma una ventana de core." };
  }

  const banned = new Set<HeroId>(view.bannedHeroes);
  const own = visibleIds(view.ownPicks, ["KNOWN", "REVEALED"]);
  const enemy = visibleIds(view.enemyPicks, ["REVEALED"]);

  // A curated counter of this hero (hard OR medium) already revealed on the enemy team is live exposure.
  const revealedCounters = curated.filter((entry) => enemy.has(entry.vs));
  if (revealedCounters.length > 0) {
    const noun = revealedCounters.length === 1 ? "counter curado ya está revelado" : "counters curados ya están revelados";
    return { isSafeWindow: false, evidence: `${revealedCounters.length} ${noun} en el equipo rival.` };
  }

  const relieved: CounterReliefEvidence["relieved"] = [];
  let bannedCount = 0;
  let ownCount = 0;
  for (const entry of hard) {
    if (banned.has(entry.vs)) {
      relieved.push({ heroId: entry.vs, level: entry.level, status: "BANNED" });
      bannedCount += 1;
    } else if (own.has(entry.vs)) {
      relieved.push({ heroId: entry.vs, level: entry.level, status: "OWN_PICK" });
      ownCount += 1;
    }
  }
  const available = hard.length - relieved.length;
  const evidence = describeExposure(bannedCount, ownCount, available, hard.length);

  if (available > 0 || bannedCount === 0) return { isSafeWindow: false, evidence };

  return {
    isSafeWindow: true,
    evidence,
    counterEvidence: { kind: "COUNTER_RELIEF", sourceType: "CURATED", relieved, totalHardCounters: hard.length },
  };
}
