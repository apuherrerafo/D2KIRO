import { overwolfRelay } from "@/lib/overwolf-relay";

// Overwolf automatic capture: the adapter exchanges a one-time pairing code for its scoped credential.
// Public in proxy.ts; the engine verifies the code (see lib/overwolf-relay.ts).
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return overwolfRelay.pair(request);
}
