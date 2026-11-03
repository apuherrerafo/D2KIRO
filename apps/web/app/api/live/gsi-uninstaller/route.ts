import { NextResponse } from "next/server";
import { buildWindowsGsiUninstaller, GSI_WINDOWS_UNINSTALLER_FILENAME } from "@/lib/gsi-windows-installer";

// "Quitar D2KIRO de Dota": a double-click file that removes only gamestate_integration_d2kiro.cfg. It
// carries no credential and changes nothing on the server, so a plain GET (behind the site session, like
// every page) is enough. Cutting the link itself is "Desconectar Dota" on /live-draft.

export const dynamic = "force-dynamic";

export function GET() {
  return new NextResponse(buildWindowsGsiUninstaller(), {
    status: 200,
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${GSI_WINDOWS_UNINSTALLER_FILENAME}"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
