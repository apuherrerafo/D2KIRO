import { describe, expect, test } from "bun:test";
import { computeEligibilityContentHash } from "../eligibility";
import type { CmHeroEligibilitySnapshot, DraftProtocolState, ProtocolCommand } from "../types";
import { applyCaptainsModeCommand, captainsModeStepDefinition, createCaptainsModeState } from "./captains-mode";

function buildEligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "test-build",
    depotManifests: { "570": "1" },
    sourceHashes: { npc_heroes: "fixture" },
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

// 24 héroes distintos, uno por paso -- suficiente margen para no chocar entre sí.
const FULL_ELIGIBILITY = buildEligibilitySnapshot(Array.from({ length: 30 }, (_, i) => i + 1));

function apply(state: DraftProtocolState, commands: ProtocolCommand[]): DraftProtocolState {
  let s = state;
  for (const command of commands) {
    const result = applyCaptainsModeCommand(s, command, 0);
    if (result.rejected) throw new Error(`comando ${command.type} rechazado: ${result.rejected}`);
    s = result.state;
  }
  return s;
}

function withFirstPickAndEligibility(side: "radiant" | "dire" = "radiant"): DraftProtocolState {
  let state = createCaptainsModeState("s1");
  state = apply(state, [{ type: "CONFIRM_FIRST_PICK_SIDE", side }, { type: "LOAD_CM_ELIGIBILITY", snapshot: FULL_ELIGIBILITY }]);
  return state;
}

// Criterio 11: regresión explícita -- step17 = SECOND, step18 = FIRST.
describe("Captain's Mode — secuencia canónica de 24 pasos", () => {
  test("regresión: paso 17 es SECOND y paso 18 es FIRST (el repo los tenía invertidos)", () => {
    expect(captainsModeStepDefinition(17)?.actor).toBe("second");
    expect(captainsModeStepDefinition(18)?.actor).toBe("first");
  });

  test("la tabla completa tiene 24 pasos: 14 bans + 10 picks, 6 fases", () => {
    const steps = Array.from({ length: 24 }, (_, i) => captainsModeStepDefinition(i + 1)!);
    expect(steps.every(Boolean)).toBe(true);
    expect(steps.filter((s) => s.kind === "BAN")).toHaveLength(14);
    expect(steps.filter((s) => s.kind === "PICK")).toHaveLength(10);
    expect(captainsModeStepDefinition(25)).toBeNull();
    expect(captainsModeStepDefinition(0)).toBeNull();
  });

  test("recorre los 24 pasos exactos con el actor/kind reales -> COMPLETE, 5 picks por lado", () => {
    let state = withFirstPickAndEligibility("radiant");
    for (let step = 1; step <= 24; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      const command: ProtocolCommand = { type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step };
      state = apply(state, [command]);
    }
    expect(state.captainsMode?.currentStep).toBe(25);
    expect(state.status).toBe("COMPLETE");
    expect(state.captainsMode?.bannedHeroes).toHaveLength(14);
    expect(state.captainsMode?.picks.radiant).toHaveLength(5);
    expect(state.captainsMode?.picks.dire).toHaveLength(5);
    expect(state.captainsMode?.history).toHaveLength(24);
  });
});

// Criterio 9: firstPickSide obligatorio.
describe("Captain's Mode — firstPickSide obligatorio (UNCONFIRMED_STATE)", () => {
  test("sin firstPickSide, el estado es UNCONFIRMED_STATE y ninguna acción de protocolo avanza", () => {
    const state = createCaptainsModeState("s1");
    expect(state.status).toBe("UNCONFIRMED_STATE");
    expect(state.captainsMode?.firstPickSide).toBeNull();
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 }, 0);
    expect(result.rejected).toBe("UNCONFIRMED_STATE");
    expect(result.state.captainsMode?.currentStep).toBe(1); // no avanzó
  });

  test("confirmar el lado activa el protocolo; confirmarlo dos veces se rechaza", () => {
    let state = createCaptainsModeState("s1");
    const first = applyCaptainsModeCommand(state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "dire" }, 0);
    expect(first.rejected).toBeUndefined();
    expect(first.state.status).toBe("ACTIVE");
    expect(first.state.captainsMode?.firstPickSide).toBe("dire");
    const second = applyCaptainsModeCommand(first.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }, 1);
    expect(second.rejected).toBe("ALREADY_RESOLVED");
    expect(second.state.captainsMode?.firstPickSide).toBe("dire"); // no se sobreescribe
  });
});

