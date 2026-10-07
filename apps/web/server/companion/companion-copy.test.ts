import { describe, expect, test } from "bun:test";
import { COMPANION_INSTALL_PS, COMPANION_RUNTIME_PS } from "./companion-scripts";

// Everything the Player reads in a Windows dialog is neutral Spanish (no voseo).
// Case-insensitive so a sentence-initial "Volvé" cannot slip past; accent-less "podes" is voseo too.
const WORDS = "descargá|abrí|abrilo|cerrá|cerralo|probá|volvelo|volvé|vení|agregá|jugá|entrá|usá|elegí|recargá|esperá|reiniciá|instalá|podés|podes|tenés|tenes|pegalo|presioná";
const VOSEO = new RegExp(`(?<![a-záéíóúñ])(${WORDS})(?![a-záéíóúñ])`, "i");

describe("Companion Player-facing copy", () => {
  test("the detector catches capitalized and accent-less voseo", () => {
    expect(VOSEO.exec("Volvé a abrir este instalador.")?.[0]).toBe("Volvé");
    expect(VOSEO.exec("Podes borrar esa carpeta.")?.[0]).toBe("Podes");
    expect(VOSEO.exec("Puedes borrar esa carpeta. Vuelve a abrirlo. Está listo.")).toBeNull();
  });

  test("installer and runtime dialogs contain no voseo", () => {
    expect(VOSEO.exec(COMPANION_INSTALL_PS)?.[0]).toBeUndefined();
    expect(VOSEO.exec(COMPANION_RUNTIME_PS)?.[0]).toBeUndefined();
  });
});
