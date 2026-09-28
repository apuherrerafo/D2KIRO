import { expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import {
  chooseHero,
  decideProgressionAction,
  formatFailureReport,
  formatScenarioProgress,
  pollUntilAuthenticated,
  progress,
  redactSessionId,
  runCli,
  type AuthPoller,
  type CliDeps,
  type SmokeFailureReport,
} from "./staging";

function fakePoller(checks: (() => Promise<boolean>)[]): AuthPoller & { calls: number } {
  const state = { calls: 0 };
  return {
    calls: state.calls,
    async check() {
      const step = checks[Math.min(state.calls, checks.length - 1)];
      state.calls += 1;
      this.calls = state.calls;
      return step();
    },
    async wait() {
      // No espera real: la resolución de qué tan seguido se sondea no es el objeto de estas
      // pruebas, sólo el control de flujo (sigue sondeando vs. corta y guarda).
    },
  };
}

test("sesion no autenticada al inicio -> sigue sondeando hasta autenticarse", async () => {
  const poller = fakePoller([
    async () => false,
    async () => false,
    async () => true,
  ]);

  const authenticated = await pollUntilAuthenticated(poller, 5_000, 0);

  expect(authenticated).toBe(true);
  expect(poller.calls).toBe(3);
});

test("la autenticacion nunca llega -> corta por timeout sin declarar exito", async () => {
  const poller = fakePoller([async () => false]);

  const authenticated = await pollUntilAuthenticated(poller, 30, 5);

  expect(authenticated).toBe(false);
  expect(poller.calls).toBeGreaterThan(1);
});

test("un error transitorio de sondeo (navegacion en curso por el redirect de Steam) no aborta el sondeo", async () => {
  const poller = fakePoller([
    async () => {
      throw new Error("Execution context was destroyed, most likely because of a navigation.");
    },
    async () => true,
  ]);

  const authenticated = await pollUntilAuthenticated(poller, 5_000, 0);

  expect(authenticated).toBe(true);
  expect(poller.calls).toBe(2);
});

function fixtureFailureReport(overrides: Partial<SmokeFailureReport> = {}): SmokeFailureReport {
  return {
    scenario: "SMOKE-07 BASIC PROGRESSION",
    route: "/engine/api/session/protocol/abc123/command",
    method: "POST",
    status: 409,
    expectedStatus: 202,
    errorClass: "no_accepted_human_pick",
    errorMessage: "no_accepted_human_pick",
    lastGoodState: "SMOKE-02/03/04/05 SOLO POS2",
    unexpected5xx: 0,
    artifactDir: "artifacts/qa/staging/2026-09-28T16-34-42-896Z",
    sessionId: "11111111-2222-3333-4444-555555555555",
    ...overrides,
  };
}

test("el reporte de fallo imprime el escenario que falló", () => {
  const report = formatFailureReport(fixtureFailureReport({ scenario: "SMOKE-03 RESOLVE_BANS" }));

  expect(report).toContain("STAGING_SMOKE_FAIL");
  expect(report).toContain("FAILED_SCENARIO:\nSMOKE-03 RESOLVE_BANS");
});

test("el reporte de fallo incluye el status HTTP real observado", () => {
  const report = formatFailureReport(fixtureFailureReport({ status: 409 }));

  expect(report).toContain("HTTP_STATUS:\n409");
  expect(report).toContain("ACTUAL_STATUS:\n409");
});

test("el reporte de fallo incluye la clase de error", () => {
  const report = formatFailureReport(fixtureFailureReport({ errorClass: "no_accepted_human_pick" }));

  expect(report).toContain("FAILURE_CLASS:\nno_accepted_human_pick");
});

test("el reporte de fallo sin status HTTP disponible (fallo de invariante, no de red) dice N/A, no null crudo", () => {
  const report = formatFailureReport(fixtureFailureReport({ status: null, expectedStatus: null }));

  expect(report).toContain("HTTP_STATUS:\nN/A");
  expect(report).not.toContain("EXPECTED_STATUS:");
});

test("el reporte de fallo nunca imprime el session id completo, solo una forma truncada", () => {
  const fullSessionId = "11111111-2222-3333-4444-555555555555";
  const report = formatFailureReport(fixtureFailureReport({ sessionId: fullSessionId }));

  expect(report).not.toContain(fullSessionId);
  expect(report).toContain(redactSessionId(fullSessionId));
});

test("el reporte de fallo nunca menciona cookies, tokens de cuenta ni storageState", () => {
  const report = formatFailureReport(fixtureFailureReport()).toLowerCase();

  expect(report).not.toContain("cookie");
  expect(report).not.toContain("storagestate");
  expect(report).not.toContain("account_token");
  expect(report).not.toContain("x-account-token");
});

test("un escenario exitoso imprime PASS con su nombre", () => {
  expect(formatScenarioProgress("SMOKE-01 HEALTH", true)).toBe("SMOKE-01 HEALTH: PASS");
});

test("un escenario fallido imprime FAIL con su nombre, distinguible de PASS", () => {
  expect(formatScenarioProgress("SMOKE-03 RESOLVE_BANS", false)).toBe("SMOKE-03 RESOLVE_BANS: FAIL");
});

test("redactSessionId trunca un id largo y nunca devuelve el valor completo", () => {
  const fullSessionId = "11111111-2222-3333-4444-555555555555";

  const redacted = redactSessionId(fullSessionId);

  expect(redacted).not.toBe(fullSessionId);
  expect(redacted.startsWith("11111111")).toBe(true);
  expect(redacted.length).toBeLessThan(fullSessionId.length);
});

// PART A (release-gate exit code): antes de esto, `smoke` imprimía STAGING_SMOKE_FAIL pero
// terminaba con código 0 -- un gate que nunca puede fallar no es un gate. `runCli` inyecta
// `stagingSmoke`/`authBootstrap` para probar el mapeo resultado -> código de salida sin tocar
// Playwright ni la red real.
function fakeDeps(overrides: Partial<CliDeps> = {}): CliDeps {
  return {
    authBootstrap: async () => 0,
    stagingSmoke: async () => "STAGING_SMOKE_PASS",
    ...overrides,
  };
}

test("CLI exit: smoke con STAGING_SMOKE_PASS -> codigo 0", async () => {
  const exitCode = await runCli(["bun", "staging.ts", "smoke"], fakeDeps({ stagingSmoke: async () => "STAGING_SMOKE_PASS" }));

  expect(exitCode).toBe(0);
});

test("CLI exit: smoke con STAGING_SMOKE_FAIL -> codigo distinto de cero", async () => {
  const exitCode = await runCli(["bun", "staging.ts", "smoke"], fakeDeps({ stagingSmoke: async () => "STAGING_SMOKE_FAIL" }));

  expect(exitCode).not.toBe(0);
});

test("CLI exit: smoke con AUTH_STATE_REQUIRED -> codigo distinto de cero", async () => {
  const exitCode = await runCli(["bun", "staging.ts", "smoke"], fakeDeps({ stagingSmoke: async () => "AUTH_STATE_REQUIRED" }));

  expect(exitCode).not.toBe(0);
});

test("CLI exit: una excepcion inesperada durante smoke -> codigo distinto de cero, nunca lanza", async () => {
  const exitCode = await runCli(
    ["bun", "staging.ts", "smoke"],
    fakeDeps({
      stagingSmoke: async () => {
        throw new Error("unexpected_playwright_crash");
      },
    }),
  );

  expect(exitCode).not.toBe(0);
});

test("CLI exit: auth propaga el codigo de authBootstrap tal cual", async () => {
  const okCode = await runCli(["bun", "staging.ts", "auth"], fakeDeps({ authBootstrap: async () => 0 }));
  const failCode = await runCli(["bun", "staging.ts", "auth"], fakeDeps({ authBootstrap: async () => 1 }));

  expect(okCode).toBe(0);
  expect(failCode).toBe(1);
});

test("CLI exit: comando desconocido -> codigo distinto de cero, nunca lanza fuera de runCli", async () => {
  const exitCode = await runCli(["bun", "staging.ts", "bogus"], fakeDeps());

  expect(exitCode).not.toBe(0);
});

// SMOKE-07 BASIC PROGRESSION (fix): el harness reintentaba la posición 2 en cada transición sin
// mirar si seguía abierta -- una vez que soloPos2() ya la había sellado, eso reproducía 409
// position_already_filled contra staging real. `decideProgressionAction` es la decisión pura
// (sin Page/red) que reemplaza ese hardcode; `progress`/`chooseHero` se prueban con un Page falso
// para probar la orquestación completa, cero red real (mismo criterio que S6/S7).

function fakePage(
  handler: (route: string, init?: { method?: string; body?: unknown }) => { status: number; body: unknown; errorClass: string | null },
): Page {
  return {
    async evaluate(_fn: unknown, arg: unknown) {
      const { route, init } = arg as { route: string; init?: { method?: string; body?: unknown } };
      return handler(route, init);
    },
  } as unknown as Page;
}

test("decideProgressionAction: con la única posición controlada ya asignada, nunca decide otro pick humano", () => {
  const snapshot = {
    view: { status: "PICK_ROUND_2" },
    legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 3 }],
    ownAssignedPositions: [{ assignedPosition: 2 }],
  };

  const decision = decideProgressionAction(snapshot, [2]);

  expect(decision).toEqual({ type: "auto_drive" });
});

