import { describe, expect, test } from "bun:test";
import { COMPANION_INSTALL_PS, COMPANION_RUNTIME_PS } from "./companion-scripts";

// Everything the Player reads in a Windows dialog is neutral Spanish (no voseo).
const VOSEO = /\b(Descargá|descargá|Abrí|abrí|Abrilo|Cerrá|cerrá|cerralo|probá|volvelo|volvé|agregá|jugá|entrá|usá|Elegí|Recargá|Esperá|Reiniciá|Instalá)\b/;

describe("Companion Player-facing copy", () => {
  test("installer and runtime dialogs contain no voseo", () => {
    expect(VOSEO.exec(COMPANION_INSTALL_PS)?.[0]).toBeUndefined();
    expect(VOSEO.exec(COMPANION_RUNTIME_PS)?.[0]).toBeUndefined();
  });
});
