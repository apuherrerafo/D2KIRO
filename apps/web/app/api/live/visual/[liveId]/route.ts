import { createGsiRelayHandler } from "../../gsi/[liveId]/route";

// Local visual capture -- the second public door of live capture. The D2KIRO helper on the Player's PC reads
// hero portraits from the Dota window and POSTs only derived facts (hero id, side, pick/ban, health) here.
// Identical trust model to the GSI relay: this route only bounds the request and forwards it to the engine on
// 127.0.0.1, which authenticates the link token, owns the session and validates the envelope. It never logs,
// parses, stores or echoes the body. No screenshot is ever accepted: the cap is a few KB.

export const dynamic = "force-dynamic";

/** One draft-event/v1 envelope is a few hundred bytes. Mirrors the engine's VISUAL_MAX_BODY_BYTES. */
export const VISUAL_RELAY_MAX_BYTES = 4 * 1024;

const relay = createGsiRelayHandler({
  engineUrl: () => process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000",
  enginePath: "/api/live/visual/",
  maxBytes: VISUAL_RELAY_MAX_BYTES,
  fetch: (input, init) => fetch(input, init),
});

export async function POST(request: Request, context: { params: Promise<{ liveId: string }> }) {
  const { liveId } = await context.params;
  return relay(request, liveId);
}
