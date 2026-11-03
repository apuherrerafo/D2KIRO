import { describe, expect, test } from "bun:test";
import {
  CAPTURE_NOT_ENABLED,
  HERO_SELECTION,
  buildHeroNameIndex,
  createCaptureState,
  createEnvelopeFactory,
  handleInfoUpdate,
  handleNewEvents,
  hasGameStateIntegration,
  healthPayload,
  parseCaptureConfig,
  roleToPosition,
  setDotaRunning,
  setGsiStatus,
} from "./capture-core.js";

// Overwolf adapter core: pure, no `overwolf.*`. Payload shapes follow the official Dota 2 GEP docs
// (players with team/team_slot/role/heroId|hero/pickConfirmed; bans/draft with heroId + team, ids as
// numbers OR numeric strings).

type Payload = { type: string; hero?: number; side?: string; position?: number; format?: string; patch?: string; status?: string; detail?: string; reason?: string };

const CATALOG = buildHeroNameIndex([
  { id: 93, name: "npc_dota_hero_slark", localizedName: "Slark" },
  { id: 129, name: "npc_dota_hero_mars", localizedName: "Mars" },
  { id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage" },
]);
const ctx = { heroIdByName: CATALOG };

function matchState(value: string) {
  return { events: [{ name: "match_state_changed", data: JSON.stringify({ match_state: value }) }] };
}
function players(list: unknown[]) {
  return { feature: "roster", info: { roster: { players: JSON.stringify(list) } } };
}
function bans(list: unknown[]) {
  return { feature: "roster", info: { roster: { bans: JSON.stringify(list) } } };
}

/** A capture already in hero selection, GSI enabled, local side radiant. */
function started() {
  const state = createCaptureState();
  setDotaRunning(state, true);
  setGsiStatus(state, true, ctx);
  const opening = [
    ...handleInfoUpdate(state, { feature: "me", info: { me: { team: "radiant" } } }, ctx),
    ...handleNewEvents(state, matchState(HERO_SELECTION), ctx),
  ] as Payload[];
  return { state, opening };
}

describe("session start + side", () => {
  test("HERO_SELECTION emite session_started all_pick 7.41e UNA vez, y el lado local", () => {
    const { state, opening } = started();
    expect(opening).toEqual([
      { type: "session_started", format: "all_pick", patch: "7.41e" },
      { type: "local_side_identified", side: "radiant" },
    ]);
    expect(handleNewEvents(state, matchState(HERO_SELECTION), ctx)).toEqual([]);
  });

  test("11. side detection: me.team dire -> local_side_identified dire", () => {
    const state = createCaptureState();
    setGsiStatus(state, true, ctx);
    handleNewEvents(state, matchState(HERO_SELECTION), ctx);
    expect(handleInfoUpdate(state, { feature: "me", info: { me: { team: "dire" } } }, ctx)).toEqual([{ type: "local_side_identified", side: "dire" }]);
  });

  test("nada de draft se emite antes de la selección de héroes", () => {
    const state = createCaptureState();
    setGsiStatus(state, true, ctx);
    expect(handleInfoUpdate(state, bans([{ heroId: "75", team: "0" }]), ctx)).toEqual([]);
    expect(handleNewEvents(state, matchState(HERO_SELECTION), ctx)).toEqual([
      { type: "session_started", format: "all_pick", patch: "7.41e" },
      { type: "hero_banned", hero: 75, side: "unknown" },
    ]);
  });
});

describe("bans", () => {
  test("9. diff de bans: sólo heroId nuevos, no cero, ids string o número", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, bans([{ heroId: "75", team: "0" }, { heroId: "14", team: "0" }]), ctx)).toEqual([
      { type: "hero_banned", hero: 75, side: "unknown" },
      { type: "hero_banned", hero: 14, side: "unknown" },
    ]);
    expect(handleInfoUpdate(state, bans([{ heroId: "75", team: "0" }, { heroId: "14", team: "0" }, { heroId: 0, team: 2 }, { heroId: 22, team: 3 }]), ctx)).toEqual([
      { type: "hero_banned", hero: 22, side: "dire" },
    ]);
  });
});