test("decideProgressionAction: con una posición controlada legítimamente abierta, decide un pick humano para esa posición", () => {
  const snapshot = {
    view: { status: "PICK_ROUND_1" },
    legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }],
    ownAssignedPositions: [{ assignedPosition: 2 }],
  };

  const decision = decideProgressionAction(snapshot, [2, 5]);

  expect(decision).toEqual({ type: "human_pick", position: 5 });
});

test("decideProgressionAction: status COMPLETE siempre declara completo, nunca intenta otro pick", () => {
  const snapshot = { view: { status: "COMPLETE" }, legalActions: [], ownAssignedPositions: [{ assignedPosition: 2 }] };

  const decision = decideProgressionAction(snapshot, [2]);

  expect(decision).toEqual({ type: "complete" });
});

test("chooseHero: un rechazo estructural (position_already_filled) corta en el primer intento, no prueba todo el catálogo", async () => {
  let commandAttempts = 0;
  const page = fakePage((route) => {
    if (route === "/engine/api/heroes") {
      return { status: 200, body: [{ id: 1 }, { id: 2 }, { id: 3 }], errorClass: null };
    }
    if (route.endsWith("/command")) {
      commandAttempts += 1;
      return { status: 409, body: { error: "position_already_filled" }, errorClass: "position_already_filled" };
    }
    return {
      status: 200,
      body: { view: { bannedHeroes: [] }, legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }] },
      errorClass: null,
    };
  });

  await expect(chooseHero(page, "session-1", 2)).rejects.toThrow("hero_submit_structural_position_already_filled");
  expect(commandAttempts).toBe(1);
});

