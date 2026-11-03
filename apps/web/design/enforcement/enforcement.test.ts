import { describe, expect, it } from "bun:test";
import { ESLint } from "eslint";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import designPlugin from "./eslint-plugin.mjs";

describe("Design System ESLint Enforcement", () => {
  const fixturesDir = join(import.meta.dir, "fixtures");

  const eslint = new ESLint({
    overrideConfigFile: true,
    overrideConfig: [
      {
        files: ["**/*.tsx"],
        plugins: {
          "design-system": designPlugin as unknown as import("eslint").ESLint.Plugin,
        },
        languageOptions: {
          parserOptions: {
            ecmaFeatures: {
              jsx: true,
            },
          },
        },
        rules: {
          "design-system/no-raw-hex": "error",
          "design-system/no-arbitrary-tailwind": "error",
          "design-system/no-primitive-token": "error",
          "design-system/no-native-button": "error",
          "design-system/no-duplicate-button": "error",
        },
      },
    ],
  });

  it("identifies all five design system violations in bad fixture with structured guidance", async () => {
    const code = readFileSync(join(fixturesDir, "bad.tsx"), "utf8");
    const results = await eslint.lintText(code, { filePath: join(fixturesDir, "bad.tsx") });
    expect(results.length).toBe(1);

    const messages = results[0].messages;
    const ruleIds = messages.map((m) => m.ruleId).filter(Boolean);

    expect(ruleIds).toContain("design-system/no-raw-hex");
    expect(ruleIds).toContain("design-system/no-arbitrary-tailwind");
    expect(ruleIds).toContain("design-system/no-primitive-token");
    expect(ruleIds).toContain("design-system/no-native-button");
    expect(ruleIds).toContain("design-system/no-duplicate-button");

    for (const msg of messages) {
      expect(msg.message).toContain("PROBLEM:");
      expect(msg.message).toContain("WHY:");
      expect(msg.message).toContain("WHAT TO USE INSTEAD:");
    }
  });

  it("passes on compliant good fixture without any violations", async () => {
    const code = readFileSync(join(fixturesDir, "good.tsx"), "utf8");
    const results = await eslint.lintText(code, { filePath: join(fixturesDir, "good.tsx") });
    expect(results.length).toBe(1);
    expect(results[0].errorCount).toBe(0);
    expect(results[0].messages.length).toBe(0);
  });

  it("avoids false positives on prose comments and string constants", async () => {
    const code = readFileSync(join(fixturesDir, "false-positive.tsx"), "utf8");
    const results = await eslint.lintText(code, { filePath: join(fixturesDir, "false-positive.tsx") });
    expect(results.length).toBe(1);
    expect(results[0].errorCount).toBe(0);
    expect(results[0].messages.length).toBe(0);
  });
});