describe("picks", () => {
  test("10. diff de picks: asiento nuevo -> hero_picked con la posición propia mapeada desde role", () => {
    const { state } = started();
    const out = handleInfoUpdate(state, players([
      { steamId: "1", team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true },
      { steamId: "2", team: 2, team_slot: 1, role: 16, heroId: 0 },
      { steamId: "6", team: 3, team_slot: 0, role: 1, heroId: 0 },
    ]), ctx);
    expect(out).toEqual([{ type: "hero_picked", hero: 129, side: "radiant", position: 3 }]);
  });

  test("nombre de héroe (formato `hero: \"slark\"` de la doc oficial) se resuelve contra el catálogo", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([{ steamId: "8", team: 3, team_slot: 3, role: 1, hero: "slark", pickConfirmed: true }]), ctx)).toEqual([
      { type: "hero_picked", hero: 93, side: "dire" },
    ]);
  });

  test("8. el mismo roster update dos veces (y reordenado) no produce un segundo hero_picked", () => {
    const { state } = started();
    const roster = [
      { team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true },
      { team: 2, team_slot: 4, role: 1, heroId: 1, pickConfirmed: true },
    ];
    expect(handleInfoUpdate(state, players(roster), ctx)).toHaveLength(2);
    expect(handleInfoUpdate(state, players(roster), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, players([...roster].reverse()), ctx)).toEqual([]);
  });

  test("hover sin confirmar (pickConfirmed:false) no es un pick", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: false }]), ctx)).toEqual([]);
  });

  test("12. mismo asiento, otro héroe confirmado durante la selección -> pick_reverted + hero_picked", () => {
    const { state } = started();
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 1, pickConfirmed: true }]), ctx)).toEqual([
      { type: "pick_reverted", hero: 129, side: "radiant" },
      { type: "hero_picked", hero: 1, side: "radiant", position: 3 },
    ]);
  });

  test("un cambio en el mismo asiento DESPUÉS de la selección no inventa un revert", () => {
    const { state } = started();
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_STRATEGY_TIME"), ctx);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 0 }]), ctx)).toEqual([]);
  });

  test("13. héroe cero / desconocido se ignora", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, players([
      { team: 2, team_slot: 0, role: 2, heroId: 0, pickConfirmed: true },
      { team: 2, team_slot: 1, role: 4, hero: "not_a_hero", pickConfirmed: true },
      { team: 2, team_slot: 2, role: 4, heroId: "abc", pickConfirmed: true },
      { team: 0, team_slot: 3, role: 4, heroId: 5, pickConfirmed: true },
    ]), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, bans([{ heroId: 0, team: 0 }, { heroId: "", team: 0 }]), ctx)).toEqual([]);
  });

  test("roster.draft sin asiento -> hero_picked; luego el asiento sólo completa la posición, nunca duplica", () => {
    const { state } = started();
    expect(handleInfoUpdate(state, { info: { roster: { draft: JSON.stringify([{ heroId: 129, team: 2 }, { heroId: 93, team: 3 }]) } } }, ctx)).toEqual([
      { type: "hero_picked", hero: 129, side: "radiant" },
      { type: "hero_picked", hero: 93, side: "dire" },
    ]);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 2, role: 2, heroId: 129, pickConfirmed: true }]), ctx)).toEqual([
      { type: "hero_picked", hero: 129, side: "radiant", position: 3 },
    ]);
    expect(handleInfoUpdate(state, players([{ team: 3, team_slot: 0, role: 1, heroId: 93, pickConfirmed: true }]), ctx)).toEqual([]);
  });

  test("role -> posición: 1 Safelane=1, 4 Mid=2, 2 Offlane=3, 8 Other=4, 16 HardSupport=5", () => {
    expect([1, 4, 2, 8, 16, 0, 3].map(roleToPosition)).toEqual([1, 2, 3, 4, 5, null, null]);
  });
});

