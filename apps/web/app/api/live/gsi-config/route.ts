import { createGsiConfigHandler, productionGsiConfigDependencies } from "@/lib/gsi-config-download";

// TSK-219 -- "Instalarlo a mano": the raw gamestate_integration_d2kiro.cfg. Same-origin form POST from
// /live-draft; the shared flow (session -> fresh link -> file) and its locks live in lib/gsi-config-download.

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return createGsiConfigHandler(productionGsiConfigDependencies())(request);
}
