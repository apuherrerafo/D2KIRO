/**
 * NOTE ON ACCESSIBILITY AUTOMATION:
 * Automated checks with Axe and ARIA snapshots verify technical accessibility contracts
 * (accessible name calculation, contrast ratios, valid ARIA roles, keyboard focusability).
 * Automation does NOT constitute complete accessibility certification.
 * Real assistive technology testing (screen readers like NVDA/VoiceOver), cognitive walkthroughs,
 * and human usability validation remain required before declaring user certification.
 */

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openStory(page: Page, storyId: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
  const root = page.locator("#storybook-root");
  await expect(root).toBeVisible();
  return root;
}

test.describe("Button Primitive Accessibility", () => {
  test("Button has accessible name, Tab focus, visible focus indicator, and keyboard activation", async ({
    page,
  }) => {
    await openStory(page, "design-system-button--keyboard-activation");
    const button = page.getByRole("button", { name: "Keyboard Target" });

    // 1. Accessible name model
    await expect(button).toHaveAccessibleName("Keyboard Target");

    // 2. Tab focus & focus-visible
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    const outlineStyle = await button.evaluate(
      (element) => getComputedStyle(element).outlineStyle,
    );
    expect(outlineStyle).not.toBe("none");

    // 3. Keyboard activation via Enter
    await page.keyboard.press("Enter");
    await expect(page.getByText("Activations: 1")).toBeVisible();

    // 4. Keyboard activation via Space
    await page.keyboard.press("Space");
    await expect(page.getByText("Activations: 2")).toBeVisible();
  });

  test("Button enforces native disabled semantics", async ({ page }) => {
    await openStory(page, "design-system-button--disabled");
    const button = page.getByRole("button", { name: "Unavailable Action" });
    await expect(button).toBeDisabled();
  });

  test("Button exposes busy state with aria-busy and disabled semantics without losing accessible name", async ({
    page,
  }) => {
    await openStory(page, "design-system-button--busy");
    const button = page.getByRole("button", { name: "Computing Suggestions..." });
    await expect(button).toHaveAttribute("aria-busy", "true");
    await expect(button).toBeDisabled();
    await expect(button).toHaveAccessibleName("Computing Suggestions...");
  });

  test("Button passes axe automated accessibility audit", async ({ page }) => {
    await openStory(page, "design-system-button--default");
    const axeResults = await new AxeBuilder({ page }).include("#storybook-root").analyze();
    expect(axeResults.violations).toEqual([]);
  });

  test("Button matches targeted ARIA snapshot", async ({ page }) => {
    const root = await openStory(page, "design-system-button--default");
    await expect(root).toMatchAriaSnapshot(`
      - button "Lock Recommendation"
    `);
  });
});

test.describe("StatusNotice Primitive Accessibility", () => {
  test("StatusNotice provides semantic status live region and heading landmarks", async ({
    page,
  }) => {
    const root = await openStory(page, "design-system-statusnotice--warning");
    const statusRegion = page.getByRole("status");
    await expect(statusRegion).toBeVisible();
    await expect(statusRegion).toHaveAttribute("aria-live", "polite");

    const heading = page.getByRole("heading", { name: "Limited Evidence", level: 3 });
    await expect(heading).toBeVisible();

    await expect(root).toMatchAriaSnapshot(`
      - status:
        - heading "Limited Evidence" [level=3]
        - text: Sample size for this hero matchup is low. Review tactical synergy before locking.
    `);
  });

  test("StatusNotice error tone announces as assertive alert", async ({ page }) => {
    await openStory(page, "design-system-statusnotice--error");
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toHaveAttribute("aria-live", "assertive");
  });

  test("StatusNotice passes axe automated accessibility audit for neutral, warning, and error tones", async ({
    page,
  }) => {
    for (const storyId of [
      "design-system-statusnotice--neutral",
      "design-system-statusnotice--warning",
      "design-system-statusnotice--error",
    ]) {
      await openStory(page, storyId);
      const results = await new AxeBuilder({ page }).include("#storybook-root").analyze();
      expect(results.violations).toEqual([]);
    }
  });
});
