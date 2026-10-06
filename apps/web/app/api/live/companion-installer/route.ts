import { createGsiConfigHandler, productionGsiConfigDependencies, type GsiDownloadArtifact } from "@/lib/gsi-config-download";
import { buildWindowsCompanionInstaller, COMPANION_INSTALLER_FILENAME } from "@/server/companion/companion-installer";

// "Instalar D2KIRO Companion": the Player's personal link (the same one /api/live/gsi-config hands out) inside the
// one-time Companion installer (server/companion). Same-origin form POST from /live-draft, same locks: session,
// Origin check, a fresh link that revokes the previous one, never logged, never cached.

export const dynamic = "force-dynamic";

export const COMPANION_INSTALLER_ARTIFACT: GsiDownloadArtifact = Object.freeze({
  filename: COMPANION_INSTALLER_FILENAME,
  render: (cfg: string) => buildWindowsCompanionInstaller(cfg),
});

export async function POST(request: Request) {
  return createGsiConfigHandler(productionGsiConfigDependencies(), COMPANION_INSTALLER_ARTIFACT)(request);
}
