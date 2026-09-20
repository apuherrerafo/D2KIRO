import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as coachBarrel from "./index";
import { MIN_CURATED_HARD_COUNTER_COVERAGE, detectSafeCoreWindow, type SafeCoreRole, type SafeCoreSignal } from "./safe-core";
import { hidden, known, revealed, signal, view } from "./test.fixtures";

// AP Ranked Roles V1 / Wave 4A (task 24) -- Safe Core V1 as a pure function. Inline fixtures only: no
// hero-counters.json, no SQLite, no network (family S9). Hero ids are arbitrary labels here.

const CARRY = 10;
const COUNTER_A = 21; // hard counter of CARRY
const COUNTER_B = 22; // hard counter of CARRY
const COUNTER_MEDIUM = 23; // medium counter of CARRY
const CORE: SafeCoreRole = { position: 1, roleStatus: "LIKELY" };

const curated = (level: CuratedCounter["level"], vs: number): CuratedCounter => ({ vs, level, why: `fixture ${vs}` });
const COUNTERS = new Map<number, CuratedCounter[]>([[CARRY, [curated("hard", COUNTER_A), curated("hard", COUNTER_B), curated("medium", COUNTER_MEDIUM)]]]);
const WITH_POSITION = [signal("position_fit", 0.6, 20)];

const detect = (bans: number[], own = [known(50)], enemy = [hidden(), hidden()], signals = WITH_POSITION, role = CORE, counters = COUNTERS) =>
  detectSafeCoreWindow(CARRY, view("PICK_ROUND_1", own, enemy, bans), signals, counters, role);

