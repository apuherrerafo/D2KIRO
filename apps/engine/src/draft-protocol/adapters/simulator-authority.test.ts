import { describe, expect, test } from "bun:test";
import { ProtocolSessionStore } from "../../server/protocol-session";
import type { DraftProtocolState, PendingCollisionAuthority, TeamSide } from "../types";
import { applyProtocolCommand } from "../kernel";
import {
  SIMULATOR_COLLISION_POLICY_VERSION,
  resolveSimulatorCollisionAuthority,
  type CollisionRegistrationEvidence,
  type RegistrationRecord,
} from "./simulator-authority";

// Task 11 -- collision #3 is won by whoever REGISTERED FIRST, as recorded by the session-store
// ledger (outside the kernel, which canonicalizes arrival order on purpose). Real kernel, real
// store; no seed, no PRNG anywhere in the path.

type Order = "radiant-first" | "dire-first";

function newStore(sessionId: string): ProtocolSessionStore {
  const store = new ProtocolSessionStore();
  store.create({ sessionId, rulesetId: "dota2/ranked-all-pick", patch: "7.41e", adapterKind: "simulator", localSide: "radiant" });
  store.apply(sessionId, { type: "BAN_RESOLUTION_COMPLETE" });
  return store;
}

function orderedOpenSlots(store: ProtocolSessionStore, id: string, order: Order) {
  const open = [...store.get(id)!.rankedAp!.round!.openSlots];
  const sideRank = (side: TeamSide) => (order === "radiant-first" ? (side === "radiant" ? 0 : 1) : side === "dire" ? 0 : 1);
  return open.sort((a, b) => sideRank(a.side) - sideRank(b.side) || a.slotIndex - b.slotIndex);
}

/** Submits every open slot: `collidingHero` on slotIndex 0 of BOTH sides, fixed distinct filler elsewhere. */
function pass(store: ProtocolSessionStore, id: string, collidingHero: number, order: Order, fillerBase: number): void {
  for (const slot of orderedOpenSlots(store, id, order)) {
    const heroId = slot.slotIndex === 0 ? collidingHero : fillerBase + (slot.side === "radiant" ? 0 : 1);
    const result = store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: slot.side, slotIndex: slot.slotIndex, heroId });
    if (result?.rejected) throw new Error(`rejected ${result.rejected}`);
  }
}

/** A round with no collision at all: every open slot gets its own distinct hero. */
function cleanRound(store: ProtocolSessionStore, id: string, order: Order, base: number): void {
  let next = base;
  for (const slot of orderedOpenSlots(store, id, order)) {
    const result = store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: slot.side, slotIndex: slot.slotIndex, heroId: (next += 1) });
    if (result?.rejected) throw new Error(`rejected ${result.rejected}`);
  }
}

/** Drives the current round to the third collision; each pass has its own arrival order. */
function driveToThird(id: string, orders: [Order, Order, Order], prepare?: (store: ProtocolSessionStore) => void): ProtocolSessionStore {
  const store = newStore(id);
  prepare?.(store);
  pass(store, id, 501, orders[0], 1000);
  pass(store, id, 502, orders[1], 1100);
  pass(store, id, 503, orders[2], 1200);
  return store;
}

function resolve(store: ProtocolSessionStore, id: string) {
  const state = store.get(id)!;
  return resolveSimulatorCollisionAuthority(state.rankedAp!.round!.pendingCollision!, store.registrationEvidence(id)!);
}

function winnerSide(store: ProtocolSessionStore, id: string): string {
  const outcome = resolve(store, id);
  if (!outcome.ok) throw new Error(`no winner: ${outcome.reason}`);
  return outcome.command.winner.side;
}