test("chooseHero: un rechazo específico de un héroe (kernel_rejected, 202) sigue probando el resto del catálogo", async () => {
  const attempted: number[] = [];
  const page = fakePage((route, init) => {
    if (route === "/engine/api/heroes") {
      return { status: 200, body: [{ id: 1 }, { id: 2 }, { id: 3 }], errorClass: null };
    }
    if (route.endsWith("/command")) {
      const body = init?.body as { command?: { heroId?: number } } | undefined;
      const heroId = body?.command?.heroId ?? -1;
      attempted.push(heroId);
      if (heroId === 1) {
        return { status: 202, body: { accepted: false, rejected: "HERO_ALREADY_TAKEN", view: { bannedHeroes: [] }, legalActions: [] }, errorClass: null };
      }
      return {
        status: 202,
        body: { accepted: true, view: { bannedHeroes: [] }, legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }] },
        errorClass: null,
      };
    }
    return {
      status: 200,
      body: { view: { bannedHeroes: [] }, legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }] },
      errorClass: null,
    };
  });

  const result = await chooseHero(page, "session-1", 2);

  expect(attempted).toEqual([1, 2]);
  expect(result).toEqual({
    accepted: true,
    view: { bannedHeroes: [] },
    legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }],
  });
});

test("progress: con Pos2 ya asignada nunca reintenta el pick (aunque el comando fallaría con 409) y llega a COMPLETE -- deja correr SMOKE-06 PARTY2 después", async () => {
  let commandCalls = 0;
  let getCalls = 0;
  const page = fakePage((route) => {
    if (route.endsWith("/command")) {
      commandCalls += 1;
      return { status: 409, body: { error: "position_already_filled" }, errorClass: "position_already_filled" };
    }
    if (route.endsWith("/auto-drive")) {
      return { status: 200, body: { view: { status: "PICK_ROUND_3", bannedHeroes: [] }, legalActions: [] }, errorClass: null };
    }
    getCalls += 1;
    // Cada llamada de progress() a este GET es una transición: sólo hace falta que el estado
    // cambie de una a la siguiente para que el guard `progression_freeze` no interfiera (a
    // diferencia del siguiente test, aquí chooseHero() nunca se invoca, así que sólo el propio
    // loop de progress() consume `getCalls`).
    const status = getCalls >= 2 ? "COMPLETE" : "PICK_ROUND_2";
    return {
      status: 200,
      body: { view: { status, bannedHeroes: [] }, legalActions: [], ownAssignedPositions: [{ assignedPosition: 2 }] },
      errorClass: null,
    };
  });

  await progress(page, "session-1", [2]);

  expect(commandCalls).toBe(0);
});

test("progress: con Pos5 aún abierta sí ejecuta un pick humano para esa posición", async () => {
  let filled = [2];
  let commandCalls = 0;
  let getCalls = 0;
  const page = fakePage((route) => {
    if (route === "/engine/api/heroes") return { status: 200, body: [{ id: 101 }], errorClass: null };
    if (route.endsWith("/command")) {
      commandCalls += 1;
      filled = [2, 5];
      return { status: 202, body: { accepted: true, view: { status: "PICK_ROUND_3", bannedHeroes: [] }, legalActions: [] }, errorClass: null };
    }
    if (route.endsWith("/auto-drive")) {
      return { status: 200, body: { view: { status: "PICK_ROUND_3", bannedHeroes: [] }, legalActions: [] }, errorClass: null };
    }
    getCalls += 1;
    const status = getCalls >= 3 ? "COMPLETE" : "PICK_ROUND_2";
    return {
      status: 200,
      body: {
        view: { status, bannedHeroes: [] },
        legalActions: [{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }],
        ownAssignedPositions: filled.map((position) => ({ assignedPosition: position })),
      },
      errorClass: null,
    };
  });

  await progress(page, "session-1", [2, 5]);

  expect(commandCalls).toBe(1);
  expect(filled).toEqual([2, 5]);
});
