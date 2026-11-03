import { createGsiRelayHandler } from "../../gsi/[liveId]/route";

// D2KIRO Companion heartbeat -- the third public door of live capture. The Companion (the Player's local
// background app that relays Dota GSI) says "I am here, Dota is <state>, phase <phase>" every 15 s, so the page
// can show the Companion as connected even while Dota is closed. Identical trust model to the GSI relay: this
// route only bounds the request and forwards it to the engine on 127.0.0.1, which authenticates the link token,
// owns the session and validates the heartbeat field by field. It never logs, parses, stores or echoes the body.

export const dynamic = "force-dynamic";

/** One heartbeat is ~250 bytes. Mirrors the engine's COMPANION_MAX_BODY_BYTES. */
export const COMPANION_RELAY_MAX_BYTES = 1024;

const relay = createGsiRelayHandler({
  engineUrl: () => process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000",
  enginePath: "/api/live/companion/",
  maxBytes: COMPANION_RELAY_MAX_BYTES,
  fetch: (input, init) => fetch(input, init),
});

export async function POST(request: Request, context: { params: Promise<{ liveId: string }> }) {
  const { liveId } = await context.params;
  return relay(request, liveId);
}