describe("resolveSimulatorCollisionAuthority -- first registration wins", () => {
  test("PLAYER FIRST: el Player (radiant) registro antes -> conserva el heroe", () => {
    const store = driveToThird("player-first", ["radiant-first", "radiant-first", "radiant-first"]);
    expect(store.get("player-first")!.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const outcome = resolve(store, "player-first");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.policy).toBe(SIMULATOR_COLLISION_POLICY_VERSION);
    expect(outcome.command).toEqual({ type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION", round: 1, heroId: 503, winner: { side: "radiant", slotIndex: 0 } });

    const applied = store.apply("player-first", outcome.command);
    expect(applied?.rejected).toBeUndefined();
    const ranked = store.get("player-first")!.rankedAp!;
    expect(ranked.confirmedPicks.find((pick) => pick.heroId === 503)?.side).toBe("radiant");
    expect(ranked.bannedHeroes).not.toContain(503); // collision #3 never bans
    expect(ranked.round?.openSlots).toEqual([{ side: "dire", slotIndex: 0 }]); // the loser reopens and repicks
  });

  test("BOT FIRST: el Enemy Bot (dire) registro antes -> conserva el heroe", () => {
    const store = driveToThird("bot-first", ["radiant-first", "radiant-first", "dire-first"]);
    const outcome = resolve(store, "bot-first");
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.command.winner).toEqual({ side: "dire", slotIndex: 0 });
    store.apply("bot-first", outcome.command);
    const ranked = store.get("bot-first")!.rankedAp!;
    expect(ranked.confirmedPicks.find((pick) => pick.heroId === 503)?.side).toBe("dire");
    expect(ranked.round?.openSlots).toEqual([{ side: "radiant", slotIndex: 0 }]);
  });

  test("CANONICALIZACION: el kernel queda IDENTICO con orden de llegada opuesto, pero el ledger conserva la diferencia", () => {
    const a = driveToThird("canon-a", ["radiant-first", "radiant-first", "radiant-first"]);
    const b = driveToThird("canon-b", ["radiant-first", "radiant-first", "dire-first"]);
    const kernelA = JSON.stringify({ ...a.get("canon-a"), sessionId: "x" });
    const kernelB = JSON.stringify({ ...b.get("canon-b"), sessionId: "x" });
    expect(kernelB).toBe(kernelA); // sealed[] and eventLog are canonicalized by the (untouched) kernel

    const ordinal = (store: ProtocolSessionStore, id: string, side: TeamSide) =>
      store.registrationEvidence(id)!.records.find((r) => r.heroId === 503 && r.side === side)!.ordinal;
    expect(ordinal(a, "canon-a", "radiant")).toBeLessThan(ordinal(a, "canon-a", "dire"));
    expect(ordinal(b, "canon-b", "dire")).toBeLessThan(ordinal(b, "canon-b", "radiant"));
    expect(winnerSide(a, "canon-a")).toBe("radiant");
    expect(winnerSide(b, "canon-b")).toBe("dire");
  });

  test("SIN PRNG: mismo orden de registro -> mismo resultado, siempre; la funcion no recibe seed", () => {
    const outcomes = Array.from({ length: 5 }, (_, index) => {
      const id = `det-${index}`;
      return JSON.stringify(resolve(driveToThird(id, ["radiant-first", "radiant-first", "dire-first"]), id));
    });
    expect(new Set(outcomes).size).toBe(1);
    expect(resolveSimulatorCollisionAuthority.length).toBe(2); // (pending, evidence) -- nothing else can influence it
  });

  test("AISLAMIENTO DE INTENTOS: los registros de las colisiones #1 y #2 no deciden la #3", () => {
    // Earlier passes reversed relative to the final pass, in both directions: the winner follows pass 3 only.
    expect(winnerSide(driveToThird("iso-a", ["dire-first", "dire-first", "radiant-first"]), "iso-a")).toBe("radiant");
    expect(winnerSide(driveToThird("iso-b", ["radiant-first", "radiant-first", "dire-first"]), "iso-b")).toBe("dire");
  });

  test("AISLAMIENTO (evidencia a mano): registros de un intento anterior nunca cuentan, aunque coincidan lado/slot/heroe", () => {
    const pending: PendingCollisionAuthority = { round: 1, heroId: 7, contenders: [{ side: "dire", slotIndex: 0 }, { side: "radiant", slotIndex: 0 }] };
    const record = (ordinal: number, collisionsResolved: number, side: TeamSide): RegistrationRecord =>
      ({ ordinal, round: 1, collisionsResolved, side, slotIndex: 0, heroId: 7 });
    const stale: CollisionRegistrationEvidence = { collisionsResolved: 2, records: [record(1, 1, "dire"), record(2, 1, "radiant")] };
    expect(resolveSimulatorCollisionAuthority(pending, stale)).toMatchObject({ ok: false, reason: "REGISTRATION_EVIDENCE_MISSING" });

    const mixed: CollisionRegistrationEvidence = {
      collisionsResolved: 2,
      records: [record(1, 1, "dire"), record(2, 1, "radiant"), record(9, 2, "radiant"), record(10, 2, "dire")],
    };
    const outcome = resolveSimulatorCollisionAuthority(pending, mixed);
    expect(outcome.ok && outcome.command.winner).toEqual({ side: "radiant", slotIndex: 0 }); // ordinals 9 < 10, not 1 < 2
  });

  test("REINICIO POR RONDA (evidencia a mano): registros de una ronda anterior no cuentan en la siguiente", () => {
    const pending: PendingCollisionAuthority = { round: 2, heroId: 7, contenders: [{ side: "dire", slotIndex: 0 }, { side: "radiant", slotIndex: 0 }] };
    const previousRound: CollisionRegistrationEvidence = {
      collisionsResolved: 2,
      records: [
        { ordinal: 1, round: 1, collisionsResolved: 2, side: "dire", slotIndex: 0, heroId: 7 },
        { ordinal: 2, round: 1, collisionsResolved: 2, side: "radiant", slotIndex: 0, heroId: 7 },
      ],
    };
    expect(resolveSimulatorCollisionAuthority(pending, previousRound)).toMatchObject({ ok: false, reason: "REGISTRATION_EVIDENCE_MISSING" });
  });

  test("REINICIO POR RONDA (flujo real): una ronda 1 limpia (radiant primero) no influye en la 3a colision de la ronda 2 (dire primero)", () => {
    const id = "round-reset";
    const store = driveToThird(id, ["radiant-first", "radiant-first", "dire-first"], (s) => cleanRound(s, id, "radiant-first", 2000));
    expect(store.get(id)!.rankedAp!.round!.round).toBe(2);
    expect(store.registrationEvidence(id)!.records.some((r) => r.round === 1)).toBe(true); // round-1 registrations exist...
    expect(winnerSide(store, id)).toBe("dire"); // ...and are ignored
  });

  test("EVIDENCIA AUSENTE o AMBIGUA => falla cerrado, nunca resolucion aleatoria", () => {
    const pending: PendingCollisionAuthority = { round: 1, heroId: 7, contenders: [{ side: "dire", slotIndex: 0 }, { side: "radiant", slotIndex: 0 }] };
    const r = (ordinal: number, side: TeamSide): RegistrationRecord => ({ ordinal, round: 1, collisionsResolved: 2, side, slotIndex: 0, heroId: 7 });
    const at = (records: RegistrationRecord[]): CollisionRegistrationEvidence => ({ collisionsResolved: 2, records });

    expect(resolveSimulatorCollisionAuthority(pending, at([]))).toMatchObject({ ok: false, reason: "REGISTRATION_EVIDENCE_MISSING" });
    expect(resolveSimulatorCollisionAuthority(pending, at([r(1, "dire")]))).toMatchObject({ ok: false, reason: "REGISTRATION_EVIDENCE_MISSING" });
    expect(resolveSimulatorCollisionAuthority(pending, at([r(1, "dire"), r(2, "dire"), r(3, "radiant")]))).toMatchObject({ ok: false, reason: "REGISTRATION_EVIDENCE_AMBIGUOUS" });
    expect(resolveSimulatorCollisionAuthority(pending, at([r(5, "dire"), r(5, "radiant")]))).toMatchObject({ ok: false, reason: "REGISTRATION_EVIDENCE_AMBIGUOUS" });
    for (const bad of [at([]), at([r(1, "dire")])]) {
      expect("command" in resolveSimulatorCollisionAuthority(pending, bad)).toBe(false);
    }
  });
});

describe("registration ledger (fuera del kernel)", () => {
  test("solo las selecciones ACEPTADAS reciben ordinal; los rechazos no dejan hueco ni registro", () => {
    const store = newStore("ledger");
    store.apply("ledger", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 11 });
    const rejected = store.apply("ledger", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 11 }); // same hero twice, same side
    expect(rejected?.rejected).toBe("DUPLICATE_HERO_IN_ROUND");
    const closed = store.apply("ledger", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 12 }); // slot already closed
    expect(closed?.rejected).toBe("SLOT_NOT_OPEN");
    store.apply("ledger", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 13 });
    const records = store.registrationEvidence("ledger")!.records;
    expect(records.map((r) => [r.ordinal, r.side, r.heroId])).toEqual([[1, "radiant", 11], [2, "dire", 13]]);
  });

  test("sin comandos de seleccion el ledger esta vacio", () => {
    const store = newStore("ledger-2");
    expect(store.registrationEvidence("ledger-2")!.records).toEqual([]);
  });

  test("el ledger no altera el estado del kernel: el mismo comando da el mismo estado con o sin store", () => {
    const store = newStore("hash");
    const created = store.get("hash")!;
    const direct = applyProtocolCommand(created, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 21 }).state;
    store.apply("hash", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 21 });
    expect(JSON.stringify(store.get("hash"))).toBe(JSON.stringify(direct));
    expect(Object.keys(store.get("hash") as DraftProtocolState)).not.toContain("registrations");
  });

  test("colisiones #1 y #2 siguen igual: heroe baneado, ambos asientos reabren, sin autoridad", () => {
    const store = newStore("c12");
    pass(store, "c12", 501, "radiant-first", 1000);
    expect(store.get("c12")!.rankedAp!.bannedHeroes).toContain(501);
    expect(store.get("c12")!.rankedAp!.round!.collisionsResolved).toBe(1);
    pass(store, "c12", 502, "dire-first", 1100);
    expect(store.get("c12")!.rankedAp!.bannedHeroes).toEqual(expect.arrayContaining([501, 502]));
    expect(store.get("c12")!.status).toBe("ACTIVE");
    expect(store.get("c12")!.rankedAp!.round!.pendingCollision).toBeNull();
  });
});
