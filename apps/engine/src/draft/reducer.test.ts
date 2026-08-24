import { describe, expect, test } from "bun:test";
import type { CaptainsModeTurnTable } from "./draft-format-turns";
import {
  applyDraftEvent,
  createIdleDraftState,
  type DraftEvent,
  type DraftEventEnvelope,
  type DraftState,
} from "./reducer";

function envelope(
  seq: number,
  payload: DraftEvent,
  overrides: Partial<DraftEventEnvelope> = {},
): DraftEventEnvelope {
  return {
    schema: "draft-event/v1",
    eventId: `evt-${seq}`,
    sessionId: "session-1",
    seq,
    emittedAt: `2026-07-27T00:00:${String(seq).padStart(2, "0")}Z`,
    source: "simulator",
    confidence: 1,
    payload,
    ...overrides,
  };
}

function idle(sessionId = "session-1"): DraftState {
  return createIdleDraftState(sessionId);
}

function active(sessionId = "session-1"): DraftState {
  const { state } = applyDraftEvent(
    idle(sessionId),
    envelope(1, { type: "session_started", format: "all_pick", patch: "7.36" }, { sessionId }),
  );
  return state;
}

// Tabla sintética minúscula, nunca la real curada en TSK-071 (costura S10, testing-seams.md: ese
// archivo se regenera por parche, un test atado a su contenido exacto se rompería en silencio).
const CM_TABLE: CaptainsModeTurnTable = {
  reserveTimeMs: 60000,
  turns: [
    { action: "ban", team: "first", standardTimeMs: 10000 },
    { action: "ban", team: "second", standardTimeMs: 10000 },
    { action: "pick", team: "first", standardTimeMs: 20000 },
    { action: "pick", team: "second", standardTimeMs: 20000 },
  ],
};

// `source: "manual"` explícito -- el helper `envelope()` por defecto usa "simulator", que
// TSK-072 exime a propósito de la validación de turno (guion artificial del simulador, TSK-016).
function activeCaptainsMode(sessionId = "session-1"): DraftState {
  const { state } = applyDraftEvent(
    idle(sessionId),
    envelope(
      1,
      { type: "session_started", format: "captains_mode", patch: "7.41e" },
      { sessionId, source: "manual", emittedAt: "2026-07-27T00:00:00Z" },
    ),
    { captainsModeTurns: CM_TABLE },
  );
  return state;
}

