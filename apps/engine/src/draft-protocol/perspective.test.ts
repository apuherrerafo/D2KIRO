import { describe, expect, test } from "bun:test";
import { functionalIdentityHash, type CanonicalValue } from "./hash";
import { project } from "./perspective";
import { rankedAllPickLegalActions, applyRankedAllPickCommand, createRankedAllPickState } from "./rulesets/ranked-all-pick";
import { applyCaptainsModeCommand, createCaptainsModeState } from "./rulesets/captains-mode";
import { computeEligibilityContentHash } from "./eligibility";
import type { DraftProtocolState, ProtocolCommand } from "./types";

function apply(state: DraftProtocolState, commands: ProtocolCommand[]): DraftProtocolState {
  let s = state;
  commands.forEach((command, index) => {
    const result = applyRankedAllPickCommand(s, command, index);
    if (result.rejected) throw new Error(`rechazado: ${result.rejected}`);
    s = result.state;
  });
  return s;
}

const DIRE_SEALED_SLOT_INDEX = 0;

/** Construye un estado con la ronda 1 abierta: radiant completó sus 2 slots (KNOWN para sí
 * mismo), dire selló sólo 1 de 2 (queda HIDDEN para radiant, el slot restante sigue abierto). */
function buildOpenRoundState(direSlot0HeroId: number): DraftProtocolState {
  let state = createRankedAllPickState("s1");
  state = apply(state, [
    { type: "BAN_RESOLUTION_COMPLETE" },
    { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 10 },
    { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 11 },
    { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: DIRE_SEALED_SLOT_INDEX, heroId: direSlot0HeroId },
  ]);
  return state;
}

// Criterio 3: las selecciones permanecen selladas hasta el reveal.
// Criterio 4: la vista de un héroe enemigo oculto nunca contiene heroId.
describe("PerspectiveDraftView — invariante de héroe oculto", () => {
  test("la selección sellada del rival aparece como HIDDEN, sin heroId", () => {
    const state = buildOpenRoundState(42);
    const view = project(state, "radiant");
    expect(view.enemyPicks).toEqual([{ visibility: "HIDDEN" }]);
    // Invariante fuerte: el heroId oculto no debe aparecer en NINGUNA parte del payload serializado.
    expect(JSON.stringify(view)).not.toContain("42");
  });

  test("las propias selecciones selladas son visibles (KNOWN) para el propio lado", () => {
    const state = buildOpenRoundState(42);
    const view = project(state, "radiant");
    expect(view.ownPicks).toEqual([
      { visibility: "KNOWN", heroId: 10 },
      { visibility: "KNOWN", heroId: 11 },
    ]);
  });

  test("un viewer sin lado (spectator) tampoco ve el héroe sellado del rival", () => {
    const state = buildOpenRoundState(42);
    const view = project(state, null);
    expect(view.ownPicks).toEqual([]);
    expect(view.enemyPicks).toContainEqual({ visibility: "HIDDEN" });
    expect(JSON.stringify(view)).not.toContain("42");
  });
});

// Criterio 5: propiedad de gemelos ocultos (hidden twin).
describe("PerspectiveDraftView — propiedad de gemelos ocultos (hidden twin)", () => {
  test("dos estados idénticos salvo el héroe oculto del rival producen vista/hash/legalActions idénticos", () => {
    const stateA = buildOpenRoundState(1001); // dire ocultó el héroe 1001
    const stateB = buildOpenRoundState(2002); // dire ocultó un héroe totalmente distinto

    const viewA = project(stateA, "radiant");
    const viewB = project(stateB, "radiant");

    expect(viewA).toEqual(viewB);
    expect(functionalIdentityHash(viewA as unknown as CanonicalValue)).toBe(
      functionalIdentityHash(viewB as unknown as CanonicalValue),
    );
    expect(rankedAllPickLegalActions(stateA)).toEqual(rankedAllPickLegalActions(stateB));
  });
});

// Criterio 6: el reveal hace visible la información.
describe("PerspectiveDraftView — reveal", () => {
  test("tras cerrar la ronda, el pick del rival pasa a REVEALED con su heroId real", () => {
    let state = buildOpenRoundState(42);
    state = apply(state, [{ type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 43 }]);
    const view = project(state, "radiant");
    expect(view.enemyPicks).toEqual(
      expect.arrayContaining([
        { visibility: "REVEALED", heroId: 42 },
        { visibility: "REVEALED", heroId: 43 },
      ]),
    );
    expect(view.rankedAp?.phase).toBe("PICK_ROUND_2");
  });
});

describe("PerspectiveDraftView — Captain's Mode nunca tiene HIDDEN (reveal inmediato)", () => {
  function eligibility(heroIds: number[]) {
    const base = {
      schema: "cm-hero-eligibility/v1" as const,
      appId: 570 as const,
      patch: "7.41e",
      buildId: "b",
      depotManifests: {},
      sourceHashes: {},
      heroIds,
    };
    return { ...base, contentHash: computeEligibilityContentHash(base) };
  }

  test("un ban del rival es visible de inmediato como REVEALED, nunca HIDDEN", () => {
    let state = createCaptainsModeState("s1");
    const confirm = applyCaptainsModeCommand(state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }, 0);
    const loaded = applyCaptainsModeCommand(confirm.state, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibility([1, 2, 3]) }, 1);
    // paso 1: BAN, actor "first" == radiant (firstPickSide=radiant), no es del rival; usamos el
    // banned list, que es siempre público en ambos formatos (no aparece como enemyPicks/ownPicks).
    const banned = applyCaptainsModeCommand(loaded.state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 }, 2);
    const view = project(banned.state, "dire");
    expect(view.bannedHeroes).toEqual([1]);
    expect(view.enemyPicks.every((slot) => slot.visibility !== "HIDDEN")).toBe(true);
    expect(view.ownPicks.every((slot) => slot.visibility !== "HIDDEN")).toBe(true);
  });
});
