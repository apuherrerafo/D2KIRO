import { expect, test, type APIRequestContext } from "@playwright/test";
import { createEnemyBotConfig } from "../apps/engine/src/simulator/enemy-bot-roles";
import { isCandidateAdmittedForPosition, loadHeroPositions } from "../apps/engine/src/signals/hero-positions";
import { FIXTURE_HERO_IDS } from "./fixtures/hero-catalog";
import { assertNoSimulatorTruthLeak, type SnapshotBody } from "./support/wave1";

// WAVE 1 -- DETERMINISTIC MULTI-SEED SOAK (protocol/API layer, through the same /engine proxy the
// browser uses). 10 Radiant + 10 Dire complete drafts. The two principal acceptance scenarios stay
// real browser flows (wave1-acceptance.spec.ts); this only widens seed coverage cheaply.
//
// Bot-role validity is checked against the Wave 1 contract: every enemy seat has an INTERNAL
// position (a pure function of the session seed, exactly what the engine derives) and the hero it
// received must be admissible for it per the curated position evidence. The Player-visible views
// never carry those assignments -- the oracle here recomputes them, it does not read them.

type Side = "radiant" | "dire";
type Position = 1 | 2 | 3 | 4 | 5;

interface DraftOutcome {
  seed: string;
  side: Side;
  position: Position;
  banPrefs: number;
  bans: number;
  own: number[];
  enemy: number[];
  collisions: number;
  failures: string[];
}

const POSITIONS = loadHeroPositions();
const NAMED = [...FIXTURE_HERO_IDS];

function seedNumber(seed: string): number {
  return [...seed].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100003, 7);
}

/** Deterministic Player strategy: a seed-rotated walk over the fixture catalog, skipping anything already taken. */
function chooseHero(seed: string, step: number, taken: Set<number>): number {
  const offset = (seedNumber(seed) + step * 13) % NAMED.length;
  for (let index = 0; index < NAMED.length; index += 1) {
    const hero = NAMED[(offset + index) % NAMED.length]!;
    if (!taken.has(hero)) return hero;
  }
  throw new Error("catalog exhausted");
}

function assignable(heroes: number[], positions: Position[]): boolean {
  if (heroes.length === 1) return isCandidateAdmittedForPosition(heroes[0]!, positions[0]!, POSITIONS);
  const [a, b] = heroes as [number, number];
  const [p, q] = positions as [Position, Position];
  return (isCandidateAdmittedForPosition(a, p, POSITIONS) && isCandidateAdmittedForPosition(b, q, POSITIONS))
    || (isCandidateAdmittedForPosition(a, q, POSITIONS) && isCandidateAdmittedForPosition(b, p, POSITIONS));
}