describe("14. -gamestateintegration", () => {
  test("detecta la opción en ProcessCommandLine", () => {
    expect(hasGameStateIntegration({ gameInfo: { GameInfo: { ProcessCommandLine: "\"dota2.exe\" -novid -gamestateintegration" } } })).toBe(true);
    expect(hasGameStateIntegration({ gameInfo: { GameInfo: { ProcessCommandLine: "\"dota2.exe\" -novid" } } })).toBe(false);
    expect(hasGameStateIntegration({ success: true })).toBeNull();
  });

  test("sin la opción: warning DOTA_CAPTURE_NOT_ENABLED y CERO eventos de draft, aunque lleguen datos", () => {
    const state = createCaptureState();
    setDotaRunning(state, true);
    expect(setGsiStatus(state, false, ctx)).toEqual([{ type: "capture_health", status: "degraded", detail: CAPTURE_NOT_ENABLED }]);
    expect(handleNewEvents(state, matchState(HERO_SELECTION), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx)).toEqual([]);
    expect(handleInfoUpdate(state, bans([{ heroId: 75, team: 0 }]), ctx)).toEqual([]);
    expect(healthPayload(state)).toEqual({ type: "capture_health", status: "degraded", detail: CAPTURE_NOT_ENABLED });
  });

  test("al habilitarla, la captura se pone al día desde el último snapshot", () => {
    const state = createCaptureState();
    setDotaRunning(state, true);
    setGsiStatus(state, false, ctx);
    handleNewEvents(state, matchState(HERO_SELECTION), ctx);
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    const out = setGsiStatus(state, true, ctx) as Payload[];
    expect(out.map((payload) => payload.type)).toEqual(["capture_health", "session_started", "hero_picked"]);
  });
});

describe("match lifecycle", () => {
  test("POST_GAME emite session_ended; una nueva selección arranca otra partida", () => {
    const { state } = started();
    handleInfoUpdate(state, players([{ team: 2, team_slot: 0, role: 2, heroId: 129, pickConfirmed: true }]), ctx);
    expect(handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_POST_GAME"), ctx)).toEqual([{ type: "session_ended", reason: "completed" }]);
    const next = handleNewEvents(state, matchState(HERO_SELECTION), ctx) as Payload[];
    expect(next[0]).toEqual({ type: "session_started", format: "all_pick", patch: "7.41e" });
  });
});

describe("config + envelopes", () => {
  test("config local: sólo 127.0.0.1, sessionId válido, token presente", () => {
    expect(parseCaptureConfig({ engineUrl: "http://127.0.0.1:4000", sessionId: "11111111-2222-3333-4444-555555555555", captureToken: "x".repeat(32) })).not.toBeNull();
    expect(parseCaptureConfig({ engineUrl: "http://0.0.0.0:4000", sessionId: "11111111-2222", captureToken: "x".repeat(32) })).toBeNull();
    expect(parseCaptureConfig({ engineUrl: "https://evil.example", sessionId: "11111111-2222", captureToken: "x".repeat(32) })).toBeNull();
    expect(parseCaptureConfig({ engineUrl: "http://127.0.0.1:4000", sessionId: "../../etc", captureToken: "x".repeat(32) })).toBeNull();
    expect(parseCaptureConfig({ engineUrl: "http://127.0.0.1:4000", sessionId: "11111111-2222", captureToken: "" })).toBeNull();
  });

  test("envelope draft-event/v1, source overwolf, eventId y seq únicos", () => {
    const make = createEnvelopeFactory({ sessionId: "s-123456789", runId: "abc", now: () => 0 });
    const a = make({ type: "hero_banned", hero: 1, side: "unknown" });
    const b = make({ type: "hero_banned", hero: 2, side: "unknown" });
    expect(a).toMatchObject({ schema: "draft-event/v1", sessionId: "s-123456789", source: "overwolf", confidence: 1, seq: 1, eventId: "ow-abc-1" });
    expect(b.eventId).not.toBe(a.eventId);
  });
});
