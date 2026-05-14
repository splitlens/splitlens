import { test, expect } from "@playwright/test";

test.describe("Landing page", () => {
  test("hero renders with the privacy wedge", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Your bank statements/i })).toBeVisible();
    await expect(page.getByText(/Nothing leaves your browser/i)).toBeVisible();
    await expect(page.getByRole("link", { name: /Star on GitHub/i }).first()).toBeVisible();
  });

  test("primary CTA scrolls to the try section", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: /Try it now/i }).click();
    await expect(page.getByRole("heading", { name: /Pre-MVP — coming soon/i })).toBeVisible();
  });

  test("each section is reachable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /Why local-first/i })).toBeVisible();
    await expect(page.getByRole("heading", { name: /What you can do/i })).toBeVisible();
  });
});