async function runDraft(request: APIRequestContext, baseURL: string, side: Side, position: Position, seed: string, banPrefs: number[]): Promise<{ outcome: DraftOutcome; snapshots: SnapshotBody[]; bodies: unknown[] }> {
  const api = `${baseURL}/engine/api/session/protocol`;
  const failures: string[] = [];
  const snapshots: SnapshotBody[] = [];
  const bodies: unknown[] = [];
  const outcome: DraftOutcome = { seed, side, position, banPrefs: banPrefs.length, bans: 0, own: [], enemy: [], collisions: 0, failures };

  async function call(label: string, path: string, data: unknown): Promise<Record<string, any> | null> {
    const response = await request.post(`${api}${path}`, { data });
    const body = (await response.json().catch(() => null)) as Record<string, any> | null;
    bodies.push(body);
    if (response.status() >= 400) {
      failures.push(`${label} -> HTTP ${response.status()} ${JSON.stringify(body)}`);
      return null;
    }
    if (body?.view) snapshots.push(body as unknown as SnapshotBody);
    return body;
  }

  // Fixture migrated to the AP session policy (PD-026/PD-027): empty `controlledSlots` + explicit `controlledPositions`.
  const partyContext = { partySize: 5, side, controlledSlots: [] };
  const created = await call("create", "", { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: side, adapterKind: "simulator", partyContext, controlledPositions: [1, 2, 3, 4, 5], humanPosition: position, simulatorSeed: seed });
  if (!created) return { outcome, snapshots, bodies };
  const sessionId = created.sessionId as string;
  if (!(await call("resolve-bans", `/${sessionId}/resolve-bans`, { playerBanPreferences: banPrefs }))) return { outcome, snapshots, bodies };

  let step = 0;
  let view: SnapshotBody["view"] | null = null;
  for (let guard = 0; guard < 60; guard += 1) {
    const drive = await call("auto-drive", `/${sessionId}/auto-drive`, {});
    if (!drive) return { outcome, snapshots, bodies };
    view = drive.view;
    if (view!.status === "COMPLETE") break;
    const open = (drive.legalActions as { type: string; side: string; slotIndex: number }[]).filter((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === side);
    if (open.length === 0) {
      failures.push("no open own seat and not complete");
      return { outcome, snapshots, bodies };
    }
    const bansBefore = view!.bannedHeroes.length;
    // AP session policy: every own seal binds a controlled, still-unbound position -- read from the engine's own
    // bindings (a collision re-opens a seat AND frees its position), never guessed from the round/slot order.
    let latest: Record<string, any> = drive;
    for (const slot of open) {
      const taken = new Set<number>([...view!.bannedHeroes, ...view!.ownPicks.flatMap((s) => (s.heroId ? [s.heroId] : [])), ...view!.enemyPicks.flatMap((s) => (s.heroId ? [s.heroId] : []))]);
      const hero = chooseHero(seed, (step += 1), taken);
      const bound = new Set<number>(((latest.ownAssignedPositions ?? []) as { assignedPosition: number }[]).map((binding) => binding.assignedPosition));
      const assignedPosition = ([1, 2, 3, 4, 5] as const).find((candidate) => !bound.has(candidate))!;
      const submitted = await call("submit", `/${sessionId}/command`, { command: { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: slot.slotIndex, heroId: hero }, assignedPosition });
      if (!submitted) return { outcome, snapshots, bodies };
      if (submitted.accepted === false) failures.push(`pick ${hero} rejected: ${submitted.rejected}`);
      view = submitted.view;
      latest = submitted;
    }
    outcome.collisions += view!.bannedHeroes.length - bansBefore;
    if (view!.status === "COMPLETE") break;
  }
  if (!view || view.status !== "COMPLETE") {
    failures.push("draft did not reach COMPLETE");
    return { outcome, snapshots, bodies };
  }

  outcome.own = view.ownPicks.flatMap((slot) => (slot.heroId ? [slot.heroId] : []));
  outcome.enemy = view.enemyPicks.flatMap((slot) => (slot.heroId ? [slot.heroId] : []));
  outcome.bans = view.bannedHeroes.length;
  if (outcome.own.length !== 5) failures.push(`own team has ${outcome.own.length} heroes`);
  if (outcome.enemy.length !== 5) failures.push(`enemy team has ${outcome.enemy.length} heroes`);
  if (new Set(outcome.own).size !== outcome.own.length) failures.push("duplicate hero on own team");
  if (new Set(outcome.enemy).size !== outcome.enemy.length) failures.push("duplicate hero on enemy team");
  if ([...outcome.own, ...outcome.enemy].some((hero) => view!.bannedHeroes.includes(hero))) failures.push("a banned hero was selected");
  if (outcome.own.some((hero) => outcome.enemy.includes(hero))) failures.push("hero on both teams");

  // Enemy Bot role validity: each round's heroes must fit that round's seats' INTERNAL positions.
  const botSide: Side = side === "radiant" ? "dire" : "radiant";
  const assignments = createEnemyBotConfig(seed, botSide).internalPositionAssignments;
  const rounds: [number[], number[]][] = [[outcome.enemy.slice(0, 2), [0, 1]], [outcome.enemy.slice(2, 4), [2, 3]], [outcome.enemy.slice(4, 5), [4]]];
  for (const [index, [heroes, seats]] of rounds.entries()) {
    if (!assignable(heroes, seats.map((seat) => assignments[seat]!) as Position[])) failures.push(`enemy round ${index + 1} heroes [${heroes}] do not fit seat positions [${seats.map((seat) => assignments[seat])}]`);
  }
  return { outcome, snapshots, bodies };
}

const RUNS: { side: Side; count: number; prefix: string }[] = [
  { side: "radiant", count: 10, prefix: "SOAKR" },
  { side: "dire", count: 10, prefix: "SOAKD" },
];

for (const { side, count, prefix } of RUNS) {
  test(`soak: ${count} ${side} drafts with different seeds complete validly`, async ({ request, baseURL }) => {
    const outcomes: DraftOutcome[] = [];
    for (let index = 1; index <= count; index += 1) {
      const seed = `${prefix}${String(index).padStart(3, "0")}`;
      const position = (((index - 1) % 5) + 1) as Position;
      // 0..4 ban nominations, cycling deterministically.
      const prefs = FIXTURE_HERO_IDS.slice(index * 3, index * 3 + ((index - 1) % 5));
      const { outcome, snapshots, bodies } = await runDraft(request, baseURL!, side, position, seed, prefs);
      try {
        assertNoSimulatorTruthLeak(snapshots, bodies);
      } catch (error) {
        outcome.failures.push(`Simulator Truth leak: ${(error as Error).message.split("\n")[0]}`);
      }
      outcomes.push(outcome);
    }
    test.info().annotations.push({ type: "soak", description: JSON.stringify(outcomes.map(({ own, enemy, ...rest }) => rest)) });
    const failed = outcomes.filter((outcome) => outcome.failures.length > 0);
    expect(failed.map((outcome) => ({ seed: outcome.seed, failures: outcome.failures })), "drafts with failures").toEqual([]);
    expect(outcomes).toHaveLength(count);
    // Seeds actually vary the drafts (not ten copies of the same game).
    expect(new Set(outcomes.map((outcome) => outcome.enemy.join(","))).size).toBeGreaterThan(count / 2);
  });
}