// Criterio 12/13: actor y kind equivocados se rechazan.
describe("Captain's Mode — actor y tipo de acción equivocados", () => {
  test("paso 1 es BAN de FIRST -- un actor equivocado se rechaza", () => {
    const state = withFirstPickAndEligibility();
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "second", kind: "BAN", heroId: 1 }, 0);
    expect(result.rejected).toBe("WRONG_ACTOR");
  });

  test("paso 1 es BAN -- un PICK del actor correcto igual se rechaza por tipo", () => {
    const state = withFirstPickAndEligibility();
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "PICK", heroId: 1 }, 0);
    expect(result.rejected).toBe("WRONG_ACTION_KIND");
  });
});

// Criterio 14: cualquier acción en el paso 25 (post-COMPLETE) se rechaza.
describe("Captain's Mode — paso posterior a COMPLETE", () => {
  test("tras el paso 24, cualquier acción adicional es STEP_AFTER_COMPLETION", () => {
    let state = withFirstPickAndEligibility();
    for (let step = 1; step <= 24; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = apply(state, [{ type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step }]);
    }
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 200 }, 0);
    expect(result.rejected).toBe("STEP_AFTER_COMPLETION");
  });
});

// Criterio 15: BAN_SKIPPED usa el ordinal independiente de paso, sin agregar héroe.
describe("Captain's Mode — BAN_SKIPPED", () => {
  test("un ban salteado avanza el paso sin agregar héroe a bannedHeroes", () => {
    const state = withFirstPickAndEligibility();
    const result = applyCaptainsModeCommand(state, { type: "CM_BAN_SKIPPED", actor: "first" }, 0);
    expect(result.rejected).toBeUndefined();
    expect(result.state.captainsMode?.currentStep).toBe(2);
    expect(result.state.captainsMode?.bannedHeroes).toHaveLength(0);
    expect(result.state.captainsMode?.history[0]).toEqual({ step: 1, outcome: { kind: "BAN_SKIPPED" } });
  });

  test("BAN_SKIPPED en un paso de PICK se rechaza por tipo", () => {
    let state = withFirstPickAndEligibility();
    // avanza hasta el paso 8 (PICK_1, first) sin usar BAN_SKIPPED aquí.
    for (let step = 1; step <= 7; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = apply(state, [{ type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step }]);
    }
    const result = applyCaptainsModeCommand(state, { type: "CM_BAN_SKIPPED", actor: "first" }, 0);
    expect(result.rejected).toBe("WRONG_ACTION_KIND");
  });
});

// Criterio 16: AUTO_PICK es representable (la reproducibilidad vía replay se cubre en kernel.test.ts).
describe("Captain's Mode — AUTO_PICK", () => {
  test("un auto-pick por timeout se registra con outcome.kind = AUTO_PICK y asigna el héroe", () => {
    let state = withFirstPickAndEligibility("radiant");
    for (let step = 1; step <= 7; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = apply(state, [{ type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step }]);
    }
    // paso 8: PICK_1, first (radiant, ya que firstPickSide=radiant). Héroe 8: libre y dentro del
    // snapshot de elegibilidad de la fixture (steps 1-7 ya consumieron los héroes 1-7).
    const result = applyCaptainsModeCommand(state, { type: "CM_AUTO_PICK", actor: "first", heroId: 8 }, 0);
    expect(result.rejected).toBeUndefined();
    expect(result.state.captainsMode?.history.at(-1)).toEqual({ step: 8, outcome: { kind: "AUTO_PICK", heroId: 8 } });
    expect(result.state.captainsMode?.picks.radiant).toContain(8);
    expect(result.state.captainsMode?.currentStep).toBe(9);
  });
});