describe("detectSafeCoreWindow -- piso de cobertura de evidencia curada (Product Owner, auditoría de incidencia Wave 4A)", () => {
  const ONE_HARD = new Map([[CARRY, [curated("hard", COUNTER_A)]]]);
  const ONE_HARD_PLUS_MEDIUM = new Map([[CARRY, [curated("hard", COUNTER_A), curated("medium", COUNTER_MEDIUM)]]]);
  const THREE_HARD = new Map([[CARRY, [curated("hard", COUNTER_A), curated("hard", COUNTER_B), curated("hard", 24)]]]);

  test("la constante de producto vale 2", () => {
    expect(MIN_CURATED_HARD_COUNTER_COVERAGE).toBe(2);
  });

  test("UN solo counter duro curado, baneado -> NO es ventana segura y no hay counterEvidence (aunque 'todos' sus counters estén fuera)", () => {
    const result = detect([COUNTER_A], [known(50)], [hidden()], WITH_POSITION, CORE, ONE_HARD);
    expect(result.isSafeWindow).toBe(false);
    expect(result).not.toHaveProperty("counterEvidence");
    expect(result.evidence).toBe("Solo 1 counter duro curado para este héroe: cobertura insuficiente para afirmar una ventana de core (mínimo 2).");
  });

  test("un héroe de un solo counter duro no dispara con NINGUNA combinación de bans / picks propios / posición", () => {
    for (const bans of [[], [COUNTER_A], [COUNTER_A, COUNTER_MEDIUM]]) {
      for (const own of [[known(50)], [known(50), known(COUNTER_A)], [known(COUNTER_A)]]) {
        for (const position of [1, 2, 3] as const) {
          const role: SafeCoreRole = { position, roleStatus: "CONFIRMED_FORCED" };
          expect(detect(bans, own, [hidden(), hidden()], WITH_POSITION, role, ONE_HARD).isSafeWindow).toBe(false);
          expect(detect(bans, own, [hidden(), hidden()], WITH_POSITION, role, ONE_HARD_PLUS_MEDIUM).isSafeWindow).toBe(false);
        }
      }
    }
  });

  // Structural invariant: the floor is a product constant, not an argument. There is no way to say "run Safe Core
  // with minHardCounters = 1" through the production API.
  test("la API de producción NO tiene parámetro de umbral: un 6º argumento (1, 0, negativo, NaN) se ignora y el piso sigue en 2", () => {
    const untyped = detectSafeCoreWindow as unknown as (...args: unknown[]) => SafeCoreSignal;
    const oneCounterState = view("PICK_ROUND_1", [known(50)], [hidden()], [COUNTER_A]);
    for (const override of [1, 0, -1, Number.NaN, Number.NEGATIVE_INFINITY, undefined, null, { minHardCounters: 1 }]) {
      const result = untyped(CARRY, oneCounterState, WITH_POSITION, ONE_HARD, CORE, override);
      expect(result.isSafeWindow).toBe(false);
      expect(result).not.toHaveProperty("counterEvidence");
      expect(result.evidence).toContain("mínimo 2");
    }
    expect(detectSafeCoreWindow.toString()).not.toMatch(/minHardCounters/);
    expect(readFileSync(join(import.meta.dir, "safe-core.ts"), "utf8")).not.toMatch(/minHardCounters/);
  });

  test("un héroe de UN solo counter duro NUNCA produce Safe Core por la API de producción (todo el estado favorable, incluso con counters medios revelados o no)", () => {
    const favourable = view("PICK_ROUND_1", [known(50)], [hidden()], [COUNTER_A, COUNTER_MEDIUM]);
    expect(detectSafeCoreWindow(CARRY, favourable, WITH_POSITION, ONE_HARD, CORE).isSafeWindow).toBe(false);
    expect(detectSafeCoreWindow(CARRY, favourable, WITH_POSITION, ONE_HARD_PLUS_MEDIUM, CORE).isSafeWindow).toBe(false);
  });

  test("el piso de 2 se aplica incluso con datos inusuales: el MISMO counter duro repetido en la lista curada cuenta como UNO", () => {
    const duplicated = new Map([[CARRY, [curated("hard", COUNTER_A), curated("hard", COUNTER_A), curated("hard", COUNTER_A)]]]);
    const result = detectSafeCoreWindow(CARRY, view("PICK_ROUND_1", [known(50)], [hidden()], [COUNTER_A]), WITH_POSITION, duplicated, CORE);
    expect(result.isSafeWindow).toBe(false);
    expect(result.evidence).toContain("Solo 1 counter duro curado");
    // ...whereas two DISTINCT hard counters do satisfy the floor.
    const distinct = new Map([[CARRY, [curated("hard", COUNTER_A), curated("hard", COUNTER_B), curated("hard", COUNTER_B)]]]);
    expect(detectSafeCoreWindow(CARRY, view("PICK_ROUND_1", [known(50)], [hidden()], [COUNTER_A, COUNTER_B]), WITH_POSITION, distinct, CORE).isSafeWindow).toBe(true);
  });

  test("la superficie pública del Coach no expone ningún helper capaz de sobrescribir el piso", () => {
    const exported = Object.keys(coachBarrel);
    expect(exported).toContain("detectSafeCoreWindow");
    expect(exported.filter((name) => /threshold|floor|override|legacy|minHard/i.test(name))).toEqual([]);
    // The only "min" symbol is the read-only product constant.
    expect(exported.filter((name) => /^MIN_/.test(name))).toEqual(["MIN_CURATED_HARD_COUNTER_COVERAGE"]);
    expect(coachBarrel.MIN_CURATED_HARD_COUNTER_COVERAGE).toBe(2);
    expect(coachBarrel.detectSafeCoreWindow).toBe(detectSafeCoreWindow);
  });

  test("ningún archivo de producción de apps/ ni de la ruta HTTP referencia un umbral alternativo de Safe Core", () => {
    const root = join(import.meta.dir, "..", "..", "..");
    for (const file of ["engine/src/coach/orchestrator.ts", "engine/src/coach/recommendation-output-v3.ts", "engine/src/server/routes/coach-recommendations.ts", "engine/src/server/routes/protocol-sessions.ts", "web/features/random-draft-simulator/coach-client.ts"]) {
      expect(readFileSync(join(root, file), "utf8")).not.toMatch(/minHardCounters|MIN_CURATED_HARD_COUNTER_COVERAGE\s*=\s*[01]/);
    }
  });

  test("un counter duro + counters MEDIOS no completan la cobertura: sólo los duros cuentan", () => {
    const result = detect([COUNTER_A, COUNTER_MEDIUM], [known(50)], [hidden()], WITH_POSITION, CORE, ONE_HARD_PLUS_MEDIUM);
    expect(result.isSafeWindow).toBe(false);
    expect(result.evidence).toContain("Solo 1 counter duro curado");
  });

  test("EXACTAMENTE 2 counters duros (el mínimo), ambos fuera de juego y uno baneado -> sí es ventana segura", () => {
    expect(detect([COUNTER_A, COUNTER_B]).isSafeWindow).toBe(true);
    expect(detect([COUNTER_A], [known(50), known(COUNTER_B)]).isSafeWindow).toBe(true);
  });

  test("con 2 counters duros basta el piso, pero sigue exigiéndose un ban real: 2 en tu equipo y 0 baneados -> no", () => {
    expect(detect([], [known(COUNTER_A), known(COUNTER_B)]).isSafeWindow).toBe(false);
  });

  test("3 counters duros, todos fuera de juego -> segura; con uno todavía disponible -> no", () => {
    expect(detect([COUNTER_A, COUNTER_B, 24], [known(50)], [hidden()], WITH_POSITION, CORE, THREE_HARD).isSafeWindow).toBe(true);
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], WITH_POSITION, CORE, THREE_HARD).isSafeWindow).toBe(false);
  });

  test("el piso no altera el redactado aprobado ni promete nada estadístico", () => {
    const safe = detect([COUNTER_A, COUNTER_B]);
    expect(safe.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)");
    expect(safe.counterEvidence?.sourceType).toBe("CURATED");
    const sparse = detect([COUNTER_A], [known(50)], [hidden()], WITH_POSITION, CORE, ONE_HARD);
    expect(sparse.evidence).not.toMatch(/baneado|STATISTICAL|win ?rate|%|parche/i);
  });
});

