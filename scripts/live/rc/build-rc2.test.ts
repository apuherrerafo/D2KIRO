import { describe, expect, test } from "bun:test";
import { VISUAL_RUNTIME } from "../../../apps/web/server/companion/companion-visual";
import { buildRcRuntime, RC_MARKER, RC_VISUAL_VERSION } from "./build-rc2";

describe("local RC runtime (visual 0.1.3-rc2)", () => {
  const text = buildRcRuntime();

  test("supervises the locally installed RC build and can never fetch 0.1.2 under its name", () => {
    expect(text.startsWith(RC_MARKER)).toBe(true);
    expect(text).toContain(`$VisualVersion = '${RC_VISUAL_VERSION}'`);
    expect(text).not.toContain(VISUAL_RUNTIME.url);
    expect(text).not.toContain(VISUAL_RUNTIME.sha256);
    expect(text).toContain(`$VisualSha = '${"0".repeat(64)}'`);
  });

  test("the production pin itself is untouched (no staging pin change)", () => {
    expect(VISUAL_RUNTIME.version).toBe("0.1.2");
  });

  test("carries this branch's draft-window raw store and on-disk redaction", () => {
    for (const piece of ["gsi-draft-", "Protect-RawLine", "Write-DraftRawLine", "hasXpos"]) expect(text).toContain(piece);
    expect(text.includes("\r\n")).toBe(true);
    expect(/[^\r]\n/.test(text)).toBe(false);
  });
});
