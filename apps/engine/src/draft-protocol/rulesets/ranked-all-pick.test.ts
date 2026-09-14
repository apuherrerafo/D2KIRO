import { describe, expect, test } from "bun:test";
import type { DraftProtocolState, ProtocolCommand } from "../types";
import { applyProtocolCommand, createProtocolState } from "../kernel";
import { isSealedSelectionLegal } from "./ranked-all-pick";

function createRankedAllPickState(sessionId: string): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("setup");
  return created.state;
}

function applyRankedAllPickCommand(
  state: DraftProtocolState,
  command: ProtocolCommand,
  _legacyOrdinal?: number,
) {
  return applyProtocolCommand(state, command);
}

function submit(side: "radiant" | "dire", slotIndex: number, heroId: number): ProtocolCommand {
  return { type: "SUBMIT_SEALED_SELECTION", side, slotIndex, heroId };
}

/** Aplica una secuencia de comandos con ordinal = índice, fallando el test si algo se rechaza. */
function apply(state: DraftProtocolState, commands: ProtocolCommand[]): DraftProtocolState {
  let s = state;
  commands.forEach((command, index) => {
    const result = applyRankedAllPickCommand(s, command, index);
    if (result.rejected) {
      throw new Error(`comando ${index} (${command.type}) rechazado: ${result.rejected}`);
    }
    s = result.state;
  });
  return s;
}

// Criterio 1: transiciones BAN_RESOLUTION -> R1 -> R2 -> R3 -> COMPLETE.
// Criterio 2: capacidad 2/2/1.
// Criterio 6: el reveal hace visible la información (confirmedPicks poblado tras cerrar la ronda).
describe("Ranked All Pick — transiciones de fase y capacidad 2/2/1", () => {
  test("BAN_RESOLUTION no se infiere por conteo -- exige BAN_RESOLUTION_COMPLETE explícito", () => {
    let state = createRankedAllPickState("s1");
    expect(state.rankedAp?.phase).toBe("BAN_RESOLUTION");
    const afterBans = apply(state, [{ type: "RECORD_RESOLVED_BANS", heroes: [1, 2, 3] }]);
    expect(afterBans.rankedAp?.phase).toBe("BAN_RESOLUTION");
    expect(afterBans.rankedAp?.bannedHeroes).toEqual([1, 2, 3]);
    state = afterBans;
    const afterComplete = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);
    expect(afterComplete.rankedAp?.phase).toBe("PICK_ROUND_1");
    expect(afterComplete.rankedAp?.round?.capacityPerSide).toBe(2);
  });

  test("recorre las 3 rondas sin colisión y llega a COMPLETE con capacidad 2/2/1", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);
    expect(state.rankedAp?.round?.capacityPerSide).toBe(2);

    state = apply(state, [submit("radiant", 0, 10), submit("radiant", 1, 11), submit("dire", 0, 12), submit("dire", 1, 13)]);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_2");
    expect(state.rankedAp?.round?.capacityPerSide).toBe(2);
    expect(state.rankedAp?.confirmedPicks).toHaveLength(4);

    state = apply(state, [submit("radiant", 0, 20), submit("radiant", 1, 21), submit("dire", 0, 22), submit("dire", 1, 23)]);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_3");
    expect(state.rankedAp?.round?.capacityPerSide).toBe(1);
    expect(state.rankedAp?.confirmedPicks).toHaveLength(8);

    state = apply(state, [submit("radiant", 0, 30), submit("dire", 0, 31)]);
    expect(state.rankedAp?.phase).toBe("COMPLETE");
    expect(state.rankedAp?.round).toBeNull();
    expect(state.rankedAp?.confirmedPicks).toHaveLength(10);
    expect(state.status).toBe("COMPLETE");
  });

  test("selecciones sin colisión permanecen selladas (no confirmadas) hasta que la ronda cierra", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }, submit("radiant", 0, 10)]);
    expect(state.rankedAp?.confirmedPicks).toHaveLength(0);
    expect(state.rankedAp?.round?.sealed).toHaveLength(1);
    expect(state.rankedAp?.round?.sealed[0]?.heroId).toBe(10);
  });
});