// Criterio 17/18: elegibilidad fail-closed.
describe("Captain's Mode — CM Hero Eligibility (fail closed)", () => {
  test("sin snapshot cargado, ningún CM_ACTION de héroe se certifica", () => {
    let state = createCaptainsModeState("s1");
    state = apply(state, [{ type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }]);
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 1 }, 0);
    expect(result.rejected).toBe("ELIGIBILITY_UNVERIFIED");
  });

  test("cargar un snapshot corrupto (hash manipulado) se rechaza, el estado no cambia", () => {
    let state = createCaptainsModeState("s1");
    state = apply(state, [{ type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }]);
    const tampered = { ...FULL_ELIGIBILITY, heroIds: [...FULL_ELIGIBILITY.heroIds, 999] };
    const result = applyCaptainsModeCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: tampered }, 0);
    expect(result.rejected).toBe("ELIGIBILITY_UNVERIFIED");
    expect(result.state.captainsMode?.eligibilitySnapshot).toBeNull();
  });

  test("un héroe fuera del snapshot certificado se rechaza -- nunca cae al catálogo global", () => {
    let state = createCaptainsModeState("s1");
    state = apply(state, [
      { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" },
      { type: "LOAD_CM_ELIGIBILITY", snapshot: buildEligibilitySnapshot([1, 2, 3]) },
    ]);
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 9999 }, 0);
    expect(result.rejected).toBe("HERO_INELIGIBLE");
  });

  test("un héroe ya baneado/pickeado no puede repetirse", () => {
    let state = withFirstPickAndEligibility();
    // paso 1 y 2 son ambos BAN_1/first -- reusar el mismo actor mantiene el foco de la prueba en
    // la reutilización del héroe, no en el turno.
    state = apply(state, [{ type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 7 }]);
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 7 }, 1);
    expect(result.rejected).toBe("HERO_ALREADY_TAKEN");
  });
});

// Blocker 4B: hash integrity solo no basta -- patch fuera de rango, o falta de identidad de
// origen requerida, deben rechazarse igual.
describe("Captain's Mode — LOAD_CM_ELIGIBILITY: validación completa (Blocker 4B)", () => {
  test("un snapshot íntegro (hash correcto, forma correcta) pero con patch fuera de [applicableFromPatch, verifiedThroughPatch] se rechaza -- el chequeo de patch es independiente del de hash", () => {
    let state = createCaptainsModeState("s1");
    state = apply(state, [{ type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }]);
    const base = {
      schema: "cm-hero-eligibility/v1" as const,
      appId: 570 as const,
      patch: "7.39", // anterior al rango CM [7.40, 7.41e]
      buildId: "test-build",
      depotManifests: { "570": "1" },
      sourceHashes: { npc_heroes: "fixture" },
      heroIds: [1, 2, 3],
    };
    const snapshot = { ...base, contentHash: computeEligibilityContentHash(base) };
    const result = applyCaptainsModeCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot }, 0);
    expect(result.rejected).toBe("ELIGIBILITY_UNVERIFIED");
    expect(result.state.captainsMode?.eligibilitySnapshot).toBeNull();
  });

  test("un snapshot sin sourceHashes.npc_heroes (identidad de origen requerida ausente) se rechaza aunque el resto sea válido", () => {
    let state = createCaptainsModeState("s1");
    state = apply(state, [{ type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }]);
    const base = {
      schema: "cm-hero-eligibility/v1" as const,
      appId: 570 as const,
      patch: "7.41e",
      buildId: "test-build",
      depotManifests: { "570": "1" },
      sourceHashes: {}, // sin la clave requerida
      heroIds: [1, 2, 3],
    };
    const snapshot = { ...base, contentHash: computeEligibilityContentHash(base) };
    const result = applyCaptainsModeCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot }, 0);
    expect(result.rejected).toBe("ELIGIBILITY_UNVERIFIED");
  });
});

// Blocker 4C: NaN/Infinity nunca deben poder colarse como heroId.
describe("Captain's Mode — heroId inválido (Blocker 4C)", () => {
  test("CM_ACTION con heroId NaN se rechaza con INVALID_HERO_ID", () => {
    const state = withFirstPickAndEligibility();
    const result = applyCaptainsModeCommand(state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: NaN }, 0);
    expect(result.rejected).toBe("INVALID_HERO_ID");
  });

  test("CM_AUTO_PICK con heroId Infinity se rechaza con INVALID_HERO_ID", () => {
    let state = withFirstPickAndEligibility("radiant");
    for (let step = 1; step <= 7; step += 1) {
      const def = captainsModeStepDefinition(step)!;
      state = apply(state, [{ type: "CM_ACTION", actor: def.actor, kind: def.kind, heroId: step }]);
    }
    const result = applyCaptainsModeCommand(state, { type: "CM_AUTO_PICK", actor: "first", heroId: Infinity }, 0);
    expect(result.rejected).toBe("INVALID_HERO_ID");
  });
});