describe("transiciones de fase", () => {
  test("idle -> active vía session_started", () => {
    const { state, rejected } = applyDraftEvent(
      idle(),
      envelope(1, { type: "session_started", format: "all_pick", patch: "7.36" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.phase).toBe("active");
    expect(state.format).toBe("all_pick");
    expect(state.patch).toBe("7.36");
  });

  test("active -> complete vía session_ended: completed", () => {
    const { state, rejected } = applyDraftEvent(
      active(),
      envelope(2, { type: "session_ended", reason: "completed" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.phase).toBe("complete");
  });

  test("active -> aborted vía session_ended: aborted|lost_capture", () => {
    const aborted = applyDraftEvent(active(), envelope(2, { type: "session_ended", reason: "aborted" }));
    expect(aborted.state.phase).toBe("aborted");

    const lost = applyDraftEvent(active(), envelope(2, { type: "session_ended", reason: "lost_capture" }));
    expect(lost.state.phase).toBe("aborted");
  });

  test("una nueva sessionId en session_started vuelve el estado a idle y arranca de nuevo", () => {
    const stale = active("session-1");
    const { state, rejected } = applyDraftEvent(
      stale,
      envelope(1, { type: "session_started", format: "unknown", patch: "7.36" }, { sessionId: "session-2" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.sessionId).toBe("session-2");
    expect(state.phase).toBe("active");
    expect(state.banned).toEqual([]);
    expect(state.picks).toEqual({ radiant: [], dire: [] });
  });

  test("format: 'unknown' es un estado legítimo, no bloquea la sesión", () => {
    const { state, rejected } = applyDraftEvent(
      idle(),
      envelope(1, { type: "session_started", format: "unknown", patch: "7.36" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.format).toBe("unknown");
    expect(state.phase).toBe("active");
  });

  test("eventos en fase complete se rechazan con wrong_phase", () => {
    const { state: completeState } = applyDraftEvent(
      active(),
      envelope(2, { type: "session_ended", reason: "completed" }),
    );
    const { state, rejected } = applyDraftEvent(
      completeState,
      envelope(3, { type: "hero_picked", hero: 1, side: "radiant" }),
    );
    expect(rejected).toBe("wrong_phase");
    expect(state).toBe(completeState);
  });
});

describe("cada RejectionReason", () => {
  test("duplicate_event: eventId repetido se descarta en silencio", () => {
    const applied = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    const { state, rejected } = applyDraftEvent(
      applied,
      envelope(3, { type: "hero_banned", hero: 2, side: "dire" }, { eventId: "evt-2" }),
    );
    expect(rejected).toBe("duplicate_event");
    expect(state).toBe(applied);
    expect(state.banned).toEqual([1]);
  });

  test("stale_seq: seq <= lastSeq se rechaza, salvo pick_reverted", () => {
    const applied = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    const { state, rejected } = applyDraftEvent(
      applied,
      envelope(2, { type: "hero_banned", hero: 3, side: "dire" }, { eventId: "evt-stale" }),
    );
    expect(rejected).toBe("stale_seq");
    expect(state).toBe(applied);
  });

  test("pick_reverted siempre se evalúa aunque su seq sea menor a lastSeq", () => {
    const banned = applyDraftEvent(
      active(),
      envelope(5, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    expect(banned.lastSeq).toBe(5);

    const { state, rejected } = applyDraftEvent(
      banned,
      envelope(2, { type: "pick_reverted", hero: 1, side: "radiant" }, { eventId: "evt-revert" }),
    );
    expect(rejected).toBeUndefined();
    expect(state.banned).toEqual([]);
    expect(state.lastSeq).toBe(5);
  });

  test("wrong_phase: evento distinto de session_started rechazado en fase idle", () => {
    const before = idle();
    const { state, rejected } = applyDraftEvent(
      before,
      envelope(1, { type: "hero_picked", hero: 1, side: "radiant" }),
    );
    expect(rejected).toBe("wrong_phase");
    expect(state).toBe(before);
  });

  test("unknown_hero: heroId no es un entero positivo", () => {
    const { state, rejected } = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_picked", hero: -1, side: "radiant" }),
    );
    expect(rejected).toBe("unknown_hero");
    expect(state.picks.radiant).toEqual([]);
  });

  test("hero_already_taken: héroe ya baneado no puede ser picked", () => {
    const banned = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
    ).state;
    const { state, rejected } = applyDraftEvent(
      banned,
      envelope(3, { type: "hero_picked", hero: 1, side: "dire" }),
    );
    expect(rejected).toBe("hero_already_taken");
    expect(state).toBe(banned);
  });

  // RCA post-TSK-076: el reductor nunca validó el tamaño del roster -- checkHeroAvailable solo
  // detectaba duplicados. Confirmado con HeroGrid en vivo: se podían pickear más de 5 héroes por
  // lado sin ningún rechazo.
  test("roster_full: un 6to pick para el mismo lado se rechaza, los 5 anteriores quedan intactos", () => {
    let state = active();
    for (const hero of [1, 2, 3, 4, 5]) {
      const result = applyDraftEvent(state, envelope(hero + 1, { type: "hero_picked", hero, side: "radiant" }));
      expect(result.rejected).toBeUndefined();
      state = result.state;
    }
    expect(state.picks.radiant).toEqual([1, 2, 3, 4, 5]);

    const { state: after, rejected } = applyDraftEvent(state, envelope(7, { type: "hero_picked", hero: 6, side: "radiant" }));
    expect(rejected).toBe("roster_full");
    expect(after).toBe(state);
    expect(after.picks.radiant).toEqual([1, 2, 3, 4, 5]);
  });

  test("roster_full es por lado -- 5 picks de radiant no bloquean el primer pick de dire", () => {
    let state = active();
    for (const hero of [1, 2, 3, 4, 5]) {
      state = applyDraftEvent(state, envelope(hero + 1, { type: "hero_picked", hero, side: "radiant" })).state;
    }
    const { state: after, rejected } = applyDraftEvent(state, envelope(7, { type: "hero_picked", hero: 6, side: "dire" }));
    expect(rejected).toBeUndefined();
    expect(after.picks.dire).toEqual([6]);
  });

  test("roster_full no aplica a hero_banned -- el conteo de bans depende de formato, fuera de alcance acá", () => {
    let state = active();
    const bannedHeroes = [1, 2, 3, 4, 5, 6];
    for (const [index, hero] of bannedHeroes.entries()) {
      const result = applyDraftEvent(state, envelope(index + 2, { type: "hero_banned", hero, side: "radiant" }));
      expect(result.rejected).toBeUndefined();
      state = result.state;
    }
    expect(state.banned).toEqual(bannedHeroes);
  });
});

describe("pureza y otros eventos", () => {
  test("misma entrada produce siempre la misma salida", () => {
    const base = active();
    const env = envelope(2, { type: "hero_picked", hero: 1, side: "radiant" });
    const first = applyDraftEvent(base, env);
    const second = applyDraftEvent(base, env);
    expect(first).toEqual(second);
    expect(base.picks.radiant).toEqual([]); // el estado original nunca se muta
  });

  test("local_side_identified actualiza localSide", () => {
    const { state } = applyDraftEvent(active(), envelope(2, { type: "local_side_identified", side: "dire" }));
    expect(state.localSide).toBe("dire");
  });

  test("capture_health actualiza quality.captureStatus", () => {
    const { state } = applyDraftEvent(
      active(),
      envelope(2, { type: "capture_health", status: "degraded", detail: "OCR confidence baja" }),
    );
    expect(state.quality.captureStatus).toBe("degraded");
  });

  test("un evento rechazado nunca corrompe el estado anterior", () => {
    const before = active();
    const { state, rejected } = applyDraftEvent(
      before,
      envelope(2, { type: "hero_picked", hero: 0, side: "radiant" }),
    );
    expect(rejected).toBe("unknown_hero");
    expect(state).toBe(before);
  });
});

describe("quality.unconfirmed (TSK-013 -- confianza < 0.6, SPEC.md línea 127)", () => {
  test("hero_picked con confidence < 0.6 marca el héroe como sin confirmar, pero el evento igual se aplica", () => {
    const { state, rejected } = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_picked", hero: 1, side: "radiant" }, { confidence: 0.4 }),
    );
    expect(rejected).toBeUndefined();
    expect(state.picks.radiant).toEqual([1]);
    expect(state.quality.unconfirmed).toEqual([1]);
  });

  test("hero_banned con confidence >= 0.6 no marca nada", () => {
    const { state } = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "unknown" }, { confidence: 0.6 }),
    );
    expect(state.quality.unconfirmed).toEqual([]);
  });

  test("pick_reverted limpia el héroe de unconfirmed al deshacerlo", () => {
    const unconfirmed = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_picked", hero: 1, side: "radiant" }, { confidence: 0.3 }),
    ).state;
    expect(unconfirmed.quality.unconfirmed).toEqual([1]);

    const { state } = applyDraftEvent(
      unconfirmed,
      envelope(3, { type: "pick_reverted", hero: 1, side: "radiant" }),
    );
    expect(state.picks.radiant).toEqual([]);
    expect(state.quality.unconfirmed).toEqual([]);
  });

  test("el mismo héroe de baja confianza no se duplica en unconfirmed", () => {
    const first = applyDraftEvent(
      active(),
      envelope(2, { type: "hero_banned", hero: 1, side: "unknown" }, { confidence: 0.2 }),
    ).state;
    // Un segundo evento de baja confianza sobre otro héroe no debe duplicar al primero.
    const { state } = applyDraftEvent(
      first,
      envelope(3, { type: "hero_banned", hero: 2, side: "unknown" }, { confidence: 0.2 }),
    );
    expect(state.quality.unconfirmed).toEqual([1, 2]);
  });
});

// TSK-072 (spec §2.2, specs/draft-native-experience.md): la máquina de turnos solo aplica a
// format:"captains_mode" con tabla cargada -- All Pick nunca la usa (spec §2.1: sus bans no son
// por turnos, y sus picks son por rondas simultáneas ocultas, no alternadas -- mecanismo distinto
// que esta fase no construye).
describe("wrong_turn (Captain's Mode, TSK-072)", () => {
  test("el primer ban con lado real bootstrapea firstPickSide y se acepta", () => {
    const { state, rejected } = applyDraftEvent(
      activeCaptainsMode(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBeUndefined();
    expect(state.firstPickSide).toBe("radiant");
    expect(state.banned).toEqual([1]);
  });

  test("el mismo lado que acaba de actuar no puede volver a actuar en el siguiente turno", () => {
    const afterFirstBan = applyDraftEvent(
      activeCaptainsMode(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    ).state;

    const { state, rejected } = applyDraftEvent(
      afterFirstBan,
      envelope(3, { type: "hero_banned", hero: 2, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBe("wrong_turn");
    expect(state).toBe(afterFirstBan);
  });

  test("el lado correcto en el turno correcto se acepta", () => {
    const afterFirstBan = applyDraftEvent(
      activeCaptainsMode(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    ).state;

    const { state, rejected } = applyDraftEvent(
      afterFirstBan,
      envelope(3, { type: "hero_banned", hero: 2, side: "dire" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBeUndefined();
    expect(state.banned).toEqual([1, 2]);
  });

  test("una acción del tipo equivocado (pick en el turno de un ban) se rechaza con wrong_turn aunque el lado sea correcto", () => {
    const { state, rejected } = applyDraftEvent(
      activeCaptainsMode(),
      envelope(2, { type: "hero_picked", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBe("wrong_turn");
    expect(state.picks.radiant).toEqual([]);
  });

  test("pick_reverted nunca se rechaza por wrong_turn, aunque el turno esperado sea de otro lado", () => {
    let state = activeCaptainsMode();
    state = applyDraftEvent(
      state,
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    ).state;
    // Turno actual esperado: dire. Revertir el ban de radiant no es "actuar fuera de turno".
    const { state: reverted, rejected } = applyDraftEvent(
      state,
      envelope(3, { type: "pick_reverted", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBeUndefined();
    expect(reverted.banned).toEqual([]);
  });

  test("source:'simulator' nunca se valida por turno -- el guion del simulador es artificial a propósito", () => {
    // Mismo lado dos veces seguidas -- rechazado si fuera "manual" (ver test de arriba), aceptado
    // acá porque envelope() usa source:"simulator" por defecto.
    const afterFirstBan = applyDraftEvent(
      activeCaptainsMode(),
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }),
      { captainsModeTurns: CM_TABLE },
    ).state;

    const { rejected } = applyDraftEvent(
      afterFirstBan,
      envelope(3, { type: "hero_banned", hero: 2, side: "radiant" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBeUndefined();
  });

  test("format:'all_pick' nunca activa wrong_turn -- ni bans ni picks tienen tabla de turnos (spec §2.1)", () => {
    // Mismo lado pickeando 2 veces seguidas -- inválido en Captain's Mode, legítimo en All Pick
    // (spec: los picks de All Pick son por rondas simultáneas, no por turno alternado).
    const afterOnePick = applyDraftEvent(
      active(), // format: all_pick
      envelope(2, { type: "hero_picked", hero: 1, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    ).state;

    const { rejected } = applyDraftEvent(
      afterOnePick,
      envelope(3, { type: "hero_picked", hero: 2, side: "radiant" }, { source: "manual" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(rejected).toBeUndefined();
  });

  test("la reserva del lado que actuó se descuenta solo por el excedente sobre el tiempo estándar", () => {
    const started = activeCaptainsMode(); // turnStartedAt = emittedAt de session_started (seq 1)
    expect(started.reserveRemainingMs).toEqual({ radiant: 60000, dire: 60000 });

    // CM_TABLE: turno 0 (ban, standardTimeMs: 10000). El ban llega 15s después de arrancado el
    // turno -- 5s de excedente, se descuentan de la reserva de radiant (el lado que actuó).
    const { state } = applyDraftEvent(
      started,
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }, { source: "manual", emittedAt: "2026-07-27T00:00:15Z" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(state.reserveRemainingMs).toEqual({ radiant: 55000, dire: 60000 });
  });

  test("dentro del tiempo estándar, la reserva no se toca", () => {
    const started = activeCaptainsMode();

    const { state } = applyDraftEvent(
      started,
      envelope(2, { type: "hero_banned", hero: 1, side: "radiant" }, { source: "manual", emittedAt: "2026-07-27T00:00:05Z" }),
      { captainsModeTurns: CM_TABLE },
    );
    expect(state.reserveRemainingMs).toEqual({ radiant: 60000, dire: 60000 });
  });
});
