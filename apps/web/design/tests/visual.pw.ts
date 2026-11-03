import { expect, test, type Page } from "@playwright/test";

async function openStory(page: Page, storyId: string) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/iframe.html?id=${storyId}&viewMode=story`);
  const root = page.locator("#storybook-root");
  await expect(root).toBeVisible();
  return root;
}

test.describe("Visual Regression Testing (Curated Baselines)", () => {
  test("Button default primary visual regression", async ({ page }) => {
    const root = await openStory(page, "design-system-button--default");
    await expect(root).toHaveScreenshot("button-default.png", { animations: "disabled" });
  });

  test("Button disabled state visual regression", async ({ page }) => {
    const root = await openStory(page, "design-system-button--disabled");
    await expect(root).toHaveScreenshot("button-disabled.png", { animations: "disabled" });
  });

  test("StatusNotice warning state visual regression", async ({ page }) => {
    const root = await openStory(page, "design-system-statusnotice--warning");
    await expect(root).toHaveScreenshot("statusnotice-warning.png", { animations: "disabled" });
  });
});
