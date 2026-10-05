import { overwolfRelay } from "@/lib/overwolf-relay";

// Overwolf automatic capture: the public hero catalog (name -> id) for the paired adapter.
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ captureId: string }> }) {
  const { captureId } = await context.params;
  return overwolfRelay.heroes(request, captureId);
}
