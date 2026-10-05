import { describe, expect, test } from "bun:test";
import { LiveCaptureRegistry } from "../../../apps/engine/src/live/live-capture-registry";
import { ProtocolSessionStore } from "../../../apps/engine/src/server/protocol-session";
import { parseCaptureBatch } from "../../../apps/engine/src/server/routes/live-overwolf";
import {
  HERO_SELECTION,
  buildBatch,
  capturePresence,
  createCaptureState,
  createCloudEventFactory,
  handleInfoUpdate,
  handleNewEvents,
  setDotaRunning,
  setGsiStatus,
} from "./capture-core.js";

// Adapter <-> engine CONTRACT: what the real adapter core emits is exactly what the engine's batch boundary
// accepts and what the real live registry turns into a 10-hero draft. Fully synthetic GEP payloads, no network.
// (The engine's own boundary tests live in apps/engine/src/server/routes/live-overwolf.test.ts.)

const T0 = 1_790_000_000_000;
const RADIANT = [129, 93, 1, 11, 14];
const DIRE = [2, 3, 4, 5, 6];

function gep(update: unknown) {
  return update as { info: Record<string, unknown> };
}
function matchState(value: string) {
  return { events: [{ name: "match_state_changed", data: JSON.stringify({ match_state: value }) }] };
}
function seats(radiant: number[], dire: number[]) {
  const roles = [1, 4, 2, 8, 16];
  return JSON.stringify([
    ...radiant.map((heroId, slot) => ({ steamId: "SENTINEL", name: "SENTINEL", heroId, team: 2, team_slot: slot, role: roles[slot], pickConfirmed: true })),
    ...dire.map((heroId, slot) => ({ steamId: "SENTINEL", name: "SENTINEL", heroId, team: 3, team_slot: slot, role: roles[slot], pickConfirmed: true })),
  ]);
}

describe("adapter output -> engine", () => {
  test("every batch the adapter builds passes the engine boundary, and the registry ends with 10 heroes + bans", () => {
    const state = createCaptureState();
    setDotaRunning(state, true);
    setGsiStatus(state, true, {});
    const make = createCloudEventFactory({ runId: "contract", now: () => T0 });
    const payloads: unknown[] = [];
    payloads.push(...handleInfoUpdate(state, gep({ info: { me: { team: "radiant" } } }), {}));
    payloads.push(...handleNewEvents(state, matchState(HERO_SELECTION), {}));
    payloads.push(...handleInfoUpdate(state, gep({ info: { roster: { bans: JSON.stringify([{ heroId: "75", team: 2 }, { heroId: 22, team: 3 }]) } } }), {}));
    payloads.push(...handleInfoUpdate(state, gep({ info: { roster: { players: seats(RADIANT.slice(0, 2), DIRE.slice(0, 2)) } } }), {}));
    payloads.push(...handleInfoUpdate(state, gep({ info: { roster: { players: seats(RADIANT, DIRE) } } }), {}));
    payloads.push(...handleInfoUpdate(state, gep({ info: { roster: { players: seats(RADIANT, DIRE) } } }), {}));
    payloads.push(...handleNewEvents(state, matchState("DOTA_GAMERULES_STATE_GAME_IN_PROGRESS"), {}));

    const events = (payloads as { type: string }[]).map((payload) => make(payload));
    const batch = buildBatch(events, capturePresence(state));
    const parsed = parseCaptureBatch(JSON.parse(JSON.stringify(batch)));
    expect(parsed).not.toBeNull();
    expect(parsed!.events).toHaveLength(events.length);
    expect(parsed!.presence).toEqual({ roster: true, bans: true, draft: false, players: true });

    const store = new ProtocolSessionStore();
    const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => T0 });
    expect(registry.ensureSession("contract-session-1", 101)).toBe(true);
    const outcome = registry.ingestOverwolf("contract-session-1", 101, parsed!.events, parsed!.presence);
    expect(outcome.accepted).toBe(true);
    const status = registry.status("contract-session-1")!;
    expect(status).toMatchObject({ draftPhase: "hero_selection", localSide: "radiant", bans: 2, picks: 10 });
    expect(status.overwolf).toMatchObject({ connected: true, players: true, authoritative: true });
    // The same batch delivered again (a retry) changes nothing.
    registry.ingestOverwolf("contract-session-1", 101, parsed!.events, parsed!.presence);
    expect(registry.status("contract-session-1")).toMatchObject({ bans: 2, picks: 10 });
    expect(JSON.stringify(batch)).not.toContain("SENTINEL");
  });
});
