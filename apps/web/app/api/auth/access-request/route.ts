import { readAccessRequestNotice } from "@/lib/access-request-session";
import { createAccessRequestHandlers } from "@/lib/access-request-handler";
import { isAccountAllowedNow } from "@/lib/beta-access";
import { getCanonicalOrigin } from "@/lib/canonical-origin";

export const dynamic = "force-dynamic";

// Puerta pública (cuelga de /api/auth/, como el login): la identidad no viene de una sesión sino de la cookie sellada que dejó
// el callback de Steam. Sin esa cookie responde 401.
function handlers() {
  return createAccessRequestHandlers({
    readNotice: readAccessRequestNotice,
    env: process.env,
    publicOrigin: getCanonicalOrigin(),
    now: Date.now,
    isAllowedNow: (accountId) => isAccountAllowedNow(accountId, process.env),
  });
}

export async function GET() {
  return handlers().GET();
}

export async function POST(request: Request) {
  return handlers().POST(request);
}
