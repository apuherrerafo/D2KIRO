import { createGsiRelayHandler } from "../../gsi/[liveId]/route";

// Local visual capture -- the second public door of live capture. The D2KIRO helper on the Player's PC reads
// hero portraits from the Dota window and POSTs only derived facts (hero id, side, pick/ban, health) here.
// Identical trust model to the GSI relay: this route only bounds the request and forwards it to the engine on
// 127.0.0.1, which authenticates the link token, owns the session and validates the envelope. It never logs,
// parses, stores or echoes the body. No screenshot is ever accepted: the cap is a few KB.
// The one thing it answers is the draft lifecycle GSI decided (phase + draft counter, rebuilt field by field),
// so the helper -- left running from before the queue -- re-arms by itself on each new hero-selection screen.

export const dynamic = "force-dynamic";

/** One draft-event/v1 envelope is a few hundred bytes. Mirrors the engine's VISUAL_MAX_BODY_BYTES. */
export const VISUAL_RELAY_MAX_BYTES = 4 * 1024;

/** Mirror of the engine's LiveVisualAck (live-capture-registry.ts). */
export interface VisualAck {
  schema: "live-visual-ack/v1";
  draftPhase: "waiting" | "hero_selection" | "ended";
  draftEpoch: number;
}

const DRAFT_PHASES = new Set(["waiting", "hero_selection", "ended"]);

/** Rebuilds the ack from the engine's answer, or null: nothing else the engine says is forwarded. */
export function visualAckOf(value: unknown): VisualAck | null {
  if (typeof value !== "object" || value === null) return null;
  const { schema, draftPhase, draftEpoch } = value as Record<string, unknown>;
  if (schema !== "live-visual-ack/v1" || typeof draftPhase !== "string" || !DRAFT_PHASES.has(draftPhase)) return null;
  if (typeof draftEpoch !== "number" || !Number.isSafeInteger(draftEpoch) || draftEpoch < 0) return null;
  return { schema, draftPhase: draftPhase as VisualAck["draftPhase"], draftEpoch };
}

const relay = createGsiRelayHandler({
  engineUrl: () => process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000",
  enginePath: "/api/live/visual/",
  maxBytes: VISUAL_RELAY_MAX_BYTES,
  answerOf: visualAckOf,
  fetch: (input, init) => fetch(input, init),
});

export async function POST(request: Request, context: { params: Promise<{ liveId: string }> }) {
  const { liveId } = await context.params;
  return relay(request, liveId);
}
