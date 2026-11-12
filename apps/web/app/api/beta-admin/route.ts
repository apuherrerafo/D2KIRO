import { createBetaAdminHandlers } from "@/lib/beta-admin-handler";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { getSession, renewSessionIfNeeded } from "@/lib/session";

export const dynamic = "force-dynamic";

function handlers() {
  return createBetaAdminHandlers({
    accountId: async () => {
      const session = await getSession();
      return (await renewSessionIfNeeded(session)) ? session.accountId : null;
    },
    env: process.env,
    publicOrigin: getCanonicalOrigin(),
    now: Date.now,
  });
}

export async function GET() {
  return handlers().GET();
}

export async function POST(request: Request) {
  return handlers().POST(request);
}
