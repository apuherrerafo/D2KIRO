import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateCatalog, type ComponentCatalog } from "./generate";

describe("Component Discovery & Catalog Verification", () => {
  const designDir = join(import.meta.dir, "..");
  const jsonPath = join(designDir, "COMPONENTS.generated.json");
  const llmsPath = join(designDir, "COMPONENTS.llms.txt");

  it("COMPONENTS.generated.json exists and matches freshly derived catalog (no drift / not stale)", async () => {
    const diskContent = readFileSync(jsonPath, "utf8");
    const diskCatalog = JSON.parse(diskContent) as ComponentCatalog;

    const freshCatalog = await generateCatalog({ write: false });

    expect(diskCatalog.schemaVersion).toBe(1);
    expect(diskCatalog.components).toEqual(freshCatalog.components);
    expect(diskCatalog.generatedFrom).toEqual(freshCatalog.generatedFrom);
  });

  it("COMPONENTS.llms.txt exists and contains projections for all components", () => {
    const llmsContent = readFileSync(llmsPath, "utf8");
    expect(llmsContent).toContain("## Button");
    expect(llmsContent).toContain("## StatusNotice");
    expect(llmsContent).toContain("import { Button } from \"@/design/components\";");
    expect(llmsContent).toContain("import { StatusNotice } from \"@/design/components\";");
  });

  it("Button entry contains mechanically derived props, states, and JSDoc intent", async () => {
    const catalog = await generateCatalog({ write: false });
    const button = catalog.components.find((c) => c.name === "Button");

    expect(button).toBeDefined();
    if (!button) return;

    expect(button.name).toBe("Button");
    expect(button.importPath).toBe("@/design/components");
    expect(button.purpose).toBe(
      "Triggers an explicit user action with strict visual and accessibility semantics.",
    );
    expect(button.canonicalUsage).toBe(
      "Use primary only for the single dominant decision on a surface; use secondary for alternatives.",
    );
    expect(button.accessibilityNotes.length).toBeGreaterThan(0);
    expect(button.requiredProps).toEqual(["children"]);
    expect(button.variants).toEqual(["primary", "secondary"]);
    expect(button.states).toContain("Busy");
    expect(button.states).toContain("Disabled");
    expect(button.states).toContain("FocusVisible");

    const propNames = button.props.map((p) => p.name);
    expect(propNames).toContain("busy");
    expect(propNames).toContain("children");
    expect(propNames).toContain("disabled");
    expect(propNames).toContain("onClick");
    expect(propNames).toContain("variant");
  });

  it("StatusNotice entry contains mechanically derived props, states, and JSDoc intent", async () => {
    const catalog = await generateCatalog({ write: false });
    const notice = catalog.components.find((c) => c.name === "StatusNotice");

    expect(notice).toBeDefined();
    if (!notice) return;

    expect(notice.name).toBe("StatusNotice");
    expect(notice.importPath).toBe("@/design/components");
    expect(notice.purpose).toBe(
      "Communicates operational or draft state changes without unnecessary container decoration.",
    );
    expect(notice.canonicalUsage).toBe(
      "Use only when state change directly affects the user's immediate decision.",
    );
    expect(notice.accessibilityNotes.length).toBeGreaterThan(0);
    expect(notice.requiredProps).toEqual(["children", "title"]);
    expect(notice.states).toContain("Neutral");
    expect(notice.states).toContain("Warning");
    expect(notice.states).toContain("Error");
    expect(notice.states).toContain("LongContent");

    const propNames = notice.props.map((p) => p.name);
    expect(propNames).toContain("children");
    expect(propNames).toContain("title");
    expect(propNames).toContain("tone");
  });
});
