import { feedbackHandlers } from "@/lib/feedback-wiring";

export const dynamic = "force-dynamic";

export async function GET() {
  return feedbackHandlers().GET();
}

export async function POST(request: Request) {
  return feedbackHandlers().POST(request);
}
