// Writes the GENERIC D2KIRO Companion installer (no credential inside) to scripts/live/companion/out/ (gitignored).
//
//   bun scripts/live/companion/build-installer.ts
//
// The generic installer pairs with the D2KIRO cfg already installed in Dota (the one the site's «Descargar
// instalador para Windows» puts there) -- so it works against the currently deployed site with no server change.
// The personal installer (link embedded, self-deleting) is what /live-draft serves once this branch is deployed.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildWindowsCompanionInstaller, COMPANION_INSTALLER_FILENAME } from "../../../apps/web/server/companion/companion-installer";

const outDir = join(import.meta.dir, "out");
mkdirSync(outDir, { recursive: true });
const target = join(outDir, COMPANION_INSTALLER_FILENAME);
writeFileSync(target, buildWindowsCompanionInstaller(null));
console.log(target);
