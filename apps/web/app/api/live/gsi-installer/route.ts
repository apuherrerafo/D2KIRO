import { createGsiConfigHandler, productionGsiConfigDependencies, type GsiDownloadArtifact } from "@/lib/gsi-config-download";
import { buildWindowsGsiInstaller, GSI_WINDOWS_INSTALLER_FILENAME } from "@/lib/gsi-windows-installer";

// "Descargar instalador para Windows": the same personal cfg as /api/live/gsi-config, wrapped in a
// double-click installer (lib/gsi-windows-installer). Same-origin form POST from /live-draft, same locks:
// session, Origin check, a fresh link that revokes the previous one, never logged, never cached.

export const dynamic = "force-dynamic";

export const WINDOWS_INSTALLER_ARTIFACT: GsiDownloadArtifact = Object.freeze({
  filename: GSI_WINDOWS_INSTALLER_FILENAME,
  render: buildWindowsGsiInstaller,
});

export async function POST(request: Request) {
  return createGsiConfigHandler(productionGsiConfigDependencies(), WINDOWS_INSTALLER_ARTIFACT)(request);
}