// Criterio 7: colisión 1ra, 2da y 3ra dentro de la misma ronda.
describe("Ranked All Pick — política de colisión (frozen contract)", () => {
  const HERO = { A: 101, B: 102, C: 103, D: 104, E: 105, F: 106 };

  test("colisión #1 y #2 -> ban + repick; colisión #3 espera autoridad explícita", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);

    // --- colisión 1: radiant slot0=A, radiant slot1=B, dire slot0=C, dire slot1=A ---
    state = apply(state, [submit("radiant", 0, HERO.A), submit("radiant", 1, HERO.B), submit("dire", 0, HERO.C), submit("dire", 1, HERO.A)]);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_1"); // la ronda no avanza, hay slots reabiertos
    expect(state.rankedAp?.bannedHeroes).toContain(HERO.A);
    expect(state.rankedAp?.round?.collisionsResolved).toBe(1);
    expect(state.rankedAp?.round?.openSlots).toEqual(
      expect.arrayContaining([
        { side: "radiant", slotIndex: 0 },
        { side: "dire", slotIndex: 1 },
      ]),
    );
    const confirmedHeroesAfterC1 = state.rankedAp?.confirmedPicks.map((p) => p.heroId).sort();
    expect(confirmedHeroesAfterC1).toEqual([HERO.B, HERO.C].sort());

    // --- colisión 2: ambos slots reabiertos vuelven a colisionar en D ---
    state = apply(state, [submit("radiant", 0, HERO.D), submit("dire", 1, HERO.D)]);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_1");
    expect(state.rankedAp?.bannedHeroes).toEqual(expect.arrayContaining([HERO.A, HERO.D]));
    expect(state.rankedAp?.round?.collisionsResolved).toBe(2);
    // sigue sin haber ganador -- D también fue baneado, no asignado.
    expect(state.rankedAp?.confirmedPicks.some((p) => p.heroId === HERO.D)).toBe(false);

    // --- colisión 3 del round: ninguna llegada decide ganador; el protocolo espera autoridad ---
    state = apply(state, [submit("radiant", 0, HERO.E), submit("dire", 1, HERO.E)]);
    expect(state.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    expect(state.rankedAp?.round?.collisionsResolved).toBe(2);
    expect(state.rankedAp?.bannedHeroes).not.toContain(HERO.E); // colisión 3+: nunca se banea
    expect(state.rankedAp?.confirmedPicks.some((p) => p.heroId === HERO.E)).toBe(false);

    state = apply(state, [{
      type: "APPLY_AUTHORITATIVE_COLLISION_RESOLUTION",
      round: 1,
      heroId: HERO.E,
      winner: { side: "radiant", slotIndex: 0 },
    }]);
    expect(state.rankedAp?.round?.collisionsResolved).toBe(3);
    expect(state.rankedAp?.confirmedPicks.find((p) => p.heroId === HERO.E)?.side).toBe("radiant");
    expect(state.rankedAp?.round?.openSlots).toEqual([{ side: "dire", slotIndex: 1 }]); // dire perdió, repick

    // dire completa su último slot sin más colisión -> la ronda cierra.
    state = apply(state, [submit("dire", 1, HERO.F)]);
    expect(state.rankedAp?.phase).toBe("PICK_ROUND_2");
    expect(state.rankedAp?.round?.collisionsResolved).toBe(0); // el contador es por ronda, se resetea

    const round1Heroes = state.rankedAp?.confirmedPicks.filter((p) => p.round === 1).map((p) => p.heroId).sort();
    expect(round1Heroes).toEqual([HERO.B, HERO.C, HERO.E, HERO.F].sort());
    expect([...(state.rankedAp?.bannedHeroes ?? [])].sort()).toEqual([HERO.A, HERO.D].sort());
  });

  test("un mismo lado no puede sellar el mismo héroe dos veces en la ronda (no es colisión, es error)", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }, submit("radiant", 0, HERO.A)]);
    const result = applyRankedAllPickCommand(state, submit("radiant", 1, HERO.A), 99);
    expect(result.rejected).toBe("DUPLICATE_HERO_IN_ROUND");
  });

  test("un héroe ya baneado o ya confirmado no puede volver a sellarse", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "RECORD_RESOLVED_BANS", heroes: [HERO.A] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, HERO.A), 99);
    expect(result.rejected).toBe("HERO_ALREADY_TAKEN");
  });
});

