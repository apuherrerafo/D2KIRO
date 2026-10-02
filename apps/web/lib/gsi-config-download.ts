import { NextResponse } from "next/server";
import { mintAccountToken } from "@/lib/account-token";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { buildGsiConfig, GSI_CFG_FILENAME, gsiIngestUri } from "@/lib/gsi-config";
import { getSession, renewSessionIfNeeded } from "@/lib/session";

// TSK-219 -- the personal Dota GSI download, shared by its two forms on /live-draft: the raw cfg
// (app/api/live/gsi-config, manual install) and the Windows installer that carries it
// (app/api/live/gsi-installer). Both are a same-origin form POST:
//   session (server side) -> engine issues a fresh link (revoking the previous one) -> the file.
// The link token travels engine -> this server -> the downloaded file. No page script asks for it, the
// browser proxy allowlist does not include the issue route, and nothing here logs it. (A script running
// on this origin could POST here like the form does -- that is no more than what such a script can
// already do as the signed-in user.)
// Failures redirect back to /live-draft with a short reason code the page explains in plain words.

export type GsiConfigFailure = "session" | "origin" | "unavailable";

export interface GsiConfigDependencies {
  getSession: () => Promise<Awaited<ReturnType<typeof getSession>>>;
  renewSession: (session: Awaited<ReturnType<typeof getSession>>) => Promise<boolean>;
  canonicalOrigin: () => string | null;
  secret: () => string | undefined;
  engineUrl: () => string;
  mint: (accountId: number, secret: string) => string;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
}

/** What the download hands over: the cfg itself, or a file that wraps it. */
export interface GsiDownloadArtifact {
  filename: string;
  render(cfg: string): string;
}

export const GSI_CFG_ARTIFACT: GsiDownloadArtifact = Object.freeze({
  filename: GSI_CFG_FILENAME,
  render: (cfg: string) => cfg,
});

interface IssuedLink {
  liveId: string;
  token: string;
}

function isIssuedLink(value: unknown): value is IssuedLink {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.liveId === "string" && typeof record.token === "string";
}

export function createGsiConfigHandler(dependencies: GsiConfigDependencies, artifact: GsiDownloadArtifact = GSI_CFG_ARTIFACT) {
  function back(origin: string | null, failure: GsiConfigFailure): Response {
    if (origin === null) return new NextResponse(null, { status: 503 });
    return NextResponse.redirect(new URL(`/live-draft?setup=${failure}`, origin), 303);
  }

  return async (request: Pick<Request, "headers">): Promise<Response> => {
    const origin = dependencies.canonicalOrigin();
    // CSRF: the session cookie is SameSite=lax (never sent on a cross-site POST); the Origin check is the
    // second lock -- a rotation must come from this site's own page.
    if (origin === null || request.headers.get("origin") !== new URL(origin).origin) return back(origin, "origin");
    const secret = dependencies.secret();
    if (!secret || secret.length < 32) return back(origin, "unavailable");
    const session = await dependencies.getSession();
    if (!await dependencies.renewSession(session)) return back(origin, "session");

    try {
      const response = await dependencies.fetch(`${dependencies.engineUrl()}/api/live/gsi-link/issue`, {
        method: "POST",
        headers: { "x-account-token": dependencies.mint(session.accountId, secret) },
        cache: "no-store",
      });
      const issued: unknown = response.ok ? await response.json() : null;
      if (!isIssuedLink(issued)) return back(origin, "unavailable");
      const uri = gsiIngestUri(origin, issued.liveId);
      if (uri === null) return back(origin, "unavailable");
      return new NextResponse(artifact.render(buildGsiConfig(uri, issued.token)), {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          "content-disposition": `attachment; filename="${artifact.filename}"`,
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    } catch {
      return back(origin, "unavailable");
    }
  };
}

export function productionGsiConfigDependencies(): GsiConfigDependencies {
  return {
    getSession: () => getSession(),
    renewSession: renewSessionIfNeeded,
    canonicalOrigin: getCanonicalOrigin,
    secret: () => process.env.INTERNAL_AUTH_SECRET,
    engineUrl: () => process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000",
    mint: (accountId, secret) => mintAccountToken(accountId, secret),
    fetch: (input, init) => fetch(input, init),
  };
}
