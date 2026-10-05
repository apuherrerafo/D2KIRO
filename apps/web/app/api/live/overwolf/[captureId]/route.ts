import { overwolfRelay } from "@/lib/overwolf-relay";

// Overwolf automatic capture: one batch of draft facts from the paired adapter (header x-capture-credential).
// Public in proxy.ts; the engine verifies the credential (see lib/overwolf-relay.ts).
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ captureId: string }> }) {
  const { captureId } = await context.params;
  return overwolfRelay.batch(request, captureId);
}
