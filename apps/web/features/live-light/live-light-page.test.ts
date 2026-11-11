import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

// Fase 4B.2 · guardia de apariencia Legacy. Las pantallas que el Player ve en /live-draft se componen con clases Canonical Light (`ll-*`, `sl-*`, `cx-*`) y
// primitivos del DS. Un nombre semántico de Tailwind del tema oscuro (`text-content-*`, `bg-surface-*`, `border-signal-*`, `text-accent-*`) en una de ellas
// significa que volvió a depender del puente de alcance en vez de la piel canónica. La entrada manual de desarrollo (`LiveManualEntry`) queda fuera a propósito.

const webRoot = resolve(import.meta.dir, "../..");
const MIGRATED = [
  "features/team-coach/components/LiveCaptureStatusBar.tsx",
  "features/team-coach/components/LiveLocalPositionPanel.tsx",
  "features/team-coach/components/LivePartyPresetPanel.tsx",
  "features/team-coach/components/DotaConnectPanel.tsx",
  "features/team-coach/components/LiveDiagnosticsPanel.tsx",
  "features/team-coach/components/LiveDotaView.tsx",
  "features/team-coach/components/LiveTeamCoachView.tsx",
  "features/live-light/components/LivePage.tsx",
  "features/live-light/components/LivePanel.tsx",
  "features/live-light/components/LiveNotice.tsx",
  "features/live-light/components/LiveNavFrame.tsx",
];
const LEGACY_CLASS = /\b(?:text|bg|border|ring|outline)-(?:content|surface|signal|accent)-[a-z]+\b/;
const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const STYLE_CSS = resolve(webRoot, "features/live-light/live-page.css");

describe("/live-draft Canonical Light completo", () => {
  for (const file of MIGRATED) {
    test(`${file} no usa clases Tailwind del tema oscuro`, () => {
      const source = readFileSync(resolve(webRoot, file), "utf8");
      expect(source.match(LEGACY_CLASS)).toBeNull();
    });
  }

  test("la hoja de composición no declara ningún color literal ni propiedad de color nueva", () => {
    const css = readFileSync(STYLE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css.match(RAW_COLOR)).toBeNull();
    const declared = [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1]);
    // El único alias de alcance es `--signal-warning` (apunta a un token Light existente): ningún nombre nuevo.
    expect(declared).toEqual(["--signal-warning"]);
  });

  test("la hoja no declara transiciones ni animaciones: el movimiento lo ponen los primitivos canónicos", () => {
    const css = readFileSync(STYLE_CSS, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(css).not.toMatch(/\btransition\s*:|\banimation\s*:|@keyframes/);
  });

  test("LivePage monta el alcance Light de toda la ruta; la navegación solo lo hace en /live-draft", () => {
    expect(readFileSync(resolve(webRoot, "features/live-light/components/LivePage.tsx"), "utf8")).toContain("<SimulatorLightScope");
    const nav = readFileSync(resolve(webRoot, "components/nav-bar/NavBar.tsx"), "utf8");
    expect(nav).toContain("isLightNavRoute(pathname)");
  });
});