describe("detectSafeCoreWindow -- Safe Core V1", () => {
  test("A. todos los counters aliviados están BANEADOS -> el detalle dice 'baneados' y el titular habla de disponibilidad", () => {
    const result = detect([COUNTER_A, COUNTER_B]);
    expect(result.isSafeWindow).toBe(true);
    expect(result.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)");
    expect(result.counterEvidence?.relieved.every((entry) => entry.status === "BANNED")).toBe(true);
  });

  test("B. alivio mixto BANNED + OWN_PICK -> titular 'ya no están disponibles' y detalle '1 baneado · 1 en tu equipo'", () => {
    const result = detect([COUNTER_A], [known(50), known(COUNTER_B)]);
    expect(result.isSafeWindow).toBe(true);
    expect(result.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (1 baneado · 1 en tu equipo)");
  });

  test("C. el caso mixto NUNCA afirma 'baneados' para el conjunto: ni '2 baneados' ni el viejo 'N de M ... baneados'", () => {
    const result = detect([COUNTER_A], [known(50), known(COUNTER_B)]);
    expect(result.evidence).not.toMatch(/2 baneados/);
    expect(result.evidence).not.toMatch(/counters? duros? curados? baneados?/);
    // The only "baneado" in the text is the singular count of what really is banned.
    expect(result.evidence.match(/baneados?/g)).toEqual(["baneado"]);
    expect(result.counterEvidence?.relieved.map((entry) => entry.status)).toEqual(["BANNED", "OWN_PICK"]);
  });

  test("todos sus counters duros curados baneados -> ventana segura, con evidencia CURATED y estados BANNED", () => {
    const result = detect([COUNTER_A, COUNTER_B]);
    expect(result.isSafeWindow).toBe(true);
    expect(result.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (2 baneados)");
    expect(result.counterEvidence).toEqual({
      kind: "COUNTER_RELIEF",
      sourceType: "CURATED",
      relieved: [
        { heroId: COUNTER_A, level: "hard", status: "BANNED" },
        { heroId: COUNTER_B, level: "hard", status: "BANNED" },
      ],
      totalHardCounters: 2,
    });
  });

  test("un counter duro sigue disponible -> NO es ventana segura, y la evidencia dice cuántos siguen expuestos", () => {
    const result = detect([COUNTER_A]);
    expect(result.isSafeWindow).toBe(false);
    expect(result.evidence).toBe("1 de 2 counters duros curados ya no están disponibles para el rival (1 baneado); 1 sigue disponible");
    expect(result).not.toHaveProperty("counterEvidence");
  });

  test("ningún counter duro baneado -> no hay evidencia de alivio (nunca una afirmación falsa de 'baneados')", () => {
    const result = detect([]);
    expect(result.isSafeWindow).toBe(false);
    expect(result.evidence).toBe("0 de 2 counters duros curados ya no están disponibles para el rival; 2 siguen disponibles");
    expect(result.counterEvidence).toBeUndefined();
  });

  test("la evidencia cambia con cuántos counters están baneados (no es una plantilla fija)", () => {
    const none = detect([]).evidence;
    const one = detect([COUNTER_A]).evidence;
    const all = detect([COUNTER_A, COUNTER_B]).evidence;
    expect(new Set([none, one, all]).size).toBe(3);
  });

  test("un counter duro en tu propio equipo cuenta como fuera de juego, pero se distingue de un ban", () => {
    const result = detect([COUNTER_A], [known(50), known(COUNTER_B)]);
    expect(result.isSafeWindow).toBe(true);
    expect(result.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (1 baneado · 1 en tu equipo)");
    expect(result.counterEvidence?.relieved).toEqual([
      { heroId: COUNTER_A, level: "hard", status: "BANNED" },
      { heroId: COUNTER_B, level: "hard", status: "OWN_PICK" },
    ]);
  });

  test("todos los counters duros en tu equipo pero ninguno baneado -> no se afirma 'counters baneados'", () => {
    const result = detect([], [known(COUNTER_A), known(COUNTER_B)]);
    expect(result.isSafeWindow).toBe(false);
    expect(result.evidence).toBe("2 de 2 counters duros curados ya no están disponibles para el rival (2 en tu equipo)");
    expect(result.evidence).not.toMatch(/baneado/);
  });

  test("un counter curado (duro o medio) ya revelado en el rival es exposición viva -> no es ventana segura", () => {
    const hardRevealed = detect([COUNTER_A], [known(50)], [revealed(COUNTER_B), revealed(60)]);
    expect(hardRevealed.isSafeWindow).toBe(false);
    expect(hardRevealed.evidence).toBe("1 counter curado ya está revelado en el equipo rival.");

    const mediumRevealed = detect([COUNTER_A, COUNTER_B], [known(50)], [revealed(COUNTER_MEDIUM), revealed(60)]);
    expect(mediumRevealed.isSafeWindow).toBe(false);
  });

  test("un rival OCULTO nunca cuenta: la vista lo expone sólo como HIDDEN y el resultado no cambia", () => {
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden(), hidden()])).toEqual(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()]));
  });

  test("un counter MEDIO baneado no basta: sólo los duros cuentan como alivio", () => {
    const onlyMedium = new Map([[CARRY, [curated("medium", COUNTER_MEDIUM)]]]);
    const result = detect([COUNTER_MEDIUM], [known(50)], [hidden()], WITH_POSITION, CORE, onlyMedium);
    expect(result.isSafeWindow).toBe(false);
    expect(result.evidence).toContain("Sin counters duros curados");
  });

  test("héroe sin entrada curada -> sin evidencia de alivio, nunca 'seguro'", () => {
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], WITH_POSITION, CORE, new Map()).isSafeWindow).toBe(false);
  });

  test("un soporte no es un core: la ventana de core no aplica aunque sus counters estén baneados", () => {
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], WITH_POSITION, { position: 5, roleStatus: "LIKELY" }).isSafeWindow).toBe(false);
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], WITH_POSITION, { position: 4, roleStatus: "CONFIRMED_FORCED" }).isSafeWindow).toBe(false);
  });

  test("un rol UNRESOLVED (Flex sin resolver) no se presenta como core", () => {
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], WITH_POSITION, { position: 2, roleStatus: "UNRESOLVED" }).isSafeWindow).toBe(false);
  });

  test("sin dato propio de position_fit (raw null o ausente) -> no se afirma la ventana", () => {
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], [signal("position_fit", null, 0)]).isSafeWindow).toBe(false);
    expect(detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], []).isSafeWindow).toBe(false);
  });

  test("la magnitud de position_fit no decide nada: sólo cuenta que tenga dato propio", () => {
    const low = detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], [signal("position_fit", 0.01, 0.1)]);
    const high = detect([COUNTER_A, COUNTER_B], [known(50)], [hidden()], [signal("position_fit", 1, 30)]);
    expect(low).toEqual(high);
  });

  test("EVIDENCIA ESTADÍSTICA NO ENTRA: ni `counter` V6 (mezcla curado+estadístico) ni `patch_meta` cambian el resultado", () => {
    const baseline = detect([COUNTER_A]);
    const inflated = detect([COUNTER_A], [known(50)], [hidden(), hidden()], [
      signal("position_fit", 0.6, 20),
      signal("counter", 0.12, 40),
      signal("patch_meta", 1, 40),
    ]);
    expect(inflated).toEqual(baseline);
    expect(inflated.isSafeWindow).toBe(false);

    const safeBase = detect([COUNTER_A, COUNTER_B]);
    const safeHostile = detect([COUNTER_A, COUNTER_B], [known(50)], [hidden(), hidden()], [
      signal("position_fit", 0.6, 20),
      signal("counter", -0.12, -40),
      signal("patch_meta", 0, 0),
    ]);
    expect(safeHostile).toEqual(safeBase);
    expect(safeHostile.isSafeWindow).toBe(true);
  });

  test("procedencia: la evidencia de alivio declara sourceType CURATED y jamás STATISTICAL", () => {
    const result = detect([COUNTER_A, COUNTER_B]);
    expect(result.counterEvidence?.sourceType).toBe("CURATED");
    expect(JSON.stringify(result)).not.toMatch(/STATISTICAL|7\.41|win ?rate|meta|%/i);
  });

  test("es pura: la misma entrada produce byte a byte la misma salida", () => {
    expect(JSON.stringify(detect([COUNTER_A, COUNTER_B]))).toBe(JSON.stringify(detect([COUNTER_A, COUNTER_B])));
  });
});
