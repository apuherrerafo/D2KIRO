import { feedbackAdminHandlers } from "@/lib/feedback-wiring";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return feedbackAdminHandlers().GET(request);
}

export async function POST(request: Request) {
  return feedbackAdminHandlers().POST(request);
}
