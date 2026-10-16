// Writes the Companion runtime of the LOCAL release candidate "visual 0.1.3-rc1" to scripts/live/rc/out/companion.ps1
// (gitignored). Not a release: no tag, no staging pin, nothing deployed.
//
//   bun scripts/live/rc/build-rc1.ts
//
// The runtime is this branch's COMPANION_RUNTIME_PS (draft-window raw store, on-disk redaction) with ONE difference:
// the supervised visual build is 0.1.3-rc1, which install-rc1.ps1 places in Companion\visual\0.1.3-rc1 beforehand.
// The pin in apps/web/server/companion/companion-visual.ts is NOT edited: its default lines are swapped in the
// generated text only. The download URL is swapped for an unreachable one and the SHA-256 for zeros, so if the local
// RC build were ever missing the Companion would report the helper as failed -- it can never silently fetch and run
// 0.1.2 under the RC's name.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCrlf } from "../../../apps/web/lib/gsi-windows-installer";
import { COMPANION_RUNTIME_PS } from "../../../apps/web/server/companion/companion-scripts";
import { VISUAL_RUNTIME } from "../../../apps/web/server/companion/companion-visual";

export const RC_VISUAL_VERSION = "0.1.3-rc1";
export const RC_MARKER = `# LOCAL RELEASE CANDIDATE -- visual ${RC_VISUAL_VERSION}. Not a release, not pinned anywhere, not deployed.`;
const NEVER_DOWNLOADED = "https://127.0.0.1:9/d2kiro-visual-rc1-is-installed-locally.zip";

export function buildRcRuntime(): string {
  let text = COMPANION_RUNTIME_PS;
  const swaps: [string, string][] = [
    [`$VisualVersion = '${VISUAL_RUNTIME.version}'`, `$VisualVersion = '${RC_VISUAL_VERSION}'`],
    [`$VisualUrl = '${VISUAL_RUNTIME.url}'`, `$VisualUrl = '${NEVER_DOWNLOADED}'`],
    [`$VisualSha = '${VISUAL_RUNTIME.sha256}'`, `$VisualSha = '${"0".repeat(64)}'`],
  ];
  for (const [from, to] of swaps) {
    if (text.split(from).length !== 2) throw new Error(`RC build: expected exactly one "${from}" in the runtime`);
    text = text.replace(from, to);
  }
  return `${toCrlf([RC_MARKER, text])}\r\n`;
}

if (import.meta.main) {
  const outDir = join(import.meta.dir, "out");
  mkdirSync(outDir, { recursive: true });
  const target = join(outDir, "companion.ps1");
  // Same bytes the installer writes: UTF-8 with BOM (Windows PowerShell 5.1), CRLF.
  writeFileSync(target, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(buildRcRuntime(), "utf8")]));
  console.log(target);
}