describe("Ranked All Pick — validación de fase / slot", () => {
  test("no se puede sellar una selección fuera de una ronda de picks (aún en bans)", () => {
    const state = createRankedAllPickState("s1");
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, 10), 0);
    expect(result.rejected).toBe("WRONG_PHASE");
  });

  test("no se puede sellar en un slot que ya no está abierto", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }, submit("radiant", 0, 10)]);
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, 11), 99);
    expect(result.rejected).toBe("SLOT_NOT_OPEN");
  });
});

// Blocker 4C: NaN/Infinity/no-entero/<=0 nunca deben poder colarse como heroId.
describe("Ranked All Pick — heroId inválido (Blocker 4C)", () => {
  test("SUBMIT_SEALED_SELECTION con heroId NaN se rechaza con INVALID_HERO_ID", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, NaN), 0);
    expect(result.rejected).toBe("INVALID_HERO_ID");
  });

  test("SUBMIT_SEALED_SELECTION con heroId Infinity se rechaza con INVALID_HERO_ID", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, Infinity), 0);
    expect(result.rejected).toBe("INVALID_HERO_ID");
  });

  test("RECORD_RESOLVED_BANS con un heroId inválido en el lote rechaza el lote entero", () => {
    const state = createRankedAllPickState("s1");
    const result = applyRankedAllPickCommand(state, { type: "RECORD_RESOLVED_BANS", heroes: [1, NaN, 3] }, 0);
    expect(result.rejected).toBe("INVALID_HERO_ID");
    expect(result.state.rankedAp?.bannedHeroes).toHaveLength(0); // nada se aplicó parcialmente
  });
});

// Blocker 3: isSealedSelectionLegal es el oracle real para AP (dominio de heroId no acotado) --
// debe coincidir exactamente con lo que el kernel acepta/rechaza.
describe("Ranked All Pick — isSealedSelectionLegal (Blocker 3, paridad con el kernel)", () => {
  test("un heroId fresco en un slot abierto es legal, y el kernel efectivamente lo acepta", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);
    expect(isSealedSelectionLegal(state, "radiant", 0, 777)).toBe(true);
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, 777), 0);
    expect(result.rejected).toBeUndefined();
  });

  test("un slot cerrado nunca es legal", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }, submit("radiant", 0, 10)]);
    expect(isSealedSelectionLegal(state, "radiant", 0, 11)).toBe(false);
    const result = applyRankedAllPickCommand(state, submit("radiant", 0, 11), 1);
    expect(result.rejected).toBe("SLOT_NOT_OPEN");
  });

  test("un héroe ya baneado nunca es legal", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "RECORD_RESOLVED_BANS", heroes: [5] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    expect(isSealedSelectionLegal(state, "radiant", 0, 5)).toBe(false);
  });

  test("un heroId inválido (NaN) nunca es legal", () => {
    let state = createRankedAllPickState("s1");
    state = apply(state, [{ type: "BAN_RESOLUTION_COMPLETE" }]);
    expect(isSealedSelectionLegal(state, "radiant", 0, NaN)).toBe(false);
  });

  test("fuera de una ronda de picks (aún en bans) nunca es legal", () => {
    const state = createRankedAllPickState("s1");
    expect(isSealedSelectionLegal(state, "radiant", 0, 10)).toBe(false);
  });
});
