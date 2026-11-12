import { feedbackHandlers } from "@/lib/feedback-wiring";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string; n: string }> }) {
  const { id, n } = await context.params;
  return feedbackHandlers().IMAGE(id, n);
}
